/**
 * Voice audio services (V2.7) — RENDERER layer.
 *
 * ⚠️ VERIFICATION NOTE: this module uses browser audio APIs (getUserMedia,
 * webkitSpeechRecognition, SpeechSynthesis) that require a real microphone,
 * speaker, and browser environment. It CANNOT be exercised in the CI container
 * (no audio devices, no headless audio). It is written to the shared interfaces
 * (WakeWordDetector / SpeechRecognizer / SpeechSynthesizer) and follows the
 * existing renderer conventions, but its runtime behavior must be verified on
 * macOS by running the app. Treat as production-shaped scaffold pending on-device
 * verification — NOT as tested code.
 *
 * Providers are behind interfaces (STEP 4/6): swap in a cloud STT/TTS by
 * implementing the same interface; nothing here hard-codes a single provider as
 * the only option.
 */
import type { SpeechRecognizer, SpeechSynthesizer, WakeWordDetector } from '@neuropause/shared';

// ── Speech recognition (Web Speech API; local, streaming) ─────────────────────
// Typed minimally to avoid a hard dependency on lib.dom's experimental types.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((e: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Web Speech recognizer. Streams partials via onPartial, final via onFinal. */
export class WebSpeechRecognizer implements SpeechRecognizer {
  private rec: SpeechRecognitionLike | null = null;

  start(onPartial: (text: string) => void, onFinal: (text: string) => void): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // caller shows "speech recognition unavailable"
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const text = last[0]?.transcript ?? '';
      if (last.isFinal) onFinal(text.trim());
      else onPartial(text);
    };
    rec.onend = () => {
      this.rec = null;
    };
    rec.start();
    this.rec = rec;
  }

  stop(): void {
    this.rec?.stop();
    this.rec = null;
  }
}

// ── Text-to-speech (SpeechSynthesis; interruptible, queued) ───────────────────
export class WebSpeechSynthesizer implements SpeechSynthesizer {
  // (utterance ref intentionally not retained; cancel() uses speechSynthesis global)

  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === 'undefined') {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.onend = () => resolve();
      u.onerror = () => resolve();

      speechSynthesis.speak(u);
    });
  }

  cancel(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
}

// ── Wake word (lightweight local matcher over the recognizer) ─────────────────
// A privacy-first, dependency-free approach: run the local recognizer in the
// background and match the wake phrase in-process. A dedicated on-device wake
// model (e.g. Porcupine) can replace this behind the same interface later.
export class LocalWakeWordDetector implements WakeWordDetector {
  readonly phrase = 'hello neuropause';
  private recognizer = new WebSpeechRecognizer();
  private listening = false;

  start(onWake: () => void): void {
    if (this.listening) return;
    this.listening = true;
    const check = (text: string): void => {
      if (/\b(hello|hi|hey)\s+neuropause\b/i.test(text)) {
        onWake();
      }
    };
    this.recognizer.start(check, check);
  }

  stop(): void {
    this.recognizer.stop();
    this.listening = false;
  }
}

// ── Microphone permission + device enumeration ────────────────────────────────
export async function requestMicPermission(): Promise<'granted' | 'denied'> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // release immediately; we only needed the grant
    return 'granted';
  } catch {
    return 'denied';
  }
}

export async function listMicrophones(): Promise<Array<{ id: string; label: string }>> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' }));
  } catch {
    return [];
  }
}
