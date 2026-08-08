/**
 * Phase 2 (P3 · diagnostics) — Runtime tab gating. Verifies that the internal-persona
 * AI tools and the raw event inspector never surface to an ordinary pilot user (a
 * packaged, non-dev build), while developers keep the full set and no route is deleted.
 */
import { describe, expect, it } from 'vitest';
import { ALL_OPS_TABS, visibleOpsTabs } from './opsTabs';

describe('Runtime tabs — developer/internal gating (P3)', () => {
  it('hides the internal-persona AI tools + the event inspector from packaged (non-dev) builds', () => {
    const ids = visibleOpsTabs(false).map((t) => t.id);
    expect(ids).not.toContain('founder');
    expect(ids).not.toContain('engineering');
    expect(ids).not.toContain('inspector');
  });

  it('never exposes an internal-persona label to ordinary pilot users', () => {
    const labels = visibleOpsTabs(false).map((t) => t.label);
    expect(labels).not.toContain('Founder AI');
    expect(labels).not.toContain('Engineering AI');
  });

  it('keeps the core operator tabs visible to everyone', () => {
    const ids = visibleOpsTabs(false).map((t) => t.id);
    for (const id of ['overview', 'installed', 'sessions', 'plugins', 'health', 'diagnostics', 'permissions']) {
      expect(ids).toContain(id);
    }
  });

  it('developers still get every tab (gated, not deleted)', () => {
    const devIds = visibleOpsTabs(true).map((t) => t.id);
    expect(visibleOpsTabs(true)).toHaveLength(ALL_OPS_TABS.length);
    for (const id of ['founder', 'engineering', 'inspector']) {
      expect(devIds).toContain(id);
    }
  });

  it('only developer/internal tabs are gated (everything else is always visible)', () => {
    const gated = ALL_OPS_TABS.filter((t) => t.devOnly).map((t) => t.id).sort();
    expect(gated).toEqual(['engineering', 'founder', 'inspector'].sort());
  });
});
