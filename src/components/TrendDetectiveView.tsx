import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Download,
  GitCompare,
  HelpCircle,
  Loader2,
  Minus,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ForecastResult,
  RegionLocation,
  RetrievedDatasetResult,
  TrendAnalysisResult,
} from '../types/earth';
import { api } from '../lib/api';
import { SpatialDistributionMap } from './SpatialDistributionMap';

export interface ComparisonEntry {
  region: RegionLocation;
  retrieved: RetrievedDatasetResult;
  trend: TrendAnalysisResult;
  color: string;
}

interface TrendDetectiveViewProps {
  retrieved: RetrievedDatasetResult | null;
  trend: TrendAnalysisResult | null;
  forecast: ForecastResult | null;
  alpha: number;
  onChangeAlpha: (alpha: number) => void;
  onSaveInvestigation: () => Promise<void>;
  savingInvestigation: boolean;
  savedNotice: string | null;
  presets: RegionLocation[];
  onGoToLab: () => void;
  onComparisonsChange?: (items: ComparisonEntry[]) => void;
}

const COMPARE_COLORS = ['#a78bfa', '#10b981'];

export const TrendDetectiveView: React.FC<TrendDetectiveViewProps> = ({
  retrieved,
  trend,
  forecast,
  alpha,
  onChangeAlpha,
  onSaveInvestigation,
  savingInvestigation,
  savedNotice,
  presets,
  onGoToLab,
  onComparisonsChange,
}) => {
  const [showDeseasonalized, setShowDeseasonalized] = useState(false);
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);
  const [compareSearchQuery, setCompareSearchQuery] = useState('');
  const [compareCandidates, setCompareCandidates] = useState<RegionLocation[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  const primarySeriesKey = retrieved
    ? `${retrieved.dataset.id}|${retrieved.variable.id}|${retrieved.region.lat}|${retrieved.region.lon}|${retrieved.requestedPeriod.startDate}|${retrieved.requestedPeriod.endDate}|${retrieved.aggregation}`
    : '';

  useEffect(() => {
    setComparisons([]);
    setCompareCandidates([]);
    setCompareError(null);
  }, [primarySeriesKey]);

  useEffect(() => {
    onComparisonsChange?.(comparisons);
  }, [comparisons, onComparisonsChange]);

  if (!retrieved || !trend || retrieved.retrievalStatus !== 'success') {
    return (
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-8 text-center space-y-3">
        <HelpCircle className="w-8 h-8 text-cyan-400 mx-auto" />
        <h2 className="font-display font-semibold text-lg text-slate-100">
          No Active Time-Series Loaded for Trend Detection
        </h2>
        <p className="text-xs text-slate-400 max-w-lg mx-auto">
          Retrieve a NASA Earth observation dataset in Data Laboratory (or click a variable card on the Mission Dashboard) to compute OLS regression, Mann-Kendall significance, and Sen&apos;s slope.
        </p>
        <button
          type="button"
          onClick={onGoToLab}
          className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
        >
          Open Data Laboratory
        </button>
      </div>
    );
  }

  const addComparisonRegion = async (targetRegion: RegionLocation) => {
    if (
      comparisons.some(
        (c) => Math.abs(c.region.lat - targetRegion.lat) < 0.02 && Math.abs(c.region.lon - targetRegion.lon) < 0.02,
      )
    ) {
      return;
    }
    if (comparisons.length >= 2) {
      setCompareError('Maximum 2 comparison regions can be overlaid simultaneously. Remove one before adding another.');
      return;
    }

    setComparing(true);
    setCompareError(null);
    setCompareCandidates([]);
    try {
      // Enforce compatible variable, units, product definition, aggregation, and exact period
      const compRet = await api.retrieveData({
        datasetId: retrieved.dataset.id,
        variableId: retrieved.variable.id,
        region: targetRegion,
        startDate: retrieved.requestedPeriod.startDate,
        endDate: retrieved.requestedPeriod.endDate,
        aggregation: retrieved.aggregation,
        mode: retrieved.mode,
      });
      if (compRet.retrievalStatus !== 'success') {
        setCompareError(
          `Incompatible or unavailable for ${targetRegion.name}: ${compRet.errorReason || 'Dataset does not cover this domain/latitude.'}`,
        );
      } else if (compRet.variable.units !== retrieved.variable.units) {
        setCompareError('Unit mismatch between regions; cannot overlay incompatible units.');
      } else {
        const compTrend = await api.analyzeTrend(compRet, alpha);
        const color = COMPARE_COLORS[comparisons.length % COMPARE_COLORS.length];
        setComparisons((prev) => [...prev, { region: targetRegion, retrieved: compRet, trend: compTrend, color }]);
      }
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  const handleSearchCompareRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compareSearchQuery.trim()) return;
    setCompareError(null);
    try {
      const res = await api.searchRegions(compareSearchQuery);
      if (res.regions.length === 0) {
        setCompareError(res.error || `No location found matching "${compareSearchQuery}".`);
        setCompareCandidates([]);
      } else if (!res.ambiguous && res.regions.length === 1) {
        await addComparisonRegion(res.regions[0]);
        setCompareSearchQuery('');
      } else {
        setCompareCandidates(res.regions);
      }
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Region lookup failed');
    }
  };

  const handleExportChartSvg = () => {
    const svg = chartContainerRef.current?.querySelector('svg');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const xml = serializer.serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aethryx-trend-${retrieved.region.name.toLowerCase()}-${retrieved.variable.id.toLowerCase()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const compareMaps = comparisons.map((c) => new Map(c.trend.series.map((p) => [p.date, p.value])));

  const chartData = trend.series.map((p) => {
    const row: Record<string, unknown> = {
      date: p.date,
      observed: showDeseasonalized ? p.deseasonalizedValue : p.value,
      fit: p.regressionFit,
      ciBand:
        p.ciLower !== null && p.ciLower !== undefined && p.ciUpper !== null && p.ciUpper !== undefined
          ? [p.ciLower, p.ciUpper]
          : undefined,
    };
    comparisons.forEach((c, idx) => {
      row[`compare_${idx}`] = compareMaps[idx].get(p.date) ?? null;
    });
    return row;
  });

  const trendBadge = () => {
    switch (trend.classification) {
      case 'increasing':
        return {
          icon: <TrendingUp className="w-5 h-5 text-amber-400" />,
          label: 'Statistically Significant Increasing Trend',
          tone: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
        };
      case 'decreasing':
        return {
          icon: <TrendingDown className="w-5 h-5 text-cyan-400" />,
          label: 'Statistically Significant Decreasing Trend',
          tone: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
        };
      case 'insufficient-evidence':
        return {
          icon: <AlertTriangle className="w-5 h-5 text-slate-400" />,
          label: 'Insufficient Evidence',
          tone: 'text-slate-300 border-slate-700 bg-slate-900',
        };
      default:
        return {
          icon: <Minus className="w-5 h-5 text-slate-300" />,
          label: 'No Statistically Significant Trend',
          tone: 'text-slate-200 border-slate-700 bg-slate-900',
        };
    }
  };

  const badge = trendBadge();

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-cyan-400">
            {retrieved.region.displayName} · {retrieved.dataset.productId} ·{' '}
            {retrieved.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
          </div>
          <h2 className="font-display font-semibold text-lg text-slate-100 mt-0.5">
            Trend Detective — {retrieved.variable.name} ({retrieved.variable.units})
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#060913] border border-slate-800 rounded-md px-2.5 py-1.5">
            <span className="text-xs text-slate-400">Alpha:</span>
            {[0.01, 0.05, 0.1].map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onChangeAlpha(a)}
                className={`px-2 py-0.5 text-xs font-mono rounded ${
                  alpha === a ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={savingInvestigation}
            onClick={onSaveInvestigation}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md flex items-center gap-1.5 whitespace-nowrap"
          >
            {savingInvestigation ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BookmarkPlus className="w-3.5 h-3.5" />
            )}
            <span>Save Investigation</span>
          </button>
        </div>
      </div>

      {savedNotice && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-md px-4 py-2 text-xs">
          {savedNotice}
        </div>
      )}

      {/* Classification Banner */}
      <div className={`border rounded-lg p-4 flex flex-wrap items-start justify-between gap-4 ${badge.tone}`}>
        <div className="flex items-start gap-3 max-w-3xl">
          <div className="mt-0.5">{badge.icon}</div>
          <div>
            <div className="font-display font-semibold text-base">{badge.label}</div>
            <p className="text-xs opacity-90 mt-1 leading-relaxed">
              {trend.diagnostics.scientificSummary}
            </p>
          </div>
        </div>
        <div className="text-xs font-mono tabular-nums text-right">
          <div>Period: {trend.startDate} → {trend.endDate}</div>
          <div>Valid: {trend.validObservations} / Missing: {trend.missingObservations}</div>
          <div>Duration: {trend.durationYears.toFixed(1)} yrs</div>
        </div>
      </div>

      {/* Statistical Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="text-xs text-slate-400">Ordinary Least Squares (OLS)</div>
          <div className="text-2xl font-mono font-semibold text-slate-100 tabular-nums">
            {trend.linearRegression.slopePerYear >= 0 ? '+' : ''}
            {trend.linearRegression.slopePerYear.toFixed(4)}{' '}
            <span className="text-xs font-normal text-slate-400">{trend.units}/yr</span>
          </div>
          <div className="text-xs font-mono text-slate-300 space-y-1 pt-2 border-t border-slate-800/80 tabular-nums">
            <div>
              95% CI: [{trend.linearRegression.ci95LowerPerYear.toFixed(4)},{' '}
              {trend.linearRegression.ci95UpperPerYear.toFixed(4)}]
            </div>
            <div>
              R² = {trend.linearRegression.rSquared.toFixed(4)} · t ={' '}
              {trend.linearRegression.tStatistic.toFixed(2)}
            </div>
            <div>
              p-value ={' '}
              {trend.linearRegression.pValue < 0.0001
                ? '< 0.0001'
                : trend.linearRegression.pValue.toFixed(4)}
            </div>
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="text-xs text-slate-400">
            Mann-Kendall ({trend.mannKendall.method === 'seasonal' ? 'Seasonal' : 'Standard'})
          </div>
          <div className="text-2xl font-mono font-semibold text-slate-100 tabular-nums">
            p ={' '}
            {trend.mannKendall.pValue < 0.0001
              ? '< 0.0001'
              : trend.mannKendall.pValue.toFixed(4)}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({trend.mannKendall.significant ? `p < ${trend.alpha}` : `p ≥ ${trend.alpha}`})
            </span>
          </div>
          <div className="text-xs font-mono text-slate-300 space-y-1 pt-2 border-t border-slate-800/80 tabular-nums">
            <div>
              S = {trend.mannKendall.sStatistic} · Z = {trend.mannKendall.zStatistic.toFixed(3)}
            </div>
            <div>Kendall&apos;s tau = {trend.mannKendall.tau.toFixed(4)}</div>
            <div>Lag-1 Autocorrelation r₁ = {trend.mannKendall.lag1Autocorrelation.toFixed(3)}</div>
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-2">
          <div className="text-xs text-slate-400">Sen&apos;s Slope (Non-Parametric)</div>
          <div className="text-2xl font-mono font-semibold text-slate-100 tabular-nums">
            {trend.sensSlope.slopePerYear >= 0 ? '+' : ''}
            {trend.sensSlope.slopePerYear.toFixed(4)}{' '}
            <span className="text-xs font-normal text-slate-400">{trend.units}/yr</span>
          </div>
          <div className="text-xs font-mono text-slate-300 space-y-1 pt-2 border-t border-slate-800/80 tabular-nums">
            <div>
              95% CI: [{trend.sensSlope.ci95LowerPerYear.toFixed(4)},{' '}
              {trend.sensSlope.ci95UpperPerYear.toFixed(4)}]
            </div>
            <div>Outliers (1.5×IQR): {trend.diagnostics.outliersDetected}</div>
            <div>Seasonal Adjustment: {trend.seasonalAdjusted ? 'Applied' : 'Not required'}</div>
          </div>
        </div>
      </div>

      {/* Primary Time-Series + Regression + Worldwide Regional Comparison Chart */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Time-Series, Linear Fit &amp; Worldwide Regional Comparison
            </h3>
            <div className="text-[11px] font-mono text-slate-400">
              Dataset: {retrieved.dataset.officialName} ({retrieved.dataset.productId} v{retrieved.productVersion ?? retrieved.dataset.productVersion}) · Variable: {trend.variableName} ({trend.units}) · Region: {retrieved.region.name} · Period: {trend.startDate} to {trend.endDate} · Source: {retrieved.dataset.nasaSource}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {trend.seasonalAdjusted && (
              <button
                type="button"
                onClick={() => setShowDeseasonalized((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-md border ${
                  showDeseasonalized
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                    : 'bg-[#060913] border-slate-700 text-slate-300'
                }`}
              >
                {showDeseasonalized ? 'Showing Deseasonalized' : 'Show Deseasonalized'}
              </button>
            )}

            <button
              type="button"
              onClick={handleExportChartSvg}
              className="px-3 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Chart SVG</span>
            </button>
          </div>
        </div>

        {/* Worldwide Comparison Picker (Search ANY Location OR Pick Preset) */}
        <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
              <GitCompare className="w-3.5 h-3.5 text-cyan-400" />
              <span>Compare Worldwide Locations (Identical {retrieved.variable.id}, {retrieved.variable.units}, {retrieved.aggregation})</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleSearchCompareRegion} className="flex items-center gap-1.5">
                <div className="relative">
                  <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={compareSearchQuery}
                    onChange={(e) => setCompareSearchQuery(e.target.value)}
                    placeholder="Add city, country, lat,lon..."
                    className="pl-7 pr-2.5 py-1 text-xs bg-[#0C1222] border border-slate-700 rounded text-slate-100 w-48 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={comparing}
                  className="px-2.5 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </button>
              </form>

              <select
                value=""
                onChange={(e) => {
                  const found = presets.find((p) => p.name === e.target.value);
                  if (found) addComparisonRegion(found);
                }}
                aria-label="Quick add preset comparison region"
                className="px-2.5 py-1 text-xs bg-[#0C1222] border border-slate-700 rounded text-slate-200"
              >
                <option value="">Quick Preset Region...</option>
                {presets
                  .filter((p) => p.name !== retrieved.region.name)
                  .map((p) => (
                    <option key={p.id || p.name} value={p.name}>
                      + {p.name} ({p.country})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {compareCandidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {compareCandidates.map((cand, idx) => (
                <button
                  key={`${cand.id || cand.name}-${idx}`}
                  type="button"
                  onClick={() => addComparisonRegion(cand)}
                  className="px-2.5 py-1 text-[11px] bg-[#0C1222] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded"
                >
                  + {cand.displayName} ({cand.lat.toFixed(2)}°, {cand.lon.toFixed(2)}°)
                </button>
              ))}
            </div>
          )}

          {comparisons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {comparisons.map((c, idx) => (
                <div
                  key={`${c.region.name}-${idx}`}
                  className="flex items-center gap-2 px-2.5 py-1 text-xs bg-[#0C1222] border border-slate-700 rounded"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-slate-200">{c.region.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${c.region.name}`}
                    onClick={() => setComparisons((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-rose-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {comparing && (
            <div className="text-xs text-cyan-300 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Retrieving compatible regional observations for comparison...</span>
            </div>
          )}
          {compareError && <div className="text-xs text-amber-300">{compareError}</div>}
        </div>

        <div ref={chartContainerRef} className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={54} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#060913',
                  borderColor: '#1e293b',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="ciBand"
                name="95% Mean Fit CI"
                stroke="none"
                fill="#f59e0b"
                fillOpacity={0.14}
              />
              <Line
                type="monotone"
                dataKey="observed"
                name={`${retrieved.region.name} (${trend.units})`}
                stroke={retrieved.isSimulated ? '#fbbf24' : '#06b6d4'}
                strokeWidth={1.8}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="fit"
                name="Primary OLS Trend"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
              />
              {comparisons.map((c, idx) => (
                <Line
                  key={`${c.region.name}-${idx}`}
                  type="monotone"
                  dataKey={`compare_${idx}`}
                  name={`${c.region.name} (${trend.units})`}
                  stroke={c.color}
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {comparisons.length > 0 && (
          <div className="overflow-x-auto bg-[#060913] border border-slate-800 rounded-md p-3 space-y-2">
            <table className="w-full text-xs text-left font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-1.5 pr-4">Region</th>
                  <th className="py-1.5 pr-4">Domain &amp; Grid</th>
                  <th className="py-1.5 pr-4">Valid Obs</th>
                  <th className="py-1.5 pr-4">Mean ({trend.units})</th>
                  <th className="py-1.5 pr-4">Sen&apos;s Slope ({trend.units}/yr)</th>
                  <th className="py-1.5">MK p-value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                <tr>
                  <td className="py-1.5 pr-4 text-cyan-300 font-semibold">{retrieved.region.name}</td>
                  <td className="py-1.5 pr-4 text-slate-400">
                    {retrieved.region.isOcean ? 'Ocean' : 'Land'} · {retrieved.dataset.spatialResolution}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-200">{retrieved.validObservations}</td>
                  <td className="py-1.5 pr-4 text-slate-200">{retrieved.summary.mean?.toFixed(3) ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-slate-200">
                    {trend.sensSlope.slopePerYear >= 0 ? '+' : ''}
                    {trend.sensSlope.slopePerYear.toFixed(4)}
                  </td>
                  <td className="py-1.5 text-slate-200">{trend.mannKendall.pValue.toFixed(4)}</td>
                </tr>
                {comparisons.map((c, idx) => (
                  <tr key={`${c.region.name}-${idx}`}>
                    <td className="py-1.5 pr-4 font-semibold" style={{ color: c.color }}>
                      {c.region.name}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-400">
                      {c.region.isOcean ? 'Ocean' : 'Land'} · {c.retrieved.dataset.spatialResolution}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-200">{c.retrieved.validObservations}</td>
                    <td className="py-1.5 pr-4 text-slate-200">
                      {c.retrieved.summary.mean?.toFixed(3) ?? '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-200">
                      {c.trend.sensSlope.slopePerYear >= 0 ? '+' : ''}
                      {c.trend.sensSlope.slopePerYear.toFixed(4)}
                    </td>
                    <td className="py-1.5 text-slate-200">{c.trend.mannKendall.pValue.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400">
              Methodological note: Comparisons enforce identical NASA product ({retrieved.dataset.productId}), variable ({retrieved.variable.id}), units ({trend.units}), and native spatial footprint ({retrieved.dataset.spatialResolution}). Regional spatial averaging across larger bounding boxes smooths local extremes compared to single grid cells.
            </p>
          </div>
        )}
      </div>

      {/* Year-over-Year Change & Statistical Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Year-over-Year Annual Mean ({trend.units})
            </h3>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              {retrieved.dataset.officialName} ({retrieved.dataset.productId}) · {trend.variableName} ({trend.units}) · {retrieved.region.name} · {trend.startDate}–{trend.endDate} · {retrieved.dataset.nasaSource}
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend.yearOverYear} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#060913',
                    borderColor: '#1e293b',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="mean" name={`Annual Mean (${trend.units})`} fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display font-semibold text-sm text-slate-100">
                Statistical Forecast (Extrapolation Estimate)
              </h3>
              <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                {retrieved.dataset.officialName} ({retrieved.dataset.productId}) · {trend.variableName} ({trend.units}) · {retrieved.region.name} · Baseline {trend.startDate}–{trend.endDate} · {retrieved.dataset.nasaSource}
              </div>
            </div>
            <span className="text-[11px] font-mono text-amber-300 shrink-0">ESTIMATE ONLY</span>
          </div>

          {forecast?.available ? (
            <>
              <div className="text-xs text-slate-400">
                Model: {forecast.modelName} · Holdout Validation (n=
                {forecast.validationMetrics?.holdoutObservations}): MAE ={' '}
                <span className="font-mono text-slate-200">{forecast.validationMetrics?.mae}</span>, RMSE ={' '}
                <span className="font-mono text-slate-200">{forecast.validationMetrics?.rmse}</span>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={forecast.points.map((p) => ({
                      date: p.date,
                      predicted: p.predicted,
                      band95: [p.lower95, p.upper95],
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#060913',
                        borderColor: '#1e293b',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="band95"
                      name="95% Prediction Interval"
                      stroke="none"
                      fill="#8b5cf6"
                      fillOpacity={0.18}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      name={`Forecast Estimate (${forecast.units})`}
                      stroke="#a78bfa"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[11px] text-amber-300/90">{forecast.disclaimer}</div>
            </>
          ) : (
            <div className="text-xs text-slate-400 py-8">
              {forecast?.reasonUnavailable ||
                'Forecasting unavailable for current observation count.'}
            </div>
          )}
        </div>
      </div>

      {/* Seasonal Cycle Climatology & Within-Season Trend Comparison */}
      {trend.seasonalBreakdown && trend.seasonalBreakdown.monthly.length > 0 && (
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Seasonal Cycle Climatology &amp; Within-Season Trend Comparison
            </h3>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Dataset: {retrieved.dataset.officialName} ({retrieved.dataset.productId}) · Variable: {trend.variableName} ({trend.units}) · Region: {retrieved.region.name} · Period: {trend.startDate} to {trend.endDate} · Source: {retrieved.dataset.nasaSource}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-center">
            <div className="xl:col-span-7 h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={trend.seasonalBreakdown.monthly}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis yAxisId="mean" tick={{ fill: '#94a3b8', fontSize: 11 }} width={48} />
                  <YAxis
                    yAxisId="slope"
                    orientation="right"
                    tick={{ fill: '#f59e0b', fontSize: 10 }}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#060913',
                      borderColor: '#1e293b',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    yAxisId="mean"
                    dataKey="mean"
                    name={`Climatological Mean (${trend.units})`}
                    fill="#06b6d4"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    yAxisId="slope"
                    type="monotone"
                    dataKey="slopePerYear"
                    name={`Within-Month Sen's Slope (${trend.units}/yr)`}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f59e0b' }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="xl:col-span-5 overflow-x-auto bg-[#060913] border border-slate-800 rounded-md p-3">
              <div className="text-[11px] font-mono text-slate-400 mb-2">
                Meteorological Season Breakdown (DJF / MAM / JJA / SON)
              </div>
              <table className="w-full text-xs text-left font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-1.5 pr-2">Season</th>
                    <th className="py-1.5 pr-2">Obs</th>
                    <th className="py-1.5 pr-2">Mean ({trend.units})</th>
                    <th className="py-1.5 pr-2">Min..Max</th>
                    <th className="py-1.5">Sen Slope (/yr)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {trend.seasonalBreakdown.quarters.map((q) => (
                    <tr key={q.season}>
                      <td className="py-1.5 pr-2 text-cyan-300 font-semibold" title={q.label}>
                        {q.season}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-300">{q.validObs}</td>
                      <td className="py-1.5 pr-2 text-slate-200">{q.mean !== null ? q.mean.toFixed(2) : '—'}</td>
                      <td className="py-1.5 pr-2 text-slate-400">
                        {q.min !== null && q.max !== null ? `${q.min.toFixed(1)}..${q.max.toFixed(1)}` : '—'}
                      </td>
                      <td className="py-1.5 text-amber-300">
                        {q.slopePerYear !== null
                          ? `${q.slopePerYear >= 0 ? '+' : ''}${q.slopePerYear.toFixed(4)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Regional Spatial Distribution & Area-Weighted Sampling Map */}
      <SpatialDistributionMap retrieved={retrieved} />

      {/* Assumptions & Limitations */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <div>
          <h4 className="font-display font-semibold text-slate-200 mb-2">Statistical Methods &amp; Assumptions</h4>
          <ul className="space-y-1.5 text-slate-400 list-disc pl-4">
            {trend.diagnostics.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="font-display font-semibold text-slate-200 mb-2">Scientific Limitations</h4>
          <ul className="space-y-1.5 text-slate-400 list-disc pl-4">
            {trend.diagnostics.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
