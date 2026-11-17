import type {
  AggregationPeriod,
  AnomalyDetectionResult,
  AnomalyMethod,
  AssistantMessage,
  DataMode,
  DatasetConnectorId,
  DatasetCoverageStatus,
  DatasetMetadata,
  ForecastResult,
  GibsLayerSpec,
  NasaImageItem,
  RegionLocation,
  RetrievedDatasetResult,
  SavedInvestigation,
  TrendAnalysisResult,
} from '../types/earth';

export interface HealthInfo {
  status: string;
  service: string;
  timestamp: string;
  geminiConfigured: boolean;
  earthdataTokenConfigured: boolean;
  databasePath: string;
  ephemeralStorageNotice: string;
}

export interface UserPreferences {
  defaultMode: DataMode;
  alpha: number;
  voiceName: string;
  autoSpeak: boolean;
  wakeWordEnabled: boolean;
  defaultRegionName: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string })?.error || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(errMsg);
  }
  return data as T;
}

export const api = {
  getHealth: () => requestJson<HealthInfo>('/api/health'),
  getDatasets: () => requestJson<{ datasets: DatasetMetadata[] }>('/api/datasets'),
  getGibsLayers: () => requestJson<{ layers: GibsLayerSpec[] }>('/api/gibs/layers'),
  searchRegions: (q: string) =>
    requestJson<{ regions: RegionLocation[]; ambiguous: boolean; error?: string }>(
      `/api/regions/search?q=${encodeURIComponent(q)}`,
    ),
  reverseGeocode: (lat: number, lon: number) =>
    requestJson<{ region: RegionLocation }>(
      `/api/regions/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
    ),
  checkDatasetCoverage: (body: {
    region: RegionLocation;
    startDate: string;
    endDate: string;
    variableId?: string;
  }) =>
    requestJson<{ coverage: DatasetCoverageStatus[] }>('/api/datasets/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  retrieveData: (body: {
    datasetId: DatasetConnectorId;
    variableId: string;
    region: RegionLocation;
    startDate: string;
    endDate: string;
    aggregation: AggregationPeriod;
    mode: DataMode;
  }) =>
    requestJson<RetrievedDatasetResult>('/api/data/retrieve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  analyzeTrend: (retrieved: RetrievedDatasetResult, alpha = 0.05) =>
    requestJson<TrendAnalysisResult>('/api/analysis/trend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrieved, alpha }),
    }),

  detectAnomalies: (retrieved: RetrievedDatasetResult, method: AnomalyMethod, threshold?: number) =>
    requestJson<AnomalyDetectionResult>('/api/analysis/anomalies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrieved, method, threshold }),
    }),

  generateForecast: (retrieved: RetrievedDatasetResult, horizonSteps = 24) =>
    requestJson<ForecastResult>('/api/analysis/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrieved, horizonSteps }),
    }),

  askAssistant: (
    question: string,
    context: {
      retrieved?: RetrievedDatasetResult | null;
      trend?: TrendAnalysisResult | null;
      anomalies?: AnomalyDetectionResult | null;
      forecast?: ForecastResult | null;
      comparisons?: Array<{
        region: RegionLocation;
        retrieved: RetrievedDatasetResult;
        trend: TrendAnalysisResult;
      }>;
    },
  ) =>
    requestJson<{
      reply: string;
      mode: 'evidence-based' | 'general-conversation';
      citations: string[];
      hasActiveContext: boolean;
      geminiConfigured: boolean;
      error?: string;
      message: AssistantMessage;
    }>('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context }),
    }),

  getAssistantHistory: () => requestJson<{ messages: AssistantMessage[] }>('/api/assistant/history'),
  clearAssistantHistory: () =>
    requestJson<{ cleared: boolean }>('/api/assistant/history', { method: 'DELETE' }),

  searchNasaImages: (q: string, yearStart?: string, page = 1) => {
    const params = new URLSearchParams({ q, page: String(page) });
    if (yearStart) params.set('yearStart', yearStart);
    return requestJson<{ items: NasaImageItem[]; totalHits: number }>(`/api/images/search?${params.toString()}`);
  },

  exportReport: async (
    format: 'csv' | 'html',
    payload: {
      retrieved: RetrievedDatasetResult;
      trend?: TrendAnalysisResult | null;
      anomalies?: AnomalyDetectionResult | null;
      forecast?: ForecastResult | null;
      aiExplanation?: string;
    },
  ) => {
    const res = await fetch('/api/reports/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, ...payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(err.error || 'Export failed');
    }
    const blob = await res.blob();
    const slug = `${payload.retrieved.region.name}-${payload.retrieved.variable.id}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aethryx-${slug}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getHistory: () => requestJson<{ investigations: SavedInvestigation[] }>('/api/history'),
  saveInvestigation: (inv: SavedInvestigation) =>
    requestJson<{ investigation: SavedInvestigation }>('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv),
    }),
  deleteInvestigation: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getFavorites: () => requestJson<{ favorites: RegionLocation[] }>('/api/favorites'),
  addFavorite: (region: RegionLocation) =>
    requestJson<{ favorite: RegionLocation }>('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(region),
    }),
  deleteFavorite: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getPreferences: () => requestJson<{ preferences: UserPreferences }>('/api/preferences'),
  updatePreferences: (prefs: Partial<UserPreferences>) =>
    requestJson<{ preferences: UserPreferences }>('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }),
};
