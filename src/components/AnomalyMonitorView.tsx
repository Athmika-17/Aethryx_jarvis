import React from 'react';
import { Activity, AlertCircle, HelpCircle } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AnomalyDetectionResult,
  AnomalyMethod,
  RetrievedDatasetResult,
} from '../types/earth';

interface AnomalyMonitorViewProps {
  retrieved: RetrievedDatasetResult | null;
  anomalies: AnomalyDetectionResult | null;
  method: AnomalyMethod;
  threshold: number;
  onChangeParams: (method: AnomalyMethod, threshold: number) => void;
  onGoToLab: () => void;
}

export const AnomalyMonitorView: React.FC<AnomalyMonitorViewProps> = ({
  retrieved,
  anomalies,
  method,
  threshold,
  onChangeParams,
  onGoToLab,
}) => {
  if (!retrieved || !anomalies || retrieved.retrievalStatus !== 'success') {
    return (
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-8 text-center space-y-3">
        <HelpCircle className="w-8 h-8 text-cyan-400 mx-auto" />
        <h2 className="font-display font-semibold text-lg text-slate-100">
          No Active Observations Loaded for Anomaly Detection
        </h2>
        <p className="text-xs text-slate-400 max-w-lg mx-auto">
          Retrieve a regional time series in Data Laboratory to evaluate seasonal Z-scores, IQR outliers, and moving-average deviations.
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

  const chartData = anomalies.baselineSeries.map((pt) => ({
    date: pt.date,
    observed: pt.observed,
    baseline: pt.baseline,
    band: pt.lowerBand !== null && pt.upperBand !== null ? [pt.lowerBand, pt.upperBand] : undefined,
    anomalyPoint: pt.isAnomaly ? pt.observed : null,
  }));

  return (
    <div className="space-y-6">
      {/* Header & Method Controls */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-cyan-400">
            {retrieved.region.displayName} · {retrieved.variable.name} ({retrieved.variable.units}) ·{' '}
            {retrieved.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
          </div>
          <h2 className="font-display font-semibold text-lg text-slate-100 mt-0.5">
            Environmental Anomaly Monitor
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Detection Method</label>
            <select
              value={method}
              onChange={(e) => {
                const nextMethod = e.target.value as AnomalyMethod;
                const defaultThresh = nextMethod === 'iqr' ? 1.5 : 2.0;
                onChangeParams(nextMethod, defaultThresh);
              }}
              className="px-3 py-1.5 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100"
            >
              <option value="seasonal-z-score">Seasonal Z-Score (Month Baseline)</option>
              <option value="z-score">Global Z-Score</option>
              <option value="iqr">Tukey Interquartile Range (IQR)</option>
              <option value="moving-average">Moving-Average Deviation</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1 font-mono">
              Threshold: {threshold.toFixed(1)} {method === 'iqr' ? '× IQR' : 'σ'}
            </label>
            <input
              type="range"
              min="1.2"
              max="3.5"
              step="0.1"
              value={threshold}
              onChange={(e) => onChangeParams(method, Number.parseFloat(e.target.value))}
              className="w-36 accent-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">Flagged Anomalies</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-slate-100 tabular-nums">
            {anomalies.anomalyCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {anomalies.totalValidObservations} valid obs
            </span>
          </div>
        </div>
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">Positive Departures (Above Baseline)</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-amber-300 tabular-nums">
            {anomalies.positiveCount}
          </div>
        </div>
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-400">Negative Departures (Below Baseline)</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
            {anomalies.negativeCount}
          </div>
        </div>
      </div>

      {/* Baseline & Anomaly Chart */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>Observed Series vs Expected Baseline &amp; Threshold Envelope</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Dataset: {retrieved.dataset.officialName} ({retrieved.dataset.productId}) · Variable:{' '}
              {retrieved.variable.name} ({anomalies.units}) · Region: {retrieved.region.name} ·{' '}
              {retrieved.actualAvailablePeriod?.startDate ?? retrieved.requestedPeriod.startDate} to{' '}
              {retrieved.actualAvailablePeriod?.endDate ?? retrieved.requestedPeriod.endDate} · Source:{' '}
              {retrieved.dataset.nasaSource}
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Red markers denote statistical departures exceeding {threshold.toFixed(1)} {method === 'iqr' ? '× IQR' : 'σ'}
          </span>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={30} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} width={52} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#060913',
                  borderColor: '#1e293b',
                  fontSize: '12px',
                }}
              />
              <Area
                type="monotone"
                dataKey="band"
                name="Normal Threshold Band"
                stroke="none"
                fill="#38bdf8"
                fillOpacity={0.1}
              />
              <Line
                type="monotone"
                dataKey="baseline"
                name="Expected Baseline"
                stroke="#64748b"
                strokeWidth={1.3}
                strokeDasharray="4 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="observed"
                name={`Observed (${anomalies.units})`}
                stroke="#06b6d4"
                strokeWidth={1.6}
                dot={false}
              />
              <Scatter
                dataKey="anomalyPoint"
                name="Flagged Anomaly"
                fill="#f43f5e"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Flagged Anomalies Table */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="font-display font-semibold text-sm text-slate-100">
          Flagged Anomaly Diagnostics
        </h3>
        {anomalies.anomalies.length === 0 ? (
          <div className="text-xs text-slate-400 py-4">
            No observations exceeded the selected threshold ({threshold.toFixed(1)}) using {method}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Observed</th>
                  <th className="py-2 pr-3">Baseline</th>
                  <th className="py-2 pr-3">Deviation</th>
                  <th className="py-2 pr-3">Z-Score</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2">Explanation &amp; Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {anomalies.anomalies.slice(0, 40).map((item, idx) => (
                  <tr key={`${item.date}-${idx}`} className="align-top">
                    <td className="py-2.5 pr-3 font-mono text-slate-200 whitespace-nowrap">
                      {item.date}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-100 whitespace-nowrap">
                      {item.observed.toFixed(2)} {anomalies.units}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {item.expectedBaseline.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 pr-3 font-mono tabular-nums whitespace-nowrap ${
                        item.deviation >= 0 ? 'text-amber-300' : 'text-cyan-300'
                      }`}
                    >
                      {item.deviation >= 0 ? '+' : ''}
                      {item.deviation.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-200">
                      {item.zScore !== null ? item.zScore.toFixed(2) : 'N/A'}
                    </td>
                    <td className="py-2.5 pr-3 capitalize">
                      <span
                        className={
                          item.severity === 'extreme'
                            ? 'text-rose-400 font-medium'
                            : item.severity === 'notable'
                              ? 'text-amber-300 font-medium'
                              : 'text-slate-300'
                        }
                      >
                        {item.severity}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-300">
                      <div>{item.reason}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{item.confidenceNote}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-3 border-t border-slate-800 flex items-start gap-2 text-xs text-slate-400">
          <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div>{anomalies.limitations.join(' ')}</div>
        </div>
      </div>
    </div>
  );
};
