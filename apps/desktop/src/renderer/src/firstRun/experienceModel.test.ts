/**
 * Private-First experience — the renderer view model.
 *
 * The judgements the first-run flow, the AI Home and the nav filter make.
 * Each test names the misreading it prevents — on this surface a misreading
 * is a privacy claim the product did not earn.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiRoutingMetadata,
  AiRoutingUsage,
  UnderstandingAttribute,
} from '@neuropause/shared';
import { SECTIONS } from '@renderer/shell/sections';
import {
  BUSINESS_NAV_GROUPS,
  FIRST_RUN_COPY,
  attentionSummary,
  businessGroupFor,
  economicsLine,
  processingBadge,
  processingIndicatorText,
  sectionVisibleFor,
  suggestedActions,
  usageDisplay,
  visibleSectionsFor,
} from './experienceModel';

const meta = (over: Partial<AiRoutingMetadata>): AiRoutingMetadata => ({
  location: 'local',
  provider: 'ollama',
  model: 'llama3.1',
  mode: 'private_first',
  reason: 'This task ran locally because a local model was available.',
  attempted: [],
  decidedAt: 't',
  ...over,
});

describe('Workspace-type navigation', () => {
  it('no choice shows everything — pre-experience installs are untouched', () => {
    for (const s of SECTIONS) expect(sectionVisibleFor(null, s.id)).toBe(true);
  });

  it('personal shows the focused set and always keeps settings reachable', () => {
    const visible = visibleSectionsFor('personal', SECTIONS).map((s) => s.id);
    expect(visible).toContain('ai-home');
    expect(visible).toContain('settings');
    expect(visible).toContain('assistant');
    expect(visible).not.toContain('enterprise');
    expect(visible).not.toContain('federation');
    expect(visible).not.toContain('workforce');
  });

  it('professional shows the business suite but not the platform-operations layers', () => {
    expect(sectionVisibleFor('professional', 'enterprise')).toBe(true);
    expect(sectionVisibleFor('professional', 'business')).toBe(true);
    expect(sectionVisibleFor('professional', 'data-center')).toBe(true);
    expect(sectionVisibleFor('professional', 'cloud')).toBe(false);
    expect(sectionVisibleFor('professional', 'federation')).toBe(false);
  });

  it('business hides nothing', () => {
    for (const s of SECTIONS) expect(sectionVisibleFor('business', s.id)).toBe(true);
  });

  it('every id in the personal allowlist is a REAL section', () => {
    // A typo here would silently drop a surface from Personal nav forever.
    const real = new Set(SECTIONS.map((s) => s.id));
    for (const s of visibleSectionsFor('personal', SECTIONS)) expect(real.has(s.id)).toBe(true);
    expect(visibleSectionsFor('personal', SECTIONS).length).toBeGreaterThanOrEqual(8);
  });

  it('filtering preserves SECTIONS order — no nav lock is disturbed', () => {
    const filtered = visibleSectionsFor('professional', SECTIONS).map((s) => s.id);
    const original = SECTIONS.filter((s) => filtered.includes(s.id)).map((s) => s.id);
    expect(filtered).toEqual(original);
  });
});

describe('Processing badge', () => {
  it('renders nothing without execution metadata — absence is never displayed as local', () => {
    expect(processingBadge(null)).toBeNull();
    expect(processingBadge(undefined)).toBeNull();
  });

  it('labels each location truthfully, with its tone', () => {
    expect(processingBadge(meta({ location: 'local' }))).toMatchObject({ label: 'Local', tone: 'good' });
    expect(processingBadge(meta({ location: 'private_infrastructure' }))).toMatchObject({
      label: 'Private infrastructure',
      tone: 'good',
    });
    expect(processingBadge(meta({ location: 'external' }))).toMatchObject({ label: 'External AI', tone: 'warn' });
    expect(processingBadge(meta({ location: 'none', model: 'none' }))).toMatchObject({
      label: 'No AI model',
      tone: 'neutral',
    });
  });

  it('BRAIN-1 — names a model ONLY when one genuinely served', () => {
    // A real model ran → the badge names it.
    expect(processingBadge(meta({ location: 'local', model: 'llama3.1' }))?.modelName).toBe('llama3.1');
    expect(processingBadge(meta({ location: 'external', model: 'claude-sonnet-4-6' }))?.modelName).toBe('claude-sonnet-4-6');
    // Zero-model / deterministic path → NO model named (never invented).
    expect(processingBadge(meta({ location: 'none', model: 'none' }))?.modelName).toBeNull();
    expect(processingBadge(meta({ location: 'local', model: 'none' }))?.modelName).toBeNull();
  });

  it('the Why answer is built from the execution metadata, attempts included', () => {
    const badge = processingBadge(
      meta({
        location: 'external',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        attempted: [{ provider: 'ollama', location: 'local', reason: 'connection refused' }],
      }),
    );
    expect(badge?.why).toContain('external provider');
    expect(badge?.why).toContain('Local was tried first');
    expect(badge?.why).toContain('connection refused');
  });

  it('the in-flight indicator states the planned route, or an honest generic when unknown', () => {
    expect(processingIndicatorText('local')).toBe('Processing locally…');
    expect(processingIndicatorText('private_infrastructure')).toContain('private infrastructure');
    expect(processingIndicatorText('external')).toContain('external provider');
    // No plan info → no fabricated source.
    expect(processingIndicatorText(null)).toBe('Working…');
  });
});

describe('Suggested actions', () => {
  it('never offers an ask when no AI route is available — offers setup instead', () => {
    const actions = suggestedActions({
      workspaceType: 'personal',
      populatedModules: 0,
      canImport: true,
      aiAvailable: false,
    });
    expect(actions.every((a) => a.kind !== 'ask')).toBe(true);
    expect(actions.some((a) => a.id === 'setup-ai')).toBe(true);
  });

  it('offers business analysis only when business records exist and the type shows them', () => {
    const personal = suggestedActions({
      workspaceType: 'personal',
      populatedModules: 5,
      canImport: true,
      aiAvailable: true,
    });
    expect(personal.some((a) => a.id === 'followups')).toBe(false);
    const professional = suggestedActions({
      workspaceType: 'professional',
      populatedModules: 5,
      canImport: true,
      aiAvailable: true,
    });
    expect(professional.some((a) => a.id === 'followups')).toBe(true);
    const noRecords = suggestedActions({
      workspaceType: 'professional',
      populatedModules: 0,
      canImport: true,
      aiAvailable: true,
    });
    expect(noRecords.some((a) => a.id === 'followups')).toBe(false);
  });

  describe('personalisation only from confirmed understanding', () => {
    const attribute = (status: 'stated' | 'inferred' | 'corrected'): UnderstandingAttribute => ({
      key: 'domain',
      label: 'You work on',
      value: 'Manufacturing',
      status,
      source: 's',
      updatedAt: 't',
    });
    const base = {
      workspaceType: 'business' as const,
      populatedModules: 3,
      canImport: true,
      aiAvailable: true,
    };

    it('an INFERRED domain never becomes a personalised suggestion', () => {
      const actions = suggestedActions({ ...base, understanding: [attribute('inferred')] });
      expect(actions.some((a) => a.id === 'domain-opportunities')).toBe(false);
    });

    it('a stated or corrected domain speaks in the user’s own words', () => {
      for (const status of ['stated', 'corrected'] as const) {
        const actions = suggestedActions({ ...base, understanding: [attribute(status)] });
        const suggestion = actions.find((a) => a.id === 'domain-opportunities');
        expect(suggestion?.label).toBe('Find opportunities in manufacturing');
        // The prompt itself forbids inventing impact — evidence or nothing.
        expect(suggestion?.prompt).toContain('only my real records');
      }
    });

    it('no understanding at all changes nothing — the old suggestions stand', () => {
      expect(suggestedActions(base).some((a) => a.id === 'domain-opportunities')).toBe(false);
      expect(suggestedActions(base).length).toBeGreaterThan(0);
    });

    it('open holds lead the list — real work waiting beats any suggestion', () => {
      const actions = suggestedActions({ ...base, openHolds: 2 });
      expect(actions[0]).toMatchObject({
        id: 'open-holds',
        label: 'Resolve 2 holds',
        kind: 'navigate',
        section: 'holds',
      });
      // Singular reads correctly, and zero holds offers nothing.
      expect(suggestedActions({ ...base, openHolds: 1 })[0]!.label).toBe('Resolve 1 hold');
      expect(suggestedActions({ ...base, openHolds: 0 })[0]!.id).not.toBe('open-holds');
    });
  });

  it('every action lands on a real path — an ask has a prompt, a navigate has a section', () => {
    const actions = suggestedActions({
      workspaceType: 'business',
      populatedModules: 3,
      canImport: true,
      aiAvailable: true,
    });
    for (const action of actions) {
      if (action.kind === 'ask') expect(action.prompt?.length).toBeGreaterThan(0);
      else expect(action.section?.length).toBeGreaterThan(0);
    }
  });
});

describe('Usage display', () => {
  it('shows the waiting message until something is measured — never a placeholder number', () => {
    expect(usageDisplay(null).rows).toBeNull();
    expect(usageDisplay(null).emptyMessage).toBe('Usage data will appear after you use NeuroPause.');
    const zero: AiRoutingUsage = {
      total: 0,
      byLocation: { local: 0, private_infrastructure: 0, external: 0, none: 0 },
      firstAt: null,
      lastAt: null,
    };
    expect(usageDisplay(zero).rows).toBeNull();
  });

  it('renders only measured locations, with percentages over the real total', () => {
    const usage: AiRoutingUsage = {
      total: 10,
      byLocation: { local: 8, private_infrastructure: 0, external: 2, none: 0 },
      firstAt: 't',
      lastAt: 't',
    };
    const view = usageDisplay(usage);
    expect(view.rows?.map((r) => r.location)).toEqual(['local', 'external']);
    expect(view.rows?.[0]).toMatchObject({ pct: 80, count: 8 });
    expect(view.total).toBe(10);
  });
});

describe('First-run copy', () => {
  it('carries the exact positioning the product leads with', () => {
    expect(FIRST_RUN_COPY.headline).toBe('Your AI. Your Data. Your Control.');
    expect(FIRST_RUN_COPY.primaryCta).toBe('Try Free Locally');
  });

  it('makes no claim the implementation cannot prove', () => {
    const all = JSON.stringify(FIRST_RUN_COPY).toLowerCase();
    // No registration flow verifies payment details, so this line may not exist.
    expect(all).not.toContain('no credit card');
    // Routing is Private First with explicit fallbacks — absolutes are earned
    // per-response by the badge, never promised globally.
    expect(all).not.toContain('100% local');
    expect(all).not.toContain('never leaves your device');
  });
});

describe('Intelligence economics', () => {
  it('is null until anything is measured — never an invented percentage', () => {
    expect(economicsLine(null)).toBeNull();
    expect(
      economicsLine({
        total: 0,
        byLocation: { local: 0, private_infrastructure: 0, external: 0, none: 0 },
        firstAt: null,
        lastAt: null,
      }),
    ).toBeNull();
  });

  it('computes "without an external provider" from real counters', () => {
    const line = economicsLine({
      total: 50,
      byLocation: { local: 20, private_infrastructure: 5, external: 10, none: 15 },
      firstAt: 't',
      lastAt: 't',
    });
    expect(line).toContain('80%');
    expect(line).toContain('50 measured requests');
  });
});

describe('Business information architecture', () => {
  it('maps every visible section to exactly one business group', () => {
    for (const s of SECTIONS.filter((x) => !x.hidden)) {
      const group = businessGroupFor(s.id, s.group);
      expect(BUSINESS_NAV_GROUPS).toContain(group);
    }
  });

  it('places the user-goal surfaces where the charter names them', () => {
    expect(businessGroupFor('data-center', 'business')).toBe('data');
    expect(businessGroupFor('knowledge', 'workspace')).toBe('data');
    expect(businessGroupFor('business', 'business')).toBe('business');
    expect(businessGroupFor('medical-devices', 'business')).toBe('business');
    expect(businessGroupFor('operations', 'ai')).toBe('operations');
    expect(businessGroupFor('intelligence', 'ai')).toBe('intelligence');
    expect(businessGroupFor('settings', 'system')).toBe('system');
    expect(businessGroupFor('ai-home', 'today')).toBe('today');
  });

  it('an unmapped surface lands in a real bucket rather than vanishing', () => {
    expect(BUSINESS_NAV_GROUPS).toContain(businessGroupFor('cloud', 'platform'));
  });
});

describe('Business attention', () => {
  it('zero everywhere is a statement, not an empty screen', () => {
    expect(
      attentionSummary([
        { id: 'a', label: 'Decisions awaiting review', count: 0, section: 'enterprise' },
        { id: 'b', label: 'Open tickets', count: 0, section: 'business' },
      ]),
    ).toBe('No items requiring attention.');
  });

  it('summarizes only the non-zero tiles', () => {
    expect(
      attentionSummary([
        { id: 'a', label: 'Decisions awaiting review', count: 3, section: 'enterprise' },
        { id: 'b', label: 'Open tickets', count: 0, section: 'business' },
        { id: 'c', label: 'Batches in quarantine', count: 1, section: 'medical-devices' },
      ]),
    ).toBe('3 decisions awaiting review · 1 batches in quarantine');
  });
});
