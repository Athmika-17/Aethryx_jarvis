import type {
  AggregationPeriod,
  CmrSampleGranule,
  ConnectorHealthState,
  DataMode,
  DatasetConnectorId,
  DatasetCoverageStatus,
  DatasetMetadata,
  DatasetVariableSpec,
  NasaImageItem,
  RegionLocation,
  RetrievedDatasetResult,
  SpatialSamplePoint,
  TimeSeriesPoint,
} from '../src/types/earth.ts';
import { buildDemoTimeSeries } from './demoData.ts';
import { DATASET_CATALOG, PRESET_REGIONS } from './nasaDatasets.ts';
import { computeSummaryStats } from './statistics.ts';

const REQUEST_TIMEOUT_MS = 12000;

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 2,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

interface CmrCacheEntry {
  checkedAt: string;
  conceptId?: string;
  versionId?: string;
  granuleCount: number;
  reachable: boolean;
  title?: string;
  timeStart?: string;
}

const cmrCache = new Map<string, { expires: number; data: CmrCacheEntry }>();

async function checkCmrCollection(shortName: string): Promise<CmrCacheEntry> {
  const cached = cmrCache.get(shortName);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  try {
    const url = `https://cmr.earthdata.nasa.gov/search/collections.json?short_name=${encodeURIComponent(shortName)}&include_granule_counts=true&page_size=10`;
    const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, 1);
    if (!res.ok) {
      return { checkedAt: new Date().toISOString(), granuleCount: 0, reachable: false };
    }
    const json = (await res.json()) as {
      feed?: {
        entry?: Array<{
          id?: string;
          version_id?: string;
          title?: string;
          time_start?: string;
          granule_count?: number;
        }>;
      };
    };
    const entries = json.feed?.entry ?? [];
    const sorted = [...entries].sort(
      (a, b) => Number.parseFloat(b.version_id || '0') - Number.parseFloat(a.version_id || '0'),
    );
    const entry = sorted[0];
    const data: CmrCacheEntry = {
      checkedAt: new Date().toISOString(),
      conceptId: entry?.id,
      versionId: entry?.version_id,
      granuleCount: Number(entry?.granule_count ?? 0),
      reachable: Boolean(entry),
      title: entry?.title,
      timeStart: entry?.time_start,
    };
    cmrCache.set(shortName, { expires: Date.now() + 15 * 60 * 1000, data });
    return data;
  } catch {
    return { checkedAt: new Date().toISOString(), granuleCount: 0, reachable: false };
  }
}

let powerHealthCache: { expires: number; ok: boolean; checkedAt: string; msg: string } | null = null;

async function checkPowerHealth(): Promise<{ ok: boolean; checkedAt: string; msg: string }> {
  if (powerHealthCache && powerHealthCache.expires > Date.now()) {
    return powerHealthCache;
  }
  const checkedAt = new Date().toISOString();
  try {
    // Neutral equatorial Atlantic coordinate probe (0, 0) — zero regional bias
    const probeUrl =
      'https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M&community=AG&longitude=0&latitude=0&start=2023&end=2023&format=JSON';
    const res = await fetchWithRetry(probeUrl, {}, 1);
    const ok = res.ok;
    const result = {
      expires: Date.now() + 10 * 60 * 1000,
      ok,
      checkedAt,
      msg: ok
        ? 'Operational — Live unauthenticated global NASA LaRC POWER API responding.'
        : `Unavailable — NASA POWER returned HTTP ${res.status}.`,
    };
    powerHealthCache = result;
    return result;
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      msg: `Unavailable — ${err instanceof Error ? err.message : 'Connection failed'}`,
    };
  }
}

export async function discoverAllDatasets(): Promise<DatasetMetadata[]> {
  const hasEarthdataToken = Boolean(process.env.EARTHDATA_TOKEN?.trim());
  const powerStatus = await checkPowerHealth();

  const ids = Object.keys(DATASET_CATALOG) as DatasetConnectorId[];
  const results = await Promise.all(
    ids.map(async (id): Promise<DatasetMetadata> => {
      const spec = DATASET_CATALOG[id];
      if (id === 'nasa-power') {
        return {
          ...spec,
          status: powerStatus.ok ? 'operational' : 'unavailable',
          statusMessage: powerStatus.msg,
          lastCheckedAt: powerStatus.checkedAt,
        };
      }

      const cmr = await checkCmrCollection(spec.cmrShortName);
      let status: ConnectorHealthState = 'unavailable';
      let statusMessage = '';

      if (!cmr.reachable) {
        status = 'unavailable';
        statusMessage = 'NASA CMR metadata endpoint unreachable or collection not discovered.';
      } else if (!hasEarthdataToken) {
        status = 'auth-required';
        statusMessage = `CMR metadata verified (${cmr.conceptId ?? spec.cmrShortName}, v${cmr.versionId ?? spec.productVersion}, ${cmr.granuleCount.toLocaleString()} granules). Granule time-series extraction requires server EARTHDATA_TOKEN.`;
      } else {
        status = 'operational';
        statusMessage = `CMR verified (${cmr.conceptId ?? spec.cmrShortName}, ${cmr.granuleCount.toLocaleString()} granules) & Earthdata Bearer token configured.`;
      }

      return {
        ...spec,
        cmrConceptId: cmr.conceptId,
        status,
        statusMessage,
        lastCheckedAt: cmr.checkedAt,
        cmrGranuleCount: cmr.granuleCount,
      };
    }),
  );

  return results;
}

