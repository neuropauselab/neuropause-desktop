/**
 * Device trust runtime state (V6.5) — the single main-side source of truth for
 * the current device's trust status, reported by the renderer. NeuroCore reads it;
 * the DeviceReportHealth IPC handler writes it. Mirrors licenseRuntimeState: an
 * ephemeral, event-driven holder with no persistence (the durable device record
 * lives in the backend).
 *
 * The renderer holds the active org and queries the devices API, so it is the
 * correct place to source this — the main process has no ambient active org, which
 * is why this is push-based rather than a background probe.
 */
import type { DeviceTrustStatus } from '@neuropause/shared';

export interface DeviceHealthSignal {
  trustStatus: DeviceTrustStatus;
}

let current: DeviceHealthSignal | null = null;

/** Update the reported device trust (called by the DeviceReportHealth handler). */
export function setDeviceRuntimeState(signal: DeviceHealthSignal | null): void {
  current = signal;
}

/** Read the last-reported device trust (NeuroCore consumes this; null = unknown). */
export function getDeviceRuntimeState(): DeviceHealthSignal | null {
  return current;
}
