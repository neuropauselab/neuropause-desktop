/**
 * License runtime state (V6.1) — the single main-side source of truth for the
 * commercial license health the renderer reports. NeuroCore reads it; the
 * LicenseReportHealth IPC handler writes it. Mirrors voiceRuntimeState: a tiny
 * ephemeral holder, event-driven, no persistence (the durable license snapshot
 * lives in the license validator's own cache).
 *
 * The renderer holds the active org and already queries the license validator, so
 * it is the correct place to source this — the main process has no ambient
 * "active org", which is why this is push-based rather than a background probe.
 */
import type { LicenseState } from '@neuropause/shared';

export interface LicenseHealthSignal {
  state: LicenseState;
  graceDaysRemaining: number;
}

let current: LicenseHealthSignal | null = null;

/** Update the reported license health (called by the LicenseReportHealth handler). */
export function setLicenseRuntimeState(signal: LicenseHealthSignal | null): void {
  current = signal;
}

/** Read the last-reported license health (NeuroCore consumes this; null = unknown). */
export function getLicenseRuntimeState(): LicenseHealthSignal | null {
  return current;
}
