/**
 * P13C ROUND 36 — GATE 5. TOGGLING ONE TAB MUST NEVER HIDE EIGHT OTHERS.
 *
 * The failure being pinned: nav prefs persisted the ENABLED set, the only
 * writer (Customize) manages 8 of the 16 Enterprise tabs, and the loader
 * intersected all 16 against that stored 8-subset — so the first toggle of
 * ANYTHING permanently removed Executive, Process Explorer, Production
 * Schedule, Operator Console, Relationship Intelligence, Trust Center,
 * Favorites and Modules, with no in-app recovery. The fix stores the HIDDEN
 * set scoped to the managed tabs, so an unmanaged tab is unhideable by
 * construction.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadNavPrefs, saveNavPrefs } from '@renderer/enterprise/lib';

/** Customize's managed subset, and the full Enterprise tab set. */
const MANAGED = ['command', 'decision', 'organization', 'operations', 'search', 'workspace', 'briefings', 'customize'];
const ALL_16 = [
  ...MANAGED,
  'executive', 'process-explorer', 'production-schedule', 'operator-console',
  'relationship', 'trust-center', 'favorites', 'modules',
];

beforeEach(() => localStorage.clear());

describe('enterprise nav prefs (round 36)', () => {
  it('THE regression: saving from the 8-tab surface leaves the other 8 visible', () => {
    // The exact user action that used to destroy half the navigation:
    // toggle one managed tab off, save from the managed scope…
    const enabled = new Set(MANAGED.filter((id) => id !== 'briefings'));
    saveNavPrefs(enabled, MANAGED);
    // …then load with ALL 16, the way EnterpriseView does.
    const visible = loadNavPrefs(ALL_16);
    expect(visible.has('briefings')).toBe(false); // the one deliberate hide
    for (const id of ALL_16.filter((id) => !MANAGED.includes(id))) {
      expect(visible.has(id), `${id} must survive a managed-scope save`).toBe(true);
    }
  });

  it('command (the home surface) can never be hidden', () => {
    saveNavPrefs(new Set<string>(), MANAGED); // everything toggled off
    const visible = loadNavPrefs(ALL_16);
    expect(visible.has('command')).toBe(true);
  });

  it('a hide round-trips, and re-enabling restores it', () => {
    saveNavPrefs(new Set(MANAGED.filter((id) => id !== 'operations')), MANAGED);
    expect(loadNavPrefs(ALL_16).has('operations')).toBe(false);
    saveNavPrefs(new Set(MANAGED), MANAGED);
    expect(loadNavPrefs(ALL_16).has('operations')).toBe(true);
  });

  it('the legacy lossy enabled-list is discarded — affected installs self-heal', () => {
    // A victim's storage: the old key holding only the managed subset.
    localStorage.setItem('np.enterprise.nav', JSON.stringify(MANAGED));
    const visible = loadNavPrefs(ALL_16);
    expect(visible.size).toBe(ALL_16.length); // everything back
    expect(localStorage.getItem('np.enterprise.nav')).toBeNull();
  });

  it('defaults to all visible with nothing stored', () => {
    expect(loadNavPrefs(ALL_16).size).toBe(ALL_16.length);
  });
});
