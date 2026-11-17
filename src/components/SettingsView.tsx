import React from 'react';
import { CheckCircle2, Cloud, Database, KeyRound, Mic, Server, ShieldCheck } from 'lucide-react';
import type { HealthInfo, UserPreferences } from '../lib/api';

interface SettingsViewProps {
  health: HealthInfo | null;
  preferences: UserPreferences;
  onUpdatePreferences: (partial: Partial<UserPreferences>) => Promise<void>;
  voices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  onSelectVoice: (name: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  health,
  preferences,
  onUpdatePreferences,
  voices,
  selectedVoiceName,
  onSelectVoice,
}) => {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-4">
        <h2 className="font-display font-semibold text-lg text-slate-100">
          Platform Preferences
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1.5">Default Data Acquisition Mode</label>
            <select
              value={preferences.defaultMode}
              onChange={(e) =>
                onUpdatePreferences({ defaultMode: e.target.value as 'live' | 'demo' })
              }
              className="w-full px-3 py-2 bg-[#060913] border border-slate-800 rounded-md text-slate-100"
            >
              <option value="live">Live NASA Data Mode (Recommended)</option>
              <option value="demo">Demo Mode (Labeled Simulated Data)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">
              Default Statistical Significance Threshold (alpha)
            </label>
            <select
              value={preferences.alpha}
              onChange={(e) =>
                onUpdatePreferences({ alpha: Number.parseFloat(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#060913] border border-slate-800 rounded-md text-slate-100 font-mono"
            >
              <option value={0.01}>0.01 (99% confidence)</option>
              <option value={0.05}>0.05 (95% confidence — Standard)</option>
              <option value={0.1}>0.10 (90% confidence)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">Voice Playback Auto-Speak</label>
            <button
              type="button"
              onClick={() => onUpdatePreferences({ autoSpeak: !preferences.autoSpeak })}
              className={`w-full py-2 px-3 rounded-md border text-left flex items-center justify-between ${
                preferences.autoSpeak
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                  : 'bg-[#060913] border-slate-800 text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2">
                <Mic className="w-3.5 h-3.5" />
                <span>{preferences.autoSpeak ? 'Speak AI responses automatically' : 'Manual speak only'}</span>
              </span>
              <span className="font-mono">{preferences.autoSpeak ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div>
            <label className="block text-slate-400 mb-1.5">Preferred Speech Synthesis Voice</label>
            <select
              value={selectedVoiceName}
              onChange={(e) => {
                onSelectVoice(e.target.value);
                onUpdatePreferences({ voiceName: e.target.value });
              }}
              className="w-full px-3 py-2 bg-[#060913] border border-slate-800 rounded-md text-slate-100"
            >
              {voices.length === 0 ? (
                <option value="">System Default Voice</option>
              ) : (
                voices.map((v, idx) => (
                  <option key={`${v.voiceURI || v.name}-${v.lang}-${idx}`} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Server-side Integrations & Security Diagnostics */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <h3 className="font-display font-semibold text-base text-slate-100">
            Server-Side Credentials &amp; Connector Status
          </h3>
        </div>
        <p className="text-xs text-slate-400">
          All API keys and Earthdata credentials remain strictly server-side via environment variables and are never exposed to browser JavaScript.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>Gemini AI Backend</span>
            </div>
            <div className={health?.geminiConfigured ? 'text-emerald-400' : 'text-amber-300'}>
              {health?.geminiConfigured ? 'Configured (GEMINI_API_KEY)' : 'Not configured in Secrets'}
            </div>
          </div>

          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
              <span>NASA Earthdata Login</span>
            </div>
            <div className={health?.earthdataTokenConfigured ? 'text-emerald-400' : 'text-amber-300'}>
              {health?.earthdataTokenConfigured
                ? 'Configured (EARTHDATA_TOKEN)'
                : 'Optional token not set (POWER & GIBS still live)'}
            </div>
          </div>

          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>Persistence Storage</span>
            </div>
            <div className="text-slate-300 font-mono truncate">
              {health?.databasePath || './data/aethryx.db'}
            </div>
          </div>
        </div>

        {health?.ephemeralStorageNotice && (
          <div className="bg-[#060913] border border-slate-800 rounded-md p-3 text-xs text-slate-400">
            <strong>Storage Note:</strong> {health.ephemeralStorageNotice}
          </div>
        )}
      </div>

      {/* NASA Earthdata & Cloud Run Deployment Documentation */}
      <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-5 space-y-4 text-xs text-slate-300 leading-relaxed">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-cyan-400" />
          <h3 className="font-display font-semibold text-base text-slate-100">
            Earthdata Authentication &amp; Production Deployment Guide
          </h3>
        </div>

        <div className="space-y-2">
          <div className="font-medium text-slate-100">1. Optional NASA Earthdata Login Token Setup</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-400">
            <li>Register for a free NASA Earthdata account at <span className="font-mono text-cyan-400">https://urs.earthdata.nasa.gov/</span>.</li>
            <li>Approve the &ldquo;NASA GESDISC DATA ARCHIVE&rdquo; and &ldquo;LP DAAC Data Pool&rdquo; applications in your Earthdata profile.</li>
            <li>Generate a Bearer Token and configure <span className="font-mono text-slate-200">EARTHDATA_TOKEN</span> in your server environment / Secrets panel.</li>
          </ol>
        </div>

        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="font-medium text-slate-100">2. Deploying to Google Cloud Run (or AI Studio Deploy)</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-400">
            <li>Build the production frontend bundle with <span className="font-mono text-slate-200">npm run build</span>.</li>
            <li>Start the production Express server on port 3000 with <span className="font-mono text-slate-200">NODE_ENV=production npm start</span>.</li>
            <li>Provide <span className="font-mono text-slate-200">GEMINI_API_KEY</span> (and optional <span className="font-mono text-slate-200">EARTHDATA_TOKEN</span>) as runtime secrets.</li>
            <li>For durable multi-instance persistence beyond ephemeral container restarts, mount a Cloud Storage/Filestore volume to <span className="font-mono text-slate-200">DB_PATH</span> or point persistence to an external managed database.</li>
          </ol>
        </div>

        <div className="flex items-center gap-2 text-emerald-400 pt-1">
          <CheckCircle2 className="w-4 h-4" />
          <span>Health endpoint active at GET /api/health</span>
        </div>
      </div>
    </div>
  );
};
