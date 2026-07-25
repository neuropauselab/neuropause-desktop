/**
 * Pure Workspace tab model (PEDP cycle 2).
 *
 * The open/dedupe/close/restore logic for Workspace tabs, extracted from the
 * ShellProvider reducer so it is unit-testable in isolation and can be extended
 * safely (the Workspace Runner builds on this surface next). No React, no IPC,
 * no side effects — deterministic given its inputs.
 */

/** A single open tab in the Workspace (an AI app instance). */
export interface WorkspaceTab {
  id: string;
  appId: string;
  title: string;
  openedAt: number;
}

/** The slice of shell state this model owns. */
export interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

/**
 * Open a tab for `appId`, or focus the existing tab for that app (dedupe by
 * appId). `makeId`/`now` are injected so the function stays pure and testable.
 */
export function openAppTab(
  state: TabsState,
  appId: string,
  title: string,
  makeId: () => string,
  now: number,
): TabsState {
  const existing = state.tabs.find((t) => t.appId === appId);
  if (existing) return { tabs: state.tabs, activeTabId: existing.id };
  const tab: WorkspaceTab = { id: makeId(), appId, title, openedAt: now };
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

/**
 * Close the tab `id`. If it was the active tab, focus the right-hand neighbour
 * (falling back to the left, then to none). Closing an unknown id is a no-op.
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeTabId = state.activeTabId;
  if (state.activeTabId === id) {
    const neighbour = tabs[idx] ?? tabs[idx - 1] ?? null;
    activeTabId = neighbour ? neighbour.id : null;
  }
  return { tabs, activeTabId };
}

/**
 * Restore persisted tabs defensively. Keeps only well-formed entries (object
 * with string `id` + `appId`) and coerces the display fields, so a partially
 * corrupted or legacy-shaped persisted tab restores cleanly (a missing title no
 * longer renders blank) instead of breaking the tab bar. Picks the persisted
 * active tab when it still exists, else the last tab.
 */
export function restoreTabs(persistedTabs: unknown, persistedActiveTab: unknown): TabsState {
  const raw = Array.isArray(persistedTabs) ? persistedTabs : [];
  const tabs: WorkspaceTab[] = raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .filter((t) => typeof t.id === 'string' && typeof t.appId === 'string')
    .map((t) => ({
      id: t.id as string,
      appId: t.appId as string,
      title: typeof t.title === 'string' && t.title.length > 0 ? t.title : 'Untitled',
      openedAt: typeof t.openedAt === 'number' && Number.isFinite(t.openedAt) ? t.openedAt : 0,
    }));
  const activeTabId =
    typeof persistedActiveTab === 'string' && tabs.some((t) => t.id === persistedActiveTab)
      ? persistedActiveTab
      : (tabs[tabs.length - 1]?.id ?? null);
  return { tabs, activeTabId };
}
