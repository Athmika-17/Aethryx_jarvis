import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import type {
  AggregationPeriod,
  AnomalyMethod,
  DataMode,
  DatasetConnectorId,
  RegionLocation,
  SavedInvestigation,
} from './src/types/earth.ts';
import {
  addFavoriteRegion,
  clearConversations,
  deleteFavoriteRegion,
  deleteInvestigation,
  getDatabasePath,
  getPreferences,
  initDatabase,
  listConversations,
  listFavoriteRegions,
  listInvestigations,
  saveConversationMessage,
  saveInvestigation,
  updatePreferences,
} from './server/database.ts';
import { askAethryxAssistant, isGeminiConfigured } from './server/geminiService.ts';
import {
  discoverAllDatasets,
  evaluateDatasetCoverageForRegion,
  fetchGibsLayerBuffer,
  getDatasetMetadata,
  retrieveNasaDataset,
  reverseGeocodeCoordinates,
  searchNasaImages,
  searchRegions,
} from './server/nasaConnectors.ts';
import { GIBS_LAYERS } from './server/nasaDatasets.ts';
import { generateCsvReport, generateHtmlReport } from './server/reportGenerator.ts';
import { detectAnomalies, generateForecast, runTrendAnalysis } from './server/statistics.ts';

const PORT = Number(process.env.PORT) || 3000;

