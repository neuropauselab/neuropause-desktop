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

  it('the work hub is a visible primary surface right after the assistant (Phase 6 Stage 5)', () => {
    const visible = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    expect(visible[4]?.id).toBe('hub');
  });

  // Phase 7: `welcome` left this lock — the onboarding wizard hands off to the
  // getting-started checklist, and a hidden section is unreachable from both
  // the sidebar and the palette, so that documented hand-off dead-ended.
  it('retired duplicate + pseudo-section surfaces are hidden from nav', () => {
    const hiddenIds = hidden.map((s) => s.id);
    for (const id of ['home', 'decision-center', 'developer-center', 'federation-center', 'control-plane', 'automations', 'analytics']) {
      expect(hiddenIds).toContain(id);
    }
  });

  it('the getting-started checklist is visible (Phase 7 — the wizard hands off to it)', () => {
    const welcome = SECTIONS.find((s) => s.id === 'welcome');
    expect(welcome?.hidden).toBeUndefined();
    expect(welcome?.group).toBe('system');
  });

  it('notifications stays visible (honest empty state + live toolbar-bell entry point)', () => {
    const visibleIds = SECTIONS.filter((s) => !s.hidden).map((s) => s.id);
    expect(visibleIds).toContain('notifications');
  });

  it('canonical production surfaces remain visible', () => {
    const visibleIds = SECTIONS.filter((s) => !s.hidden).map((s) => s.id);
    for (const id of ['mission-control', 'intent-home', 'search', 'assistant', 'hub', 'organization', 'enterprise', 'operations', 'workforce', 'connectors', 'cloud', 'federation', 'marketplace', 'sandbox', 'settings']) {
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

  // Phase 7 (Product Experience) — grouped navigation. Grouping is a render
  // concern; the SECTIONS array order is untouched, so every lock above holds.
  it('every visible primary section carries a sidebar group', () => {
    const visiblePrimary = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    for (const s of visiblePrimary) {
      expect(s.group, `section "${s.id}" needs a sidebar group`).toBeTruthy();
    }
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
        // NP-008 census F-N8-1: intent-home draws the seeded strategy goals (the
        // strategy-center substrate, already Preview) — labeled to match the truth.
        'intent-home',
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
      'search',
      'assistant',
      'hub',
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

// Phase 2 IA — the Operations-cluster disambiguation (P0). These lock the job-based
// labels so a future edit can't silently reintroduce the "Operations / Ops Center /
// AI Operations" collision, and add a standing no-duplicate-label guardrail.
describe('Phase 2 IA — Operations cluster (P0)', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('the enterprise operations center owns the plain "Operations" label', () => {
    expect(byId('opscenter')?.label).toBe('Operations');
  });

  it('the local runtime/app control panel is "Runtime" (not the enterprise "Operations")', () => {
    expect(byId('operations')?.label).toBe('Runtime');
  });

  it('the product/release lens is "Release Ops" (not the generic "Product Ops")', () => {
    expect(byId('product-ops')?.label).toBe('Release Ops');
  });

  it('every Operations-cluster section carries a user-facing description', () => {
    for (const id of ['operations', 'opscenter', 'ai-operations', 'product-ops', 'auto-ops-center']) {
      const desc = byId(id)?.description ?? '';
      expect(desc.length, `section "${id}" needs a description`).toBeGreaterThan(0);
    }
  });
});

// Phase 2 IA — Workforce / Knowledge / Business clarity (P1).
describe('Phase 2 IA — Workforce / Knowledge / Business (P1)', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('workforce splits into operate ("AI Workforce") and administer ("Workforce Admin")', () => {
    expect(byId('workforce')?.label).toBe('AI Workforce');
    expect(byId('workforce-center')?.label).toBe('Workforce Admin');
  });

  it('the deep fabric explorer is "Enterprise Knowledge"; the umbrella stays "Knowledge"', () => {
    expect(byId('knowledge')?.label).toBe('Knowledge');
    expect(byId('knowledge-center')?.label).toBe('Enterprise Knowledge');
  });

  it('the P1 clusters carry user-facing descriptions', () => {
    for (const id of ['workforce', 'workforce-center', 'knowledge', 'knowledge-center', 'memory', 'enterprise', 'business', 'organization', 'administration']) {
      const desc = byId(id)?.description ?? '';
      expect(desc.length, `section "${id}" needs a description`).toBeGreaterThan(0);
    }
  });
});

// Phase 2 IA — Marketplace & platform pairs (P2).
describe('Phase 2 IA — Marketplace & platform pairs (P2)', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('the governed package catalog is "Enterprise Marketplace"; consumer apps stay "AI Store"', () => {
    expect(byId('marketplace')?.label).toBe('Enterprise Marketplace');
    expect(byId('store')?.label).toBe('AI Store');
  });

  it('cloud and infrastructure stay distinct (no shared "control plane" label)', () => {
    expect(byId('cloud')?.label).toBe('Cloud');
    expect(byId('infrastructure')?.label).toBe('Infrastructure');
  });

  it('the P2 clusters carry user-facing descriptions', () => {
    for (const id of ['store', 'marketplace', 'extensibility', 'ecosystem', 'cloud', 'infrastructure']) {
      const desc = byId(id)?.description ?? '';
      expect(desc.length, `section "${id}" needs a description`).toBeGreaterThan(0);
    }
  });
});

// Phase 2 IA — internal-label leakage (P3).
describe('Phase 2 IA — no internal version labels (P3)', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('the commercial surface is "Commercial Center", not the internal "Platform v2"', () => {
    expect(byId('commercial-center')?.label).toBe('Commercial Center');
  });

  it('no visible section exposes an internal version identifier as its label', () => {
    const visibleLabels = SECTIONS.filter((s) => !s.hidden).map((s) => s.label);
    for (const banned of ['Platform v2', 'v1', 'v2']) {
      expect(visibleLabels).not.toContain(banned);
    }
    expect(visibleLabels.some((l) => /\bstage\s*\d|\bphase\s*\d/i.test(l))).toBe(false);
  });
});

// Phase 2 IA — Today landings & Sandbox positioning.
describe('Phase 2 IA — Today landings & Sandbox', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('the three Today landings each carry a distinct description (org vs strategy vs personal)', () => {
    const descs = ['mission-control', 'intent-home', 'hub'].map((id) => byId(id)?.description ?? '');
    for (const d of descs) expect(d.length).toBeGreaterThan(0);
    expect(new Set(descs).size).toBe(3);
  });

  it('Sandbox is positioned in the platform group with a description', () => {
    expect(byId('sandbox')?.group).toBe('platform');
    expect((byId('sandbox')?.description ?? '').length).toBeGreaterThan(0);
  });
});

