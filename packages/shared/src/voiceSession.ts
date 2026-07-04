/**
 * Voice conversation session machine (V2.7, STEP 5).
 *
 * A PURE reducer over the voice session lifecycle. It owns state transitions only
 * — it does not touch audio, IPC, or the DOM (those are driven by the renderer,
 * which dispatches events into this machine and reacts to the resulting state).
 * This is the verifiable heart of the Experience Layer: deterministic, unit-tested.
 *
 * Flow: idle → (wake) → listening → recognizing → thinking → speaking → waiting
 *   → (follow-up loops back to listening) → conversation-ended / timeout / cancelled.
 */
import type { VoiceState } from './types/voice';

export type VoiceEvent =
  | { type: 'wake' } // wake word detected
  | { type: 'startListening' } // mic opened
  | { type: 'partialTranscript'; text: string } // STT partial
  | { type: 'finalTranscript'; text: string } // STT final
  | { type: 'thinkingDone' } // brain produced a response
  | { type: 'speakStart' } // TTS began
  | { type: 'speakEnd' } // TTS finished
  | { type: 'interrupt' } // user spoke a stop/cancel command
  | { type: 'goodbye' } // user ended the session
  | { type: 'timeout' } // waiting expired
  | { type: 'cancel' } // programmatic cancel
  | { type: 'error' }
  | { type: 'mute' }
  | { type: 'unmute' }
  | { type: 'permissionRequired' }
  | { type: 'offline' }
  | { type: 'reset' };

export interface VoiceSession {
  state: VoiceState;
  /** Live transcript for the current turn. */
  transcript: string;
  /** True while a conversation is active (between wake and goodbye/timeout). */
  active: boolean;
  /** The last final transcript, for "repeat"/"start over" support. */
  lastFinal: string;
}

export const INITIAL_SESSION: VoiceSession = {
  state: 'idle',
  transcript: '',
  active: false,
  lastFinal: '',
};

/** Pure transition. Unknown events for a state are no-ops (returns same session). */
export function voiceSessionReducer(session: VoiceSession, event: VoiceEvent): VoiceSession {
  switch (event.type) {
    case 'wake':
      return { ...session, state: 'wake', active: true, transcript: '' };

    case 'startListening':
      if (!session.active) return session;
      return { ...session, state: 'listening', transcript: '' };

    case 'partialTranscript':
      if (session.state !== 'listening' && session.state !== 'recognizing') return session;
      return { ...session, state: 'recognizing', transcript: event.text };

    case 'finalTranscript':
      return { ...session, state: 'thinking', transcript: event.text, lastFinal: event.text };

    case 'thinkingDone':
      return { ...session, state: 'speaking' };

    case 'speakStart':
      return { ...session, state: 'speaking' };

    case 'speakEnd':
      // After speaking, wait for a follow-up (conversation stays active).
      return { ...session, state: 'waiting' };

    case 'interrupt':
      // Stop speaking immediately; return to listening for the next request.
      return { ...session, state: 'listening', transcript: '' };

    case 'goodbye':
      return { ...session, state: 'conversation-ended', active: false, transcript: '' };

    case 'timeout':
      return { ...session, state: 'conversation-timeout', active: false };

    case 'cancel':
      return { ...session, state: 'conversation-cancelled', active: false, transcript: '' };

    case 'error':
      return { ...session, state: 'error' };

    case 'mute':
      return { ...session, state: 'muted' };

    case 'unmute':
      return { ...session, state: session.active ? 'listening' : 'idle' };

    case 'permissionRequired':
      return { ...session, state: 'permission-required', active: false };

    case 'offline':
      return { ...session, state: 'offline' };

    case 'reset':
      return { ...INITIAL_SESSION };

    default:
      return session;
  }
}

/** Convenience: is the session in a state where the mic should be capturing? */
export function isCapturing(state: VoiceState): boolean {
  return state === 'listening' || state === 'recognizing';
}

/** Convenience: is the session in a terminal state? */
export function isTerminal(state: VoiceState): boolean {
  return (
    state === 'conversation-ended' ||
    state === 'conversation-timeout' ||
    state === 'conversation-cancelled'
  );
}
