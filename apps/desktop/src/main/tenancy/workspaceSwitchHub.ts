/**
 * The tenant-switch residue seam, with no dependencies.
 *
 * WHY IT MOVED HERE
 *
 * `onWorkspaceSwitch` lived on the enterprise root, which is correct as a
 * composition point and wrong as an import target: that root reaches
 * `app.getPath`, so any pure model importing it drags Electron into a node
 * test. Seven platform subsystems need to register a cache flush on a switch,
 * and every one of them unit-tests as a pure model.
 *
 * So the hub is here — a list of callbacks and nothing else. The enterprise
 * root still OWNS the switch (it is the only thing that may decide one
 * happened) and now announces it through this hub, so there is still exactly
 * one place a switch is declared.
 *
 * WHAT THIS IS NOT
 *
 * Not tenant state. It holds no scope, no ids and no data — only functions to
 * call when something else decides a switch occurred. A subsystem that
 * registers here is saying "I hold something derived from the previous tenant",
 * which is a statement about that subsystem, not about who the tenant is.
 */

type SwitchListener = (workspaceId: string) => void;

const listeners: SwitchListener[] = [];

/**
 * Register a callback fired after a tenant or workspace switch commits.
 *
 * The canonical use is dropping a memoised, tenant-derived snapshot. A cache
 * that survives a switch and is served within its TTL is the shape of finding
 * H7: seven read-model caches held composed KPIs, incidents, objectives and the
 * org roster, and were cleared only on `dispose()` — so switching organization
 * and opening a dashboard, the most common multi-tenant action there is,
 * landed inside the window.
 */
export function onWorkspaceSwitch(fn: SwitchListener): void {
  listeners.push(fn);
}

/**
 * Announce a committed switch. Called by the enterprise root ONLY.
 *
 * A listener that throws must not stop the others: these are cache flushes, and
 * one subsystem failing to forget is not a reason to leave the remaining six
 * holding the previous tenant's data.
 */
export function announceWorkspaceSwitch(workspaceId: string): void {
  for (const fn of listeners) {
    try {
      fn(workspaceId);
    } catch {
      // Best-effort: see above.
    }
  }
}

/** For tests: forget every listener. Never called in production. */
export function resetWorkspaceSwitchListenersForTests(): void {
  listeners.length = 0;
}

/** How many subsystems have declared switch residue. For the startup report. */
export function workspaceSwitchListenerCount(): number {
  return listeners.length;
}
