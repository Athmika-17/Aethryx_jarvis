export type DatasetConnectorId =
  | 'nasa-power'
  | 'merra2'
  | 'gpm-imerg'
  | 'modis'
  | 'airs'
  | 'omi'
  | 'gldas';

export type DataMode = 'live' | 'demo';

export type AggregationPeriod = 'daily' | 'monthly' | 'annual';

export type AnomalyMethod = 'seasonal-z-score' | 'z-score' | 'iqr' | 'moving-average';

export type ConnectorHealthState = 'operational' | 'auth-required' | 'degraded' | 'unavailable';

export interface DatasetVariableSpec {
  id: string;
  name: string;
  shortLabel: string;
  units: string;
  description: string;
  category: 'temperature' | 'precipitation' | 'vegetation' | 'humidity' | 'wind' | 'land' | 'atmosphere';
  gibsLayer?: string;
  gibsLegendUrl?: string;
  powerParam?: string;
  supportsDaily: boolean;
  supportsMonthly: boolean;
  landOnly?: boolean;
  temporalStartOverride?: string;
}

export interface CmrSampleGranule {
  title: string;
  timeStart: string;
  downloadUrl?: string;
}

export interface DatasetMetadata {
  id: DatasetConnectorId;
  officialName: string;
  productId: string;
  productVersion: string;
  cmrShortName: string;
  cmrConceptId?: string;
  apiEndpoint: string;
  nasaSource: string;
  spatialResolution: string;
  temporalResolution: string;
  historicalCoverageStart: string;
  historicalCoverageEnd: string;
  latBounds: [number, number]; // [minLat, maxLat]
  landOnly: boolean;
  officialSourceUrl: string;
  authRequired: boolean;
  authInstructions: string;
  processingInfo: string;
  missingDataConvention: string;
  variables: DatasetVariableSpec[];
  status: ConnectorHealthState;
  statusMessage: string;
  lastCheckedAt: string;
  cmrGranuleCount?: number;
  cmrSampleGranules?: CmrSampleGranule[];
}

export interface RegionLocation {
  id?: string;
  name: string;
  displayName: string;
  country: string;
  featureType?: string;
  lat: number;
  lon: number;
  bbox?: [number, number, number, number]; // [west, south, east, north]
  polygon?: Array<[number, number]>; // Array of [lon, lat] vertices
  isOcean?: boolean;
  isFavorite?: boolean;
}

export interface DatasetCoverageStatus {
  datasetId: DatasetConnectorId;
  officialName: string;
  productId: string;
  productVersion?: string;
  spatialCovered: boolean;
  temporalCovered: boolean;
  surfaceApplicable: boolean;
  availableForRegion: boolean;
  authRequired: boolean;
  canRetrieveNow: boolean;
  granulesDiscovered?: number;
  sampleGranules?: CmrSampleGranule[];
  reason: string;
  suggestedAlternatives: Array<{
    datasetId: DatasetConnectorId;
    officialName: string;
    variableId: string;
  }>;
}

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD or YYYY-MM
  timestamp: number;
  value: number | null;
  rawValue: number | null;
  unit: string;
  isMissing: boolean;
  seasonalBaseline?: number | null;
  deseasonalizedValue?: number | null;
  regressionFit?: number | null;
  ciLower?: number | null;
  ciUpper?: number | null;
}

export interface SpatialSamplePoint {
  lat: number;
  lon: number;
  weight?: number;
  meanValue?: number | null;
  validCount?: number;
}

export interface RetrievedDatasetResult {
  region: RegionLocation;
  dataset: DatasetMetadata;
  variable: DatasetVariableSpec;
  requestedPeriod: { startDate: string; endDate: string };
  actualAvailablePeriod: { startDate: string; endDate: string } | null;
  aggregation: AggregationPeriod;
  mode: DataMode;
  isSimulated: boolean;
  sourceAttribution: string;
  endpointUrl?: string;
  productVersion?: string;
  processingMethod?: string;
  retrievalTimestamp: string;
  validObservations: number;
  missingObservations: number;
  retrievalStatus: 'success' | 'auth-required' | 'unavailable';
  errorReason?: string;
  authSetupHint?: string;
  spatialSampling?: {
    method: 'point' | 'regional-bbox-mean' | 'polygon-mean';
    weightingMethod: 'single-point' | 'cosine-latitude-area-weighted';
    sampleCount: number;
    sampledCoordinates: SpatialSamplePoint[];
  };
  coverageStatus?: DatasetCoverageStatus;
  points: TimeSeriesPoint[];
  summary: {
    latestValue: number | null;
    latestDate: string | null;
    mean: number | null;
    median: number | null;
    min: number | null;
    max: number | null;
    stdDev: number | null;
  };
}

