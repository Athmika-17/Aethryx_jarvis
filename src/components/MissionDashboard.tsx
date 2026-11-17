import React, { useState } from 'react';
import {
  ArrowRight,
  Compass,
  Droplets,
  Flame,
  Gauge,
  Leaf,
  MapPin,
  Search,
  Sparkles,
  Wind,
} from 'lucide-react';
import type {
  DataMode,
  DatasetMetadata,
  GibsLayerSpec,
  RegionLocation,
  RetrievedDatasetResult,
  SavedInvestigation,
  TrendAnalysisResult,
} from '../types/earth';
import type { HealthInfo } from '../lib/api';
import { api } from '../lib/api';
import { EarthGlobe } from './EarthGlobe';

export interface EnvironmentalSnapshotCard {
  id: string;
  label: string;
  category: 'temperature' | 'precipitation' | 'vegetation' | 'humidity' | 'wind' | 'land';
  value: number | null;
  units: string;
  date: string | null;
  sourceLabel: string;
  datasetId: DatasetMetadata['id'];
  variableId: string;
  isSimulated: boolean;
  unavailableReason?: string;
}

interface MissionDashboardProps {
  region: RegionLocation;
  onSelectRegion: (r: RegionLocation) => void;
  datasets: DatasetMetadata[];
  health: HealthInfo | null;
  mode: DataMode;
  snapshots: EnvironmentalSnapshotCard[];
  snapshotsLoading: boolean;
  activeRetrieved: RetrievedDatasetResult | null;
  activeTrend: TrendAnalysisResult | null;
  investigations: SavedInvestigation[];
  favorites: RegionLocation[];
  gibsLayers: GibsLayerSpec[];
  onNavigate: (tab: string) => void;
  onRunQuickVariable: (datasetId: DatasetMetadata['id'], variableId: string) => void;
  onLoadInvestigation: (inv: SavedInvestigation) => void;
}

