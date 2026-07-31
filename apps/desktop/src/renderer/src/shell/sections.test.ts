/**
 * Product Integrity v1.0 — navigation guardrails. Locks the consolidated nav: the retired
 * duplicate/superseded experiences and empty placeholders are hidden from the sidebar (but retained +
 * routable, so the change is reversible), and the real production surfaces stay visible. This prevents a
 * duplicate or placeholder screen from silently reappearing in navigation.
 *
 * Phase 6 Stage 2: `mission-control` is the canonical landing surface and leads the visible nav;
 * `intent-home` remains visible directly beneath it (complementary, not a duplicate).
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from './sections';

describe('navigation sections — production visibility', () => {
  const hidden = SECTIONS.filter((s) => s.hidden);

  it('mission-control is the canonical, visible first primary section (Phase 6 Stage 2 landing)', () => {
    const firstVisible = SECTIONS.find((s) => s.placement === 'primary' && !s.hidden);
    expect(firstVisible?.id).toBe('mission-control');
  });

  it('intent-home stays visible right after the landing surface (complementary, not retired)', () => {
    const visible = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    expect(visible[1]?.id).toBe('intent-home');
  });

  it('universal search is a visible primary surface right after the landing pair (Phase 6 Stage 3)', () => {
    const visible = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    expect(visible[2]?.id).toBe('search');
  });

  it('the workspace assistant is a visible primary surface right after search (Phase 6 Stage 4)', () => {
    const visible = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    expect(visible[3]?.id).toBe('assistant');
  });

  it('retired duplicate + pseudo-section surfaces are hidden from nav', () => {
    const hiddenIds = hidden.map((s) => s.id);
    for (const id of ['home', 'decision-center', 'welcome', 'developer-center', 'federation-center', 'control-plane', 'automations', 'analytics']) {
      expect(hiddenIds).toContain(id);
    }
  });

  it('notifications stays visible (honest empty state + live toolbar-bell entry point)', () => {
    const visibleIds = SECTIONS.filter((s) => !s.hidden).map((s) => s.id);
    expect(visibleIds).toContain('notifications');
  });

  it('canonical production surfaces remain visible', () => {
    const visibleIds = SECTIONS.filter((s) => !s.hidden).map((s) => s.id);
    for (const id of ['mission-control', 'intent-home', 'search', 'assistant', 'organization', 'enterprise', 'operations', 'workforce', 'connectors', 'cloud', 'federation', 'marketplace', 'sandbox', 'settings']) {
      expect(visibleIds).toContain(id);
    }
  });

  it('complementary pairs are BOTH kept visible (not treated as duplicates)', () => {
    const visibleIds = SECTIONS.filter((s) => !s.hidden).map((s) => s.id);
    // operations (operator console) + opscenter (analyst view); workforce (operate) + workforce-center (admin)
    for (const id of ['operations', 'opscenter', 'workforce', 'workforce-center']) {
      expect(visibleIds).toContain(id);
    }
  });

  it('every hidden section is still defined (hide is reversible, not a deletion)', () => {
    for (const s of hidden) expect(s.label.length).toBeGreaterThan(0);
  });

  // PEDP Cycle 1 — honest positioning: the NRIA §3/§12 "Prototype-Model" surfaces
  // (real code, in-memory/seeded, no external effect) are labeled Preview so a user
  // can tell them apart from real production capability. Labeling, not hiding.
  it('marks exactly the NRIA Prototype-Model surfaces as preview', () => {
    const previewIds = SECTIONS.filter((s) => s.preview).map((s) => s.id).sort();
    expect(previewIds).toEqual(
      [
        'auto-ops-center',
        'cloud',
        'commercial-center',
        'ecosystem',
        'enterprise',
        'federation',
        'industry-center',
        'knowledge-center',
        'marketplace',
        'network-center',
        'orchestration-center',
        'strategy-center',
        'twin-center',
      ].sort(),
    );
  });

  it('does NOT mark real production surfaces as preview', () => {
    const previewIds = new Set<string>(SECTIONS.filter((s) => s.preview).map((s) => s.id));
    for (const id of [
      'mission-control',
      'intent-home',
      'search',
      'assistant',
      'connectors',
      'memory',
      'store',
      'operations',
      'workforce',
      'organization',
      'infrastructure',
      'opscenter',
      'settings',
    ]) {
      expect(previewIds.has(id)).toBe(false);
    }
  });

  it('preview is a label, not a hide — every preview surface stays visible', () => {
    const preview = SECTIONS.filter((s) => s.preview);
    const previewVisible = preview.filter((s) => !s.hidden);
    expect(previewVisible.length).toBe(preview.length);
  });
});
