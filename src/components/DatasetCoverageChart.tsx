import React from 'react';
import type { DatasetCoverageStatus, DatasetMetadata, RegionLocation } from '../types/earth';

interface DatasetCoverageChartProps {
  datasets: DatasetMetadata[];
  coverageList: DatasetCoverageStatus[];
  region: RegionLocation;
  startDate: string;
  endDate: string;
}

const MIN_YEAR = 1979;
const MAX_YEAR = new Date().getUTCFullYear();
const YEAR_SPAN = MAX_YEAR - MIN_YEAR || 1;

function parseYearFrac(dateStr: string): number {
  const y = Number.parseInt(dateStr.slice(0, 4), 10);
  const m = Number.parseInt(dateStr.slice(5, 7), 10) || 1;
  if (!Number.isFinite(y)) return MAX_YEAR;
  return y + (m - 1) / 12;
}

export const DatasetCoverageChart: React.FC<DatasetCoverageChartProps> = ({
  datasets,
  coverageList,
  region,
  startDate,
  endDate,
}) => {
  const reqStartYear = Math.max(MIN_YEAR, parseYearFrac(startDate));
  const reqEndYear = Math.min(MAX_YEAR, parseYearFrac(endDate));
  const reqLeftPct = ((reqStartYear - MIN_YEAR) / YEAR_SPAN) * 100;
  const reqWidthPct = Math.max(1.5, ((reqEndYear - reqStartYear) / YEAR_SPAN) * 100);

  // Target region latitude position mapped across -90..+90 (left to right)
  const regionLatPct = ((region.lat + 90) / 180) * 100;

  return (
    <div className="bg-[#060913] border border-slate-800 rounded-md p-3.5 mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-display font-semibold text-slate-200">
          Dataset Temporal Span ({MIN_YEAR}–{MAX_YEAR}) &amp; Latitude Swath Coverage (-90° to +90°)
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80 inline-block" /> Live Retrievable
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/80 inline-block" /> Auth Required (Covered)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/70 inline-block" /> Excluded Here
          </span>
          <span className="text-cyan-300">
            Selected Window: {startDate.slice(0, 7)} → {endDate.slice(0, 7)} · Lat: {region.lat.toFixed(1)}°
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-[11px] font-mono">
        {/* Left: Temporal Timeline Bars */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-slate-500">
            <span>Temporal Record vs Selected Date Window</span>
            <span>{MIN_YEAR} — {MAX_YEAR}</span>
          </div>
          <div className="space-y-1.5 relative">
            {datasets.map((d) => {
              const cov = coverageList.find((c) => c.datasetId === d.id);
              const dsStart = Math.max(MIN_YEAR, parseYearFrac(d.historicalCoverageStart));
              const leftPct = ((dsStart - MIN_YEAR) / YEAR_SPAN) * 100;
              const widthPct = Math.max(2, 100 - leftPct);
              const barColor = !cov?.temporalCovered
                ? 'bg-rose-500/75'
                : d.status === 'operational'
                  ? 'bg-emerald-500/80'
                  : 'bg-amber-500/75';
              return (
                <div key={d.id} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-4 truncate text-slate-300" title={d.officialName}>
                    {d.cmrShortName === 'POWER' ? 'NASA POWER' : d.cmrShortName}
                  </div>
                  <div className="col-span-8 h-4 bg-slate-900 border border-slate-800 rounded relative overflow-hidden">
                    <div
                      className={`absolute top-0.5 bottom-0.5 rounded-sm ${barColor}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={`${d.historicalCoverageStart} to ${d.historicalCoverageEnd}`}
                    />
                    {/* Active requested window overlay */}
                    <div
                      className="absolute top-0 bottom-0 border-x border-cyan-400 bg-cyan-400/15 pointer-events-none"
                      style={{ left: `${reqLeftPct}%`, width: `${reqWidthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Latitude Swath Bars */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-slate-500">
            <span>Latitude Swath (-90°S .. 0° .. +90°N)</span>
            <span>Target: {region.lat.toFixed(1)}°</span>
          </div>
          <div className="space-y-1.5 relative">
            {datasets.map((d) => {
              const cov = coverageList.find((c) => c.datasetId === d.id);
              const [minLat, maxLat] = d.latBounds;
              const leftPct = ((minLat + 90) / 180) * 100;
              const widthPct = ((maxLat - minLat) / 180) * 100;
              const ok = cov ? cov.spatialCovered && cov.surfaceApplicable : true;
              const barColor = !ok
                ? 'bg-rose-500/75'
                : d.status === 'operational'
                  ? 'bg-emerald-500/80'
                  : 'bg-amber-500/75';
              return (
                <div key={d.id} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-5 truncate text-slate-300">
                    {minLat}°..{maxLat}° {d.landOnly ? '(Land)' : '(All)'}
                  </div>
                  <div className="col-span-7 h-4 bg-slate-900 border border-slate-800 rounded relative overflow-hidden">
                    <div
                      className={`absolute top-0.5 bottom-0.5 rounded-sm ${barColor}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                    {/* Target region latitude pin */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 pointer-events-none"
                      style={{ left: `${regionLatPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
