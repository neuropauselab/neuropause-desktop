/**
 * Phase 6 Stage 1 — workspaceContextModel unit tests (pure; no DOM, no React).
 * The pref reader is injected, so these run under the same Node gate as the
 * rest of the state models.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '@renderer/shell/sections';
import {
  legacyShellSnapshot,
  suggestedWorkspaceName,
  switcherShortcutHint,
  workspaceTemplates,
  type PrefReader,
} from './workspaceContextModel';

function fakeReader(values: Record<string, unknown>): PrefReader {
  return <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback);
}

describe('workspaceTemplates', () => {
  it('every template resolves to a REAL, visible section in the registry', () => {
    for (const t of workspaceTemplates()) {
      const hit = SECTIONS.find((s) => s.id === t.section);
      expect(hit, `template ${t.id} -> ${t.section}`).toBeTruthy();
      expect(hit?.hidden ?? false).toBe(false);
    }
  });

  it('offers the four Stage 1 templates with unique ids', () => {
    const ids = workspaceTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['blank', 'operations', 'enterprise', 'research']);
  });
});

describe('legacyShellSnapshot', () => {
  it('returns null on a genuinely fresh profile (nothing to migrate)', () => {
    expect(legacyShellSnapshot(fakeReader({}))).toBeNull();
  });

  it('captures persisted section + tabs when they exist', () => {
    const snap = legacyShellSnapshot(
      fakeReader({
        activeSection: 'operations',
        workspaceTabs: [{ id: 't1', appId: 'a', title: 'A', openedAt: 1 }],
        activeTabId: 't1',
      }),
    );
    expect(snap?.activeSection).toBe('operations');
    expect(Array.isArray(snap?.tabs)).toBe(true);
    expect(snap?.activeTabId).toBe('t1');
  });

  it('treats a tabs-only legacy profile as migratable with a safe section', () => {
    const snap = legacyShellSnapshot(
      fakeReader({ workspaceTabs: [{ id: 't1', appId: 'a', title: 'A', openedAt: 1 }] }),
    );
    expect(snap?.activeSection).toBe('intent-home');
  });
});

describe('switcher helpers', () => {
  it('suggests non-colliding workspace names', () => {
    expect(suggestedWorkspaceName([])).toBe('Workspace 1');
    expect(suggestedWorkspaceName(['Default'])).toBe('Workspace 2');
    expect(suggestedWorkspaceName(['Default', 'Workspace 3'])).toBe('Workspace 4');
  });

  it('offers shortcut hints only for the first nine entries', () => {
    expect(switcherShortcutHint(0)).toBe('⌘1');
    expect(switcherShortcutHint(8)).toBe('⌘9');
    expect(switcherShortcutHint(9)).toBeNull();
    expect(switcherShortcutHint(-1)).toBeNull();
  });
});
