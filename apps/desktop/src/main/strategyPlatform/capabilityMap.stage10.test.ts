/**
 * Phase 6 Stage 10 — the Enterprise Capability Map (the approved enhancement):
 * twelve capabilities analyzed ONLY from declared live evidence, honest
 * evidence-coverage + unknown conditions, initiative/decision ATTENTION (counts,
 * never currency — disclosed), the Stage 7 standards join, and the executive
 * questions: weakest / unsupported / investment focus / lacking standards /
 * highest operational risk.
 */
import { describe, expect, it } from 'vitest';
import { buildCapabilityMap, CAPABILITY_DISCLOSURE, conditionFrom, type CapabilityInput, type CapabilitySignals } from './capabilityMap';

const NOW = '2026-07-31T12:00:00.000Z';

function healthySignals(): CapabilitySignals {
  return {
    domains: ['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'].map(
      (key) => ({ key, band: 'healthy', score: 90 }),
    ),
    kpis: [
      { key: 'org-health', band: 'healthy', display: '82' },
      { key: 'engineering-health', band: 'healthy', display: '78' },
      { key: 'ai-adoption', band: 'healthy', display: '64%' },
      { key: 'connector-health', band: 'healthy', display: '100%' },
      { key: 'license-status', band: null, display: 'active' },
      { key: 'active-members', band: null, display: '12' },
    ],
    s9Services: [
      'execution-runtime',
      'workforce-jobs',
      'automation-rules',
      'connector-fleet',
      'ai-runtime',
      'assistant-experience',
      'notification-delivery',
    ].map((serviceId) => ({ serviceId, state: 'operational' })),
    readiness: ['deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance'].map((key) => ({
      key,
      state: 'ready',
    })),
    minedTypes: ['order_to_cash', 'procure_to_pay', 'make_to_complete'],
    compliance: [{ status: 'pass' }, { status: 'pass' }],
    slaStatuses: [{ targetId: 'exec-success-rate', status: 'met' }],
    apFindings: [],
    decisions: [{ category: 'growth', status: 'completed' }],
  };
}

function mkInput(over: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    nowIso: NOW,
    signals: healthySignals(),
    objectives: [
      { id: 'co-reliable-execution', capabilityKeys: ['operations', 'engineering'], health: 'on-track' },
      { id: 'do-support-signals', capabilityKeys: ['customer-success', 'support'], health: 'at-risk' },
    ],
    initiatives: [
      { id: 'init-operational-cadence', capabilityKeys: ['operations'], state: 'advancing' },
      { id: 'init-incident-response', capabilityKeys: ['operations', 'support'], state: 'blocked' },
      { id: 'init-ai-enablement', capabilityKeys: ['engineering', 'security'], state: 'advancing' },
    ],
    units: [
      { id: 'u1', name: 'Operations', leadUserId: 'p1' },
      { id: 'u2', name: 'Sales', leadUserId: null },
    ],
    users: [{ id: 'p1', name: 'Ada' }],
    knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: ref === 'sop' })),
    failures: {},
    ...over,
  };
}

describe('conditionFrom — honest composition', () => {
  it('all readable good → on-track; ≥ half bad → off-track; some bad → at-risk; nothing readable → unknown with 0 coverage', () => {
    expect(conditionFrom([{ verdict: 'good' }, { verdict: 'good' }])).toEqual({ condition: 'on-track', coverage: 1 });
    expect(conditionFrom([{ verdict: 'bad' }, { verdict: 'good' }]).condition).toBe('off-track');
    expect(conditionFrom([{ verdict: 'bad' }, { verdict: 'good' }, { verdict: 'good' }]).condition).toBe('at-risk');
    expect(conditionFrom([{ verdict: 'unknown' }, { verdict: 'unknown' }])).toEqual({ condition: 'unknown', coverage: 0 });
    // Coverage is fractional and honest: 1 readable of 2 declared.
    expect(conditionFrom([{ verdict: 'good' }, { verdict: 'unknown' }]).coverage).toBe(0.5);
  });
});

