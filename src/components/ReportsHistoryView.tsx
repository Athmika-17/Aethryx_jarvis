import React, { useState } from 'react';
import {
  Bookmark,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Loader2,
  MapPin,
  Trash2,
} from 'lucide-react';
import type {
  AnomalyDetectionResult,
  ForecastResult,
  RegionLocation,
  RetrievedDatasetResult,
  SavedInvestigation,
  TrendAnalysisResult,
} from '../types/earth';
import { api } from '../lib/api';
import { exportPdfReport } from '../lib/pdfExport';

interface ReportsHistoryViewProps {
  retrieved: RetrievedDatasetResult | null;
  trend: TrendAnalysisResult | null;
  anomalies: AnomalyDetectionResult | null;
  forecast: ForecastResult | null;
  latestAiExplanation?: string;
  investigations: SavedInvestigation[];
  favorites: RegionLocation[];
  onLoadInvestigation: (inv: SavedInvestigation) => void;
  onDeleteInvestigation: (id: string) => Promise<void>;
  onSelectRegion: (r: RegionLocation) => void;
  onDeleteFavorite: (id: string) => Promise<void>;
  onGoToLab: () => void;
}

export const ReportsHistoryView: React.FC<ReportsHistoryViewProps> = ({
  retrieved,
  trend,
  anomalies,
  forecast,
  latestAiExplanation,
  investigations,
  favorites,
  onLoadInvestigation,
  onDeleteInvestigation,
  onSelectRegion,
  onDeleteFavorite,
  onGoToLab,
}) => {
  const [exporting, setExporting] = useState<'pdf' | 'csv' | 'html' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canExport = Boolean(retrieved && retrieved.retrievalStatus === 'success');

  const handleExport = async (format: 'pdf' | 'csv' | 'html') => {
    if (!retrieved) return;
    setExporting(format);
    setExportError(null);
    try {
      if (format === 'pdf') {
        exportPdfReport({
          retrieved,
          trend,
          anomalies,
          forecast,
          aiExplanation: latestAiExplanation,
        });
      } else {
        await api.exportReport(format, {
          retrieved,
          trend,
          anomalies,
          forecast,
          aiExplanation: latestAiExplanation,
        });
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Report export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Report Generation Panel */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display font-semibold text-lg text-slate-100">
              Scientific Report Export
            </h2>
            <p className="text-xs text-slate-400">
              Download reproducible PDF, CSV, or HTML reports built strictly from your active retrieved observations and statistical outputs.
            </p>
          </div>
          {canExport && retrieved && (
            <span className="text-xs font-mono text-cyan-400">
              Active: {retrieved.region.name} · {retrieved.variable.id} ({retrieved.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'})
            </span>
          )}
        </div>

        {canExport && retrieved ? (
          <div className="space-y-4">
            <div className="bg-[#060913] border border-slate-800 rounded-md p-3.5 text-xs grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
              <div>
                <span className="text-slate-400">Dataset:</span>{' '}
                <span className="text-slate-200">{retrieved.dataset.productId}</span>
              </div>
              <div>
                <span className="text-slate-400">Period:</span>{' '}
                <span className="text-slate-200">
                  {retrieved.actualAvailablePeriod?.startDate} → {retrieved.actualAvailablePeriod?.endDate}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Observations:</span>{' '}
                <span className="text-slate-200">
                  {retrieved.validObservations} valid / {retrieved.missingObservations} missing
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => handleExport('pdf')}
                className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md flex items-center gap-2"
              >
                {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                <span>Download PDF Report</span>
              </button>

              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => handleExport('csv')}
                className="px-4 py-2 text-xs font-medium bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-100 rounded-md flex items-center gap-2"
              >
                {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                <span>Download CSV Time-Series</span>
              </button>

              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => handleExport('html')}
                className="px-4 py-2 text-xs font-medium bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-100 rounded-md flex items-center gap-2"
              >
                {exporting === 'html' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode2 className="w-4 h-4" />}
                <span>Download HTML Report</span>
              </button>
            </div>

            {exportError && <div className="text-xs text-rose-400">{exportError}</div>}
          </div>
        ) : (
          <div className="bg-[#060913] border border-slate-800 rounded-md p-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              No active investigation is loaded. Retrieve a dataset in Data Laboratory or open a saved investigation below to generate reports.
            </span>
            <button
              type="button"
              onClick={onGoToLab}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
            >
              Open Data Laboratory
            </button>
          </div>
        )}
      </div>

      {/* Saved Investigations History */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-base text-slate-100">
            Saved Investigations ({investigations.length})
          </h3>
          <span className="text-xs font-mono text-slate-400">SQLite Persistent Archive</span>
        </div>

        {investigations.length === 0 ? (
          <div className="text-xs text-slate-400 py-4">
            No saved investigations yet. Run an analysis in Trend Detective and click Save Investigation.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {investigations.map((inv) => (
              <div
                key={inv.id}
                className="py-3 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-100">{inv.title}</div>
                  <div className="text-xs font-mono text-slate-400">
                    {inv.region.displayName} · {inv.productId} · {inv.startDate} to {inv.endDate} ·{' '}
                    {inv.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'}
                  </div>
                  <div className="text-xs text-slate-300 font-mono tabular-nums">
                    Saved {new Date(inv.createdAt).toLocaleString()}
                    {inv.slopePerYear !== undefined &&
                      ` · Sen's slope: ${inv.slopePerYear >= 0 ? '+' : ''}${inv.slopePerYear.toFixed(4)} ${inv.units}/yr`}
                    {inv.mannKendallP !== undefined && ` · MK p=${inv.mannKendallP.toFixed(4)}`}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onLoadInvestigation(inv)}
                    className="px-3 py-1.5 text-xs font-medium bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-600/30 rounded-md flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Load &amp; Export</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteInvestigation(inv.id)}
                    aria-label="Delete saved investigation"
                    className="p-1.5 text-slate-400 hover:text-rose-400 border border-slate-800 rounded-md"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Favorite Regions */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-amber-400" />
          <h3 className="font-display font-semibold text-base text-slate-100">
            Favorite Regions ({favorites.length})
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {favorites.map((fav) => (
            <div
              key={fav.id || fav.name}
              className="bg-[#060913] border border-slate-800 rounded-md p-3 flex items-center justify-between gap-2"
            >
              <button
                type="button"
                onClick={() => onSelectRegion(fav)}
                className="text-left min-w-0 flex-1"
              >
                <div className="text-xs font-medium text-slate-100 flex items-center gap-1.5 truncate">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{fav.name}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                  {fav.lat.toFixed(3)}°, {fav.lon.toFixed(3)}° · {fav.country}
                </div>
              </button>
              {fav.id && (
                <button
                  type="button"
                  onClick={() => onDeleteFavorite(fav.id!)}
                  aria-label={`Remove ${fav.name} from favorites`}
                  className="p-1.5 text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
