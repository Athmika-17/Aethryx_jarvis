import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileBarChart2,
  FlaskConical,
  Globe2,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  Mic,
  MicOff,
  Settings as SettingsIcon,
  TrendingUp,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type {
  AggregationPeriod,
  AnomalyDetectionResult,
  AnomalyMethod,
  AssistantMessage,
  DataMode,
  DatasetConnectorId,
  DatasetMetadata,
  ForecastResult,
  GibsLayerSpec,
  RegionLocation,
  RetrievedDatasetResult,
  SavedInvestigation,
  TrendAnalysisResult,
} from './types/earth';
import { api, type HealthInfo, type UserPreferences } from './lib/api';
import { AethryxEmblem } from './components/AethryxEmblem';
import { AiAssistantView } from './components/AiAssistantView';
import { AnomalyMonitorView } from './components/AnomalyMonitorView';
import { DataLaboratoryView } from './components/DataLaboratoryView';
import { EarthExplorerView } from './components/EarthExplorerView';
import {
  MissionDashboard,
  type EnvironmentalSnapshotCard,
} from './components/MissionDashboard';
import { NasaImageExplorerView } from './components/NasaImageExplorerView';
import { ReportsHistoryView } from './components/ReportsHistoryView';
import { SettingsView } from './components/SettingsView';
import { TrendDetectiveView, type ComparisonEntry } from './components/TrendDetectiveView';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';

