/**
 * Voice runtime state (V5.2) — the single main-side source of truth for the live
 * voice state the renderer's VoiceWidget reports. NeuroCore reads it; the IPC
 * handler writes it. Kept as a tiny module holder (not a store) since it's
 * ephemeral runtime state, event-driven, no persistence.
 */
import type { VoiceRuntimeState } from '@neuropause/shared';

let currentVoiceState: VoiceRuntimeState = 'idle';
let lastVoiceActivityMs: number | null = null;
let listener: ((state: VoiceRuntimeState) => void) | null = null;

/** Update the live voice state (called by the VoiceStatus IPC handler). */
export function setVoiceRuntimeState(state: VoiceRuntimeState): void {
  const changed = state !== currentVoiceState;
  currentVoiceState = state;
  if (state !== 'idle') lastVoiceActivityMs = Date.now();
  if (changed) listener?.(state);
}

/** Read the current voice state (NeuroCore consumes this). */
export function getVoiceRuntimeState(): VoiceRuntimeState {
  return currentVoiceState;
}

/** Timestamp of the last non-idle voice activity, if any. */
export function getLastVoiceActivityMs(): number | null {
  return lastVoiceActivityMs;
}

/** Subscribe to voice-state transitions (for platform-event emission). */
export function onVoiceStateChange(cb: (state: VoiceRuntimeState) => void): void {
  listener = cb;
}