export async function createAppServer() {
  initDatabase();
  const app = express();

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // CORS handling: allow same-origin, local loopback, configured APP_URL, and CORS_ORIGIN; never crash Vite assets
  const configuredOrigins = [
    ...(process.env.CORS_ORIGIN || '').split(','),
    process.env.APP_URL || '',
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).origin;
      } catch {
        return s;
      }
    });

  app.use('/api', (req, res, next) => {
    const reqHost = (req.get('x-forwarded-host') || req.get('host') || '').toLowerCase();
    return cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        try {
          const parsed = new URL(origin);
          const originHost = parsed.host.toLowerCase();
          if (
            originHost === reqHost ||
            parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            configuredOrigins.length === 0 ||
            configuredOrigins.includes(parsed.origin)
          ) {
            return callback(null, true);
          }
        } catch {
          // Invalid origin format
        }
        return callback(null, false);
      },
      credentials: true,
    })(req, res, next);
  });

  // Request size limits
  app.use(express.json({ limit: '2mb' }));

  // Simple sliding-window rate limiter on /api/* (120 req/min per IP)
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  app.use('/api', (req, res, next) => {
    const key = req.ip || 'local';
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > 180) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait before sending more requests.' });
    }
    return next();
  });

  // 1. Health & Runtime Diagnostics
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'AETHRYX JARVIS Backend',
      timestamp: new Date().toISOString(),
      geminiConfigured: isGeminiConfigured(),
      earthdataTokenConfigured: Boolean(process.env.EARTHDATA_TOKEN?.trim()),
      databasePath: getDatabasePath(),
      ephemeralStorageNotice:
        'Local SQLite persistence is active. On stateless serverless containers, mount a persistent volume or external database for cross-restart durability.',
    });
  });

  // 2. Datasets & Metadata
  app.get('/api/datasets', async (_req, res) => {
    try {
      const datasets = await discoverAllDatasets();
      res.json({ datasets });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to discover NASA datasets' });
    }
  });

  app.get('/api/datasets/:id/metadata', async (req, res) => {
    try {
      const id = req.params.id as DatasetConnectorId;
      const meta = await getDatasetMetadata(id);
      if (!meta) return res.status(404).json({ error: 'Dataset not found' });
      res.json({ dataset: meta });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Metadata lookup failed' });
    }
  });

  // 3. NASA GIBS Layers & Image Proxy
  app.get('/api/gibs/layers', (_req, res) => {
    res.json({ layers: GIBS_LAYERS });
  });

  const gibsImageCache = new Map<string, { expires: number; buffer: Buffer; contentType: string }>();
  app.get('/api/gibs/image', async (req, res) => {
    try {
      const layerName = String(req.query.layer || 'BlueMarble_ShadedRelief_Bathymetry');
      const spec = GIBS_LAYERS.find((l) => l.layerName === layerName);
      if (!spec) {
        return res.status(400).json({ error: 'Unsupported GIBS layer identifier' });
      }
      const date = req.query.date ? String(req.query.date) : spec.defaultDate;
      const width = Number(req.query.width || 1024);
      const height = Number(req.query.height || 512);
      const cacheKey = `${layerName}|${date}|${width}|${height}`;
      const cached = gibsImageCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(cached.buffer);
      }

      const { buffer, contentType } = await fetchGibsLayerBuffer({
        layerName: spec.layerName,
        date: spec.supportsTime ? date : undefined,
        format: spec.format,
        width,
        height,
        transparent: spec.format === 'image/png',
      });
      gibsImageCache.set(cacheKey, { expires: Date.now() + 3600 * 1000, buffer, contentType });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'NASA GIBS imagery fetch failed' });
    }
  });

  // 4. Worldwide Region Search, Reverse Geocoding & Dataset Coverage Check
  app.get('/api/regions/search', async (req, res) => {
    try {
      const q = String(req.query.q || '');
      const result = await searchRegions(q);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Region search failed' });
    }
  });

  app.get('/api/regions/reverse', async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ error: 'Valid numeric lat and lon query parameters are required.' });
      }
      const region = await reverseGeocodeCoordinates(lat, lon);
      res.json({ region });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Reverse geocoding failed' });
    }
  });

  app.post('/api/datasets/coverage', async (req, res) => {
    try {
      const { region, startDate, endDate, variableId } = req.body as {
        region: RegionLocation;
        startDate: string;
        endDate: string;
        variableId?: string;
      };
      if (!region || !Number.isFinite(region.lat) || !Number.isFinite(region.lon) || !startDate || !endDate) {
        return res.status(400).json({ error: 'Valid region coordinates, startDate, and endDate are required.' });
      }
      const coverage = await evaluateDatasetCoverageForRegion({
        region,
        startDate,
        endDate,
        variableId,
      });
      res.json({ coverage });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Coverage evaluation failed' });
    }
  });

  // 5. Data Retrieval
  app.post('/api/data/retrieve', async (req, res) => {
    try {
      const { datasetId, variableId, region, startDate, endDate, aggregation, mode } = req.body as {
        datasetId: DatasetConnectorId;
        variableId: string;
        region: RegionLocation;
        startDate: string;
        endDate: string;
        aggregation: AggregationPeriod;
        mode: DataMode;
      };
      if (!datasetId || !variableId || !region || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing required retrieval fields (datasetId, variableId, region, startDate, endDate).' });
      }
      const result = await retrieveNasaDataset({
        datasetId,
        variableId,
        region,
        startDate,
        endDate,
        aggregation: aggregation || 'monthly',
        mode: mode || 'live',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Data retrieval failed' });
    }
  });

  // 6. Trend Detective Statistical Engine
  app.post('/api/analysis/trend', (req, res) => {
    try {
      const { retrieved, alpha } = req.body as {
        retrieved: Awaited<ReturnType<typeof retrieveNasaDataset>>;
        alpha?: number;
      };
      if (!retrieved?.points) {
        return res.status(400).json({ error: 'Missing retrieved dataset points for trend analysis.' });
      }
      const trend = runTrendAnalysis({
        points: retrieved.points,
        variableId: retrieved.variable.id,
        variableName: retrieved.variable.name,
        units: retrieved.variable.units,
        datasetName: retrieved.dataset.officialName,
        productId: retrieved.dataset.productId,
        aggregation: retrieved.aggregation,
        mode: retrieved.mode,
        isSimulated: retrieved.isSimulated,
        alpha: typeof alpha === 'number' && alpha > 0 && alpha < 0.5 ? alpha : 0.05,
      });
      res.json(trend);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Trend analysis failed' });
    }
  });

  // 7. Anomaly Detection
  app.post('/api/analysis/anomalies', (req, res) => {
    try {
      const { retrieved, method, threshold } = req.body as {
        retrieved: Awaited<ReturnType<typeof retrieveNasaDataset>>;
        method?: AnomalyMethod;
        threshold?: number;
      };
      if (!retrieved?.points) {
        return res.status(400).json({ error: 'Missing retrieved dataset points for anomaly detection.' });
      }
      const result = detectAnomalies({
        points: retrieved.points,
        units: retrieved.variable.units,
        method: method || 'seasonal-z-score',
        threshold,
        mode: retrieved.mode,
        isSimulated: retrieved.isSimulated,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Anomaly detection failed' });
    }
  });

  // 8. Validated Forecasting
  app.post('/api/analysis/forecast', (req, res) => {
    try {
      const { retrieved, horizonSteps } = req.body as {
        retrieved: Awaited<ReturnType<typeof retrieveNasaDataset>>;
        horizonSteps?: number;
      };
      if (!retrieved?.points) {
        return res.status(400).json({ error: 'Missing retrieved dataset points for forecasting.' });
      }
      const result = generateForecast({
        points: retrieved.points,
        units: retrieved.variable.units,
        aggregation: retrieved.aggregation,
        horizonSteps,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Forecast generation failed' });
    }
  });

  // 9. Gemini AI Assistant
  app.post('/api/assistant/chat', async (req, res) => {
    try {
      const { question, context } = req.body as {
        question: string;
        context?: Parameters<typeof askAethryxAssistant>[0]['context'];
      };
      if (!question || !question.trim()) {
        return res.status(400).json({ error: 'Question cannot be empty.' });
      }
      const existingHistory = listConversations();
      const userMsg = {
        id: `msg-${Date.now()}-u`,
        role: 'user' as const,
        content: question.trim(),
        createdAt: new Date().toISOString(),
        hasActiveContext: Boolean(context?.retrieved?.points?.length),
      };
      saveConversationMessage(userMsg);

      const answer = await askAethryxAssistant({
        question: question.trim(),
        history: existingHistory.map((m) => ({ role: m.role, content: m.content })),
        context,
      });

      const assistantMsg = {
        id: `msg-${Date.now()}-a`,
        role: 'assistant' as const,
        content: answer.reply,
        createdAt: new Date().toISOString(),
        mode: answer.mode,
        citations: answer.citations,
        hasActiveContext: answer.hasActiveContext,
      };
      saveConversationMessage(assistantMsg);

      res.json({ ...answer, message: assistantMsg });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'AI assistant error' });
    }
  });

  app.get('/api/assistant/history', (_req, res) => {
    res.json({ messages: listConversations() });
  });

  app.delete('/api/assistant/history', (_req, res) => {
    clearConversations();
    res.json({ cleared: true });
  });

  // 10. NASA Image Explorer
  app.get('/api/images/search', async (req, res) => {
    try {
      const result = await searchNasaImages({
        q: req.query.q ? String(req.query.q) : undefined,
        yearStart: req.query.yearStart ? String(req.query.yearStart) : undefined,
        yearEnd: req.query.yearEnd ? String(req.query.yearEnd) : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'NASA Image search failed' });
    }
  });

  // 11. Report Exports (CSV & HTML)
  app.post('/api/reports/export', (req, res) => {
    try {
      const { format, retrieved, trend, anomalies, forecast, aiExplanation } = req.body as {
        format: 'csv' | 'html';
        retrieved: Awaited<ReturnType<typeof retrieveNasaDataset>>;
        trend?: ReturnType<typeof runTrendAnalysis> | null;
        anomalies?: ReturnType<typeof detectAnomalies> | null;
        forecast?: ReturnType<typeof generateForecast> | null;
        aiExplanation?: string;
      };
      if (!retrieved?.points) {
        return res.status(400).json({ error: 'Cannot export report without retrieved dataset results.' });
      }
      const slug = `${retrieved.region.name}-${retrieved.variable.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (format === 'csv') {
        const csv = generateCsvReport({ retrieved, trend, anomalies });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="aethryx-${slug}.csv"`);
        return res.send(csv);
      }
      const html = generateHtmlReport({ retrieved, trend, anomalies, forecast, aiExplanation });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="aethryx-${slug}.html"`);
      return res.send(html);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Report generation failed' });
    }
  });

  // 12. Persistent History, Favorites & Preferences
  app.get('/api/history', (_req, res) => {
    res.json({ investigations: listInvestigations() });
  });

  app.post('/api/history', (req, res) => {
    try {
      const body = req.body as SavedInvestigation;
      if (!body?.id || !body?.region || !body?.datasetId) {
        return res.status(400).json({ error: 'Invalid investigation payload' });
      }
      const saved = saveInvestigation(body);
      res.status(201).json({ investigation: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save investigation' });
    }
  });

  app.delete('/api/history/:id', (req, res) => {
    const deleted = deleteInvestigation(req.params.id);
    res.json({ deleted });
  });

  app.get('/api/favorites', (_req, res) => {
    res.json({ favorites: listFavoriteRegions() });
  });

  app.post('/api/favorites', (req, res) => {
    try {
      const region = req.body as RegionLocation;
      if (!region?.name || !Number.isFinite(region.lat) || !Number.isFinite(region.lon)) {
        return res.status(400).json({ error: 'Valid region name, lat, and lon required' });
      }
      const added = addFavoriteRegion(region);
      res.status(201).json({ favorite: added });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save favorite region' });
    }
  });

  app.delete('/api/favorites/:id', (req, res) => {
    const deleted = deleteFavoriteRegion(req.params.id);
    res.json({ deleted });
  });

  app.get('/api/preferences', (_req, res) => {
    res.json({ preferences: getPreferences() });
  });

  app.put('/api/preferences', (req, res) => {
    const preferences = updatePreferences(req.body ?? {});
    res.json({ preferences });
  });

  // Serve frontend (Vite in dev, dist in production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

// Only bind port when executed directly (allows importing createAppServer in tests)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve('server.ts');
if (isMain) {
  createAppServer().then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`AETHRYX JARVIS server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
