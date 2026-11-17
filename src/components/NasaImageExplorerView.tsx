import React, { useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import type { NasaImageItem } from '../types/earth';
import { api } from '../lib/api';

const QUICK_TOPICS = [
  'Western Ghats India',
  'Monsoon Satellite',
  'Earth from ISS',
  'MODIS Vegetation',
  'Tropical Cyclone',
  'Amazon River',
  'Arctic Sea Ice',
  'GPM Satellite',
];

export const NasaImageExplorerView: React.FC = () => {
  const [query, setQuery] = useState('Western Ghats India');
  const [yearStart, setYearStart] = useState('');
  const [items, setItems] = useState<NasaImageItem[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NasaImageItem | null>(null);

  const runSearch = async (q: string, ys = yearStart) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchNasaImages(q, ys || undefined, 1);
      setItems(res.items);
      setTotalHits(res.totalHits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query NASA Image Library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSearch('Earth observation');
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-semibold text-lg text-slate-100">
              NASA Image Explorer
            </h2>
            <p className="text-xs text-slate-400">
              Live search across images-api.nasa.gov. Visual imagery is for contextual exploration and is not a quantitative measurement.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            {totalHits.toLocaleString()} archive matches
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search missions, Earth phenomena, satellites..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <input
            type="number"
            min="1958"
            max={new Date().getFullYear()}
            value={yearStart}
            onChange={(e) => setYearStart(e.target.value)}
            placeholder="From Year"
            className="w-28 px-3 py-2 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
          >
            {loading ? 'Searching...' : 'Search Archive'}
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setQuery(t);
                runSearch(t);
              }}
              className="px-2.5 py-1 text-xs bg-[#060913] border border-slate-800 hover:border-cyan-500/50 text-slate-300 rounded"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-lg p-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-xs text-cyan-300 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Querying official NASA Image and Video Library...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-8 text-center text-xs text-slate-400">
          No NASA archive images found for &ldquo;{query}&rdquo;. Try another keyword.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <button
              key={item.nasaId}
              type="button"
              onClick={() => setSelected(item)}
              className="text-left bg-[#0C1222] border border-slate-800 hover:border-cyan-500/50 rounded-lg overflow-hidden flex flex-col transition-colors"
            >
              <div className="h-44 w-full bg-[#060913] overflow-hidden flex items-center justify-center">
                <img
                  src={item.previewUrl}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="p-3.5 space-y-1 flex-1 flex flex-col justify-between">
                <div className="font-medium text-xs text-slate-100 line-clamp-2">{item.title}</div>
                <div className="text-[11px] font-mono text-slate-400 pt-1">
                  {item.center} · {item.dateCreated ? item.dateCreated.slice(0, 10) : 'Archive'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0C1222] border border-slate-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100 truncate">
                <ImageIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate">{selected.title}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close modal"
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <img
                src={selected.previewUrl}
                alt={selected.title}
                referrerPolicy="no-referrer"
                className="w-full max-h-80 object-contain bg-[#060913] rounded-md"
              />
              <div className="text-xs text-slate-300 leading-relaxed">{selected.description}</div>
              <div className="text-xs font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                <div>NASA ID: {selected.nasaId} · Center: {selected.center}</div>
                {selected.photographer && <div>Credit: {selected.photographer}</div>}
                <div>Date: {selected.dateCreated || 'Unknown'}</div>
              </div>
              <div className="flex justify-end pt-2">
                <a
                  href={selected.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md flex items-center gap-1.5"
                >
                  <span>Open Original NASA Record</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
