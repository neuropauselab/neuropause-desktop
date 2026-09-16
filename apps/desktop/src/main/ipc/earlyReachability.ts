/**
 * P13C — O-3. The reachability channel exists BEFORE the window does.
 *
 * THE DEFECT
 *
 * `system:backendReachability` is registered by `registerSecureHandlers`, which
 * runs inside `initRuntimeCore()` — the LAST step of bootstrap. `createMainWindow()`
 * runs several steps earlier, and `authService.restoreSession()` between them
 * retries five times when the backend is down. On a cold start where runtime
 * core took 11.8s, the renderer invoked the channel at t+8s and Electron logged:
 *
 *   Error occurred in handler for 'system:backendReachability':
 *   No handler registered for 'system:backendReachability'
 *
 * twice, on a healthy launch. It did not occur on an 8.2s start, which is what
 * makes it a race rather than a bug you can see once and fix.
 *
 * WHY NOT JUST WAIT LONGER. An arbitrary delay converts a race into a slower
 * race, and it would still be wrong on a cold Windows disk. The window is
 * created early ON PURPOSE — a founder should see a sign-in form immediately,
 * not eleven seconds of nothing. The ordering is a product decision and it is
 * the right one.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Registers the channel at bootstrap with the only answer that is TRUE before a
 * probe has run: `checkedAt: null` — "we have not asked." `BackendReachabilityNotice`
 * already treats that exact shape as *still checking* rather than as an outage
 * (round21), so the contract this satisfies is one that already existed and was
 * simply unreachable during the window where it mattered most.
 *
 * `registerSecureHandlers` replaces this with the real sampler-backed handler
 * the moment runtime core is up. The replacement is what `ipcMain.removeHandler`
 * in `secureBridge.ts` is for.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not touch INVOKABLE_CHANNELS,
 * `routes`, PUBLIC_CHANNELS, or the Round 10 channel classification. The
 * authority surface is unchanged: this channel was already public by the F-7
 * exception, and the payload here carries strictly less than the real handler's.
 */
import { ipcMain } from 'electron';
import { IpcChannel } from '@neuropause/shared';
import type { BackendReachability } from '@neuropause/shared';
import { isTrustedSenderFrame } from './router';

/**
 * The honest answer before any probe has completed.
 *
 * `reachable: false` here does NOT mean the backend is down. It means no probe
 * has run, which is why `checkedAt: null` accompanies it — that field is the
 * one the notice reads to distinguish "unknown" from "unreachable".
 */
export const NOT_YET_PROBED: BackendReachability = Object.freeze({
  reachable: false,
  checkedAt: null,
  lastError: null,
});

/** Register the pre-runtime-core answer. Called once, before the window opens. */
export function registerEarlyReachabilityHandler(): void {
  ipcMain.removeHandler(IpcChannel.BackendReachability);
  ipcMain.handle(IpcChannel.BackendReachability, (event) => {
    // Same origin check as every other channel; an early handler is not a
    // relaxed one.
    if (!isTrustedSenderFrame(event)) throw new Error('Untrusted sender');
    return NOT_YET_PROBED;
  });
}
