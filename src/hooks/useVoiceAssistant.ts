import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function useVoiceAssistant(options: {
  preferredVoiceName?: string;
  autoSpeak?: boolean;
  onTranscriptReady: (transcript: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(options.preferredVoiceName || '');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [wakeWordSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition,
    );
  });

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(options.onTranscriptReady);
  onTranscriptRef.current = options.onTranscriptReady;

  const speechSynthSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const speechRecSupported = wakeWordSupported;

  // Discover voices & prefer an English male-sounding voice by default
  useEffect(() => {
    if (!speechSynthSupported) return;
    const loadVoices = () => {
      const raw = window.speechSynthesis.getVoices();
      const seen = new Set<string>();
      const available = raw.filter((v) => {
        const key = `${v.name}|${v.lang}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setVoices(available);
      if (!selectedVoiceName && available.length > 0) {
        const maleHints = [
          'daniel',
          'arthur',
          'google uk english male',
          'microsoft david',
          'microsoft mark',
          'microsoft guy',
          'alex',
          'oliver',
          'ryan',
          'male',
        ];
        const eng = available.filter((v) => v.lang.toLowerCase().startsWith('en'));
        const preferred =
          eng.find((v) => maleHints.some((h) => v.name.toLowerCase().includes(h))) ||
          eng[0] ||
          available[0];
        if (preferred) setSelectedVoiceName(preferred.name);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [speechSynthSupported, selectedVoiceName]);

  const stopSpeaking = useCallback(() => {
    if (!speechSynthSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [speechSynthSupported]);

  const speak = useCallback(
    (text: string) => {
      if (!speechSynthSupported || !text.trim()) return;
      window.speechSynthesis.cancel();
      // Strip markdown symbols for natural speech playback
      const clean = text
        .replace(/[*_`#>-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const utterance = new SpeechSynthesisUtterance(clean);
      const chosen = voices.find((v) => v.name === selectedVoiceName);
      if (chosen) utterance.voice = chosen;
      utterance.rate = 1.02;
      utterance.pitch = 0.96;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [speechSynthSupported, voices, selectedVoiceName],
  );

  const startListening = useCallback(() => {
    setVoiceError(null);
    if (!speechRecSupported) {
      setVoiceError('Browser SpeechRecognition is not available in this browser; please use the text input below.');
      return;
    }
    try {
      stopSpeaking();
      const Ctor =
        (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition ||
        (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition;
      const rec = new Ctor();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';
      let finalText = '';

      rec.onresult = (ev) => {
        let combined = '';
        for (let i = 0; i < ev.results.length; i++) {
          combined += ev.results[i][0].transcript;
        }
        finalText = combined.trim();
        setTranscript(finalText);
      };

      rec.onerror = (ev) => {
        setIsListening(false);
        setVoiceError(
          ev.error === 'not-allowed'
            ? 'Microphone permission denied. Please allow microphone access or type your question.'
            : `Voice recognition error: ${ev.error}`,
        );
      };

      rec.onend = () => {
        setIsListening(false);
        if (finalText) {
          onTranscriptRef.current(finalText);
        }
      };

      recognitionRef.current = rec;
      setTranscript('');
      setIsListening(true);
      rec.start();
    } catch (err) {
      setIsListening(false);
      setVoiceError(err instanceof Error ? err.message : 'Could not start speech recognition');
    }
  }, [speechRecSupported, stopSpeaking]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  return {
    voices,
    selectedVoiceName,
    setSelectedVoiceName,
    isListening,
    isSpeaking,
    transcript,
    voiceError,
    speechSynthSupported,
    speechRecSupported,
    wakeWordSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
