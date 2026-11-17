import React, { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { RetrievedDatasetResult, SpatialSamplePoint } from '../types/earth';

interface SpatialDistributionMapProps {
  retrieved: RetrievedDatasetResult;
}

function interpolateColor(t: number): string {
  // Smooth 3-stop scientific thermal-cyan scale (#0284c7 -> #10b981 -> #f59e0b -> #f43f5e)
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.33) {
    const u = clamped / 0.33;
    const r = Math.round(2 + u * (16 - 2));
    const g = Math.round(132 + u * (185 - 132));
    const b = Math.round(199 + u * (129 - 199));
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (clamped < 0.67) {
    const u = (clamped - 0.33) / 0.34;
    const r = Math.round(16 + u * (245 - 16));
    const g = Math.round(185 + u * (158 - 185));
    const b = Math.round(129 + u * (11 - 129));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const u = (clamped - 0.67) / 0.33;
  const r = Math.round(245 + u * (244 - 245));
  const g = Math.round(158 + u * (63 - 158));
  const b = Math.round(11 + u * (94 - 11));
  return `rgb(${r}, ${g}, ${b})`;
}

export const SpatialDistributionMap: React.FC<SpatialDistributionMapProps> = ({ retrieved }) => {
  const [hovered, setHovered] = useState<SpatialSamplePoint | null>(null);

  const coords = retrieved.spatialSampling?.sampledCoordinates ?? [
    {
      lat: retrieved.region.lat,
      lon: retrieved.region.lon,
      weight: Math.max(0.01, Math.cos((retrieved.region.lat * Math.PI) / 180)),
      meanValue: retrieved.summary.mean,
      validCount: retrieved.validObservations,
    },
  ];

  const { bounds, minVal, maxVal, polyPoints } = useMemo(() => {
    const allLons: number[] = coords.map((c) => c.lon);
    const allLats: number[] = coords.map((c) => c.lat);

    if (retrieved.region.bbox) {
      allLons.push(retrieved.region.bbox[0], retrieved.region.bbox[2]);
      allLats.push(retrieved.region.bbox[1], retrieved.region.bbox[3]);
    }
    if (retrieved.region.polygon) {
      for (const [pLon, pLat] of retrieved.region.polygon) {
        allLons.push(pLon);
        allLats.push(pLat);
      }
    }

    const rawMinLon = Math.min(...allLons);
    const rawMaxLon = Math.max(...allLons);
    const rawMinLat = Math.min(...allLats);
    const rawMaxLat = Math.max(...allLats);

    const padLon = Math.max(0.4, (rawMaxLon - rawMinLon) * 0.28);
    const padLat = Math.max(0.4, (rawMaxLat - rawMinLat) * 0.28);

    const vals = coords
      .map((c) => c.meanValue)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const lo = vals.length > 0 ? Math.min(...vals) : (retrieved.summary.min ?? 0);
    const hi = vals.length > 0 ? Math.max(...vals) : (retrieved.summary.max ?? 1);

    return {
      bounds: {
        minLon: rawMinLon - padLon,
        maxLon: rawMaxLon + padLon,
        minLat: rawMinLat - padLat,
        maxLat: rawMaxLat + padLat,
      },
      minVal: lo,
      maxVal: hi,
      polyPoints: retrieved.region.polygon ?? null,
    };
  }, [coords, retrieved.region.bbox, retrieved.region.polygon, retrieved.summary.min, retrieved.summary.max]);

  const W = 540;
  const H = 260;
  const pad = { l: 54, r: 22, t: 18, b: 36 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const lonSpan = bounds.maxLon - bounds.minLon || 1;
  const latSpan = bounds.maxLat - bounds.minLat || 1;

  const xAt = (lon: number) => pad.l + ((lon - bounds.minLon) / lonSpan) * innerW;
  const yAt = (lat: number) => pad.t + innerH - ((lat - bounds.minLat) / latSpan) * innerH;

  const valSpan = maxVal - minVal;

  return (
    <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
            <MapPin className="w-4 h-4 text-cyan-400" />
            <span>Regional Spatial Distribution &amp; Area-Weighted Footprint Map</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
            Dataset: {retrieved.dataset.officialName} ({retrieved.dataset.productId}) · Variable:{' '}
            {retrieved.variable.name} ({retrieved.variable.units}) · Region: {retrieved.region.name} ·{' '}
            {retrieved.actualAvailablePeriod?.startDate ?? retrieved.requestedPeriod.startDate} to{' '}
            {retrieved.actualAvailablePeriod?.endDate ?? retrieved.requestedPeriod.endDate} · Source:{' '}
            {retrieved.dataset.nasaSource}
          </div>
        </div>
        <div className="text-[11px] font-mono text-cyan-300 bg-[#060913] border border-slate-800 px-2.5 py-1 rounded">
          {retrieved.spatialSampling?.weightingMethod === 'cosine-latitude-area-weighted'
            ? 'Cosine-Latitude Area Weighted'
            : 'Single-Grid Point'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-8 bg-[#060913] border border-slate-800 rounded-md p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Spatial distribution of sampled NASA coordinates">
            {/* Latitude & Longitude Graticule */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const gx = pad.l + f * innerW;
              const gy = pad.t + f * innerH;
              const lonLabel = bounds.minLon + f * lonSpan;
              const latLabel = bounds.maxLat - f * latSpan;
              return (
                <g key={f}>
                  <line x1={gx} y1={pad.t} x2={gx} y2={H - pad.b} stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                  <line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                  <text x={gx} y={H - 12} textAnchor="middle" fill="#64748b" fontSize="10" fontFamily="monospace">
                    {lonLabel.toFixed(1)}°
                  </text>
                  <text x={pad.l - 6} y={gy + 3} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
                    {latLabel.toFixed(1)}°
                  </text>
                </g>
              );
            })}

            {/* Region Bounding Box */}
            {retrieved.region.bbox && (
              <rect
                x={xAt(retrieved.region.bbox[0])}
                y={yAt(retrieved.region.bbox[3])}
                width={Math.max(4, xAt(retrieved.region.bbox[2]) - xAt(retrieved.region.bbox[0]))}
                height={Math.max(4, yAt(retrieved.region.bbox[1]) - yAt(retrieved.region.bbox[3]))}
                fill="#06b6d4"
                fillOpacity={0.07}
                stroke="#22d3ee"
                strokeWidth="1.5"
                strokeDasharray="5,3"
              />
            )}

            {/* Custom Polygon Boundary */}
            {polyPoints && polyPoints.length >= 3 && (
              <polygon
                points={polyPoints.map(([lon, lat]) => `${xAt(lon).toFixed(1)},${yAt(lat).toFixed(1)}`).join(' ')}
                fill="#10b981"
                fillOpacity={0.1}
                stroke="#34d399"
                strokeWidth="2"
              />
            )}

            {/* Sampled NASA Grid Coordinates Colored by Period Mean */}
            {coords.map((pt, idx) => {
              const cx = xAt(pt.lon);
              const cy = yAt(pt.lat);
              const t =
                pt.meanValue !== null && pt.meanValue !== undefined && valSpan > 1e-6
                  ? (pt.meanValue - minVal) / valSpan
                  : 0.45;
              const fill = pt.meanValue !== null && pt.meanValue !== undefined ? interpolateColor(t) : '#64748b';
              const isSelected = hovered?.lat === pt.lat && hovered?.lon === pt.lon;
              return (
                <g
                  key={`${pt.lat}-${pt.lon}-${idx}`}
                  onMouseEnter={() => setHovered(pt)}
                  onMouseLeave={() => setHovered(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 10 : coords.length === 1 ? 11 : 8}
                    fill={fill}
                    stroke="#f8fafc"
                    strokeWidth={isSelected ? 2.2 : 1.4}
                  />
                  {pt.meanValue !== null && pt.meanValue !== undefined && (
                    <text
                      x={cx}
                      y={cy - 12}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {pt.meanValue.toFixed(1)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="lg:col-span-4 space-y-3 text-xs">
          {/* Quantitative Color Scale Bar */}
          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-2">
            <div className="text-[11px] font-mono text-slate-400">
              Sample Point Mean Scale ({retrieved.variable.units})
            </div>
            <div
              className="h-2.5 w-full rounded"
              style={{
                background:
                  'linear-gradient(90deg, rgb(2,132,199) 0%, rgb(16,185,129) 33%, rgb(245,158,11) 67%, rgb(244,63,94) 100%)',
              }}
            />
            <div className="flex justify-between font-mono text-[11px] text-slate-300 tabular-nums">
              <span>{minVal.toFixed(2)}</span>
              <span>{((minVal + maxVal) / 2).toFixed(2)}</span>
              <span>{maxVal.toFixed(2)}</span>
            </div>
          </div>

          {/* Sample Details Table / Active Hover */}
          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-1.5">
            <div className="text-[11px] font-mono text-slate-400">
              {hovered ? 'Hovered Sample Node' : `Sample Nodes (${coords.length})`}
            </div>
            {hovered ? (
              <div className="font-mono text-[11px] text-slate-200 space-y-1 tabular-nums">
                <div>Coords: {hovered.lat.toFixed(3)}°, {hovered.lon.toFixed(3)}°</div>
                <div>Cos(lat) Area Weight: {hovered.weight?.toFixed(4) ?? '1.0000'}</div>
                <div>
                  Node Mean: {hovered.meanValue?.toFixed(3) ?? 'Missing'} {retrieved.variable.units}
                </div>
                <div>Valid Obs: {hovered.validCount ?? retrieved.validObservations}</div>
              </div>
            ) : (
              <div className="max-h-28 overflow-y-auto divide-y divide-slate-800/80 font-mono text-[11px] tabular-nums">
                {coords.map((pt, i) => (
                  <div key={i} className="py-1 flex justify-between gap-2 text-slate-300">
                    <span>
                      {pt.lat.toFixed(2)}°, {pt.lon.toFixed(2)}° (w={pt.weight?.toFixed(2) ?? '1.00'})
                    </span>
                    <span className="text-cyan-300">
                      {pt.meanValue !== null && pt.meanValue !== undefined
                        ? `${pt.meanValue.toFixed(2)} ${retrieved.variable.units}`
                        : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-400 leading-relaxed">
            Resolution: <span className="font-mono text-slate-300">{retrieved.dataset.spatialResolution}</span>. Hover any sample point to inspect its exact cosine-latitude weight and historical mean.
          </div>
        </div>
      </div>
    </div>
  );
};
