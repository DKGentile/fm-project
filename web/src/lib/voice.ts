/**
 * Browser voice helpers.
 *  - Speech-to-text via the Web Speech API (no key required).
 *  - Text-to-speech via ElevenLabs (/api/tts) when configured, else the
 *    browser's built-in speechSynthesis.
 */

export function speechRecognitionSupported(): boolean {
  return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export interface Recognizer {
  start: () => void;
  stop: () => void;
}

export function createRecognizer(handlers: {
  onResult: (text: string) => void;
  onEnd: () => void;
  onError: (err: string) => void;
}): Recognizer | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  rec.onresult = (e: any) => handlers.onResult(e.results[0][0].transcript as string);
  rec.onend = () => handlers.onEnd();
  rec.onerror = (e: any) => handlers.onError(String(e.error ?? 'recognition error'));
  return { start: () => rec.start(), stop: () => rec.stop() };
}

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* noop */
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export async function speak(text: string, provider: 'elevenlabs' | 'browser'): Promise<void> {
  stopSpeaking();
  const clean = text.trim();
  if (!clean) return;

  if (provider === 'elevenlabs') {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      }
    } catch {
      /* fall through to browser TTS */
    }
  }

  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.05;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
  }
}
