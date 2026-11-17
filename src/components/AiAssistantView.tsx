import React, { useState } from 'react';
import {
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AssistantMessage,
  RegionLocation,
  RetrievedDatasetResult,
  TrendAnalysisResult,
} from '../types/earth';

interface AiAssistantViewProps {
  region: RegionLocation;
  messages: AssistantMessage[];
  sending: boolean;
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  activeRetrieved: RetrievedDatasetResult | null;
  activeTrend: TrendAnalysisResult | null;
  geminiConfigured: boolean;
  voice: {
    voices: SpeechSynthesisVoice[];
    selectedVoiceName: string;
    setSelectedVoiceName: (name: string) => void;
    isListening: boolean;
    isSpeaking: boolean;
    transcript: string;
    voiceError: string | null;
    speechSynthSupported: boolean;
    speechRecSupported: boolean;
    startListening: () => void;
    stopListening: () => void;
    speak: (text: string) => void;
    stopSpeaking: () => void;
  };
  autoSpeak: boolean;
  onToggleAutoSpeak: (val: boolean) => void;
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  region,
  messages,
  sending,
  onSendMessage,
  onClearHistory,
  activeRetrieved,
  activeTrend,
  geminiConfigured,
  voice,
  autoSpeak,
  onToggleAutoSpeak,
}) => {
  const [input, setInput] = useState('');
  const activeRegionLabel = activeRetrieved?.region.name || region.name;
  const activeVarLabel = activeRetrieved?.variable.shortLabel.toLowerCase() || 'temperature';
  const suggestedPrompts = [
    `What is happening to ${activeVarLabel} in ${activeRegionLabel}?`,
    'Is the observed trend statistically significant? Explain the Mann-Kendall result.',
    'Explain this time-series graph in simple English.',
    'Summarize my current investigation with NASA dataset citations and limitations.',
    'Which NASA datasets cover this region and why are some unavailable over oceans or high latitudes?',
    `AETHRYX, analyse temperature trends in ${activeRegionLabel}.`,
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');
    await onSendMessage(text);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
      {/* Left Column: Voice & Context Controls */}
      <div className="lg:col-span-4 space-y-4">
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <div>
              <h2 className="font-display font-semibold text-base text-slate-100">
                AETHRYX JARVIS Voice &amp; AI
              </h2>
              <p className="text-xs text-slate-400">Your Earth Intelligence Assistant</p>
            </div>
          </div>

          {/* Push-to-Talk Control */}
          <div className="bg-[#060913] border border-slate-800 rounded-lg p-4 text-center space-y-3">
            <button
              type="button"
              onClick={() => (voice.isListening ? voice.stopListening() : voice.startListening())}
              disabled={!voice.speechRecSupported}
              className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center border transition-all ${
                voice.isListening
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 scale-105'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={voice.isListening ? 'Stop listening' : 'Start push-to-talk microphone'}
            >
              {voice.isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
            </button>

            <div className="text-xs font-medium text-slate-200">
              {voice.isListening
                ? 'Listening... Speak your Earth science question or command'
                : voice.speechRecSupported
                  ? 'Click microphone to speak (Push-to-Talk)'
                  : 'Microphone speech-to-text unavailable in this browser; use text input'}
            </div>

            {voice.isListening && (
              <div className="flex items-center justify-center gap-1 h-5" aria-hidden="true">
                {[0.5, 0.9, 0.65, 1, 0.7, 0.45].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 bg-cyan-400 rounded-full animate-bounce"
                    style={{ height: `${h * 18}px`, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            )}

            {voice.transcript && (
              <div className="text-xs font-mono text-cyan-300 bg-[#0C1222] border border-slate-800 rounded p-2">
                &ldquo;{voice.transcript}&rdquo;
              </div>
            )}

            {voice.voiceError && (
              <div className="text-xs text-amber-300">{voice.voiceError}</div>
            )}
          </div>

          {/* Speech Output Controls */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Auto-Speak Responses</span>
              <button
                type="button"
                onClick={() => onToggleAutoSpeak(!autoSpeak)}
                className={`px-2.5 py-1 rounded border ${
                  autoSpeak
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                    : 'bg-[#060913] border-slate-700 text-slate-400'
                }`}
              >
                {autoSpeak ? 'Enabled' : 'Muted'}
              </button>
            </div>

            {voice.speechSynthSupported && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Assistant Voice</label>
                <select
                  value={voice.selectedVoiceName}
                  onChange={(e) => voice.setSelectedVoiceName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-200"
                >
                  {voice.voices.length === 0 ? (
                    <option value="">System Default Voice</option>
                  ) : (
                    voice.voices.map((v, idx) => (
                      <option key={`${v.voiceURI || v.name}-${v.lang}-${idx}`} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {voice.isSpeaking && (
              <button
                type="button"
                onClick={voice.stopSpeaking}
                className="w-full py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md flex items-center justify-center gap-1.5"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Stop Voice Playback</span>
              </button>
            )}
          </div>
        </div>

        {/* Active Scientific Context Card */}
        <div className="bg-[#0C1222] border border-slate-800 rounded-lg p-4 space-y-2 text-xs">
          <div className="font-display font-semibold text-slate-100">Grounded Context</div>
          {activeRetrieved ? (
            <div className="space-y-1 text-slate-300">
              <div>
                <span className="text-slate-400">Region:</span> {activeRetrieved.region.displayName}
              </div>
              <div>
                <span className="text-slate-400">Dataset:</span> {activeRetrieved.dataset.productId} (
                {activeRetrieved.isSimulated ? 'DEMO / SIMULATED' : 'LIVE NASA'})
              </div>
              <div>
                <span className="text-slate-400">Variable:</span> {activeRetrieved.variable.name}
              </div>
              {activeTrend && (
                <div>
                  <span className="text-slate-400">Trend:</span> {activeTrend.classification} (p=
                  {activeTrend.mannKendall.pValue.toFixed(4)})
                </div>
              )}
            </div>
          ) : (
            <p className="text-amber-300">
              No active regional dataset loaded. The assistant will inform you when measurements are required.
            </p>
          )}
          <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400">
            Gemini Backend: {geminiConfigured ? 'Connected' : 'Fallback mode (GEMINI_API_KEY not set)'}
          </div>
        </div>
      </div>

      {/* Right Column: Conversation Thread */}
      <div className="lg:col-span-8 bg-[#0C1222] border border-slate-800 rounded-lg flex flex-col min-h-[560px] max-h-[780px]">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="text-sm font-display font-semibold text-slate-100">
            Scientific Dialogue &amp; Voice Command Console
          </div>
          <button
            type="button"
            onClick={onClearHistory}
            className="px-2.5 py-1 text-xs text-slate-400 hover:text-rose-300 flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear History</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-4 py-4">
              <p className="text-xs text-slate-400">
                Ask about regional climate trends for any location worldwide, statistical significance, NASA dataset coverage, or speak a voice command like &ldquo;AETHRYX, analyse temperature trends in {activeRegionLabel}&rdquo;.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {suggestedPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onSendMessage(p)}
                    className="text-left p-2.5 text-xs bg-[#060913] border border-slate-800 hover:border-cyan-500/50 rounded-md text-slate-300 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg p-3.5 text-xs leading-relaxed space-y-2 ${
                    m.role === 'user'
                      ? 'bg-cyan-600/20 border border-cyan-500/40 text-slate-100'
                      : 'bg-[#060913] border border-slate-800 text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 text-[11px] font-mono text-slate-400">
                    <span>
                      {m.role === 'user'
                        ? 'Researcher'
                        : m.mode === 'evidence-based'
                          ? 'AETHRYX JARVIS · Evidence-Based Analysis'
                          : 'AETHRYX JARVIS · General Guidance'}
                    </span>
                    {m.role === 'assistant' && voice.speechSynthSupported && (
                      <button
                        type="button"
                        onClick={() => voice.speak(m.content)}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                        aria-label="Play voice response"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Speak</span>
                      </button>
                    )}
                  </div>

                  <div className="whitespace-pre-wrap">{m.content}</div>

                  {m.citations && m.citations.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                      Sources: {m.citations.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-cyan-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>AETHRYX JARVIS is analyzing retrieved telemetry...</span>
            </div>
          )}
        </div>

        {/* Text Fallback & Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask AETHRYX about trends, Mann-Kendall tests, or type a voice command..."
            className="flex-1 px-3 py-2 text-xs bg-[#060913] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
