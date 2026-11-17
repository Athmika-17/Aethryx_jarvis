import { GoogleGenAI } from '@google/genai';
import type {
  AnomalyDetectionResult,
  ForecastResult,
  RegionLocation,
  RetrievedDatasetResult,
  TrendAnalysisResult,
} from '../src/types/earth.ts';

export interface AssistantComparisonItem {
  region: RegionLocation;
  retrieved: RetrievedDatasetResult;
  trend: TrendAnalysisResult;
}

export interface AssistantContextPayload {
  retrieved?: RetrievedDatasetResult | null;
  trend?: TrendAnalysisResult | null;
  anomalies?: AnomalyDetectionResult | null;
  forecast?: ForecastResult | null;
  comparisons?: AssistantComparisonItem[];
}

export interface AssistantChatResponse {
  reply: string;
  mode: 'evidence-based' | 'general-conversation';
  citations: string[];
  hasActiveContext: boolean;
  geminiConfigured: boolean;
  error?: string;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
}

function formatContextForPrompt(ctx?: AssistantContextPayload | null): {
  summaryText: string;
  citations: string[];
  hasData: boolean;
} {
  if (!ctx?.retrieved || ctx.retrieved.points.length === 0) {
    return {
      summaryText: 'ACTIVE INVESTIGATION CONTEXT: NONE. No regional dataset time-series is currently loaded.',
      citations: [],
      hasData: false,
    };
  }

  const r = ctx.retrieved;
  const citations = [
    `${r.dataset.officialName} (${r.dataset.productId}, v${r.productVersion ?? r.dataset.productVersion}) — ${r.endpointUrl || r.dataset.officialSourceUrl}`,
  ];
  const samplingText = r.spatialSampling
    ? `${r.spatialSampling.method} (${r.spatialSampling.weightingMethod}, ${r.spatialSampling.sampleCount} sample point${r.spatialSampling.sampleCount > 1 ? 's' : ''})`
    : 'point';
  const lines: string[] = [
    `ACTIVE INVESTIGATION CONTEXT (${r.isSimulated ? 'DEMO / SIMULATED DATA — NOT LIVE NASA TELEMETRY' : 'LIVE RETRIEVED NASA DATA'}):`,
    `- Region: ${r.region.displayName} (Lat ${r.region.lat}°, Lon ${r.region.lon}°, Domain: ${r.region.isOcean ? 'Marine / Ocean' : 'Land / Terrestrial'})`,
    r.region.bbox ? `- Bounding Box: [${r.region.bbox.map((n) => n.toFixed(3)).join(', ')}]` : '',
    r.region.polygon?.length ? `- Custom Polygon Vertices: ${r.region.polygon.length}` : '',
    `- Spatial Sampling & Averaging: ${samplingText}`,
    `- Dataset: ${r.dataset.officialName} [${r.dataset.productId}, version ${r.productVersion ?? r.dataset.productVersion}] (${r.dataset.nasaSource})`,
    r.endpointUrl ? `- Source Endpoint Invoked: ${r.endpointUrl}` : '',
    `- Variable: ${r.variable.name} (${r.variable.id}), Units: ${r.variable.units}`,
    `- Aggregation: ${r.aggregation}`,
    `- Actual Period: ${r.actualAvailablePeriod?.startDate ?? 'N/A'} to ${r.actualAvailablePeriod?.endDate ?? 'N/A'}`,
    `- Retrieval Timestamp: ${r.retrievalTimestamp}`,
    `- Valid Observations: ${r.validObservations}, Missing Observations: ${r.missingObservations}`,
    `- Summary Stats: Mean=${r.summary.mean} ${r.variable.units}, Median=${r.summary.median}, Min=${r.summary.min}, Max=${r.summary.max}, StdDev=${r.summary.stdDev}, Latest (${r.summary.latestDate})=${r.summary.latestValue}`,
  ].filter(Boolean);

  if (ctx.trend) {
    const t = ctx.trend;
    lines.push(
      `TREND ANALYSIS (alpha = ${t.alpha}, seasonalAdjusted = ${t.seasonalAdjusted}):`,
      `- Classification: ${t.classification}`,
      `- OLS Linear Regression: slope=${t.linearRegression.slopePerYear} ${t.units}/yr (95% CI: [${t.linearRegression.ci95LowerPerYear}, ${t.linearRegression.ci95UpperPerYear}]), R²=${t.linearRegression.rSquared}, t=${t.linearRegression.tStatistic}, p=${t.linearRegression.pValue}`,
      `- Mann-Kendall (${t.mannKendall.method}): S=${t.mannKendall.sStatistic}, Z=${t.mannKendall.zStatistic}, tau=${t.mannKendall.tau}, p=${t.mannKendall.pValue}, significant=${t.mannKendall.significant}`,
      `- Sen's Slope: ${t.sensSlope.slopePerYear} ${t.units}/yr (95% CI: [${t.sensSlope.ci95LowerPerYear}, ${t.sensSlope.ci95UpperPerYear}])`,
      `- Lag-1 Autocorrelation: ${t.mannKendall.lag1Autocorrelation} ${t.mannKendall.autocorrelationNote ?? ''}`,
      `- Limitations: ${t.diagnostics.limitations.join(' | ')}`,
    );
    if (t.seasonalBreakdown?.quarters?.length) {
      const qSummary = t.seasonalBreakdown.quarters
        .filter((q) => q.validObs > 0)
        .map(
          (q) =>
            `${q.season}: mean=${q.mean} ${t.units}, min=${q.min}, max=${q.max}, Sen's slope=${q.slopePerYear ?? 'N/A'}/yr`,
        )
        .join(' | ');
      if (qSummary) {
        lines.push(`- Seasonal Breakdown: ${qSummary}`);
      }
    }
  }

  if (ctx.anomalies) {
    const a = ctx.anomalies;
    const topAnom = a.anomalies
      .slice(0, 5)
      .map((x) => `${x.date}: observed ${x.observed} vs baseline ${x.expectedBaseline} (z=${x.zScore ?? 'N/A'}, ${x.severity})`)
      .join('; ');
    lines.push(
      `ANOMALY DETECTION (method=${a.method}, threshold=${a.threshold}):`,
      `- Flagged Anomalies: ${a.anomalyCount} of ${a.totalValidObservations} observations (${a.positiveCount} positive, ${a.negativeCount} negative)`,
      `- Top Anomalies: ${topAnom || 'None flagged'}`,
    );
  }

  if (ctx.forecast) {
    const f = ctx.forecast;
    lines.push(
      `FORECASTING (${f.available ? 'Available — ESTIMATE ONLY' : 'Unavailable'}):`,
      f.available
        ? `- Model: ${f.modelName}, Horizon: ${f.horizonLabel}, Holdout MAE=${f.validationMetrics?.mae}, RMSE=${f.validationMetrics?.rmse}`
        : `- Reason Unavailable: ${f.reasonUnavailable}`,
    );
  }

  if (ctx.comparisons && ctx.comparisons.length > 0) {
    lines.push('REGIONAL COMPARISON REGIONS OVERLAID ON CHART:');
    for (const c of ctx.comparisons) {
      lines.push(
        `- Compare Region "${c.region.displayName}" (${c.region.lat}°, ${c.region.lon}°): valid=${c.retrieved.validObservations}, mean=${c.retrieved.summary.mean} ${c.retrieved.variable.units}, Sen's slope=${c.trend.sensSlope.slopePerYear} ${c.trend.units}/yr, MK p=${c.trend.mannKendall.pValue} (${c.trend.classification})`,
      );
    }
  }

  return { summaryText: lines.join('\n'), citations, hasData: true };
}

