import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  FlaskConical,
  Loader2,
  MapPin,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AggregationPeriod,
  DataMode,
  DatasetConnectorId,
  DatasetCoverageStatus,
  DatasetMetadata,
  RegionLocation,
  RetrievedDatasetResult,
} from '../types/earth';
import { api } from '../lib/api';
import { DatasetCoverageChart } from './DatasetCoverageChart';
import { SpatialDistributionMap } from './SpatialDistributionMap';

interface DataLaboratoryViewProps {
  region: RegionLocation;
  onSelectRegion: (r: RegionLocation) => void;
  datasets: DatasetMetadata[];
  selectedDatasetId: DatasetConnectorId;
  selectedVariableId: string;
  startDate: string;
  endDate: string;
  aggregation: AggregationPeriod;
  mode: DataMode;
  onChangeParams: (next: {
    datasetId?: DatasetConnectorId;
    variableId?: string;
    startDate?: string;
    endDate?: string;
    aggregation?: AggregationPeriod;
    mode?: DataMode;
  }) => void;
  onRunRetrieval: (
    overrideMode?: DataMode,
    overrideDatasetId?: DatasetConnectorId,
    overrideVarId?: string,
  ) => Promise<void>;
  retrieving: boolean;
  retrievalError: string | null;
  retrieved: RetrievedDatasetResult | null;
  presets: RegionLocation[];
  onGoToTrends: () => void;
}