export type TrendClassification =
  | 'increasing'
  | 'decreasing'
  | 'no-significant-trend'
  | 'insufficient-evidence';

export interface YearOverYearRow {
  year: number;
  mean: number;
  validMonths: number;
  changeFromPrevious: number | null;
  percentChange: number | null;
}

export interface SeasonalMonthStat {
  month: number; // 1..12
  label: string;
  validYears: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  slopePerYear: number | null;
}

export interface SeasonalQuarterStat {
  season: 'DJF' | 'MAM' | 'JJA' | 'SON';
  label: string;
  validObs: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  slopePerYear: number | null;
}

export interface TrendAnalysisResult {
  variableId: string;
  variableName: string;
  units: string;
  datasetName: string;
  productId: string;
  mode: DataMode;
  isSimulated: boolean;
  alpha: number;
  nObservations: number;
  validObservations: number;
  missingObservations: number;
  startDate: string;
  endDate: string;
  durationYears: number;
  linearRegression: {
    slopePerYear: number;
    slopePerStep: number;
    intercept: number;
    rSquared: number;
    standardErrorPerYear: number;
    tStatistic: number;
    pValue: number;
    ci95LowerPerYear: number;
    ci95UpperPerYear: number;
  };
  mannKendall: {
    sStatistic: number;
    varianceS: number;
    zStatistic: number;
    pValue: number;
    tau: number;
    method: 'standard' | 'seasonal';
    significant: boolean;
    lag1Autocorrelation: number;
    autocorrelationNote: string | null;
  };
  sensSlope: {
    slopePerYear: number;
    intercept: number;
    ci95LowerPerYear: number;
    ci95UpperPerYear: number;
  };
  classification: TrendClassification;
  seasonalAdjusted: boolean;
  yearOverYear: YearOverYearRow[];
  seasonalBreakdown?: {
    monthly: SeasonalMonthStat[];
    quarters: SeasonalQuarterStat[];
  };
  diagnostics: {
    outliersDetected: number;
    missingFraction: number;
    assumptions: string[];
    limitations: string[];
    scientificSummary: string;
  };
  series: TimeSeriesPoint[];
}

export interface AnomalyFinding {
  date: string;
  observed: number;
  expectedBaseline: number;
  deviation: number;
  percentDeviation: number | null;
  zScore: number | null;
  severity: 'moderate' | 'notable' | 'extreme';
  method: AnomalyMethod;
  reason: string;
  confidenceNote: string;
}

export interface AnomalyDetectionResult {
  method: AnomalyMethod;
  threshold: number;
  units: string;
  mode: DataMode;
  isSimulated: boolean;
  totalValidObservations: number;
  anomalyCount: number;
  positiveCount: number;
  negativeCount: number;
  anomalies: AnomalyFinding[];
  baselineSeries: Array<{
    date: string;
    observed: number | null;
    baseline: number | null;
    upperBand: number | null;
    lowerBand: number | null;
    isAnomaly: boolean;
  }>;
  limitations: string[];
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
  isEstimate: true;
}

export interface ForecastResult {
  available: boolean;
  reasonUnavailable?: string;
  modelName: string;
  horizonSteps: number;
  horizonLabel: string;
  units: string;
  assumptions: string[];
  validationMetrics?: {
    holdoutObservations: number;
    mae: number;
    rmse: number;
    mape: number | null;
    skillNote: string;
  };
  points: ForecastPoint[];
  disclaimer: string;
}

export interface SavedInvestigation {
  id: string;
  title: string;
  createdAt: string;
  region: RegionLocation;
  datasetId: DatasetConnectorId;
  datasetName: string;
  productId: string;
  variableId: string;
  variableName: string;
  units: string;
  aggregation: AggregationPeriod;
  mode: DataMode;
  isSimulated: boolean;
  startDate: string;
  endDate: string;
  trendClassification?: TrendClassification;
  slopePerYear?: number;
  mannKendallP?: number;
  anomalyCount?: number;
  payloadJson?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mode?: 'evidence-based' | 'general-conversation';
  citations?: string[];
  hasActiveContext?: boolean;
}

export interface NasaImageItem {
  nasaId: string;
  title: string;
  description: string;
  dateCreated: string;
  center: string;
  photographer?: string;
  keywords: string[];
  previewUrl: string;
  sourceUrl: string;
}

export interface GibsLayerSpec {
  id: string;
  layerName: string;
  title: string;
  category: 'base' | 'temperature' | 'precipitation' | 'vegetation' | 'humidity' | 'wind' | 'atmosphere';
  nasaSource: string;
  units: string;
  temporalResolution: string;
  defaultDate: string;
  supportsTime: boolean;
  latBounds: [number, number];
  landOnly?: boolean;
  format: 'image/jpeg' | 'image/png';
  legendStops: Array<{ label: string; color: string }>;
  description: string;
}