// Phase 2 IA — progressive disclosure (tiers). Advanced surfaces collapse behind the
// sidebar's "Advanced" disclosure; this is cognitive-load reduction, NOT feature removal.
describe('Phase 2 IA — progressive disclosure tiers', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('marks the platform-heavy / preview / developer surfaces as advanced', () => {
    for (const id of [
      'industry-center', 'strategy-center', 'twin-center', 'knowledge-center', 'orchestration-center',
      'network-center', 'auto-ops-center', 'commercial-center', 'ecosystem', 'federation', 'developer',
      'extensibility', 'product-ops', 'cloud', 'infrastructure', 'operations', 'sandbox', 'workforce-center',
      // GATE 12 (round 57 decision): the two preview surfaces that used to sit in
      // the primary nav are demoted here for consistency with every other preview.
      'enterprise', 'marketplace',
    ]) {
      expect(byId(id)?.tier, `section "${id}" should be advanced`).toBe('advanced');
    }
  });

  it('never collapses a daily / core surface behind Advanced', () => {
    // GATE 12 (round 57 decision): `enterprise` moved OUT of this core list — it
    // is a preview surface and is now demoted to Advanced with the other preview
    // sections (see the "preview-tier placement" block below). `business`,
    // `organization` etc. remain the production business surfaces in the default nav.
    for (const id of [
      'mission-control', 'intent-home', 'search', 'assistant', 'hub', 'business',
      'organization', 'knowledge', 'memory', 'store', 'connectors', 'workforce', 'opscenter',
      'notifications', 'settings',
    ]) {
      expect(byId(id)?.tier === 'advanced', `section "${id}" must stay in the default sidebar`).toBe(false);
    }
  });

  it('advanced sections stay non-hidden, so the command palette + search still expose every route', () => {
    const advanced = SECTIONS.filter((s) => s.tier === 'advanced');
    expect(advanced.length).toBeGreaterThan(0);
    for (const s of advanced) expect(s.hidden).toBeFalsy();
  });

  it('the locked top-5 primary order is unaffected by tiering', () => {
    const visible = SECTIONS.filter((s) => s.placement === 'primary' && !s.hidden);
    expect(visible.slice(0, 5).map((s) => s.id)).toEqual(['mission-control', 'intent-home', 'search', 'assistant', 'hub']);
  });
});

// Phase 2 IA — standing coherence guardrail: no two VISIBLE sections may share a
// label, so the sidebar and command palette never show two identically-named
// destinations. (Hidden/retired routes are exempt — they aren't shown.)
describe('Phase 2 IA — navigation label coherence', () => {
  it('no two visible sections share the same label', () => {
    const labels = SECTIONS.filter((s) => !s.hidden).map((s) => s.label);
    const dupes = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
    expect(dupes, `duplicate visible labels: ${dupes.join(', ')}`).toEqual([]);
  });
});