export async function askAethryxAssistant(params: {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: AssistantContextPayload | null;
}): Promise<AssistantChatResponse> {
  const { summaryText, citations, hasData } = formatContextForPrompt(params.context);
  const qLower = params.question.toLowerCase();
  const isScienceQuery =
    /trend|rain|precip|temp|ndvi|vegetat|soil|humid|wind|ozone|mann|kendall|sen|regress|anomal|forecast|nasa|merra|imerg|modis|airs|omi|gldas|power|graph|chart|data|statist|p-value|region|investigat|latitude|longitude|ocean|forest|desert|season|compar/.test(
      qLower,
    );

  const ai = getGeminiClient();
  if (!ai) {
    // Honest fallback when GEMINI_API_KEY is missing in environment
    if (isScienceQuery && !hasData) {
      return {
        reply:
          'I am AETHRYX JARVIS, your Earth Intelligence Assistant. Currently, no regional NASA dataset analysis is loaded in your workspace, and the server GEMINI_API_KEY is not configured. Please run an analysis in Data Laboratory or Trend Detective first, and ensure GEMINI_API_KEY is set in Settings > Secrets so I can interpret your retrieved observations.',
        mode: 'evidence-based',
        citations: [],
        hasActiveContext: false,
        geminiConfigured: false,
        error: 'GEMINI_API_KEY is not configured on the server.',
      };
    }

    if (hasData && params.context?.retrieved) {
      const r = params.context.retrieved;
      const t = params.context.trend;
      const a = params.context.anomalies;
      const comps = params.context.comparisons;
      const seasonalText = t?.seasonalBreakdown?.quarters?.length
        ? `Seasonal averages: ${t.seasonalBreakdown.quarters
            .filter((q) => q.validObs > 0)
            .map((q) => `${q.season}=${q.mean} ${t.units}`)
            .join(', ')}.`
        : '';
      const anomText =
        a && a.anomalyCount > 0
          ? `Anomalies (${a.method}): ${a.anomalyCount} flagged (top: ${a.anomalies[0].date} at ${a.anomalies[0].observed} ${a.units}).`
          : '';
      const compText =
        comps && comps.length > 0
          ? `Comparison vs ${comps.map((c) => `${c.region.name} (mean=${c.retrieved.summary.mean} ${c.trend.units}, slope=${c.trend.sensSlope.slopePerYear}/yr, p=${c.trend.mannKendall.pValue})`).join('; ')}.`
          : '';
      const fallbackSummary = [
        `Evidence-based summary (deterministic fallback — GEMINI_API_KEY not configured on server):`,
        `For ${r.region.displayName}, ${r.dataset.officialName} (${r.dataset.productId}, v${r.productVersion ?? r.dataset.productVersion}) provides ${r.validObservations} valid and ${r.missingObservations} missing observations for ${r.variable.name} (${r.variable.units}, mean=${r.summary.mean}, range ${r.summary.min}–${r.summary.max}) from ${r.actualAvailablePeriod?.startDate} to ${r.actualAvailablePeriod?.endDate} via ${r.spatialSampling?.weightingMethod ?? 'point'} sampling.`,
        t
          ? `Trend classification: ${t.classification} (Mann-Kendall p = ${t.mannKendall.pValue}, Sen's slope = ${t.sensSlope.slopePerYear} ${t.units}/yr, OLS R² = ${t.linearRegression.rSquared}).`
          : '',
        seasonalText,
        anomText,
        compText,
        r.isSimulated
          ? 'Note: These values are from DEMO / SIMULATED mode and do not represent live NASA satellite measurements.'
          : `Source: Live retrieved NASA observations (${r.endpointUrl || r.dataset.officialSourceUrl}). Observed trends indicate historical statistical patterns, not physical causation.`,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        reply: fallbackSummary,
        mode: 'evidence-based',
        citations,
        hasActiveContext: true,
        geminiConfigured: false,
        error: 'GEMINI_API_KEY is not configured on the server; returned deterministic statistical summary.',
      };
    }

    return {
      reply:
        'AETHRYX JARVIS AI synthesis requires GEMINI_API_KEY to be configured on the server (Settings > Secrets). You can still run live NASA data retrieval, statistical trend detection, anomaly monitoring, and report exports.',
      mode: 'general-conversation',
      citations: [],
      hasActiveContext: false,
      geminiConfigured: false,
      error: 'GEMINI_API_KEY is not configured on the server.',
    };
  }

  const systemInstruction = `You are "AETHRYX JARVIS — Your Voice. Earth's Intelligence.", the scientific Earth Intelligence Assistant for a NASA Space Apps Challenge 2026 platform ("Be An Earth System Trend Detective!").

STRICT SCIENTIFIC & INTEGRITY RULES:
1. Ground every quantitative claim strictly in the ACTIVE INVESTIGATION CONTEXT provided below. NEVER invent, guess, or hallucinate satellite measurements, p-values, slopes, or percentages that are not present in the context.
2. If ACTIVE INVESTIGATION CONTEXT is NONE and the user asks about measurements, trends, graphs, or current conditions in any geographical region, explicitly state that you do not currently have active regional measurements loaded in the workspace, and instruct them to select any region globally and run an analysis in Data Laboratory or Trend Detective.
3. Always cite the retrieved dataset name, verified product ID, NASA source center, and whether the data is LIVE or DEMO / SIMULATED.
4. Clearly separate observed facts (e.g., Sen's slope, Mann-Kendall p-value, R², missing count) from physical interpretation (e.g., possible monsoon variability, land-cover dynamics).
5. Explicitly mention missing observations, sample size limits, autocorrelation warnings, or forecast uncertainty when relevant.
6. Never claim that correlation or a statistical trend establishes causation. Never treat a non-significant p-value as proof that zero environmental change exists.
7. Keep responses clear, structured, accessible to students and researchers, and concise enough for voice playback when spoken aloud (avoid excessive markdown clutter when answering straightforward voice queries).

${summaryText}`;

  const recentTurns = params.history
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'User' : 'AETHRYX JARVIS'}: ${m.content}`)
    .join('\n');

  const prompt = recentTurns
    ? `Previous conversation:\n${recentTurns}\n\nCurrent user question: ${params.question}`
    : params.question;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
      },
    });

    const text = (response.text ?? '').trim();
    return {
      reply:
        text ||
        'I received an empty response from the Gemini model. Please rephrase your Earth science question.',
      mode: hasData || isScienceQuery ? 'evidence-based' : 'general-conversation',
      citations: hasData ? citations : [],
      hasActiveContext: hasData,
      geminiConfigured: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gemini API call failed';
    return {
      reply: `Unable to reach the Gemini AI service (${msg}). Please verify GEMINI_API_KEY in Settings > Secrets.`,
      mode: isScienceQuery ? 'evidence-based' : 'general-conversation',
      citations,
      hasActiveContext: hasData,
      geminiConfigured: true,
      error: msg,
    };
  }
}
