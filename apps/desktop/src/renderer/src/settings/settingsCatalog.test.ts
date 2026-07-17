/**
 * Constitutional Settings v1.0 — catalog tests. Locks the authenticity contract: every navigable search
 * result routes to a REAL production section, no search entry is 'unavailable' (unavailable capabilities are
 * hidden and only listed in the inventory), natural-language search works, and the capability inventory is a
 * complete, honest ledger.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '@renderer/shell/sections';
import {
  CAPABILITY_INVENTORY,
  computeReadiness,
  searchSettings,
  SETTINGS_DOMAINS,
  SETTINGS_SEARCH,
} from './settingsCatalog';

describe('search index authenticity', () => {
  it('every navigable setting routes to a REAL, visible production section (or stays in Settings)', () => {
    for (const e of SETTINGS_SEARCH) {
      if (e.targetSection) {
        expect(SECTIONS.some((s) => s.id === e.targetSection && !s.hidden)).toBe(true);
      }
      expect(SETTINGS_DOMAINS.some((d) => d.id === e.domain)).toBe(true);
    }
  });

  it('no search entry is "unavailable" — unavailable capabilities are hidden, never navigable', () => {
    for (const e of SETTINGS_SEARCH) expect(e.state).not.toBe('unavailable');
  });
});

describe('natural-language search', () => {
  it('matches example queries to the right settings', () => {
    expect(searchSettings('enable claude').some((r) => r.domain === 'ai')).toBe(true);
    expect(searchSettings('change startup page').some((r) => r.label === 'Startup experience')).toBe(true);
    expect(searchSettings('manage billing').some((r) => r.domain === 'billing')).toBe(true);
    expect(searchSettings('disable automatic execution').some((r) => r.domain === 'ai')).toBe(true);
    expect(searchSettings('trusted device').some((r) => r.label === 'Trusted devices')).toBe(true);
  });

  it('returns nothing for an empty query and caps results', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
    expect(searchSettings('e').length).toBeLessThanOrEqual(8);
  });
});

describe('capability inventory — the honesty ledger', () => {
  it('contains both managed and unavailable capabilities, each with a reason and a real domain', () => {
    const managed = CAPABILITY_INVENTORY.filter((c) => c.state === 'managed');
    const unavailable = CAPABILITY_INVENTORY.filter((c) => c.state === 'unavailable');
    expect(managed.length).toBeGreaterThan(0);
    expect(unavailable.length).toBeGreaterThan(0);
    for (const c of CAPABILITY_INVENTORY) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(SETTINGS_DOMAINS.some((d) => d.id === c.domain)).toBe(true);
    }
  });

  it('classifies AI provider/model as managed (env-governed) and account-security gaps as not-yet-built', () => {
    const managed = CAPABILITY_INVENTORY.filter((c) => c.state === 'managed').map((c) => c.capability).join(' ').toLowerCase();
    const unavailable = CAPABILITY_INVENTORY.filter((c) => c.state === 'unavailable').map((c) => c.capability).join(' ').toLowerCase();
    expect(managed).toMatch(/provider|model/); // env-managed, shown read-only — not faked, not hidden
    expect(unavailable).toMatch(/password/);
    expect(unavailable).toMatch(/passkey/);
  });
});

describe('readiness', () => {
  it('computes a coherent editable/managed/unavailable split', () => {
    const r = computeReadiness();
    expect(r.total).toBe(r.editable + r.managed + r.unavailable);
    expect(r.editable).toBeGreaterThan(0);
    expect(r.realPct).toBe(Math.round(((r.editable + r.managed) / r.total) * 100));
    expect(r.realPct).toBeGreaterThan(0);
    expect(r.realPct).toBeLessThanOrEqual(100);
  });
});