// Phase 6 — the Data Command Center. It is the only surface that WRITES the
// organization's own records from a file, so it must stay reachable, must not be
// mistaken for a preview, and must not be hidden behind the Advanced disclosure.
describe('Phase 6 — Data Command Center', () => {
  const dataCenter = SECTIONS.find((s) => s.id === 'data-center');

  it('is a visible primary section in the business group', () => {
    expect(dataCenter).toBeDefined();
    expect(dataCenter?.hidden).toBeUndefined();
    expect(dataCenter?.placement).toBe('primary');
    expect(dataCenter?.group).toBe('business');
  });

  it('is real capability, not a preview surface', () => {
    expect(dataCenter?.preview).toBeUndefined();
  });

  it('stays in the default sidebar rather than behind the Advanced disclosure', () => {
    expect(dataCenter?.tier === 'advanced').toBe(false);
  });

  it('carries a user-facing description that says what it is for', () => {
    expect((dataCenter?.description ?? '').length).toBeGreaterThan(0);
  });

  it('does not collide with the AI Memory or Connectors surfaces', () => {
    expect(dataCenter?.label).not.toBe(SECTIONS.find((s) => s.id === 'memory')?.label);
    expect(dataCenter?.label).not.toBe(SECTIONS.find((s) => s.id === 'connectors')?.label);
  });
});

// GATE 12 (round 57) — preview-tier nav placement, DECIDED.
//
// The matrix left this open: `enterprise` and `marketplace` were the only two
// `preview: true` sections still in the PRIMARY sidebar, while every other
// preview surface was already behind the Advanced disclosure. The decision
// (demote both to Advanced) makes the rule uniform: preview features are opt-in
// under Advanced, so the default sidebar shows production-ready surfaces to an
// enterprise buyer — while the visible "Preview" badge, the command palette and
// universal search keep every preview surface honest and reachable. The lone
// intentional exception is `intent-home`, the preview Today landing.
describe('Gate 12 — preview-tier nav placement (decided: demote to Advanced)', () => {
  const byId = (id: string): (typeof SECTIONS)[number] | undefined => SECTIONS.find((s) => s.id === id);

  it('every preview section is behind Advanced — the ONLY exception is the intent-home landing', () => {
    const previewInPrimaryNav = SECTIONS.filter(
      (s) => s.preview && s.tier !== 'advanced' && !s.hidden,
    ).map((s) => s.id);
    expect(previewInPrimaryNav).toEqual(['intent-home']);
  });

  it('enterprise and marketplace are specifically demoted to Advanced (the decision)', () => {
    expect(byId('enterprise')?.tier).toBe('advanced');
    expect(byId('marketplace')?.tier).toBe('advanced');
  });

  it('demotion is placement only — both stay preview-badged, visible (reachable), and functional', () => {
    for (const id of ['enterprise', 'marketplace']) {
      expect(byId(id)?.preview, `${id} keeps its Preview badge`).toBe(true);
      expect(byId(id)?.hidden, `${id} is not hidden — palette + search still reach it`).toBeFalsy();
    }
  });

  it('CONTROL: a production business surface (business) stays in the default nav, never demoted', () => {
    expect(byId('business')?.preview).toBeUndefined();
    expect(byId('business')?.tier === 'advanced').toBe(false);
  });

  // The two preview storefronts (Enterprise Marketplace vs Ecosystem) previously
  // carried near-identical "workers, connectors, templates, …" descriptions — a
  // "which one do I click?" hazard, since both are the palette/tooltip subtitle a
  // user reads to tell them apart. Their jobs differ: Marketplace = governed
  // packages (publisher trust + org install policy); Ecosystem = the storefront +
  // partner exchange. Pin that they read distinctly along that axis.
  it('the two storefronts (marketplace, ecosystem) carry DISTINCT, job-differentiated descriptions', () => {
    const mkt = byId('marketplace')?.description ?? '';
    const eco = byId('ecosystem')?.description ?? '';
    expect(mkt.length).toBeGreaterThan(0);
    expect(eco.length).toBeGreaterThan(0);
    expect(mkt).not.toEqual(eco);
    // Marketplace's distinct job: governance / publisher trust / install policy.
    expect(mkt).toMatch(/govern|publisher|policy/i);
    // Ecosystem's distinct job: storefront / partner exchange.
    expect(eco).toMatch(/storefront|exchange|partner/i);
    // And they no longer share the old ambiguous "packages" vs "storefront for" collision:
    expect(mkt).not.toMatch(/storefront/i);
  });
});