export async function getDatasetMetadata(id: DatasetConnectorId): Promise<DatasetMetadata | null> {
  if (!DATASET_CATALOG[id]) return null;
  const all = await discoverAllDatasets();
  return all.find((d) => d.id === id) ?? null;
}

// --- Coordinate & Geometry Helpers ---

export function parseCoordinateQuery(query: string): { lat: number; lon: number } | null {
  const q = query.trim();
  // Match forms like "40.7128, -74.0060" or "13.93 N 75.57 E" or "13.93°S, 62.2°W"
  const m = q.match(
    /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s;]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i,
  );
  if (!m) return null;
  let lat = Number.parseFloat(m[1]);
  let lon = Number.parseFloat(m[3]);
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) };
}

function pointInPolygon(lon: number, lat: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function cosineLatitudeWeight(lat: number): number {
  return Number(Math.max(0.01, Math.cos((lat * Math.PI) / 180)).toFixed(6));
}

export function computeAreaWeightedMean(samples: Array<{ value: number; lat: number }>): number | null {
  if (samples.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of samples) {
    const w = cosineLatitudeWeight(s.lat);
    weightedSum += s.value * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

function computeSpatialSamplePoints(region: RegionLocation): {
  method: 'point' | 'regional-bbox-mean' | 'polygon-mean';
  weightingMethod: 'single-point' | 'cosine-latitude-area-weighted';
  coords: SpatialSamplePoint[];
} {
  if (region.polygon && region.polygon.length >= 3) {
    const lons = region.polygon.map((p) => p[0]);
    const lats = region.polygon.map((p) => p[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const candidates: SpatialSamplePoint[] = [
      { lat: Number(region.lat.toFixed(4)), lon: Number(region.lon.toFixed(4)), weight: cosineLatitudeWeight(region.lat) },
    ];
    for (const fx of [0.22, 0.5, 0.78]) {
      for (const fy of [0.22, 0.5, 0.78]) {
        if (fx === 0.5 && fy === 0.5) continue;
        const testLon = minLon + fx * (maxLon - minLon);
        const testLat = minLat + fy * (maxLat - minLat);
        if (pointInPolygon(testLon, testLat, region.polygon)) {
          candidates.push({
            lat: Number(testLat.toFixed(4)),
            lon: Number(testLon.toFixed(4)),
            weight: cosineLatitudeWeight(testLat),
          });
        }
      }
    }
    return {
      method: 'polygon-mean',
      weightingMethod: candidates.length > 1 ? 'cosine-latitude-area-weighted' : 'single-point',
      coords: candidates.slice(0, 9),
    };
  }

  if (region.bbox) {
    const [w, s, e, n] = region.bbox;
    const spanLon = Math.abs(e - w);
    const spanLat = Math.abs(n - s);
    if (spanLon >= 0.8 || spanLat >= 0.8) {
      const coords: SpatialSamplePoint[] = [];
      for (const fy of [0.2, 0.5, 0.8]) {
        for (const fx of [0.2, 0.5, 0.8]) {
          const lat = Number((s + fy * (n - s)).toFixed(4));
          const lon = Number((w + fx * (e - w)).toFixed(4));
          coords.push({ lat, lon, weight: cosineLatitudeWeight(lat) });
        }
      }
      return {
        method: 'regional-bbox-mean',
        weightingMethod: 'cosine-latitude-area-weighted',
        coords,
      };
    }
  }

  return {
    method: 'point',
    weightingMethod: 'single-point',
    coords: [{ lat: region.lat, lon: region.lon, weight: cosineLatitudeWeight(region.lat) }],
  };
}

// --- Surface Classification (Land vs Ocean) ---

const oceanCache = new Map<string, boolean>();

export async function detectOceanCoordinate(region: RegionLocation): Promise<boolean> {
  if (typeof region.isOcean === 'boolean') return region.isOcean;
  if (region.featureType && /ocean|sea|bay|strait|marine/i.test(region.featureType)) {
    return true;
  }
  const key = `${region.lat.toFixed(2)},${region.lon.toFixed(2)}`;
  if (oceanCache.has(key)) return oceanCache.get(key)!;

  try {
    // NASA POWER GWETROOT (Root Zone Soil Wetness) returns -999 over oceans and valid [0..1] over land
    const probe = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=GWETROOT&community=AG&longitude=${region.lon.toFixed(4)}&latitude=${region.lat.toFixed(4)}&start=2023&end=2023&format=JSON`;
    const res = await fetchWithRetry(probe, {}, 0);
    if (res.ok) {
      const json = (await res.json()) as {
        properties?: { parameter?: { GWETROOT?: Record<string, number> } };
      };
      const vals = Object.values(json.properties?.parameter?.GWETROOT ?? {});
      const isOcean = vals.length > 0 && vals.every((v) => v <= -900);
      oceanCache.set(key, isOcean);
      return isOcean;
    }
  } catch {
    // Non-fatal fallback
  }
  return false;
}

// --- Independent Dataset Geographical & Temporal Coverage Engine ---

export async function evaluateDatasetCoverageForRegion(params: {
  region: RegionLocation;
  startDate: string;
  endDate: string;
  variableId?: string;
}): Promise<DatasetCoverageStatus[]> {
  const hasToken = Boolean(process.env.EARTHDATA_TOKEN?.trim());
  const isOcean = await detectOceanCoordinate(params.region);
  const reqStart = params.startDate.slice(0, 10);
  const reqEnd = params.endDate.slice(0, 10);

  const ids = Object.keys(DATASET_CATALOG) as DatasetConnectorId[];
  const statuses: DatasetCoverageStatus[] = [];

  for (const id of ids) {
    const ds = DATASET_CATALOG[id];
    const targetVar: DatasetVariableSpec | undefined =
      ds.variables.find((v) => v.id === params.variableId) ?? ds.variables[0];

    const [minLat, maxLat] = ds.latBounds;
    const spatialCovered = params.region.lat >= minLat && params.region.lat <= maxLat;

    const effStart = targetVar?.temporalStartOverride || ds.historicalCoverageStart;
    const temporalCovered = reqEnd >= effStart && reqStart <= new Date().toISOString().slice(0, 10);

    const varLandOnly = targetVar?.landOnly ?? ds.landOnly;
    const surfaceApplicable = !(isOcean && varLandOnly);

    const availableForRegion = spatialCovered && temporalCovered && surfaceApplicable;
    const canRetrieveNow = availableForRegion && (!ds.authRequired || hasToken);

    const reasons: string[] = [];
    if (!spatialCovered) {
      reasons.push(
        `Selected latitude (${params.region.lat.toFixed(2)}°) is outside ${ds.productId} coverage (${minLat}° to ${maxLat}°).`,
      );
    }
    if (!temporalCovered) {
      reasons.push(
        `Requested window (${reqStart} to ${reqEnd}) falls outside ${ds.productId} historical start (${effStart}).`,
      );
    }
    if (!surfaceApplicable) {
      reasons.push(
        `${ds.officialName} (${targetVar?.id}) is land-only and not defined over open ocean coordinates.`,
      );
    }
    if (availableForRegion && ds.authRequired && !hasToken) {
      reasons.push(
        `Region & period are covered (${minLat}° to ${maxLat}°, ${effStart}–present), but direct granule extraction requires EARTHDATA_TOKEN.`,
      );
    }
    if (canRetrieveNow) {
      reasons.push(
        `Full coverage verified (${minLat}° to ${maxLat}°, ${effStart}–present)${isOcean ? ' · Marine/Atmospheric domain' : ' · Terrestrial domain'}.`,
      );
    }

    statuses.push({
      datasetId: id,
      officialName: ds.officialName,
      productId: ds.productId,
      productVersion: ds.productVersion,
      spatialCovered,
      temporalCovered,
      surfaceApplicable,
      availableForRegion,
      authRequired: ds.authRequired,
      canRetrieveNow,
      reason: reasons.join(' '),
      suggestedAlternatives: [],
    });
  }

  // Populate genuine alternatives for any dataset that cannot be retrieved
  const availableNow = statuses.filter((s) => s.canRetrieveNow);
  for (const st of statuses) {
    if (!st.canRetrieveNow) {
      st.suggestedAlternatives = availableNow.map((alt) => ({
        datasetId: alt.datasetId,
        officialName: alt.officialName,
        variableId: DATASET_CATALOG[alt.datasetId].variables[0].id,
      }));
    }
  }

  return statuses;
}

function parseDateYYYYMMDD(dateStr: string): string {
  const clean = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean.replace(/-/g, '');
  if (/^\d{4}-\d{2}$/.test(clean)) return `${clean.replace(/-/g, '')}01`;
  if (/^\d{4}$/.test(clean)) return `${clean}0101`;
  return '20010101';
}

async function fetchSinglePowerPoint(params: {
  paramCode: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  aggregation: AggregationPeriod;
}): Promise<{
  endpoint: string;
  series: Map<string, { value: number | null; isMissing: boolean; timestamp: number }>;
}> {
  const startYear = Math.max(1981, Number.parseInt(params.startDate.slice(0, 4), 10) || 2001);
  const currentYear = new Date().getUTCFullYear();
  const endYear = Math.min(currentYear, Number.parseInt(params.endDate.slice(0, 4), 10) || currentYear);

  const isDaily = params.aggregation === 'daily';
  const startParam = isDaily ? parseDateYYYYMMDD(params.startDate) : String(startYear);
  const endParam = isDaily ? parseDateYYYYMMDD(params.endDate) : String(endYear);
  const clampedStartParam =
    isDaily && endYear - startYear > 5 ? `${endYear - 5}0101` : startParam;

  const endpoint = isDaily
    ? `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${encodeURIComponent(params.paramCode)}&community=AG&longitude=${params.lon.toFixed(4)}&latitude=${params.lat.toFixed(4)}&start=${clampedStartParam}&end=${endParam}&format=JSON`
    : `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=${encodeURIComponent(params.paramCode)}&community=AG&longitude=${params.lon.toFixed(4)}&latitude=${params.lat.toFixed(4)}&start=${startYear}&end=${endYear}&format=JSON`;

  const res = await fetchWithRetry(endpoint, { headers: { Accept: 'application/json' } }, 2);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NASA POWER HTTP ${res.status}: ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as {
    properties?: { parameter?: Record<string, Record<string, number>> };
    header?: { fill_value?: number };
  };
  const rawMap = json.properties?.parameter?.[params.paramCode] ?? {};
  const fillVal = json.header?.fill_value ?? -999;

  const out = new Map<string, { value: number | null; isMissing: boolean; timestamp: number }>();
  const reqStartYM = params.startDate.slice(0, 7);
  const reqEndYM = params.endDate.slice(0, 7);

  for (const k of Object.keys(rawMap).sort()) {
    const rawNum = rawMap[k];
    const isMissing = rawNum === fillVal || rawNum <= -900 || !Number.isFinite(rawNum);

    if (isDaily) {
      const dateStr = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
      const ts = Date.parse(`${dateStr}T00:00:00Z`);
      if (!Number.isNaN(ts)) {
        out.set(dateStr, { value: isMissing ? null : rawNum, isMissing, timestamp: ts });
      }
    } else {
      const yr = k.slice(0, 4);
      const mo = k.slice(4, 6);
      if (params.aggregation === 'annual') {
        if (mo !== '13') continue;
        const dateStr = `${yr}-01`;
        const ts = Date.parse(`${dateStr}-01T00:00:00Z`);
        out.set(dateStr, { value: isMissing ? null : rawNum, isMissing, timestamp: ts });
      } else {
        if (mo === '13') continue;
        const ym = `${yr}-${mo}`;
        if (ym < reqStartYM || ym > reqEndYM) continue;
        const ts = Date.parse(`${ym}-01T00:00:00Z`);
        if (!Number.isNaN(ts)) {
          out.set(ym, { value: isMissing ? null : rawNum, isMissing, timestamp: ts });
        }
      }
    }
  }
  return { endpoint, series: out };
}

export async function retrieveNasaDataset(params: {
  datasetId: DatasetConnectorId;
  variableId: string;
  region: RegionLocation;
  startDate: string;
  endDate: string;
  aggregation: AggregationPeriod;
  mode: DataMode;
}): Promise<RetrievedDatasetResult> {
  const retrievalTimestamp = new Date().toISOString();
  const metadata = await getDatasetMetadata(params.datasetId);
  if (!metadata) {
    throw new Error(`Unknown dataset connector: ${params.datasetId}`);
  }
  const variable =
    metadata.variables.find((v) => v.id === params.variableId) ?? metadata.variables[0];

  if (
    !Number.isFinite(params.region.lat) ||
    !Number.isFinite(params.region.lon) ||
    params.region.lat < -90 ||
    params.region.lat > 90 ||
    params.region.lon < -180 ||
    params.region.lon > 180
  ) {
    throw new Error(
      'Invalid geographic coordinates: latitude must be [-90, 90] and longitude [-180, 180].',
    );
  }

  const coverageAll = await evaluateDatasetCoverageForRegion({
    region: params.region,
    startDate: params.startDate,
    endDate: params.endDate,
    variableId: variable.id,
  });
  const coverageStatus = coverageAll.find((c) => c.datasetId === params.datasetId);
  const sampling = computeSpatialSamplePoints(params.region);

  // DEMO MODE — explicitly labeled simulated dataset, never mixed with live measurements
  if (params.mode === 'demo') {
    const points = buildDemoTimeSeries({
      datasetId: params.datasetId,
      variableId: variable.id,
      units: variable.units,
      region: params.region,
      startDate: params.startDate,
      endDate: params.endDate,
      aggregation: params.aggregation,
    });
    const missingObservations = points.filter((p) => p.isMissing).length;
    const validObservations = points.length - missingObservations;
    const summary = computeSummaryStats(points);
    const coordsWithSummary = sampling.coords.map((c) => ({
      ...c,
      meanValue: summary.mean,
      validCount: validObservations,
    }));
    return {
      region: params.region,
      dataset: metadata,
      variable,
      requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
      actualAvailablePeriod:
        points.length > 0
          ? { startDate: points[0].date, endDate: points[points.length - 1].date }
          : null,
      aggregation: params.aggregation,
      mode: 'demo',
      isSimulated: true,
      sourceAttribution: `DEMO / SIMULATED REFERENCE SERIES (Calibrated for ${metadata.productId} at ${params.region.lat.toFixed(2)}°, ${params.region.lon.toFixed(2)}° · Not live NASA telemetry)`,
      endpointUrl: 'simulated://aethryx-jarvis/demo-reference',
      productVersion: metadata.productVersion,
      processingMethod: `Simulated calibration (${sampling.weightingMethod})`,
      retrievalTimestamp,
      validObservations,
      missingObservations,
      retrievalStatus: 'success',
      spatialSampling: {
        method: sampling.method,
        weightingMethod: sampling.weightingMethod,
        sampleCount: sampling.coords.length,
        sampledCoordinates: coordsWithSummary,
      },
      coverageStatus,
      points,
      summary,
    };
  }

  // Enforce coverage bounds honestly in Live Mode
  if (coverageStatus && !coverageStatus.availableForRegion) {
    return {
      region: params.region,
      dataset: metadata,
      variable,
      requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
      actualAvailablePeriod: null,
      aggregation: params.aggregation,
      mode: 'live',
      isSimulated: false,
      sourceAttribution: `${metadata.officialName} (${metadata.productId})`,
      endpointUrl: metadata.apiEndpoint,
      productVersion: metadata.productVersion,
      processingMethod: metadata.processingInfo,
      retrievalTimestamp,
      validObservations: 0,
      missingObservations: 0,
      retrievalStatus: 'unavailable',
      errorReason: coverageStatus.reason,
      spatialSampling: {
        method: sampling.method,
        weightingMethod: sampling.weightingMethod,
        sampleCount: sampling.coords.length,
        sampledCoordinates: sampling.coords,
      },
      coverageStatus,
      points: [],
      summary: computeSummaryStats([]),
    };
  }

  // LIVE MODE — NASA POWER (Supports point, cosine-latitude area-weighted bbox mean, and polygon mean)
  if (params.datasetId === 'nasa-power') {
    const paramCode = variable.powerParam ?? 'T2M';
    const startYear = Math.max(1981, Number.parseInt(params.startDate.slice(0, 4), 10) || 2001);
    const currentYear = new Date().getUTCFullYear();
    const endYear = Math.min(currentYear, Number.parseInt(params.endDate.slice(0, 4), 10) || currentYear);

    if (startYear > endYear) {
      throw new Error('Start date cannot be after end date.');
    }

    try {
      const pointResponses = await Promise.all(
        sampling.coords.map((coord) =>
          fetchSinglePowerPoint({
            paramCode,
            lat: coord.lat,
            lon: coord.lon,
            startDate: params.startDate,
            endDate: params.endDate,
            aggregation: params.aggregation,
          }),
        ),
      );
      const primaryEndpoint = pointResponses[0]?.endpoint ?? metadata.apiEndpoint;
      const pointMaps = pointResponses.map((r) => r.series);

      const allDates = Array.from(pointMaps[0]?.keys() ?? []).sort();
      const points: TimeSeriesPoint[] = allDates.map((dateStr) => {
        const firstEntry = pointMaps[0].get(dateStr)!;
        const validSamples: Array<{ value: number; lat: number }> = [];
        pointMaps.forEach((m, idx) => {
          const entry = m.get(dateStr);
          if (entry && !entry.isMissing && entry.value !== null) {
            validSamples.push({ value: entry.value, lat: sampling.coords[idx].lat });
          }
        });
        const isMissing = validSamples.length === 0;
        const weightedAvg = isMissing ? null : computeAreaWeightedMean(validSamples);
        const avg = weightedAvg !== null ? Number(weightedAvg.toFixed(4)) : null;
        return {
          date: dateStr,
          timestamp: firstEntry.timestamp,
          value: avg,
          rawValue: avg,
          unit: variable.units,
          isMissing,
        };
      });

      const sampledCoordinatesWithMeans: SpatialSamplePoint[] = sampling.coords.map((coord, idx) => {
        const m = pointMaps[idx];
        const vals: number[] = [];
        if (m) {
          for (const entry of m.values()) {
            if (!entry.isMissing && entry.value !== null && Number.isFinite(entry.value)) {
              vals.push(entry.value);
            }
          }
        }
        const meanValue =
          vals.length > 0 ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null;
        return {
          ...coord,
          meanValue,
          validCount: vals.length,
        };
      });

      const missingObservations = points.filter((p) => p.isMissing).length;
      const validObservations = points.length - missingObservations;

      if (validObservations === 0) {
        return {
          region: params.region,
          dataset: metadata,
          variable,
          requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
          actualAvailablePeriod: null,
          aggregation: params.aggregation,
          mode: 'live',
          isSimulated: false,
          sourceAttribution: `LIVE NASA POWER (${metadata.productId}) · ${metadata.nasaSource}`,
          endpointUrl: primaryEndpoint,
          productVersion: metadata.productVersion,
          processingMethod: `${sampling.weightingMethod} across ${sampling.coords.length} grid point(s)`,
          retrievalTimestamp,
          validObservations: 0,
          missingObservations,
          retrievalStatus: 'unavailable',
          errorReason: `${variable.name} (${variable.id}) returned zero valid observations (all -999 fill values) for ${params.region.displayName}. Land-surface parameters such as GWETROOT are undefined over oceans/inland water. Try T2M, PRECTOTCORR, RH2M, or WS10M.`,
          spatialSampling: {
            method: sampling.method,
            weightingMethod: sampling.weightingMethod,
            sampleCount: sampling.coords.length,
            sampledCoordinates: sampledCoordinatesWithMeans,
          },
          coverageStatus,
          points: [],
          summary: computeSummaryStats([]),
        };
      }

      return {
        region: params.region,
        dataset: metadata,
        variable,
        requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
        actualAvailablePeriod:
          points.length > 0
            ? { startDate: points[0].date, endDate: points[points.length - 1].date }
            : null,
        aggregation: params.aggregation,
        mode: 'live',
        isSimulated: false,
        sourceAttribution: `LIVE NASA POWER (${metadata.productId}) · ${metadata.nasaSource}`,
        endpointUrl: primaryEndpoint,
        productVersion: metadata.productVersion,
        processingMethod: `${sampling.weightingMethod} across ${sampling.coords.length} coordinate(s) · -999 fill values excluded`,
        retrievalTimestamp,
        validObservations,
        missingObservations,
        retrievalStatus: 'success',
        spatialSampling: {
          method: sampling.method,
          weightingMethod: sampling.weightingMethod,
          sampleCount: sampling.coords.length,
          sampledCoordinates: sampledCoordinatesWithMeans,
        },
        coverageStatus,
        points,
        summary: computeSummaryStats(points),
      };
    } catch (err) {
      return {
        region: params.region,
        dataset: metadata,
        variable,
        requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
        actualAvailablePeriod: null,
        aggregation: params.aggregation,
        mode: 'live',
        isSimulated: false,
        sourceAttribution: `${metadata.officialName} (${metadata.productId})`,
        endpointUrl: metadata.apiEndpoint,
        productVersion: metadata.productVersion,
        processingMethod: metadata.processingInfo,
        retrievalTimestamp,
        validObservations: 0,
        missingObservations: 0,
        retrievalStatus: 'unavailable',
        errorReason: err instanceof Error ? err.message : 'NASA POWER retrieval failed',
        coverageStatus,
        points: [],
        summary: computeSummaryStats([]),
      };
    }
  }

  // LIVE MODE — Earthdata-authenticated NASA missions (MERRA-2, GPM IMERG, MODIS, AIRS, OMI, GLDAS)
  const bbox = params.region.bbox ?? [
    params.region.lon - 0.5,
    params.region.lat - 0.5,
    params.region.lon + 0.5,
    params.region.lat + 0.5,
  ];
  const temporal = `${params.startDate.slice(0, 10)}T00:00:00Z,${params.endDate.slice(0, 10)}T23:59:59Z`;
  // Global Level-3 collections without spatial granule indexing (such as AIRS3STM) query cleanly via collection_concept_id
  const cmrGranuleUrl = metadata.cmrConceptId
    ? `https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id=${encodeURIComponent(metadata.cmrConceptId)}&${params.datasetId === 'airs' ? '' : `bounding_box=${bbox.join(',')}&`}temporal=${encodeURIComponent(temporal)}&page_size=5`
    : `https://cmr.earthdata.nasa.gov/search/granules.json?short_name=${encodeURIComponent(metadata.cmrShortName)}&${params.datasetId === 'airs' ? '' : `bounding_box=${bbox.join(',')}&`}temporal=${encodeURIComponent(temporal)}&page_size=5`;

  let granulesFound = 0;
  let sampleGranuleTitle = '';
  const sampleGranules: CmrSampleGranule[] = [];
  try {
    const gRes = await fetchWithRetry(cmrGranuleUrl, { headers: { Accept: 'application/json' } }, 1);
    if (gRes.ok) {
      const gHits = gRes.headers.get('CMR-Hits');
      const gJson = (await gRes.json()) as {
        feed?: {
          entry?: Array<{
            title?: string;
            time_start?: string;
            links?: Array<{ rel?: string; href?: string }>;
          }>;
        };
      };
      const entries = gJson.feed?.entry ?? [];
      granulesFound = gHits ? Number.parseInt(gHits, 10) : entries.length;
      sampleGranuleTitle = entries[0]?.title ?? '';
      for (const e of entries.slice(0, 5)) {
        const dl =
          e.links?.find((l) => l.rel?.includes('data#'))?.href ??
          e.links?.find((l) => l.href?.startsWith('https://'))?.href;
        if (e.title) {
          sampleGranules.push({
            title: e.title,
            timeStart: e.time_start ?? '',
            downloadUrl: dl,
          });
        }
      }
    }
  } catch {
    // Non-fatal CMR check
  }

  const token = process.env.EARTHDATA_TOKEN?.trim();
  if (!token) {
    return {
      region: params.region,
      dataset: {
        ...metadata,
        cmrSampleGranules: sampleGranules,
      },
      variable,
      requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
      actualAvailablePeriod: null,
      aggregation: params.aggregation,
      mode: 'live',
      isSimulated: false,
      sourceAttribution: `${metadata.officialName} (${metadata.productId})`,
      endpointUrl: cmrGranuleUrl,
      productVersion: metadata.productVersion,
      processingMethod: metadata.processingInfo,
      retrievalTimestamp,
      validObservations: 0,
      missingObservations: 0,
      retrievalStatus: 'auth-required',
      errorReason: `Direct ${metadata.officialName} granule extraction requires NASA Earthdata Login authentication (EARTHDATA_TOKEN is not configured on the server). NASA CMR discovered ${granulesFound.toLocaleString()} matching granules for ${params.region.displayName}${sampleGranuleTitle ? ` (e.g., ${sampleGranuleTitle})` : ''}.`,
      authSetupHint:
        'Set EARTHDATA_TOKEN in your server environment (obtained from https://urs.earthdata.nasa.gov/), switch to NASA POWER for live unauthenticated reanalysis/solar observations, or switch to Demo Mode for a clearly labeled simulated example.',
      spatialSampling: {
        method: sampling.method,
        weightingMethod: sampling.weightingMethod,
        sampleCount: sampling.coords.length,
        sampledCoordinates: sampling.coords,
      },
      coverageStatus: coverageStatus
        ? { ...coverageStatus, granulesDiscovered: granulesFound, sampleGranules }
        : undefined,
      points: [],
      summary: computeSummaryStats([]),
    };
  }

  return {
    region: params.region,
    dataset: {
      ...metadata,
      cmrSampleGranules: sampleGranules,
    },
    variable,
    requestedPeriod: { startDate: params.startDate, endDate: params.endDate },
    actualAvailablePeriod: null,
    aggregation: params.aggregation,
    mode: 'live',
    isSimulated: false,
    sourceAttribution: `${metadata.officialName} (${metadata.productId})`,
    endpointUrl: cmrGranuleUrl,
    productVersion: metadata.productVersion,
    processingMethod: metadata.processingInfo,
    retrievalTimestamp,
    validObservations: 0,
    missingObservations: 0,
    retrievalStatus: 'unavailable',
    errorReason: `EARTHDATA_TOKEN is present and CMR discovered ${granulesFound.toLocaleString()} HDF5/NetCDF4 granules for ${metadata.productId} in ${params.region.displayName}. Binary HDF5/NetCDF4 OPeNDAP spatial-temporal subsetting requires an Earthdata Harmony async job or Python xarray/h5py worker; use NASA POWER for instant live point/regional time-series or Demo Mode for simulated multi-mission evaluation.`,
    spatialSampling: {
      method: sampling.method,
      weightingMethod: sampling.weightingMethod,
      sampleCount: sampling.coords.length,
      sampledCoordinates: sampling.coords,
    },
    coverageStatus: coverageStatus
      ? { ...coverageStatus, granulesDiscovered: granulesFound, sampleGranules }
      : undefined,
    points: [],
    summary: computeSummaryStats([]),
  };
}

// --- Worldwide Geocoding & Reverse Geocoding (Zero Hardcoded Fallbacks) ---

export async function reverseGeocodeCoordinates(lat: number, lon: number): Promise<RegionLocation> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Invalid coordinates: latitude must be [-90, 90] and longitude [-180, 180].');
  }
  const cleanLat = Number(lat.toFixed(4));
  const cleanLon = Number(lon.toFixed(4));

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${cleanLat}&lon=${cleanLon}&format=json&accept-language=en&addressdetails=1&zoom=10`;
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': 'AETHRYX-JARVIS-NASA-SpaceApps/1.0', Accept: 'application/json' } },
      1,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        error?: string;
        display_name?: string;
        name?: string;
        type?: string;
        class?: string;
        address?: {
          country?: string;
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          county?: string;
          sea?: string;
          ocean?: string;
        };
      };
      if (!data.error && data.display_name) {
        const isOcean = Boolean(
          data.address?.ocean ||
            data.address?.sea ||
            /ocean|sea|bay|strait/i.test(data.type || ''),
        );
        const name =
          data.name ||
          data.address?.city ||
          data.address?.town ||
          data.address?.village ||
          data.address?.state ||
          data.address?.ocean ||
          data.address?.sea ||
          data.display_name.split(',')[0].trim();
        return {
          id: `rev-${cleanLat}-${cleanLon}`,
          name,
          displayName: data.display_name,
          country: data.address?.country || (isOcean ? 'International Waters' : 'Global'),
          featureType: data.type || data.class || (isOcean ? 'ocean' : 'location'),
          lat: cleanLat,
          lon: cleanLon,
          bbox: [cleanLon - 0.5, cleanLat - 0.5, cleanLon + 0.5, cleanLat + 0.5],
          isOcean,
        };
      }
    }
  } catch {
    // Proceed to ocean detection check
  }

  const probeRegion: RegionLocation = {
    name: `${cleanLat.toFixed(2)}°, ${cleanLon.toFixed(2)}°`,
    displayName: `Coordinates (${cleanLat.toFixed(3)}°, ${cleanLon.toFixed(3)}°)`,
    country: 'Global Selection',
    lat: cleanLat,
    lon: cleanLon,
    bbox: [cleanLon - 0.5, cleanLat - 0.5, cleanLon + 0.5, cleanLat + 0.5],
  };
  const isOcean = await detectOceanCoordinate(probeRegion);
  if (isOcean) {
    return {
      ...probeRegion,
      name: `Open Ocean (${cleanLat.toFixed(2)}°, ${cleanLon.toFixed(2)}°)`,
      displayName: `Open Ocean Marine Coordinate (${cleanLat.toFixed(3)}°, ${cleanLon.toFixed(3)}°)`,
      country: 'International Waters',
      featureType: 'ocean',
      isOcean: true,
    };
  }
  return { ...probeRegion, isOcean: false, featureType: 'coordinates' };
}

export async function searchRegions(query: string): Promise<{
  regions: RegionLocation[];
  ambiguous: boolean;
  error?: string;
}> {
  const q = query.trim();
  if (!q) {
    return { regions: PRESET_REGIONS, ambiguous: false };
  }

  // 1. Direct coordinate parsing (e.g. "40.7128, -74.0060" or "25.0 N, 10.0 E")
  const parsedCoords = parseCoordinateQuery(q);
  if (parsedCoords) {
    const resolved = await reverseGeocodeCoordinates(parsedCoords.lat, parsedCoords.lon);
    return { regions: [resolved], ambiguous: false };
  }

  // 2. Live worldwide Nominatim search (supports countries, states, districts, cities, villages, forests, deserts, mountains, rivers, oceans)
  const lower = q.toLowerCase();
  const presetMatches = PRESET_REGIONS.filter(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      r.displayName.toLowerCase().includes(lower) ||
      r.country.toLowerCase().includes(lower),
  );

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&accept-language=en&addressdetails=1&limit=8`;
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          'User-Agent': 'AETHRYX-JARVIS-NASA-SpaceApps/1.0',
          Accept: 'application/json',
        },
      },
      1,
    );
    if (!res.ok) {
      return presetMatches.length > 0
        ? { regions: presetMatches, ambiguous: presetMatches.length > 1 }
        : {
            regions: [],
            ambiguous: false,
            error: `Geocoding service returned HTTP ${res.status}. Try entering latitude, longitude coordinates (e.g., 40.71, -74.01).`,
          };
    }

    const rows = (await res.json()) as Array<{
      place_id: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
      class?: string;
      type?: string;
      boundingbox?: [string, string, string, string];
      address?: {
        country?: string;
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        ocean?: string;
        sea?: string;
      };
    }>;

    const remote: RegionLocation[] = rows.map((row) => {
      const lat = Number.parseFloat(row.lat);
      const lon = Number.parseFloat(row.lon);
      const bb = row.boundingbox;
      const bbox: [number, number, number, number] = bb
        ? [
            Number.parseFloat(bb[2]),
            Number.parseFloat(bb[0]),
            Number.parseFloat(bb[3]),
            Number.parseFloat(bb[1]),
          ]
        : [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5];
      const isOcean = Boolean(
        row.address?.ocean ||
          row.address?.sea ||
          /ocean|sea|bay|strait/i.test(row.type || ''),
      );
      const shortName =
        row.name ||
        row.address?.city ||
        row.address?.town ||
        row.address?.village ||
        row.address?.ocean ||
        row.display_name.split(',')[0].trim();

      return {
        id: `osm-${row.place_id}`,
        name: shortName,
        displayName: row.display_name,
        country: row.address?.country ?? (isOcean ? 'International Waters' : 'Global'),
        featureType: row.type || row.class || 'region',
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        bbox,
        isOcean,
      };
    });

    const merged: RegionLocation[] = [...remote];
    for (const p of presetMatches) {
      if (!merged.some((m) => Math.abs(m.lat - p.lat) < 0.1 && Math.abs(m.lon - p.lon) < 0.1)) {
        merged.push(p);
      }
    }

    if (merged.length === 0) {
      return {
        regions: [],
        ambiguous: false,
        error: `No geographical location found matching "${q}". Try a broader place name or latitude, longitude coordinates.`,
      };
    }

    return {
      regions: merged.slice(0, 8),
      ambiguous: merged.length > 1,
    };
  } catch {
    if (presetMatches.length > 0) {
      return { regions: presetMatches, ambiguous: presetMatches.length > 1 };
    }
    return {
      regions: [],
      ambiguous: false,
      error: `Unable to resolve "${q}" because the geocoding service is unreachable. Enter latitude, longitude coordinates directly.`,
    };
  }
}

