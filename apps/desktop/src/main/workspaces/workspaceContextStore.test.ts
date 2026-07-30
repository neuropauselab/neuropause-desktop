/**
 * Phase 6 Stage 1 — WorkspaceContextStore unit tests (pure Node, tmpdir-backed).
 * Covers: first-boot bootstrap + legacy migration, create/rename/delete/switch
 * semantics, persistence round-trip (relaunch simulation), defensive loading of
 * corrupt files, snapshot sanitization, and the workspace cap.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_WORKSPACES,
  WorkspaceContextStore,
  sanitizeSnapshot,
} from './workspaceContextStore';

let dirs: string[] = [];
function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'np-wsc-'));
  dirs.push(dir);
  return join(dir, 'workspace-contexts.json');
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Deterministic, strictly-increasing clock so ids and recency are stable. */
function makeClock(start = 1_000_000): () => number {
  let t = start;
  return () => (t += 1000);
}

describe('bootstrap + migration', () => {
  it('creates a Default workspace on first boot with no legacy state', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const state = store.bootstrap();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe('Default');
    expect(state.activeId).toBe(state.workspaces[0].id);
    expect(state.activeSnapshot.tabs).toEqual([]);
    expect(state.activeSnapshot.activeSection).toBe('intent-home');
  });

  it('imports the legacy single-context session into Default (backward compat)', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const legacy = {
      activeSection: 'operations',
      tabs: [
        { id: 't1', appId: 'app.alpha', title: 'Alpha', openedAt: 5 },
        { id: 't2', appId: 'app.beta', title: 'Beta', openedAt: 6 },
      ],
      activeTabId: 't2',
    };
    const state = store.bootstrap(legacy);
    expect(state.activeSnapshot.activeSection).toBe('operations');
    expect(state.activeSnapshot.tabs.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(state.activeSnapshot.activeTabId).toBe('t2');
  });

  it('bootstrap is idempotent — a second call never duplicates Default', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    store.bootstrap({ activeSection: 'operations', tabs: [], activeTabId: null });
    const again = store.bootstrap();
    expect(again.workspaces).toHaveLength(1);
    expect(again.activeSnapshot.activeSection).toBe('operations');
  });
});

describe('create / rename / delete / switch', () => {
  it('create activates the new workspace with the template section', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    store.bootstrap();
    const state = store.create('Ops room', 'operations');
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces[0].name).toBe('Ops room'); // active-first ordering
    expect(state.activeSnapshot.activeSection).toBe('operations');
  });

  it('deduplicates names with a numeric suffix', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    store.bootstrap();
    store.create('Research', 'research');
    const state = store.create('Research', 'research');
    expect(state.workspaces.map((w) => w.name)).toContain('Research (2)');
  });

  it('switch changes the active id and bumps recency ordering', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const first = store.bootstrap().activeId;
    const second = store.create('Second', 'blank').activeId;
    expect(second).not.toBe(first);
    const state = store.switch(first);
    expect(state.activeId).toBe(first);
    expect(state.workspaces[0].id).toBe(first);
  });

  it('switching to an unknown id is a harmless no-op', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const before = store.bootstrap();
    const after = store.switch('wsc_does_not_exist');
    expect(after.activeId).toBe(before.activeId);
  });

  it('deleting the active workspace activates the most recent remaining one', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const a = store.bootstrap().activeId;
    const b = store.create('B', 'blank').activeId;
    const state = store.remove(b);
    expect(state.activeId).toBe(a);
    expect(state.workspaces).toHaveLength(1);
  });

  it('deleting the last workspace resets to a fresh Default (never zero)', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    const only = store.bootstrap().activeId;
    const state = store.remove(only);
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe('Default');
    expect(state.activeId).toBe(state.workspaces[0].id);
  });

  it('rename trims, caps and deduplicates', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    store.bootstrap();
    const b = store.create('B', 'blank').activeId;
    const state = store.rename(b, '  Default  ');
    const renamed = state.workspaces.find((w) => w.id === b);
    expect(renamed?.name).toBe('Default (2)');
  });

  it('enforces the workspace cap with a loud error', () => {
    const store = new WorkspaceContextStore(tempStorePath(), makeClock());
    store.bootstrap();
    for (let i = 1; i < MAX_WORKSPACES; i++) store.create(`W${i}`, 'blank');
    expect(() => store.create('overflow', 'blank')).toThrow(/limit/);
  });
});

describe('persistence round-trip (relaunch simulation)', () => {
  it('a new store instance over the same file restores the exact session', () => {
    const path = tempStorePath();
    const s1 = new WorkspaceContextStore(path, makeClock());
    s1.bootstrap();
    s1.create('Ops', 'operations');
    s1.updateSnapshot(s1.getState().activeId, {
      activeSection: 'operations',
      tabs: [{ id: 'x1', appId: 'app.gamma', title: 'Gamma', openedAt: 9 }],
      activeTabId: 'x1',
    });
    s1.flush();

    const s2 = new WorkspaceContextStore(path, makeClock(9_000_000));
    const state = s2.bootstrap();
    expect(state.workspaces).toHaveLength(2);
    expect(state.workspaces[0].name).toBe('Ops');
    expect(state.activeSnapshot.tabs[0]).toMatchObject({ id: 'x1', appId: 'app.gamma', title: 'Gamma' });
    expect(state.activeSnapshot.activeTabId).toBe('x1');
  });

  it('a corrupt store file degrades to a clean first boot, never a throw', () => {
    const path = tempStorePath();
    writeFileSync(path, '{ not json !!!', 'utf-8');
    const store = new WorkspaceContextStore(path, makeClock());
    const state = store.bootstrap();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe('Default');
  });

  it('flush writes durable JSON (atomic rename target exists and parses)', () => {
    const path = tempStorePath();
    const store = new WorkspaceContextStore(path, makeClock());
    store.bootstrap();
    store.flush();
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.workspaces)).toBe(true);
  });
});

describe('sanitizeSnapshot', () => {
  it('drops malformed tabs, coerces titles, and validates the active tab', () => {
    const snap = sanitizeSnapshot({
      activeSection: '  ',
      tabs: [
        { id: 'ok', appId: 'a', title: '', openedAt: 'nope' },
        { id: 42, appId: 'broken' },
        'garbage',
        null,
      ],
      activeTabId: 'missing',
    });
    expect(snap.activeSection).toBe('intent-home');
    expect(snap.tabs).toHaveLength(1);
    expect(snap.tabs[0]).toEqual({ id: 'ok', appId: 'a', title: 'Untitled', openedAt: 0 });
    expect(snap.activeTabId).toBe('ok');
  });

  it('handles a completely foreign value', () => {
    const snap = sanitizeSnapshot(1234);
    expect(snap).toEqual({ activeSection: 'intent-home', tabs: [], activeTabId: null });
  });
});