export const MissionDashboard: React.FC<MissionDashboardProps> = ({
  region,
  onSelectRegion,
  datasets,
  health,
  mode,
  snapshots,
  snapshotsLoading,
  activeRetrieved,
  activeTrend,
  investigations,
  favorites,
  gibsLayers,
  onNavigate,
  onRunQuickVariable,
  onLoadInvestigation,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RegionLocation[]>([]);
  const [searchAmbiguous, setSearchAmbiguous] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const operationalCount = datasets.filter((d) => d.status === 'operational').length;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchAmbiguous(false);
    try {
      const res = await api.searchRegions(searchQuery);
      setSearchResults(res.regions);
      setSearchAmbiguous(res.ambiguous);
      if (res.error) setSearchError(res.error);
      if (!res.ambiguous && res.regions.length === 1) {
        onSelectRegion(res.regions[0]);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Location search failed');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleGlobeClick = async (lat: number, lon: number) => {
    setSearchError(null);
    try {
      const res = await api.reverseGeocode(lat, lon);
      onSelectRegion(res.region);
    } catch {
      onSelectRegion({
        name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
        displayName: `Custom Coordinates (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`,
        country: 'Global Selection',
        lat,
        lon,
        bbox: [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5],
      });
    }
  };

  const categoryIcon = (cat: EnvironmentalSnapshotCard['category']) => {
    switch (cat) {
      case 'temperature':
        return <Flame className="w-4 h-4 text-amber-400" />;
      case 'precipitation':
        return <Droplets className="w-4 h-4 text-cyan-400" />;
      case 'vegetation':
        return <Leaf className="w-4 h-4 text-emerald-400" />;
      case 'humidity':
        return <Gauge className="w-4 h-4 text-sky-400" />;
      case 'wind':
        return <Wind className="w-4 h-4 text-indigo-400" />;
      case 'land':
        return <Compass className="w-4 h-4 text-violet-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Status Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">Active Target Region</div>
          <div className="mt-1 font-display font-semibold text-slate-100 truncate">
            {region.name}
          </div>
          <div className="mt-1 text-xs font-mono text-cyan-400 tabular-nums">
            {region.lat.toFixed(4)}°, {region.lon.toFixed(4)}° ·{' '}
            {region.isOcean ? 'Ocean / Marine' : region.country}
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">NASA Data Connectors</div>
          <div className="mt-1 font-display font-semibold text-slate-100 tabular-nums">
            {operationalCount} / {datasets.length || 7} Live Streams
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {mode === 'demo'
              ? 'Workspace in DEMO / SIMULATED mode'
              : health?.earthdataTokenConfigured
                ? 'Earthdata Bearer token configured'
                : 'NASA POWER & GIBS live · CMR verified'}
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">Active Investigation Variable</div>
          <div className="mt-1 font-display font-semibold text-slate-100 truncate">
            {activeRetrieved ? activeRetrieved.variable.name : 'No active retrieval'}
          </div>
          <div className="mt-1 text-xs font-mono text-slate-400 tabular-nums">
            {activeRetrieved
              ? `${activeRetrieved.validObservations} obs · ${activeRetrieved.isSimulated ? 'DEMO' : 'LIVE'}`
              : 'Select variable below to run'}
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">AETHRYX AI & Voice Engine</div>
          <div className="mt-1 font-display font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>{health?.geminiConfigured ? 'Gemini Ready' : 'Fallback Mode'}</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {health?.geminiConfigured
              ? 'Server-side Gemini reasoning active'
              : 'Set GEMINI_API_KEY in Secrets'}
          </div>
        </div>
      </div>

      {/* Central Interactive Earth + Region & Trend Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 bg-[#0C1222] border border-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-100">
                Interactive Earth Observatory
              </h2>
              <p className="text-xs text-slate-400">
                NASA Blue Marble · Click any location on Earth to inspect regional telemetry
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('explorer')}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded-md hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <span>Open Full Explorer</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative h-[380px] lg:h-[430px] w-full">
            <EarthGlobe
              region={region}
              activeLayer={gibsLayers[0] ?? null}
              layerDate="2024-07-01"
              autoRotate={false}
              onSelectCoordinates={handleGlobeClick}
            />
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Quick Global Region Switcher */}
          <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Target Region Control
            </h3>
            <form onSubmit={handleSearch} className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="City, country, forest, desert, ocean, lat,lon..."
                  className="w-full pl-9 pr-3 py-2 text-sm bg-[#060913] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={searching}
                className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {searching ? 'Searching...' : 'Locate'}
              </button>
            </form>

            {searchError && (
              <div className="mt-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                {searchError}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1">
                {searchAmbiguous && (
                  <div className="text-[11px] text-slate-400">Multiple matches — select exact location:</div>
                )}
                <div className="max-h-36 overflow-y-auto border border-slate-800 rounded-md bg-[#060913] divide-y divide-slate-800/70">
                  {searchResults.map((r, idx) => (
                    <button
                      key={`${r.id || r.name}-${idx}`}
                      type="button"
                      onClick={() => {
                        onSelectRegion(r);
                        setSearchResults([]);
                        setSearchError(null);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-200 truncate">{r.displayName}</span>
                      <span className="font-mono text-cyan-400 shrink-0 tabular-nums">
                        {r.lat.toFixed(2)}°, {r.lon.toFixed(2)}°
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {favorites.slice(0, 4).map((fav) => (
                <button
                  key={fav.id || fav.name}
                  type="button"
                  onClick={() => onSelectRegion(fav)}
                  className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    Math.abs(fav.lat - region.lat) < 0.05 && Math.abs(fav.lon - region.lon) < 0.05
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                      : 'bg-[#060913] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <MapPin className="w-3 h-3" />
                  <span>{fav.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Active Trend Summary */}
          <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display font-semibold text-sm text-slate-100">
                  Environmental Trend Summary
                </h3>
                {activeTrend && (
                  <span className="text-xs font-mono text-slate-400">
                    {activeTrend.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
                  </span>
                )}
              </div>

              {activeTrend ? (
                <div className="mt-3 space-y-2.5">
                  <div className="text-base font-display font-semibold text-cyan-300">
                    {activeTrend.classification === 'increasing'
                      ? 'Statistically Significant Increasing Trend'
                      : activeTrend.classification === 'decreasing'
                        ? 'Statistically Significant Decreasing Trend'
                        : activeTrend.classification === 'insufficient-evidence'
                          ? 'Insufficient Evidence for Trend'
                          : 'No Statistically Significant Trend'}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeTrend.diagnostics.scientificSummary}
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                    <div>
                      <div className="text-slate-400">Sen&apos;s Slope</div>
                      <div className="text-slate-100 font-semibold">
                        {activeTrend.sensSlope.slopePerYear >= 0 ? '+' : ''}
                        {activeTrend.sensSlope.slopePerYear.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">MK p-value</div>
                      <div className="text-slate-100 font-semibold">
                        {activeTrend.mannKendall.pValue < 0.0001
                          ? '<0.0001'
                          : activeTrend.mannKendall.pValue.toFixed(4)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">OLS R²</div>
                      <div className="text-slate-100 font-semibold">
                        {activeTrend.linearRegression.rSquared.toFixed(3)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                  No trend computation loaded yet. Retrieve a regional variable below or open Trend Detective to evaluate linear regression, Mann-Kendall significance, and Sen&apos;s slope.
                </p>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => onNavigate('trends')}
                className="flex-1 py-2 px-3 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
              >
                Open Trend Detective
              </button>
              <button
                type="button"
                onClick={() => onNavigate('assistant')}
                className="py-2 px-3 text-xs font-medium bg-[#060913] border border-slate-700 hover:border-cyan-500/50 text-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Ask AI
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 6 Environmental Overview Cards */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-display font-semibold text-base text-slate-100">
              Regional Environmental Telemetry — {region.displayName}
            </h2>
            <p className="text-xs text-slate-400">
              Real retrieved measurements only. Unavailable authenticated mission datasets display status transparently.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {snapshotsLoading
              ? 'Synchronizing NASA endpoints...'
              : mode === 'demo'
                ? 'Source Mode: DEMO / SIMULATED'
                : 'Source Mode: LIVE NASA'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {snapshots.map((card) => (
            <div
              key={card.id}
              className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex flex-col justify-between hover:border-slate-700 transition-colors"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    {categoryIcon(card.category)}
                    <span>{card.label}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {card.isSimulated ? 'DEMO' : card.value !== null ? 'LIVE' : 'UNAVAILABLE'}
                  </span>
                </div>

                {card.value !== null ? (
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-2xl font-mono font-semibold text-slate-100 tabular-nums">
                      {card.value.toFixed(2)}
                    </span>
                    <span className="text-xs font-mono text-slate-400">{card.units}</span>
                  </div>
                ) : (
                  <div className="mt-3 text-sm font-medium text-amber-300">
                    Data currently unavailable
                  </div>
                )}

                <div className="mt-1.5 text-xs text-slate-400">
                  {card.value !== null
                    ? `${card.sourceLabel} · Observation ${card.date ?? 'Latest'}`
                    : card.unavailableReason || 'Requires NASA Earthdata Login token or Demo Mode.'}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500">{card.variableId}</span>
                <button
                  type="button"
                  onClick={() => onRunQuickVariable(card.datasetId, card.variableId)}
                  className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition-colors whitespace-nowrap"
                >
                  Analyze 20-Yr Trend →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Investigations */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Recent Saved Investigations
          </h3>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            View All History →
          </button>
        </div>

        {investigations.length === 0 ? (
          <div className="text-xs text-slate-400 py-4">
            No investigations saved yet. Run an analysis in Trend Detective and click Save Investigation to persist results locally.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {investigations.slice(0, 4).map((inv) => (
              <div
                key={inv.id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-medium text-slate-200">{inv.title}</div>
                  <div className="text-slate-400 font-mono">
                    {inv.region.name} · {inv.productId} · {inv.startDate} to {inv.endDate} ·{' '}
                    {inv.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onLoadInvestigation(inv)}
                  className="px-3 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md whitespace-nowrap"
                >
                  Open Analysis
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