export async function searchNasaImages(params: {
  q?: string;
  yearStart?: string;
  yearEnd?: string;
  page?: number;
}): Promise<{ items: NasaImageItem[]; totalHits: number }> {
  const q = params.q?.trim() || 'Earth observation satellite';
  const page = Math.max(1, params.page ?? 1);
  const url = new URL('https://images-api.nasa.gov/search');
  url.searchParams.set('q', q);
  url.searchParams.set('media_type', 'image');
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', '18');
  if (params.yearStart) url.searchParams.set('year_start', params.yearStart);
  if (params.yearEnd) url.searchParams.set('year_end', params.yearEnd);

  const res = await fetchWithRetry(url.toString(), { headers: { Accept: 'application/json' } }, 2);
  if (!res.ok) {
    throw new Error(`NASA Images API returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    collection?: {
      metadata?: { total_hits?: number };
      items?: Array<{
        href?: string;
        data?: Array<{
          nasa_id: string;
          title: string;
          description?: string;
          date_created?: string;
          center?: string;
          photographer?: string;
          keywords?: string[];
        }>;
        links?: Array<{ href: string; rel?: string }>;
      }>;
    };
  };

  const rawItems = json.collection?.items ?? [];
  const items: NasaImageItem[] = rawItems
    .filter((it) => it.data?.[0] && it.links?.[0]?.href)
    .map((it) => {
      const d = it.data![0];
      const preview = it.links!.find((l) => l.rel === 'preview')?.href ?? it.links![0].href;
      return {
        nasaId: d.nasa_id,
        title: d.title,
        description: d.description ?? 'No description provided by NASA archive.',
        dateCreated: d.date_created ?? '',
        center: d.center ?? 'NASA',
        photographer: d.photographer,
        keywords: d.keywords ?? [],
        previewUrl: preview,
        sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
      };
    });

  return {
    items,
    totalHits: json.collection?.metadata?.total_hits ?? items.length,
  };
}

export async function fetchGibsLayerBuffer(params: {
  layerName: string;
  date?: string;
  format?: 'image/jpeg' | 'image/png';
  width?: number;
  height?: number;
  transparent?: boolean;
}): Promise<{ buffer: Buffer; contentType: string }> {
  const width = Math.min(2048, Math.max(256, params.width ?? 1024));
  const height = Math.min(1024, Math.max(128, params.height ?? 512));
  const format = params.format ?? 'image/jpeg';
  const url = new URL('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi');
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('REQUEST', 'GetMap');
  url.searchParams.set('VERSION', '1.3.0');
  url.searchParams.set('LAYERS', params.layerName);
  url.searchParams.set('STYLES', '');
  url.searchParams.set('FORMAT', format);
  url.searchParams.set('CRS', 'EPSG:4326');
  url.searchParams.set('BBOX', '-90,-180,90,180');
  url.searchParams.set('WIDTH', String(width));
  url.searchParams.set('HEIGHT', String(height));
  if (params.transparent && format === 'image/png') {
    url.searchParams.set('TRANSPARENT', 'TRUE');
  }
  if (params.date) {
    url.searchParams.set('TIME', params.date);
  }

  const res = await fetchWithRetry(url.toString(), {}, 1);
  if (!res.ok) {
    throw new Error(`NASA GIBS WMS returned HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || format;
  if (!contentType.startsWith('image/')) {
    throw new Error(`NASA GIBS returned non-image response (${contentType})`);
  }
  const arr = await res.arrayBuffer();
  return { buffer: Buffer.from(arr), contentType };
}