export const DataLaboratoryView: React.FC<DataLaboratoryViewProps> = ({
  region,
  onSelectRegion,
  datasets,
  selectedDatasetId,
  selectedVariableId,
  startDate,
  endDate,
  aggregation,
  mode,
  onChangeParams,
  onRunRetrieval,
  retrieving,
  retrievalError,
  retrieved,
  presets,
  onGoToTrends,
}) => {
  const [cityQuery, setCityQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [cityResults, setCityResults] = useState<RegionLocation[]>([]);
  const [searchAmbiguous, setSearchAmbiguous] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [latInput, setLatInput] = useState(String(region.lat));
  const [lonInput, setLonInput] = useState(String(region.lon));
  const [coverageList, setCoverageList] = useState<DatasetCoverageStatus[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  useEffect(() => {
    setLatInput(String(region.lat));
    setLonInput(String(region.lon));
  }, [region.lat, region.lon]);

  // Evaluate independent spatial, temporal & surface coverage across all 7 NASA datasets
  useEffect(() => {
    let cancelled = false;
    setCoverageLoading(true);
    api
      .checkDatasetCoverage({
        region,
        startDate,
        endDate,
        variableId: selectedVariableId,
      })
      .then((res) => {
        if (!cancelled) setCoverageList(res.coverage);
      })
      .catch(() => {
        if (!cancelled) setCoverageList([]);
      })
      .finally(() => {
        if (!cancelled) setCoverageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [region, startDate, endDate, selectedVariableId]);

  const activeDataset = datasets.find((d) => d.id === selectedDatasetId) ?? datasets[0];
  const activeVariable =
    activeDataset?.variables.find((v) => v.id === selectedVariableId) ?? activeDataset?.variables[0];
  const activeCoverage = coverageList.find((c) => c.datasetId === selectedDatasetId);

  const handleCitySearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchAmbiguous(false);
    try {
      const res = await api.searchRegions(cityQuery);
      setCityResults(res.regions);
      setSearchAmbiguous(res.ambiguous);
      if (res.error) setSearchError(res.error);
      if (!res.ambiguous && res.regions.length === 1) {
        onSelectRegion(res.regions[0]);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Geocoding failed');
      setCityResults([]);
    } finally {
      setSearching(false);
    }
  };

  const applyManualCoords = async () => {
    const lat = Number.parseFloat(latInput);
    const lon = Number.parseFloat(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setSearchError('Coordinates out of range: Latitude [-90, 90], Longitude [-180, 180].');
      return;
    }
    setSearchError(null);
    try {
      const res = await api.reverseGeocode(lat, lon);
      onSelectRegion(res.region);
    } catch {
      onSelectRegion({
        name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
        displayName: `Custom Area (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`,
        country: 'Coordinate Selection',
        lat,
        lon,
        bbox: [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5],
      });
    }
  };

  const chartData = (retrieved?.points ?? []).map((p) => ({
    date: p.date,
    value: p.value,
  }));

  return (
    <div className="space-y-6">
      {/* Mode & Controls Header */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display font-semibold text-lg text-slate-100">
            Data Laboratory &amp; Global NASA Connectors
          </h2>
          <p className="text-xs text-slate-400">
            Search any location worldwide, verify NASA dataset spatial/temporal coverage, and retrieve observational time-series.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#060913] border border-slate-800 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => onChangeParams({ mode: 'live' })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'live' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live NASA Mode
          </button>
          <button
            type="button"
            onClick={() => onChangeParams({ mode: 'demo' })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'demo' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Demo Mode (Simulated)
          </button>
        </div>
      </div>

      {mode === 'demo' && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-3 text-xs text-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>DEMO / SIMULATED MODE ACTIVE:</strong> Retrieved series in Demo Mode are calibrated synthetic reference curves for multi-mission evaluation and never represent live NASA telemetry.
          </span>
        </div>
      )}

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          {/* Region Selector */}
          <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span>1. Worldwide Geographical Region</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {region.isOcean ? 'Ocean / Marine' : 'Terrestrial'}
              </span>
            </div>

            <div className="bg-[#060913] border border-slate-800 rounded px-3 py-2 text-xs">
              <div className="font-medium text-slate-100 truncate">{region.displayName}</div>
              <div className="font-mono text-cyan-400 text-[11px] tabular-nums">
                {region.lat.toFixed(4)}°, {region.lon.toFixed(4)}°
                {region.polygon ? ` · Custom Polygon (${region.polygon.length} pts)` : ''}
              </div>
            </div>

            <form onSubmit={handleCitySearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  placeholder="City, country, forest, desert, ocean, or lat,lon..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md"
              >
                {searching ? '...' : 'Find'}
              </button>
            </form>

            {searchError && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                {searchError}
              </div>
            )}

            {cityResults.length > 0 && (
              <div className="space-y-1">
                {searchAmbiguous && (
                  <div className="text-[11px] text-slate-400">
                    Multiple matches found — choose exact region:
                  </div>
                )}
                <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-md bg-[#060913] divide-y divide-slate-800">
                  {cityResults.map((r, i) => (
                    <button
                      key={`${r.id || r.name}-${i}`}
                      type="button"
                      onClick={() => {
                        onSelectRegion(r);
                        setCityResults([]);
                        setSearchError(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-800/70 text-slate-200 flex justify-between gap-2"
                    >
                      <span className="truncate">{r.displayName}</span>
                      <span className="font-mono text-cyan-400 shrink-0 tabular-nums">
                        {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Latitude (°)</label>
                <input
                  type="number"
                  step="0.001"
                  min="-90"
                  max="90"
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Longitude (°)</label>
                <input
                  type="number"
                  step="0.001"
                  min="-180"
                  max="180"
                  value={lonInput}
                  onChange={(e) => setLonInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100 tabular-nums"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={applyManualCoords}
                  className="w-full py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md"
                >
                  Apply
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {presets.map((p) => (
                <button
                  key={p.id || p.name}
                  type="button"
                  onClick={() => onSelectRegion(p)}
                  className={`px-2 py-1 text-[11px] rounded border ${
                    p.name === region.name
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                      : 'bg-[#060913] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Dataset & Variable Parameters */}
          <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
              <Database className="w-4 h-4 text-cyan-400" />
              <span>2. NASA Dataset &amp; Variable</span>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">NASA Connector</label>
              <select
                value={selectedDatasetId}
                onChange={(e) => {
                  const id = e.target.value as DatasetConnectorId;
                  const ds = datasets.find((d) => d.id === id);
                  onChangeParams({
                    datasetId: id,
                    variableId: ds?.variables[0]?.id,
                  });
                }}
                className="w-full px-3 py-2 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100"
              >
                {datasets.map((d) => {
                  const cov = coverageList.find((c) => c.datasetId === d.id);
                  const regionLabel = cov
                    ? !cov.availableForRegion
                      ? 'Unavailable Here'
                      : d.status === 'operational'
                        ? 'Live Ready'
                        : 'CMR / Token Req.'
                    : d.status === 'operational'
                      ? 'Live'
                      : 'Auth Required';
                  return (
                    <option key={d.id} value={d.id}>
                      {d.officialName} ({d.productId}) — {regionLabel}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Environmental Variable</label>
              <select
                value={activeVariable?.id || ''}
                onChange={(e) => onChangeParams({ variableId: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100"
              >
                {(activeDataset?.variables ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.units}){v.landOnly ? ' [Land Only]' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  min="1979-01-01"
                  max={endDate}
                  onChange={(e) => onChangeParams({ startDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => onChangeParams({ endDate: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Temporal Aggregation</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['monthly', 'daily', 'annual'] as AggregationPeriod[]).map((agg) => {
                  const disabled = agg === 'daily' && activeVariable && !activeVariable.supportsDaily;
                  return (
                    <button
                      key={agg}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChangeParams({ aggregation: agg })}
                      className={`py-1.5 text-xs rounded-md border capitalize ${
                        aggregation === agg
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                          : 'bg-[#060913] border-slate-800 text-slate-300'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {agg}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Coverage Pre-Check Callout */}
            {activeCoverage && !activeCoverage.availableForRegion && (
              <div className="bg-amber-500/10 border border-amber-500/40 rounded-md p-2.5 text-xs text-amber-200 space-y-1">
                <div className="font-semibold">Selected Dataset Coverage Restriction</div>
                <div>{activeCoverage.reason}</div>
                {activeCoverage.suggestedAlternatives.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const alt = activeCoverage.suggestedAlternatives[0];
                      onChangeParams({ datasetId: alt.datasetId, variableId: alt.variableId });
                    }}
                    className="mt-1 px-2.5 py-1 text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white rounded"
                  >
                    Switch to {activeCoverage.suggestedAlternatives[0].officialName}
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={retrieving}
              onClick={() => onRunRetrieval()}
              className="w-full py-2.5 px-4 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white rounded-md transition-colors flex items-center justify-center gap-2"
            >
              {retrieving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Retrieving NASA Data &amp; Computing Trends...</span>
                </>
              ) : (
                <>
                  <FlaskConical className="w-4 h-4" />
                  <span>Retrieve Data &amp; Run Analysis</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Panel: Dataset Integrity Card & Retrieval Output */}
        <div className="lg:col-span-7 space-y-4">
          {activeDataset && (
            <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-cyan-400">{activeDataset.productId}</div>
                  <h3 className="font-display font-semibold text-base text-slate-100">
                    {activeDataset.officialName}
                  </h3>
                </div>
                <a
                  href={activeDataset.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <span>Official Docs</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs pt-2 border-t border-slate-800">
                <div>
                  <span className="text-slate-400">NASA Source: </span>
                  <span className="text-slate-200">{activeDataset.nasaSource}</span>
                </div>
                <div>
                  <span className="text-slate-400">Spatial Resolution: </span>
                  <span className="font-mono text-slate-200">{activeDataset.spatialResolution}</span>
                </div>
                <div>
                  <span className="text-slate-400">Latitude Bounds: </span>
                  <span className="font-mono text-slate-200">
                    {activeDataset.latBounds[0]}° to {activeDataset.latBounds[1]}° (
                    {activeDataset.landOnly ? 'Land Only' : 'Global'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Historical Coverage: </span>
                  <span className="font-mono text-slate-200">
                    {activeVariable?.temporalStartOverride || activeDataset.historicalCoverageStart} to{' '}
                    {activeDataset.historicalCoverageEnd}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400">Product Version &amp; Endpoint: </span>
                  <span className="font-mono text-slate-300 break-all">
                    v{activeDataset.productVersion} · {activeDataset.apiEndpoint}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400">Processing: </span>
                  <span className="text-slate-300">{activeDataset.processingInfo}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-400">Region Coverage Check: </span>
                  <span
                    className={
                      activeCoverage?.canRetrieveNow
                        ? 'text-emerald-400'
                        : activeCoverage?.availableForRegion
                          ? 'text-amber-300'
                          : 'text-rose-400'
                    }
                  >
                    {coverageLoading ? 'Checking bounds...' : activeCoverage?.reason || activeDataset.statusMessage}
                  </span>
                </div>
              </div>
            </div>
          )}

          {(retrievalError || (retrieved && retrieved.retrievalStatus !== 'success')) && (
            <div className="bg-[#0C1222] border border-amber-500/40 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <div className="text-sm font-semibold text-amber-300">
                    {retrieved?.retrievalStatus === 'auth-required'
                      ? 'NASA Earthdata Authentication Required for Granule Extraction'
                      : 'Data Retrieval Unavailable for Selected Configuration'}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {retrievalError || retrieved?.errorReason}
                  </p>
                  {retrieved?.authSetupHint && (
                    <p className="text-xs text-slate-400">{retrieved.authSetupHint}</p>
                  )}
                  {retrieved?.coverageStatus?.sampleGranules && retrieved.coverageStatus.sampleGranules.length > 0 && (
                    <div className="bg-[#060913] border border-slate-800 rounded p-2.5 mt-2 space-y-1">
                      <div className="text-[11px] font-mono text-cyan-400">
                        Verified NASA CMR Granules Discovered ({retrieved.coverageStatus.granulesDiscovered?.toLocaleString() ?? retrieved.coverageStatus.sampleGranules.length} matches):
                      </div>
                      {retrieved.coverageStatus.sampleGranules.slice(0, 3).map((g, gi) => (
                        <div key={gi} className="text-[11px] font-mono text-slate-300 truncate">
                          • {g.title} ({g.timeStart.slice(0, 10)})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onChangeParams({ datasetId: 'nasa-power', variableId: 'T2M', mode: 'live' });
                    onRunRetrieval('live', 'nasa-power', 'T2M');
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
                >
                  Use Live NASA POWER (T2M)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeParams({ mode: 'demo' });
                    onRunRetrieval('demo');
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-md"
                >
                  Load Labeled Demo Example
                </button>
              </div>
            </div>
          )}

          {retrieved && retrieved.retrievalStatus === 'success' && (
            <div className="space-y-4">
              <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-display font-semibold text-slate-100">
                      {retrieved.variable.name} ({retrieved.variable.units})
                    </span>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-200">
                    {retrieved.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums bg-[#060913] border border-slate-800 rounded-md p-3">
                  <div>
                    <div className="text-slate-400">Valid / Missing</div>
                    <div className="text-slate-100 font-semibold">
                      {retrieved.validObservations} / {retrieved.missingObservations}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Mean ({retrieved.variable.units})</div>
                    <div className="text-slate-100 font-semibold">
                      {retrieved.summary.mean?.toFixed(3) ?? 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Range (Min–Max)</div>
                    <div className="text-slate-100 font-semibold">
                      {retrieved.summary.min?.toFixed(2) ?? '—'} .. {retrieved.summary.max?.toFixed(2) ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Spatial Weighting</div>
                    <div className="text-slate-100 font-semibold truncate" title={retrieved.spatialSampling?.weightingMethod}>
                      {retrieved.spatialSampling
                        ? `${retrieved.spatialSampling.method} (${retrieved.spatialSampling.sampleCount})`
                        : 'point (1)'}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono space-y-0.5 bg-[#060913] border border-slate-800 rounded px-3 py-2">
                  <div>
                    Dataset: {retrieved.dataset.officialName} ({retrieved.dataset.productId} · v
                    {retrieved.productVersion ?? retrieved.dataset.productVersion}) · Variable: {retrieved.variable.name} ({retrieved.variable.units})
                  </div>
                  <div>
                    Region: {retrieved.region.displayName} ({retrieved.region.lat.toFixed(2)}°, {retrieved.region.lon.toFixed(2)}°) · Period:{' '}
                    {retrieved.actualAvailablePeriod?.startDate} to {retrieved.actualAvailablePeriod?.endDate} · Retrieved:{' '}
                    {retrieved.retrievalTimestamp.slice(0, 19).replace('T', ' ')} UTC
                  </div>
                  {retrieved.endpointUrl && (
                    <div className="truncate text-slate-500" title={retrieved.endpointUrl}>
                      Source Endpoint: {retrieved.endpointUrl}
                    </div>
                  )}
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={28} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={52} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#060913',
                          borderColor: '#1e293b',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name={`${retrieved.variable.shortLabel} (${retrieved.variable.units})`}
                        stroke={retrieved.isSimulated ? '#f59e0b' : '#06b6d4'}
                        strokeWidth={1.8}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onGoToTrends}
                    className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md"
                  >
                    Inspect Statistical Trend Results &amp; Seasonal Analysis →
                  </button>
                </div>
              </div>

              <SpatialDistributionMap retrieved={retrieved} />
            </div>
          )}
        </div>
      </div>

      {/* Regional Applicability Matrix & Visual Coverage Diagram across all 7 NASA Datasets */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            NASA Dataset Global Coverage &amp; Region Applicability Matrix ({region.name})
          </h3>
          <span className="text-xs font-mono text-slate-400">
            Target: {region.lat.toFixed(2)}°, {region.lon.toFixed(2)}° ·{' '}
            {region.isOcean ? 'Ocean / Marine' : 'Land / Terrestrial'}
          </span>
        </div>

        <DatasetCoverageChart
          datasets={datasets}
          coverageList={coverageList}
          region={region}
          startDate={startDate}
          endDate={endDate}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-4">Dataset</th>
                <th className="py-2 pr-4">Product ID</th>
                <th className="py-2 pr-4">Spatial Bounds</th>
                <th className="py-2 pr-4">Region Applicability</th>
                <th className="py-2 pr-4">Live Status</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {datasets.map((d) => {
                const cov = coverageList.find((c) => c.datasetId === d.id);
                return (
                  <tr key={d.id} className="hover:bg-slate-900/40">
                    <td className="py-2.5 pr-4 font-medium text-slate-200">{d.officialName}</td>
                    <td className="py-2.5 pr-4 font-mono text-cyan-400">{d.productId}</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-400">
                      {d.latBounds[0]}°..{d.latBounds[1]}° {d.landOnly ? '(Land)' : '(Global)'}
                    </td>
                    <td className="py-2.5 pr-4">
                      {cov ? (
                        <span
                          className={
                            cov.availableForRegion ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {cov.availableForRegion ? 'Covered' : 'Excluded'}
                        </span>
                      ) : (
                        <span className="text-slate-500">Checking...</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={
                          d.status === 'operational'
                            ? 'text-emerald-400'
                            : d.status === 'auth-required'
                              ? 'text-amber-300'
                              : 'text-rose-400'
                        }
                      >
                        {d.status === 'operational'
                          ? '● Operational'
                          : d.status === 'auth-required'
                            ? '▲ Auth Required'
                            : '✖ Unavailable'}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-400 max-w-sm">
                      {cov?.reason || d.statusMessage}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
