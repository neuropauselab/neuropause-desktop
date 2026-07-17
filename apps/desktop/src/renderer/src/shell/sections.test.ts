/**
 * Product Integrity v1.0 — navigation guardrails. Locks the consolidated nav: intent-home is the single
 * canonical landing, the retired duplicate/superseded experiences and empty placeholders are hidden from the
 * sidebar (but retained + routable, so the change is reversible), and the real production surfaces stay
 * visible. This prevents a duplicate or placeholder screen from silently reappearing in navigation.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS } from './sections';

describe('navigation sections — production visibility', () => {
  const hidden = SECTIONS.filter((s) => s.hidden);

  it('intent-home is the canonical, visible first primary section', () => {
    const firstVisible = SECTIONS.find((s) => s.placement === 'primary' && !s.hidden);
    expect(firstVisible?.id).toBe('intent-home');
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
    for (const id of ['intent-home', 'organization', 'enterprise', 'operations', 'workforce', 'connectors', 'cloud', 'federation', 'marketplace', 'sandbox', 'settings']) {
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
});