describe('buildCapabilityMap — the twelve business capabilities', () => {
  it('produces all twelve, on-track under fully healthy declared evidence, with full coverage', () => {
    const m = buildCapabilityMap(mkInput());
    expect(m.capabilities).toHaveLength(12);
    for (const c of m.capabilities) {
      expect(c.condition, c.key).toBe('on-track');
      expect(c.evidenceCoverage, c.key).toBe(1);
    }
    expect(m.weakest).toBeNull();
    expect(m.highestOperationalRisk).toBeNull();
    expect(m.disclosure).toBe(CAPABILITY_DISCLOSURE);
  });

  it('cross-references the backbone: objectives, initiatives, KPIs, risks, and decision attention per capability', () => {
    const m = buildCapabilityMap(mkInput());
    const ops = m.capabilities.find((c) => c.key === 'operations')!;
    expect(ops.objectives.total).toBe(1);
    expect(ops.initiatives).toEqual({ total: 2, blocked: 1 });
    expect(ops.kpis.map((k) => k.key).sort()).toEqual(['active-members', 'org-health']);
    expect(ops.riskIds.length).toBeGreaterThan(0);
    expect(ops.owner?.unitName).toBe('Operations');
    // growth decision → sales+marketing attention; initiatives add attention too.
    const sales = m.capabilities.find((c) => c.key === 'sales')!;
    expect(sales.decisionAttention).toBe(1);
    expect(ops.decisionAttention).toBe(2); // 2 initiatives + 0 decisions
  });

  it('unsupported capabilities (zero initiatives) and unmatched standards are named — and become gaps', () => {
    const m = buildCapabilityMap(mkInput());
    expect(m.unsupported).toContain('marketing');
    expect(m.unsupported).toContain('manufacturing');
    expect(m.unsupported).not.toContain('operations');
    const marketing = m.capabilities.find((c) => c.key === 'marketing')!;
    expect(marketing.gaps.some((g) => g.includes('no initiative supports'))).toBe(true);
    // knowledgeMatch matched only 'sop' topics → capabilities without an 'sop' topic lack standards.
    expect(m.lackingStandards).toContain('marketing');
    expect(m.lackingStandards).not.toContain('operations');
  });

  it('a sick shared domain drags exactly the capabilities that DECLARED it — weakest is judged, not invented', () => {
    const signals = healthySignals();
    signals.domains = signals.domains!.map((d) => (d.key === 'departments' ? { ...d, band: 'at-risk', score: 35 } : d));
    const m = buildCapabilityMap(mkInput({ signals }));
    const sales = m.capabilities.find((c) => c.key === 'sales')!;
    const marketing = m.capabilities.find((c) => c.key === 'marketing')!;
    const ops = m.capabilities.find((c) => c.key === 'operations')!;
    expect(sales.condition).toBe('off-track'); // 1 bad of 2 readable
    expect(marketing.condition).toBe('off-track'); // its only evidence
    expect(ops.condition).toBe('on-track'); // never declared 'departments'
    expect(m.weakest?.key).toBe('sales'); // worst condition, registry-stable order
    expect(m.weakest?.detail).toContain('off-track');
  });

  it('thin readable evidence → unknown condition + low coverage + a low-confidence gap (never a made-up score)', () => {
    const signals = healthySignals();
    signals.minedTypes = null; // manufacturing's ONLY evidence becomes unreadable
    const m = buildCapabilityMap(mkInput({ signals }));
    const man = m.capabilities.find((c) => c.key === 'manufacturing')!;
    expect(man.condition).toBe('unknown');
    expect(man.evidenceCoverage).toBe(0);
    expect(man.gaps.some((g) => g.includes('low-confidence'))).toBe(true);
  });

  it('operational risk: platform-wide breaches/findings attribute to operations; the top carrier is named', () => {
    const signals = healthySignals();
    signals.apFindings = [
      { kind: 'stuck-execution', severity: 'critical' },
      { kind: 'failed-run', severity: 'high' },
    ];
    signals.slaStatuses = [{ targetId: 'exec-success-rate', status: 'breached' }];
    const m = buildCapabilityMap(mkInput({ signals }));
    expect(m.highestOperationalRisk?.key).toBe('operations');
    expect(m.highestOperationalRisk?.detail).toContain('platform-wide');
  });

  it('a null standards join stays null-safe: refs read unmatched, all capabilities lack standards', () => {
    const m = buildCapabilityMap(mkInput({ knowledgeMatch: null }));
    expect(m.lackingStandards).toHaveLength(12);
  });

  it('investment focus is ATTENTION COUNTS — the disclosure says never currency', () => {
    const m = buildCapabilityMap(mkInput());
    expect(m.investmentFocus[0]).toEqual({ key: 'operations', attention: 2 });
    expect(m.investmentFocus).toHaveLength(5);
    expect(m.disclosure).toContain('never currency');
  });
});
