/**
 * Executive Voice Assistant (V2.6) — shared types.
 *
 * The voice layer is a ROUTING + RESPONSE-COMPOSITION layer over existing
 * intelligence (Executive Center snapshot, Founder AI, Org Intelligence). It does
 * NOT contain an AI model, a context builder, or governance of its own — it maps a
 * recognized utterance to the existing system that answers it, then phrases the
 * answer for speech. Audio I/O (wake word, STT, TTS) and the floating UI are
 * defined as interfaces the desktop/renderer wire; the brain here is pure + tested.
 */

/** The high-level intents the voice router recognizes, each mapped to an existing system. */
export type VoiceIntent =
  | 'greeting' // "Hello NeuroPause"
  | 'org-health' // "How is the organization?"
  | 'engineering-health' // "How is engineering?"
  | 'critical-risks' // "Any critical risks?"
  | 'mission-brief' // "What's my brief / priorities?"
  | 'founder-recommendations' // "What do you recommend?"
  | 'fix-first' // "What should I fix first?" / "highest priority issue"
  | 'decisions-pending' // "What decisions are pending?"
  | 'decisions-recent' // "What did we decide this week?"
  | 'decisions-complete' // "Complete decision" / "mark decision done"
  | 'decisions-overdue' // "What is overdue?"
  | 'decisions-blocked' // "What decisions are blocked?"
  | 'connector-status' // "Any connector issues?"
  | 'license-status' // "How's our license?"
  | 'summarize' // "Summarize everything"
  | 'open-module' // "Open Founder AI / Mission Brief / Organization"
  | 'action' // "Create a task / notify the team" (routes through governance)
  | 'unknown'; // falls back to Founder AI free-form

/** A recognized utterance turned into a routed intent (pure classification output). */
export interface VoiceIntentResult {
  intent: VoiceIntent;
  /** 0..1 confidence in the classification. */
  confidence: number;
  /** For 'open-module' / 'action': the target the intent resolved to. */
  target?: string;
  /** The normalized transcript that produced this. */
  transcript: string;
}

/** What the voice layer produces for a turn: text to speak + optional navigation/action. */
export interface VoiceResponse {
  /** The words to speak (also shown as text). Evidence-grounded, never fabricated. */
  speech: string;
  intent: VoiceIntent;
  /** If the turn should navigate the UI, the deep-link (reuses V2.4/V2.5 routing). */
  deepLink?: string;
  /** If the turn requests an action, the action id that must pass governance. */
  actionId?: string;
  /** True when the action requires explicit approval before execution. */
  requiresApproval?: boolean;
}

/** The visual + session states of the voice experience (STEP 5/8). */
export type VoiceState =
  | 'idle'
  | 'wake'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'speaking'
  | 'waiting'
  | 'completed'
  | 'error'
  | 'muted'
  | 'offline'
  | 'permission-required'
  | 'conversation-ended'
  | 'conversation-timeout'
  | 'conversation-cancelled';

/** In-conversation control commands the user can speak (STEP 7). */
export type VoiceCommand =
  | 'stop'
  | 'cancel'
  | 'pause'
  | 'continue'
  | 'repeat'
  | 'start-over'
  | 'goodbye'
  | 'thank-you'
  | 'none';

/** User-configurable voice settings (STEP 10). Persisted via existing settings. */
export interface VoiceSettings {
  wakeWordEnabled: boolean;
  microphoneDeviceId: string | null;
  speakerDeviceId: string | null;
  voice: string | null;
  speakingRate: number; // 0.5..2.0
  wakeSensitivity: number; // 0..1
  backgroundListening: boolean;
  pushToTalk: boolean;
  autoStartListening: boolean;
  conversationTimeoutMs: number;
  doNotDisturb: boolean;
  privacyMode: boolean; // suppress on-screen transcript
  storeAudioHistory: boolean; // default false — no raw audio kept
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  wakeWordEnabled: true,
  microphoneDeviceId: null,
  speakerDeviceId: null,
  voice: null,
  speakingRate: 1.0,
  wakeSensitivity: 0.5,
  backgroundListening: false,
  pushToTalk: false,
  autoStartListening: true,
  conversationTimeoutMs: 15_000,
  doNotDisturb: false,
  privacyMode: false,
  storeAudioHistory: false,
};

/** A single turn kept for in-conversation context (STEP 8) — reuses Executive Memory downstream. */
export interface VoiceTurn {
  at: string;
  transcript: string;
  intent: VoiceIntent;
  speech: string;
}

// ── Interfaces the desktop/renderer implement (audio I/O is not in the tested core) ──

/** Wake-word detector (local, low-CPU). Implemented in the renderer/native layer. */
export interface WakeWordDetector {
  readonly phrase: string;
  start(onWake: () => void): void;
  stop(): void;
}

/** Speech-to-text provider. Local by default; cloud providers slot behind this. */
export interface SpeechRecognizer {
  start(onPartial: (text: string) => void, onFinal: (text: string) => void): void;
  stop(): void;
}

/** Text-to-speech provider. */
export interface SpeechSynthesizer {
  speak(text: string): Promise<void>;
  cancel(): void;
}
