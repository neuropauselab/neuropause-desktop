/**
 * The tenant-recovery seam, with no dependencies — the workspaceSwitchHub's
 * sibling, for the OTHER transition.
 *
 * P13C ROUND 39 — GATE 26. The AI engine rebuilds its router on preference
 * change and on workspace switch, but its boot-time build races composition:
 * on a live restart the upgrade ran at T+13ms while the org runtime finished
 * loading at T+19ms, so `tenantAiPreferenceStore.mine()` saw no resolved
 * tenant, the local-only clamp never entered the plan, and the engine parked
 * fail-closed for the whole session — Settings showing "Local Only · Ollama
 * Connected" while every request answered "No AI model". The resolver already
 * KNOWS the moment resolution comes back (`onRecovered`, the W-10 interval
 * line); this hub lets subsystems holding a router/plan built during the
 * refused window rebuild once resolution is real, without the tenancy layer
 * importing them.
 *
 * Same contract as the switch hub: no state, only callbacks; the enterprise
 * root is the only announcer; a throwing listener must not stop the rest.
 */

type RecoveryListener = () => void;

const listeners: RecoveryListener[] = [];

/** Register a callback fired after tenant resolution transitions refused → resolved. */
export function onTenantRecovery(fn: RecoveryListener): void {
  listeners.push(fn);
}

/** Announce a recovery. Called by the enterprise root ONLY. */
export function announceTenantRecovery(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Best-effort, as with switch residue: one listener failing to rebuild
      // is not a reason to leave the others parked on refused-window state.
    }
  }
}

/** For tests: forget every listener. Never called in production. */
export function resetTenantRecoveryListenersForTests(): void {
  listeners.length = 0;
}

/** How many subsystems rebuild on recovery. For the startup report. */
export function tenantRecoveryListenerCount(): number {
  return listeners.length;
}
