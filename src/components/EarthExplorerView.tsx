import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  Calendar,
  Check,
  Layers,
  Maximize2,
  Minimize2,
  MousePointer,
  Pause,
  Pentagon,
  Play,
  RotateCcw,
  Search,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GibsLayerSpec, RegionLocation } from '../types/earth';
import { api } from '../lib/api';
import { EarthGlobe, type GlobeInteractionMode } from './EarthGlobe';

interface EarthExplorerViewProps {
  region: RegionLocation;
  onSelectRegion: (r: RegionLocation) => void;
  onToggleFavorite: (r: RegionLocation) => void;
  isFavorite: boolean;
  gibsLayers: GibsLayerSpec[];
  presets: RegionLocation[];
}

export const EarthExplorerView: React.FC<EarthExplorerViewProps> = ({
  region,
  onSelectRegion,
  onToggleFavorite,
  isFavorite,
  gibsLayers,
  presets,
}) => {
  const [activeLayerId, setActiveLayerId] = useState<string>(gibsLayers[0]?.id || 'blue-marble');
  const [layerDate, setLayerDate] = useState<string>('2024-07-01');
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [zoomCmd, setZoomCmd] = useState<{ type: 'in' | 'out' | 'reset'; seq: number } | null>(null);

  // Interactive area selection & drawing
  const [drawMode, setDrawMode] = useState<GlobeInteractionMode>('select');
  const [draftVertices, setDraftVertices] = useState<Array<[number, number]>>([]);

  // Search & Coordinate inputs
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RegionLocation[]>([]);
  const [searchAmbiguous, setSearchAmbiguous] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingClick, setResolvingClick] = useState(false);

  const [manualLat, setManualLat] = useState(String(region.lat));
  const [manualLon, setManualLon] = useState(String(region.lon));
  const [bboxInputs, setBboxInputs] = useState({
    west: String((region.bbox?.[0] ?? region.lon - 0.5).toFixed(2)),
    south: String((region.bbox?.[1] ?? region.lat - 0.5).toFixed(2)),
    east: String((region.bbox?.[2] ?? region.lon + 0.5).toFixed(2)),
    north: String((region.bbox?.[3] ?? region.lat + 0.5).toFixed(2)),
  });

  useEffect(() => {
    setManualLat(String(region.lat));
    setManualLon(String(region.lon));
    if (region.bbox) {
      setBboxInputs({
        west: String(region.bbox[0].toFixed(2)),
        south: String(region.bbox[1].toFixed(2)),
        east: String(region.bbox[2].toFixed(2)),
        north: String(region.bbox[3].toFixed(2)),
      });
    }
  }, [region.lat, region.lon, region.bbox]);

  const activeLayer = gibsLayers.find((l) => l.id === activeLayerId) ?? gibsLayers[0] ?? null;

  // Evaluate whether the active GIBS overlay scientifically covers the selected coordinate/domain
  const layerSpatialOk =
    !activeLayer?.latBounds ||
    (region.lat >= activeLayer.latBounds[0] && region.lat <= activeLayer.latBounds[1]);
  const layerSurfaceOk = !(activeLayer?.landOnly && region.isOcean);

  const handleLayerChange = (layer: GibsLayerSpec) => {
    setActiveLayerId(layer.id);
    if (layer.supportsTime) {
      setLayerDate(layer.defaultDate);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchText.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSearchAmbiguous(false);
    try {
      const res = await api.searchRegions(searchText);
      setSearchResults(res.regions);
      setSearchAmbiguous(res.ambiguous);
      if (res.error) setSearchError(res.error);
      if (!res.ambiguous && res.regions.length === 1) {
        onSelectRegion(res.regions[0]);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Location search failed.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleApplyCoords = async (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number.parseFloat(manualLat);
    const lon = Number.parseFloat(manualLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setSearchError('Invalid coordinates: Latitude must be -90 to 90 and Longitude -180 to 180.');
      return;
    }
    setSearchError(null);
    setResolvingClick(true);
    try {
      const res = await api.reverseGeocode(lat, lon);
      onSelectRegion(res.region);
    } catch {
      onSelectRegion({
        name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
        displayName: `Coordinates (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)`,
        country: 'Manual Coordinate Entry',
        lat,
        lon,
        bbox: [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5],
      });
    } finally {
      setResolvingClick(false);
    }
  };

  const handleApplyBbox = (e: React.FormEvent) => {
    e.preventDefault();
    const w = Number.parseFloat(bboxInputs.west);
    const s = Number.parseFloat(bboxInputs.south);
    const east = Number.parseFloat(bboxInputs.east);
    const n = Number.parseFloat(bboxInputs.north);
    if (
      ![w, s, east, n].every(Number.isFinite) ||
      s < -90 ||
      n > 90 ||
      w < -180 ||
      east > 180 ||
      s >= n ||
      w >= east
    ) {
      setSearchError('Invalid bounding box: ensure West < East (-180..180) and South < North (-90..90).');
      return;
    }
    setSearchError(null);
    const cLat = Number(((s + n) / 2).toFixed(4));
    const cLon = Number(((w + east) / 2).toFixed(4));
    onSelectRegion({
      id: `bbox-${w.toFixed(2)}-${s.toFixed(2)}-${east.toFixed(2)}-${n.toFixed(2)}`,
      name: `Area [${s.toFixed(1)}°..${n.toFixed(1)}°]`,
      displayName: `Custom Bounding Box [${w.toFixed(2)}°E..${east.toFixed(2)}°E, ${s.toFixed(2)}°N..${n.toFixed(2)}°N]`,
      country: 'Custom Area',
      featureType: 'bounding-box',
      lat: cLat,
      lon: cLon,
      bbox: [w, s, east, n],
    });
  };

  const finalizePolygon = () => {
    if (draftVertices.length < 3) return;
    const lons = draftVertices.map((v) => v[0]);
    const lats = draftVertices.map((v) => v[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const cLat = Number(((minLat + maxLat) / 2).toFixed(4));
    const cLon = Number(((minLon + maxLon) / 2).toFixed(4));
    onSelectRegion({
      id: `poly-${Date.now()}`,
      name: `Polygon (${draftVertices.length} pts)`,
      displayName: `Custom Polygon Region (${draftVertices.length} vertices centered at ${cLat.toFixed(2)}°, ${cLon.toFixed(2)}°)`,
      country: 'Custom Polygon',
      featureType: 'polygon',
      lat: cLat,
      lon: cLon,
      bbox: [minLon, minLat, maxLon, maxLat],
      polygon: draftVertices,
    });
    setDraftVertices([]);
    setDrawMode('select');
  };

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-50 bg-[#060913] p-4 flex flex-col gap-4' : 'space-y-4'}>
      {/* Top Toolbar */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="City, country, forest, desert, ocean, lat/lon..."
                className="pl-8 pr-3 py-1.5 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100 w-64 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md whitespace-nowrap"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>

          <form onSubmit={handleApplyCoords} className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.01"
              min="-90"
              max="90"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              aria-label="Latitude"
              className="w-20 px-2 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-200 tabular-nums"
              placeholder="Lat"
            />
            <input
              type="number"
              step="0.01"
              min="-180"
              max="180"
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
              aria-label="Longitude"
              className="w-20 px-2 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-200 tabular-nums"
              placeholder="Lon"
            />
            <button
              type="submit"
              disabled={resolvingClick}
              className="px-2.5 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md whitespace-nowrap"
            >
              Go
            </button>
          </form>
        </div>

        {/* Drawing & Camera Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#060913] border border-slate-800 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => {
                setDrawMode('select');
                setDraftVertices([]);
              }}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 whitespace-nowrap ${
                drawMode === 'select' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Click anywhere on Earth to select coordinates"
            >
              <MousePointer className="w-3 h-3" />
              <span>Select</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDrawMode('bbox');
                setDraftVertices([]);
              }}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 whitespace-nowrap ${
                drawMode === 'bbox' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Drag a rectangular bounding box across the globe"
            >
              <Square className="w-3 h-3" />
              <span>Draw BBox</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDrawMode('polygon');
                setDraftVertices([]);
              }}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 whitespace-nowrap ${
                drawMode === 'polygon' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Click 3 or more vertices to define a custom polygon area"
            >
              <Pentagon className="w-3 h-3" />
              <span>Polygon</span>
            </button>
          </div>

          {drawMode === 'polygon' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={draftVertices.length < 3}
                onClick={finalizePolygon}
                className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md flex items-center gap-1 whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Apply ({draftVertices.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDraftVertices([])}
                className="px-2 py-1.5 text-xs bg-[#060913] border border-slate-700 text-slate-300 rounded-md"
              >
                Clear
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => onToggleFavorite(region)}
            className={`px-3 py-1.5 text-xs rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
              isFavorite
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-[#060913] border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>{isFavorite ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            onClick={() => setAutoRotate((v) => !v)}
            className="px-2.5 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
          >
            {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{autoRotate ? 'Pause' : 'Rotate'}</span>
          </button>

          <button
            type="button"
            onClick={() => setZoomCmd((p) => ({ type: 'in', seq: (p?.seq ?? 0) + 1 }))}
            aria-label="Zoom in"
            className="p-1.5 bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomCmd((p) => ({ type: 'out', seq: (p?.seq ?? 0) + 1 }))}
            aria-label="Zoom out"
            className="p-1.5 bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomCmd((p) => ({ type: 'reset', seq: (p?.seq ?? 0) + 1 }))}
            aria-label="Reset camera"
            className="p-1.5 bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="px-2.5 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
          </button>
        </div>
      </div>

      {/* Invalid Search / Reverse Geocode Feedback */}
      {searchError && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg px-4 py-2 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {/* Search Results / Ambiguity Disambiguation */}
      {searchResults.length > 0 && (
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-3 space-y-2">
          <div className="text-xs text-slate-300 font-medium">
            {searchAmbiguous
              ? 'Multiple geographical matches found — select the exact region to inspect:'
              : 'Resolved Geographical Location:'}
          </div>
          <div className="flex flex-wrap gap-2">
            {searchResults.map((r, i) => (
              <button
                key={`${r.id || r.name}-${i}`}
                type="button"
                onClick={() => {
                  onSelectRegion(r);
                  setSearchResults([]);
                  setSearchError(null);
                }}
                className="px-3 py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md text-left"
              >
                <span className="font-medium">{r.displayName}</span>{' '}
                <span className="font-mono text-cyan-400">
                  ({r.lat.toFixed(2)}°, {r.lon.toFixed(2)}°{r.isOcean ? ' · Ocean' : ''})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Split: Layer Controls + Custom BBox + 3D Globe */}
      <div className={`grid grid-cols-1 lg:grid-cols-12 gap-4 ${isFullscreen ? 'flex-1 min-h-0' : ''}`}>
        <div className="lg:col-span-4 bg-[#0C1222] border border-slate-800 rounded-lg p-4 flex flex-col justify-between gap-4 overflow-y-auto">
          <div className="space-y-4">
            {/* Active Region Identity & Domain */}
            <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-1">
              <div className="text-xs font-semibold text-slate-100">{region.displayName}</div>
              <div className="text-[11px] font-mono text-cyan-400 tabular-nums">
                Center: {region.lat.toFixed(4)}°, {region.lon.toFixed(4)}° ·{' '}
                {region.isOcean ? 'Ocean / Marine Domain' : 'Land / Terrestrial Domain'}
              </div>
              {region.polygon && (
                <div className="text-[11px] font-mono text-emerald-300">
                  Active Custom Polygon: {region.polygon.length} vertices
                </div>
              )}
              {resolvingClick && (
                <div className="text-[11px] text-slate-400">Resolving globe coordinates via OpenStreetMap...</div>
              )}
            </div>

            {/* Applicability Warning if Selected GIBS Layer Doesn't Apply */}
            {(!layerSpatialOk || !layerSurfaceOk) && (
              <div className="bg-amber-500/10 border border-amber-500/40 rounded-md p-2.5 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  {!layerSpatialOk && (
                    <div>
                      <strong>Latitude Limit:</strong> {activeLayer?.title} covers{' '}
                      {activeLayer?.latBounds?.[0]}° to {activeLayer?.latBounds?.[1]}° latitude. Selected coordinate ({region.lat.toFixed(1)}°) is outside this sensor swath.
                    </div>
                  )}
                  {!layerSurfaceOk && (
                    <div>
                      <strong>Land-Only Layer:</strong> {activeLayer?.title} has no terrestrial vegetation signal over open ocean coordinates.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-100">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>NASA GIBS Global Layers</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Every overlay streams global WMS imagery directly from NASA GIBS.
              </p>
            </div>

            <div className="space-y-2">
              {gibsLayers.map((layer) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => handleLayerChange(layer)}
                  className={`w-full text-left p-2.5 rounded-md border transition-colors ${
                    activeLayer?.id === layer.id
                      ? 'bg-cyan-500/15 border-cyan-500/50 text-slate-100'
                      : 'bg-[#060913] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-medium">{layer.title}</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {layer.nasaSource} · {layer.units}
                    {layer.latBounds ? ` · ${layer.latBounds[0]}°..${layer.latBounds[1]}°` : ''}
                    {layer.landOnly ? ' · Land Only' : ''}
                  </div>
                </button>
              ))}
            </div>

            {activeLayer?.supportsTime && (
              <div className="pt-2 border-t border-slate-800">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  <span>GIBS Layer Observation Date</span>
                </label>
                <input
                  type="date"
                  value={layerDate}
                  max={new Date().toISOString().slice(0, 10)}
                  min="2002-01-01"
                  onChange={(e) => setLayerDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-[#060913] border border-slate-800 rounded-md text-slate-100"
                />
              </div>
            )}

            {/* Custom Bounding Box Numeric Form */}
            <form onSubmit={handleApplyBbox} className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-xs font-medium text-slate-300">Custom Bounding Box (°)</div>
              <div className="grid grid-cols-4 gap-1.5">
                {(['west', 'south', 'east', 'north'] as const).map((k) => (
                  <div key={k}>
                    <label className="block text-[10px] uppercase text-slate-400">{k}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bboxInputs[k]}
                      onChange={(e) => setBboxInputs((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="w-full px-1.5 py-1 text-[11px] font-mono bg-[#060913] border border-slate-800 rounded text-slate-200 tabular-nums"
                    />
                  </div>
                ))}
              </div>
              <button
                type="submit"
                className="w-full py-1.5 text-xs bg-[#060913] border border-slate-700 hover:border-cyan-500 text-slate-200 rounded-md"
              >
                Apply Rectangular Region
              </button>
            </form>

            <div className="pt-2 border-t border-slate-800">
              <div className="text-xs font-medium text-slate-300 mb-2">Global Reference Locations</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.id || p.name}
                    type="button"
                    onClick={() => onSelectRegion(p)}
                    className={`px-2.5 py-1 text-xs rounded border ${
                      p.name === region.name
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                        : 'bg-[#060913] border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeLayer && (
            <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-2">
              <div className="text-xs font-medium text-slate-200">{activeLayer.title}</div>
              <div className="text-[11px] text-slate-400">{activeLayer.description}</div>
              <div className="text-[11px] font-mono text-slate-400">
                Source: {activeLayer.nasaSource} · Res: {activeLayer.temporalResolution}
                {activeLayer.supportsTime ? ` · Date: ${layerDate}` : ''}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {activeLayer.legendStops.map((stop) => (
                  <div key={stop.label} className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300">
                    <span
                      className="w-3 h-3 rounded-sm border border-slate-700 shrink-0"
                      style={{ backgroundColor: stop.color }}
                    />
                    <span>{stop.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`lg:col-span-8 bg-[#0C1222] border border-slate-800 rounded-lg overflow-hidden ${isFullscreen ? 'h-full' : 'h-[620px]'}`}>
          <EarthGlobe
            region={region}
            activeLayer={activeLayer}
            layerDate={layerDate}
            autoRotate={autoRotate}
            drawMode={drawMode}
            draftPolygonVertices={draftVertices}
            zoomCommand={zoomCmd}
            onSelectCoordinates={async (lat, lon) => {
              setResolvingClick(true);
              setSearchError(null);
              try {
                const res = await api.reverseGeocode(lat, lon);
                onSelectRegion(res.region);
              } catch {
                onSelectRegion({
                  name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
                  displayName: `Selected Globe Point (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`,
                  country: 'Global Selection',
                  lat,
                  lon,
                  bbox: [lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5],
                });
              } finally {
                setResolvingClick(false);
              }
            }}
            onCompleteBbox={(bbox) => {
              const [w, s, e, n] = bbox;
              const cLat = Number(((s + n) / 2).toFixed(4));
              const cLon = Number(((w + e) / 2).toFixed(4));
              onSelectRegion({
                id: `drawn-bbox-${Date.now()}`,
                name: `Drawn BBox [${s.toFixed(1)}°, ${w.toFixed(1)}°]`,
                displayName: `Drawn Area [${w.toFixed(2)}°..${e.toFixed(2)}°E, ${s.toFixed(2)}°..${n.toFixed(2)}°N]`,
                country: 'Custom Area',
                featureType: 'bounding-box',
                lat: cLat,
                lon: cLon,
                bbox,
              });
              setDrawMode('select');
            }}
            onAddPolygonVertex={(lat, lon) => {
              setDraftVertices((prev) => [...prev, [lon, lat]]);
            }}
          />
        </div>
      </div>
    </div>
  );
};
