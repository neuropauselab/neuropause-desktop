import { describe, expect, it } from 'vitest';
import { openAppTab, closeTab, restoreTabs, type TabsState, type WorkspaceTab } from './workspaceTabs';

/**
 * PEDP cycle 2 — first tests for the Workspace tab model. Locks open/dedupe,
 * close-with-neighbour-selection, and the defensive restore path so the surface
 * the Workspace Runner will extend is regression-safe.
 */
function tab(id: string, appId = id, title = id, openedAt = 0): WorkspaceTab {
  return { id, appId, title, openedAt };
}
const seq = (ids: string[]): (() => string) => {
  let i = 0;
  return () => ids[i++];
};

describe('openAppTab', () => {
  it('opens a new tab and makes it active', () => {
    const next = openAppTab({ tabs: [], activeTabId: null }, 'notes', 'Notes', seq(['t1']), 1000);
    expect(next.tabs).toEqual([{ id: 't1', appId: 'notes', title: 'Notes', openedAt: 1000 }]);
    expect(next.activeTabId).toBe('t1');
  });

  it('dedupes by appId — focuses the existing tab instead of adding', () => {
    const state: TabsState = { tabs: [tab('t1', 'notes')], activeTabId: 't1' };
    const next = openAppTab(state, 'notes', 'Notes (again)', seq(['t2']), 2000);
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs).toBe(state.tabs); // unchanged reference
    expect(next.activeTabId).toBe('t1');
  });

  it('appends distinct apps in order', () => {
    let s: TabsState = { tabs: [], activeTabId: null };
    s = openAppTab(s, 'a', 'A', seq(['t1']), 1);
    s = openAppTab(s, 'b', 'B', seq(['t2']), 2);
    expect(s.tabs.map((t) => t.appId)).toEqual(['a', 'b']);
    expect(s.activeTabId).toBe('t2');
  });
});

describe('closeTab', () => {
  const three: TabsState = { tabs: [tab('t1'), tab('t2'), tab('t3')], activeTabId: 't2' };

  it('closing the active tab focuses the right-hand neighbour', () => {
    const next = closeTab(three, 't2');
    expect(next.tabs.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(next.activeTabId).toBe('t3');
  });

  it('closing the active LAST tab falls back to the left neighbour', () => {
    const next = closeTab({ tabs: [tab('t1'), tab('t2')], activeTabId: 't2' }, 't2');
    expect(next.activeTabId).toBe('t1');
  });

  it('closing the only tab clears the active id', () => {
    const next = closeTab({ tabs: [tab('t1')], activeTabId: 't1' }, 't1');
    expect(next.tabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it('closing a non-active tab keeps the active id', () => {
    const next = closeTab(three, 't1');
    expect(next.activeTabId).toBe('t2');
    expect(next.tabs.map((t) => t.id)).toEqual(['t2', 't3']);
  });

  it('closing an unknown id is a no-op', () => {
    expect(closeTab(three, 'nope')).toBe(three);
  });
});

describe('restoreTabs', () => {
  it('restores well-formed tabs and the persisted active tab', () => {
    const persisted = [tab('t1', 'a', 'A', 10), tab('t2', 'b', 'B', 20)];
    const next = restoreTabs(persisted, 't1');
    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe('t1');
  });

  it('falls back to the last tab when the persisted active id is gone', () => {
    const next = restoreTabs([tab('t1'), tab('t2')], 'missing');
    expect(next.activeTabId).toBe('t2');
  });

  it('coerces a malformed/legacy tab (missing title → "Untitled", bad openedAt → 0)', () => {
    const next = restoreTabs([{ id: 't1', appId: 'a' }, { id: 't2', appId: 'b', title: '', openedAt: NaN }], null);
    expect(next.tabs).toEqual([
      { id: 't1', appId: 'a', title: 'Untitled', openedAt: 0 },
      { id: 't2', appId: 'b', title: 'Untitled', openedAt: 0 },
    ]);
  });

  it('drops entries that are not objects or lack id/appId', () => {
    const next = restoreTabs([null, 'x', { id: 't1' }, { appId: 'a' }, { id: 't2', appId: 'ok' }], null);
    expect(next.tabs.map((t) => t.id)).toEqual(['t2']);
  });

  it('handles a non-array persisted value safely', () => {
    expect(restoreTabs(undefined, null)).toEqual({ tabs: [], activeTabId: null });
    expect(restoreTabs('corrupt', 'x')).toEqual({ tabs: [], activeTabId: null });
  });
});