const INITIAL_DEMO_REGION: RegionLocation = {
  id: 'shivamogga',
  name: 'Shivamogga',
  displayName: 'Shivamogga, Karnataka, India',
  country: 'India',
  featureType: 'city',
  lat: 13.9299,
  lon: 75.5681,
  bbox: [74.95, 13.45, 76.15, 14.45],
  isOcean: false,
  isFavorite: true,
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Mission Dashboard', icon: LayoutDashboard },
  { id: 'explorer', label: 'Earth Explorer', icon: Globe2 },
  { id: 'lab', label: 'Data Laboratory', icon: FlaskConical },
  { id: 'trends', label: 'Trend Detective', icon: TrendingUp },
  { id: 'anomalies', label: 'Anomaly Monitor', icon: Activity },
  { id: 'assistant', label: 'AI Assistant', icon: Bot },
  { id: 'images', label: 'NASA Image Explorer', icon: ImageIcon },
  { id: 'reports', label: 'Reports & History', icon: FileBarChart2 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;

type NavTabId = (typeof NAV_ITEMS)[number]['id'];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clockText, setClockText] = useState(() => new Date().toUTCString().slice(17, 25));

  // Core Workspace State (Shivamogga is only the initial demonstration example; user can analyze any location worldwide)
  const [region, setRegion] = useState<RegionLocation>(INITIAL_DEMO_REGION);
  const [mode, setMode] = useState<DataMode>('live');
  const [selectedDatasetId, setSelectedDatasetId] = useState<DatasetConnectorId>('nasa-power');
  const [selectedVariableId, setSelectedVariableId] = useState<string>('PRECTOTCORR');
  const [startDate, setStartDate] = useState<string>('2005-01-01');
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [aggregation, setAggregation] = useState<AggregationPeriod>('monthly');
  const [alpha, setAlpha] = useState<number>(0.05);
  const [anomalyMethod, setAnomalyMethod] = useState<AnomalyMethod>('seasonal-z-score');
  const [anomalyThreshold, setAnomalyThreshold] = useState<number>(2.0);

  // Remote Metadata & Persistence State
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [datasets, setDatasets] = useState<DatasetMetadata[]>([]);
  const [gibsLayers, setGibsLayers] = useState<GibsLayerSpec[]>([]);
  const [presets, setPresets] = useState<RegionLocation[]>([INITIAL_DEMO_REGION]);
  const [favorites, setFavorites] = useState<RegionLocation[]>([INITIAL_DEMO_REGION]);
  const [investigations, setInvestigations] = useState<SavedInvestigation[]>([]);
  const [preferences, setPreferences] = useState<UserPreferences>({
    defaultMode: 'live',
    alpha: 0.05,
    voiceName: '',
    autoSpeak: true,
    wakeWordEnabled: false,
    defaultRegionName: 'Shivamogga, Karnataka, India',
  });

  // Active Scientific Analysis Results
  const [retrieving, setRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);
  const [retrieved, setRetrieved] = useState<RetrievedDatasetResult | null>(null);
  const [trend, setTrend] = useState<TrendAnalysisResult | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyDetectionResult | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonEntry[]>([]);

  // Dashboard 6 Overview Cards
  const [snapshots, setSnapshots] = useState<EnvironmentalSnapshotCard[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Save Investigation & AI State
  const [savingInvestigation, setSavingInvestigation] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [aiSending, setAiSending] = useState(false);

  // Live UTC Clock
  useEffect(() => {
    const id = window.setInterval(() => {
      setClockText(new Date().toUTCString().slice(17, 25));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Pipeline Runner: Retrieve -> Trend -> Anomalies -> Forecast
  const runAnalysisPipeline = useCallback(
    async (opts?: {
      targetRegion?: RegionLocation;
      overrideMode?: DataMode;
      overrideDatasetId?: DatasetConnectorId;
      overrideVarId?: string;
      overrideAlpha?: number;
    }) => {
      const targetRegion = opts?.targetRegion ?? region;
      const targetMode = opts?.overrideMode ?? mode;
      const targetDataset = opts?.overrideDatasetId ?? selectedDatasetId;
      const targetVar = opts?.overrideVarId ?? selectedVariableId;
      const targetAlpha = opts?.overrideAlpha ?? alpha;

      setRetrieving(true);
      setRetrievalError(null);
      setSavedNotice(null);
      setComparisons([]);

      try {
        const ret = await api.retrieveData({
          datasetId: targetDataset,
          variableId: targetVar,
          region: targetRegion,
          startDate,
          endDate,
          aggregation,
          mode: targetMode,
        });
        setRetrieved(ret);

        if (ret.retrievalStatus !== 'success') {
          setTrend(null);
          setAnomalies(null);
          setForecast(null);
          return ret;
        }

        const [tr, an, fc] = await Promise.all([
          api.analyzeTrend(ret, targetAlpha),
          api.detectAnomalies(ret, anomalyMethod, anomalyThreshold),
          api.generateForecast(ret, aggregation === 'annual' ? 5 : 24),
        ]);
        setTrend(tr);
        setAnomalies(an);
        setForecast(fc);
        return ret;
      } catch (err) {
        setRetrievalError(err instanceof Error ? err.message : 'Data retrieval failed');
        return null;
      } finally {
        setRetrieving(false);
      }
    },
    [
      region,
      mode,
      selectedDatasetId,
      selectedVariableId,
      startDate,
      endDate,
      aggregation,
      alpha,
      anomalyMethod,
      anomalyThreshold,
    ],
  );

  // Load 6 Dashboard Environmental Overview Cards for Active Region
  const refreshDashboardSnapshots = useCallback(
    async (targetRegion: RegionLocation, targetMode: DataMode, hasEarthdata: boolean) => {
      setSnapshotsLoading(true);
      const curYear = new Date().getUTCFullYear();
      const snapStart = `${curYear - 2}-01-01`;
      const snapEnd = `${curYear}-12-31`;

      const specs: Array<{
        id: string;
        label: string;
        category: EnvironmentalSnapshotCard['category'];
        datasetId: DatasetConnectorId;
        variableId: string;
        units: string;
        sourceLabel: string;
      }> = [
        {
          id: 'temp',
          label: 'Temperature (2m)',
          category: 'temperature',
          datasetId: 'nasa-power',
          variableId: 'T2M',
          units: '°C',
          sourceLabel: 'NASA POWER (MERRA-2)',
        },
        {
          id: 'precip',
          label: 'Precipitation',
          category: 'precipitation',
          datasetId: 'nasa-power',
          variableId: 'PRECTOTCORR',
          units: 'mm/day',
          sourceLabel: 'NASA POWER (Bias-Corrected)',
        },
        {
          id: 'veg',
          label: 'Vegetation (MODIS NDVI)',
          category: 'vegetation',
          datasetId: 'modis',
          variableId: 'MODIS_NDVI',
          units: 'NDVI',
          sourceLabel: 'NASA LP DAAC MOD13C2',
        },
        {
          id: 'humidity',
          label: 'Atmospheric Humidity',
          category: 'humidity',
          datasetId: 'nasa-power',
          variableId: 'RH2M',
          units: '%',
          sourceLabel: 'NASA POWER (MERRA-2)',
        },
        {
          id: 'wind',
          label: 'Wind Speed (10m)',
          category: 'wind',
          datasetId: 'nasa-power',
          variableId: 'WS10M',
          units: 'm/s',
          sourceLabel: 'NASA POWER (MERRA-2)',
        },
        {
          id: 'land',
          label: 'Land-Surface Soil Wetness',
          category: 'land',
          datasetId: 'nasa-power',
          variableId: 'GWETROOT',
          units: 'ratio (0–1)',
          sourceLabel: 'NASA POWER (Root Zone)',
        },
      ];

      const cards = await Promise.all(
        specs.map(async (s): Promise<EnvironmentalSnapshotCard> => {
          if (s.datasetId === 'modis' && targetMode === 'live' && !hasEarthdata) {
            return {
              id: s.id,
              label: s.label,
              category: s.category,
              value: null,
              units: s.units,
              date: null,
              sourceLabel: s.sourceLabel,
              datasetId: s.datasetId,
              variableId: s.variableId,
              isSimulated: false,
              unavailableReason:
                'Earthdata Login token required for MOD13C2 granule extraction (or switch to Demo Mode).',
            };
          }
          try {
            const res = await api.retrieveData({
              datasetId: s.datasetId,
              variableId: s.variableId,
              region: targetRegion,
              startDate: snapStart,
              endDate: snapEnd,
              aggregation: 'monthly',
              mode: targetMode,
            });
            return {
              id: s.id,
              label: s.label,
              category: s.category,
              value: res.summary.latestValue,
              units: res.variable.units,
              date: res.summary.latestDate,
              sourceLabel: s.sourceLabel,
              datasetId: s.datasetId,
              variableId: s.variableId,
              isSimulated: res.isSimulated,
              unavailableReason: res.errorReason,
            };
          } catch {
            return {
              id: s.id,
              label: s.label,
              category: s.category,
              value: null,
              units: s.units,
              date: null,
              sourceLabel: s.sourceLabel,
              datasetId: s.datasetId,
              variableId: s.variableId,
              isSimulated: targetMode === 'demo',
              unavailableReason: 'Endpoint temporarily unavailable.',
            };
          }
        }),
      );

      setSnapshots(cards);
      setSnapshotsLoading(false);
    },
    [],
  );

  // Initial Bootstrap
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const [hRes, dRes, gRes, pRes, fRes, hstRes, prfRes, msgRes] = await Promise.all([
          api.getHealth(),
          api.getDatasets(),
          api.getGibsLayers(),
          api.searchRegions(''),
          api.getFavorites(),
          api.getHistory(),
          api.getPreferences(),
          api.getAssistantHistory(),
        ]);
        if (!mounted) return;
        setHealth(hRes);
        setDatasets(dRes.datasets);
        setGibsLayers(gRes.layers);
        setPresets(pRes.regions);
        setFavorites(fRes.favorites);
        setInvestigations(hstRes.investigations);
        setPreferences(prfRes.preferences);
        setMode(prfRes.preferences.defaultMode);
        setAlpha(prfRes.preferences.alpha);
        setMessages(msgRes.messages);

        await Promise.all([
          refreshDashboardSnapshots(
            INITIAL_DEMO_REGION,
            prfRes.preferences.defaultMode,
            hRes.earthdataTokenConfigured,
          ),
          runAnalysisPipeline({
            targetRegion: INITIAL_DEMO_REGION,
            overrideMode: prfRes.preferences.defaultMode,
            overrideDatasetId: 'nasa-power',
            overrideVarId: 'PRECTOTCORR',
            overrideAlpha: prfRes.preferences.alpha,
          }),
        ]);
      } catch {
        // Non-fatal bootstrap error handled in view states
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Re-run snapshots whenever active region coordinates/domain or mode change after initial mount
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    refreshDashboardSnapshots(region, mode, Boolean(health?.earthdataTokenConfigured));
  }, [region.lat, region.lon, region.bbox, region.polygon, mode, health?.earthdataTokenConfigured, refreshDashboardSnapshots]);

  // Ref for voice callback so speech recognition always calls latest command handler
  const handleVoiceOrChatRef = useRef<(text: string, fromVoice?: boolean) => Promise<void>>(async () => {});

  const voice = useVoiceAssistant({
    preferredVoiceName: preferences.voiceName,
    autoSpeak: preferences.autoSpeak,
    onTranscriptReady: (transcript) => {
      handleVoiceOrChatRef.current(transcript, true);
    },
  });

  // Natural Voice Command + Gemini AI Assistant Handler
  const handleSendMessage = useCallback(
    async (text: string, fromVoice = false) => {
      const clean = text.trim();
      if (!clean) return;

      // Detect imperative analysis commands for any worldwide region or coordinates
      const commandMatch = clean.match(
        /(?:aethryx[,\s]+)?(?:analy[sz]e|check|show|investigate|run)\s+(.+?)(?:\s+in\s+(.+))?$/i,
      );

      if (commandMatch && /(rain|precip|temp|humid|wind|soil|ndvi|vegetat|ozone)/i.test(clean)) {
        const varPhrase = commandMatch[1].toLowerCase();
        const regionPhrase = commandMatch[2]?.replace(/[.?!]+$/, '').trim();

        let targetVar = 'PRECTOTCORR';
        let targetDs: DatasetConnectorId = 'nasa-power';
        let varLabel = 'rainfall';
        if (/temp/i.test(varPhrase)) {
          targetVar = 'T2M';
          varLabel = 'temperature';
        } else if (/humid/i.test(varPhrase)) {
          targetVar = 'RH2M';
          varLabel = 'atmospheric humidity';
        } else if (/wind/i.test(varPhrase)) {
          targetVar = 'WS10M';
          varLabel = 'wind speed';
        } else if (/soil|land/i.test(varPhrase)) {
          targetVar = 'GWETROOT';
          varLabel = 'soil moisture';
        } else if (/ndvi|vegetat/i.test(varPhrase)) {
          targetVar = 'MODIS_NDVI';
          targetDs = 'modis';
          varLabel = 'vegetation NDVI';
        }

        let targetReg = region;
        if (regionPhrase) {
          const found = await api.searchRegions(regionPhrase);
          if (!found.regions[0]) {
            const failMsg =
              found.error ||
              `Could not resolve location "${regionPhrase}". Please specify a valid city, country, geographical feature, or latitude/longitude coordinates.`;
            setMessages((prev) => [
              ...prev,
              { id: `cmd-${Date.now()}-u`, role: 'user', content: clean, createdAt: new Date().toISOString() },
              {
                id: `cmd-${Date.now()}-a`,
                role: 'assistant',
                content: failMsg,
                createdAt: new Date().toISOString(),
                mode: 'general-conversation',
              },
            ]);
            if (preferences.autoSpeak || fromVoice) voice.speak(failMsg);
            return;
          }
          targetReg = found.regions[0];
          setRegion(targetReg);
        }

        setSelectedDatasetId(targetDs);
        setSelectedVariableId(targetVar);

        const startAck = `Starting your regional ${varLabel} investigation for ${targetReg.name}. I am retrieving the available NASA observations and checking the historical trend.`;
        if (preferences.autoSpeak || fromVoice) {
          voice.speak(startAck);
        }

        setAiSending(true);
        const userEntry: AssistantMessage = {
          id: `cmd-${Date.now()}-u`,
          role: 'user',
          content: clean,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userEntry]);

        const ret = await runAnalysisPipeline({
          targetRegion: targetReg,
          overrideDatasetId: targetDs,
          overrideVarId: targetVar,
        });

        let finalReply = '';
        if (ret && ret.retrievalStatus === 'success') {
          const trendRes = await api.analyzeTrend(ret, alpha);
          finalReply = `Investigation complete for ${targetReg.displayName}. Retrieved ${ret.validObservations} ${ret.isSimulated ? 'demo' : 'live NASA'} observations for ${ret.variable.name} (${ret.actualAvailablePeriod?.startDate} to ${ret.actualAvailablePeriod?.endDate}). ${trendRes.diagnostics.scientificSummary}`;
          setActiveTab('trends');
        } else {
          finalReply =
            ret?.errorReason ||
            `Could not retrieve live ${varLabel} observations for ${targetReg.name}. Please check Data Laboratory for authentication or Demo Mode options.`;
        }

        const assistantEntry: AssistantMessage = {
          id: `cmd-${Date.now()}-a`,
          role: 'assistant',
          content: finalReply,
          createdAt: new Date().toISOString(),
          mode: 'evidence-based',
          citations: ret ? [`${ret.dataset.officialName} (${ret.dataset.productId})`] : [],
          hasActiveContext: Boolean(ret && ret.retrievalStatus === 'success'),
        };
        setMessages((prev) => [...prev, assistantEntry]);
        setAiSending(false);
        if (preferences.autoSpeak || fromVoice) {
          voice.speak(finalReply);
        }
        return;
      }

      // Standard Gemini Assistant Chat grounded in active context
      setAiSending(true);
      const optimisticUser: AssistantMessage = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: clean,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);

      try {
        const res = await api.askAssistant(clean, {
          retrieved,
          trend,
          anomalies,
          forecast,
          comparisons: comparisons.map((c) => ({
            region: c.region,
            retrieved: c.retrieved,
            trend: c.trend,
          })),
        });
        setMessages((prev) => [...prev.filter((m) => m.id !== optimisticUser.id), optimisticUser, res.message]);
        if (preferences.autoSpeak || fromVoice) {
          voice.speak(res.reply);
        }
      } catch (err) {
        const errMsg: AssistantMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Unable to reach AI assistant.',
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setAiSending(false);
      }
    },
    [
      region,
      preferences.autoSpeak,
      voice,
      runAnalysisPipeline,
      alpha,
      retrieved,
      trend,
      anomalies,
      forecast,
      comparisons,
    ],
  );

  handleVoiceOrChatRef.current = handleSendMessage;

  const handleToggleFavorite = async (r: RegionLocation) => {
    const existing = favorites.find(
      (f) => Math.abs(f.lat - r.lat) < 0.02 && Math.abs(f.lon - r.lon) < 0.02,
    );
    if (existing?.id) {
      await api.deleteFavorite(existing.id);
      setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
    } else {
      const res = await api.addFavorite(r);
      setFavorites((prev) => [res.favorite, ...prev]);
    }
  };

  const handleSaveInvestigation = async () => {
    if (!retrieved || !trend) return;
    setSavingInvestigation(true);
    setSavedNotice(null);
    try {
      const inv: SavedInvestigation = {
        id: `inv-${Date.now()}`,
        title: `${retrieved.region.name} · ${retrieved.variable.shortLabel} (${retrieved.requestedPeriod.startDate.slice(0, 4)}–${retrieved.requestedPeriod.endDate.slice(0, 4)})`,
        createdAt: new Date().toISOString(),
        region: retrieved.region,
        datasetId: retrieved.dataset.id,
        datasetName: retrieved.dataset.officialName,
        productId: retrieved.dataset.productId,
        variableId: retrieved.variable.id,
        variableName: retrieved.variable.name,
        units: retrieved.variable.units,
        aggregation: retrieved.aggregation,
        mode: retrieved.mode,
        isSimulated: retrieved.isSimulated,
        startDate: retrieved.actualAvailablePeriod?.startDate ?? retrieved.requestedPeriod.startDate,
        endDate: retrieved.actualAvailablePeriod?.endDate ?? retrieved.requestedPeriod.endDate,
        trendClassification: trend.classification,
        slopePerYear: trend.sensSlope.slopePerYear,
        mannKendallP: trend.mannKendall.pValue,
        anomalyCount: anomalies?.anomalyCount ?? 0,
        payloadJson: JSON.stringify({ retrieved, trend, anomalies, forecast }),
      };
      const res = await api.saveInvestigation(inv);
      setInvestigations((prev) => [res.investigation, ...prev]);
      setSavedNotice('Investigation saved to persistent SQLite archive.');
    } finally {
      setSavingInvestigation(false);
    }
  };

  const handleLoadInvestigation = (inv: SavedInvestigation) => {
    setRegion(inv.region);
    setMode(inv.mode);
    setSelectedDatasetId(inv.datasetId);
    setSelectedVariableId(inv.variableId);
    setAggregation(inv.aggregation);
    if (inv.payloadJson) {
      try {
        const parsed = JSON.parse(inv.payloadJson) as {
          retrieved: RetrievedDatasetResult;
          trend: TrendAnalysisResult;
          anomalies: AnomalyDetectionResult;
          forecast: ForecastResult;
        };
        setRetrieved(parsed.retrieved);
        setTrend(parsed.trend);
        setAnomalies(parsed.anomalies);
        setForecast(parsed.forecast);
        setActiveTab('trends');
        return;
      } catch {
        // Fallback to fresh retrieval
      }
    }
    runAnalysisPipeline({
      targetRegion: inv.region,
      overrideMode: inv.mode,
      overrideDatasetId: inv.datasetId,
      overrideVarId: inv.variableId,
    });
    setActiveTab('trends');
  };

  const isRegionFavorite = useMemo(
    () =>
      favorites.some(
        (f) => Math.abs(f.lat - region.lat) < 0.02 && Math.abs(f.lon - region.lon) < 0.02,
      ),
    [favorites, region],
  );

  const latestAiExplanation = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    return last?.content;
  }, [messages]);

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 flex">
      {/* Desktop Collapsible Left Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-800/90 bg-[#080D1A] transition-all duration-200 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="h-14 px-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <AethryxEmblem className="w-7 h-7 shrink-0" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="font-display font-bold text-sm tracking-wide text-slate-100 truncate">
                  AETHRYX JARVIS
                </div>
                <div className="text-[10px] text-cyan-400 truncate">
                  Your Voice. Earth&apos;s Intelligence.
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1 text-slate-400 hover:text-slate-100 rounded"
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-3 border-t border-slate-800/90 text-[11px] text-slate-500 space-y-0.5">
            <div className="text-slate-400 font-medium">NASA Space Apps 2026</div>
            <div>Earth System Trend Detective</div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-64 bg-[#080D1A] border-r border-slate-800 flex flex-col">
            <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AethryxEmblem className="w-7 h-7" />
                <span className="font-display font-bold text-sm">AETHRYX JARVIS</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-1 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-2 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-xs font-medium ${
                      active
                        ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Mission Ribbon */}
        <header className="h-14 px-4 lg:px-6 border-b border-slate-800/90 bg-[#080D1A]/90 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="md:hidden p-1.5 text-slate-300 border border-slate-800 rounded-md"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="font-display font-semibold text-sm sm:text-base text-slate-100 truncate">
              {NAV_ITEMS.find((n) => n.id === activeTab)?.label}
            </h1>
            <span className="hidden lg:inline text-slate-700" aria-hidden="true">·</span>
            <span className="hidden lg:inline text-xs font-mono text-slate-400 truncate tabular-nums">
              {region.name} ({region.lat.toFixed(2)}°, {region.lon.toFixed(2)}°)
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`hidden sm:inline text-[11px] font-mono px-2 py-0.5 rounded border ${
                mode === 'demo'
                  ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                  : 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10'
              }`}
            >
              {mode === 'demo' ? 'DEMO / SIMULATED' : 'LIVE NASA'}
            </span>

            <button
              type="button"
              onClick={() => {
                if (voice.isListening) voice.stopListening();
                else voice.startListening();
              }}
              disabled={!voice.speechRecSupported}
              title={
                voice.speechRecSupported
                  ? 'Push-to-talk voice command'
                  : 'Voice recognition unavailable in this browser'
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
                voice.isListening
                  ? 'bg-rose-500/20 border-rose-500 text-rose-200'
                  : 'bg-[#060913] border-slate-700 hover:border-cyan-500 text-slate-200'
              } disabled:opacity-40`}
            >
              {voice.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-cyan-400" />}
              <span className="hidden sm:inline">{voice.isListening ? 'Listening...' : 'Voice'}</span>
            </button>

            <div className="text-xs font-mono text-slate-400 tabular-nums whitespace-nowrap">
              {clockText} UTC
            </div>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              {activeTab === 'dashboard' && (
                <MissionDashboard
                  region={region}
                  onSelectRegion={(r) => {
                    setRegion(r);
                    runAnalysisPipeline({ targetRegion: r });
                  }}
                  datasets={datasets}
                  health={health}
                  mode={mode}
                  snapshots={snapshots}
                  snapshotsLoading={snapshotsLoading}
                  activeRetrieved={retrieved}
                  activeTrend={trend}
                  investigations={investigations}
                  favorites={favorites}
                  gibsLayers={gibsLayers}
                  onNavigate={(tab) => setActiveTab(tab as NavTabId)}
                  onRunQuickVariable={(dsId, varId) => {
                    setSelectedDatasetId(dsId);
                    setSelectedVariableId(varId);
                    runAnalysisPipeline({ overrideDatasetId: dsId, overrideVarId: varId });
                    setActiveTab('trends');
                  }}
                  onLoadInvestigation={handleLoadInvestigation}
                />
              )}

              {activeTab === 'explorer' && (
                <EarthExplorerView
                  region={region}
                  onSelectRegion={(r) => setRegion(r)}
                  onToggleFavorite={handleToggleFavorite}
                  isFavorite={isRegionFavorite}
                  gibsLayers={gibsLayers}
                  presets={presets}
                />
              )}

              {activeTab === 'lab' && (
                <DataLaboratoryView
                  region={region}
                  onSelectRegion={(r) => setRegion(r)}
                  datasets={datasets}
                  selectedDatasetId={selectedDatasetId}
                  selectedVariableId={selectedVariableId}
                  startDate={startDate}
                  endDate={endDate}
                  aggregation={aggregation}
                  mode={mode}
                  onChangeParams={(next) => {
                    if (next.datasetId) setSelectedDatasetId(next.datasetId);
                    if (next.variableId) setSelectedVariableId(next.variableId);
                    if (next.startDate) setStartDate(next.startDate);
                    if (next.endDate) setEndDate(next.endDate);
                    if (next.aggregation) setAggregation(next.aggregation);
                    if (next.mode) setMode(next.mode);
                  }}
                  onRunRetrieval={async (ovMode, ovDs, ovVar) => {
                    await runAnalysisPipeline({
                      overrideMode: ovMode,
                      overrideDatasetId: ovDs,
                      overrideVarId: ovVar,
                    });
                  }}
                  retrieving={retrieving}
                  retrievalError={retrievalError}
                  retrieved={retrieved}
                  presets={presets}
                  onGoToTrends={() => setActiveTab('trends')}
                />
              )}

              {activeTab === 'trends' && (
                <TrendDetectiveView
                  retrieved={retrieved}
                  trend={trend}
                  forecast={forecast}
                  alpha={alpha}
                  onChangeAlpha={async (nextAlpha) => {
                    setAlpha(nextAlpha);
                    if (retrieved && retrieved.retrievalStatus === 'success') {
                      const nextTrend = await api.analyzeTrend(retrieved, nextAlpha);
                      setTrend(nextTrend);
                    }
                  }}
                  onSaveInvestigation={handleSaveInvestigation}
                  savingInvestigation={savingInvestigation}
                  savedNotice={savedNotice}
                  presets={presets}
                  onGoToLab={() => setActiveTab('lab')}
                  onComparisonsChange={setComparisons}
                />
              )}

              {activeTab === 'anomalies' && (
                <AnomalyMonitorView
                  retrieved={retrieved}
                  anomalies={anomalies}
                  method={anomalyMethod}
                  threshold={anomalyThreshold}
                  onChangeParams={async (nextMethod, nextThresh) => {
                    setAnomalyMethod(nextMethod);
                    setAnomalyThreshold(nextThresh);
                    if (retrieved && retrieved.retrievalStatus === 'success') {
                      const nextAnom = await api.detectAnomalies(retrieved, nextMethod, nextThresh);
                      setAnomalies(nextAnom);
                    }
                  }}
                  onGoToLab={() => setActiveTab('lab')}
                />
              )}

              {activeTab === 'assistant' && (
                <AiAssistantView
                  region={region}
                  messages={messages}
                  sending={aiSending}
                  onSendMessage={(text) => handleSendMessage(text, false)}
                  onClearHistory={async () => {
                    await api.clearAssistantHistory();
                    setMessages([]);
                  }}
                  activeRetrieved={retrieved}
                  activeTrend={trend}
                  geminiConfigured={Boolean(health?.geminiConfigured)}
                  voice={voice}
                  autoSpeak={preferences.autoSpeak}
                  onToggleAutoSpeak={async (val) => {
                    const updated = await api.updatePreferences({ autoSpeak: val });
                    setPreferences(updated.preferences);
                  }}
                />
              )}

              {activeTab === 'images' && <NasaImageExplorerView />}

              {activeTab === 'reports' && (
                <ReportsHistoryView
                  retrieved={retrieved}
                  trend={trend}
                  anomalies={anomalies}
                  forecast={forecast}
                  latestAiExplanation={latestAiExplanation}
                  investigations={investigations}
                  favorites={favorites}
                  onLoadInvestigation={handleLoadInvestigation}
                  onDeleteInvestigation={async (id) => {
                    await api.deleteInvestigation(id);
                    setInvestigations((prev) => prev.filter((i) => i.id !== id));
                  }}
                  onSelectRegion={(r) => {
                    setRegion(r);
                    runAnalysisPipeline({ targetRegion: r });
                    setActiveTab('dashboard');
                  }}
                  onDeleteFavorite={async (id) => {
                    await api.deleteFavorite(id);
                    setFavorites((prev) => prev.filter((f) => f.id !== id));
                  }}
                  onGoToLab={() => setActiveTab('lab')}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  health={health}
                  preferences={preferences}
                  onUpdatePreferences={async (partial) => {
                    const res = await api.updatePreferences(partial);
                    setPreferences(res.preferences);
                    if (partial.defaultMode) setMode(partial.defaultMode);
                    if (partial.alpha) setAlpha(partial.alpha);
                  }}
                  voices={voice.voices}
                  selectedVoiceName={voice.selectedVoiceName}
                  onSelectVoice={voice.setSelectedVoiceName}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
