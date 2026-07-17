/**
 * Experience Program v1.0 — model tests. Pure compression over a composed platform snapshot: the Decision
 * Center home, the decision queue, per-module summaries + progressive disclosure, the intent catalog, and
 * governance — PLUS the CARDINAL UX LAW (AI compresses, humans decide): raw signals are distilled to ONE
 * sentence + a compression count, and the home surfaces exactly one decision/risk/approval no matter how
 * much the platform knows. Deterministic and never-throws-on-empty.
 */
import { describe, expect, it } from 'vitest';
import {
  attentionHeadline,
  bandFor,
  valueBand,
  workforceBand,
  buildExperienceDecisions,
  buildExperienceGovernance,
  buildExperienceHome,
  buildExperienceIntents,
  buildExperienceSummaries,
  buildRoleViews,
  healthHeadline,
  workforceHeadline,
  type ExperienceState,
} from './experienceModel';

function state(over: Partial<ExperienceState> = {}): ExperienceState {
  return {
    greeting: 'Good morning',
    generatedAt: '2026-07-16T08:00:00.000Z',
    health: { score: 82, band: 'healthy' },
    mission: { title: 'Reduce cloud cost by right-sizing the fleet', detail: 'Idle replicas in us-east.', why: 'Saves an estimated $4,200/mo with no reliability impact.' },
    revenue: { display: '$1.2M', label: 'Revenue', band: 'healthy', detail: 'From enterprise KPIs.' },
    workforce: { successPct: 97, activeWorkers: 12, needApproval: 3 },
    oneDecision: { id: 'dec:1', title: 'Approve the fleet right-sizing', why: 'High-confidence saving.', band: 'watch', source: 'Strategy', requiredApprovals: 1, evidenceCount: 4 },
    oneRisk: { id: 'risk:1', title: 'Single point of failure in payments', domain: 'infrastructure', risk: 78, band: 'critical', reason: '12 resources depend on it.' },
    oneApproval: { id: 'app:1', title: 'Send Q3 renewal emails', source: 'workforce', requestedBy: 'growth-worker', band: 'watch' },
    kpiPool: {
      health: { label: 'Business health', display: '82/100', band: 'healthy' },
      revenue: { label: 'Revenue', display: '$1.2M', band: 'healthy' },
      risk: { label: 'Risk', display: '61/100', band: 'at-risk' },
      workforce: { label: 'AI workforce', display: '97%', band: 'healthy' },
      approvals: { label: 'Approvals pending', display: '3', band: 'watch' },
      reliability: { label: 'Reliability', display: '88/100', band: 'healthy' },
      security: { label: 'Security', display: '74/100', band: 'watch' },
      compliance: { label: 'Compliance', display: '90/100', band: 'healthy' },
      cloud: { label: 'Cloud cost', display: '$4,900/mo', band: 'healthy' },
      adoption: { label: 'Adoption', display: '66/100', band: 'watch' },
    },
    decisions: [
      { id: 'dec:1', kind: 'decision', title: 'Approve the fleet right-sizing', why: 'High-confidence saving.', band: 'watch', urgency: 75, source: 'Strategy', requiredApprovals: 1, evidenceCount: 4 },
      { id: 'app:1', kind: 'approval', title: 'Send Q3 renewal emails', why: 'Pending workforce approval.', band: 'watch', urgency: 50, source: 'workforce', requiredApprovals: 1, evidenceCount: 0 },
      { id: 'opt:1', kind: 'optimization', title: 'Consolidate two workers', why: 'Overlapping skills.', band: 'healthy', urgency: 20, source: 'Strategy', requiredApprovals: 0, evidenceCount: 2 },
    ],
    rawDecisionSignals: 127,
    moduleSummaries: [
      { key: 'operations', label: 'Operations', headline: '2 incidents and 1 approval need attention.', band: 'at-risk', compressedFrom: 40, detail: 'x', expandTo: 'auto-ops-center' },
      { key: 'twin', label: 'Digital Twin', headline: 'Digital Twin health is healthy at 84/100 across 6 domains.', band: 'healthy', compressedFrom: 320, detail: 'x', expandTo: 'twin-center' },
      { key: 'workforce', label: 'AI Workforce', headline: 'Your AI workforce completed 97% of objectives; 3 need approval.', band: 'healthy', compressedFrom: 1842, detail: 'x', expandTo: 'organization' },
    ],
    compressedSignals: 2329,
    ...over,
  };
}

function emptyState(): ExperienceState {
  return {
    greeting: 'Good evening', generatedAt: '2026-07-16T20:00:00.000Z',
    health: { score: 0, band: 'critical' }, mission: { title: 'Keep the momentum', detail: '', why: '' },
    revenue: { display: 'n/a', label: 'Revenue', band: 'watch', detail: '' },
    workforce: { successPct: 0, activeWorkers: 0, needApproval: 0 },
    oneDecision: null, oneRisk: null, oneApproval: null, kpiPool: {}, decisions: [], rawDecisionSignals: 0,
    moduleSummaries: [], compressedSignals: 0,
  };
}

describe('faithfulness: bands never false-green or false-red', () => {
  it('an idle workforce (no jobs) is neutral, never a false-red critical', () => {
    expect(workforceBand(0, 0)).toBe('watch'); // 0% of nothing is not a failure
    expect(workforceBand(100, 20)).toBe('critical'); // real activity, low success → critical
    expect(workforceBand(100, 90)).toBe('healthy');
  });

  it('a target-less value figure never hard-greens a zero/negative value', () => {
    expect(valueBand(1200)).toBe('healthy');
    expect(valueBand(0)).toBe('watch'); // never 'healthy' at $0
    expect(valueBand(-50)).toBe('watch');
  });
});

describe('CARDINAL: compression primitives (AI compresses, humans decide)', () => {
  it('"127 alerts" → "3 issues need your attention today."', () => {
    expect(attentionHeadline(3, 'issues')).toBe('3 issues need your attention today.');
    expect(attentionHeadline(1, 'issues')).toBe('1 issue needs your attention today.'); // singular
    expect(attentionHeadline(0, 'issues')).toBe('All clear — no issues need your attention.');
  });

  it('health + workforce compress to one sentence', () => {
    expect(healthHeadline(82, 'healthy')).toMatch(/strong/i);
    expect(healthHeadline(82, 'healthy')).toContain('82/100');
    expect(healthHeadline(20, 'critical')).toMatch(/critical/i);
    expect(workforceHeadline(97, 3)).toBe("Your AI workforce completed 97% of today's objectives. 3 decisions need approval.");
    expect(workforceHeadline(100, 0)).toMatch(/Nothing needs approval/);
  });
});

describe('buildExperienceHome — the Decision Center', () => {
  it('surfaces exactly one decision, one risk, one approval — no matter how much is known', () => {
    const h = buildExperienceHome(state());
    expect(h.oneDecision?.id).toBe('dec:1');
    expect(h.oneRisk?.band).toBe('critical');
    expect(h.oneApproval?.id).toBe('app:1');
    // the compression ratio: thousands of signals distilled to a handful of primary items.
    expect(h.compressedSignals).toBe(2329);
    expect(h.businessHealth.headline).toMatch(/strong/i);
    expect(h.aiWorkforce.headline).toContain('97%');
  });

  it('is role-adaptive — 8 roles, each with its focus + three KPIs', () => {
    const h = buildExperienceHome(state());
    expect(h.roleViews).toHaveLength(8);
    for (const rv of h.roleViews) expect(rv.kpis.length).toBe(3);
    const founder = h.roleViews.find((r) => r.role === 'founder')!;
    expect(founder.kpis.map((k) => k.label)).toContain('Revenue');
    const cfo = h.roleViews.find((r) => r.role === 'cfo')!;
    expect(cfo.kpis.map((k) => k.label)).toContain('Cloud cost');
  });

  it('role views degrade gracefully when the KPI pool is sparse', () => {
    const rv = buildRoleViews({ health: { label: 'Business health', display: '80/100', band: 'healthy' } });
    expect(rv).toHaveLength(8);
    // only the available pool key survives; missing keys are filtered, never undefined.
    for (const r of rv) for (const k of r.kpis) expect(k).toBeTruthy();
  });
});

describe('buildExperienceDecisions — the Decision Queue', () => {
  it('CARDINAL: compresses many raw signals to a ranked, actionable-only queue', () => {
    const d = buildExperienceDecisions(state());
    expect(d.compressedFrom).toBe(127); // raw signal firehose
    expect(d.items.length).toBeLessThan(d.compressedFrom); // compressed
    expect(d.items[0].urgency).toBeGreaterThanOrEqual(d.items[d.items.length - 1].urgency); // ranked desc
    expect(d.needApproval).toBe(2); // the decision + the approval require a human
  });
});

describe('summaries + intents + governance', () => {
  it('summaries lead with the worst module and expose the 3 disclosure levels', () => {
    const s = buildExperienceSummaries(state());
    expect(s.modules[0].key).toBe('operations'); // at-risk sorts before healthy
    expect(s.disclosure.map((d) => d.id)).toEqual(['executive', 'management', 'specialist']);
    expect(s.disclosure[0].timeToValue).toBe('5 seconds');
    expect(s.totalCompressed).toBe(40 + 320 + 1842);
  });

  it('intents route outcomes to existing sections with keywords for intent search', () => {
    const i = buildExperienceIntents();
    expect(i.intents.length).toBeGreaterThanOrEqual(8);
    const cloud = i.intents.find((x) => x.id === 'reduce-cloud-cost')!;
    expect(cloud.targetSection).toBe('commercial-center');
    expect(cloud.keywords).toContain('cost');
    expect(cloud.available).toBe(true);
    for (const intent of i.intents) expect(intent.targetSection.length).toBeGreaterThan(0);
    // AUTHENTICITY (Intent Experience v2.0): no intent may advertise an unbacked capability — the former
    // `available:false` "launch-product" was removed; every remaining intent routes to a real workflow.
    for (const intent of i.intents) expect(intent.available).toBe(true);
    expect(i.intents.find((x) => x.id === 'launch-product')).toBeUndefined();
  });

  it('governance states the core UX law and reuses existing scopes', () => {
    const g = buildExperienceGovernance();
    expect(g.experienceScope).toBe('experience:read');
    expect(g.law).toMatch(/never ask a human to process/i);
    expect(g.reusedSystems.length).toBeGreaterThanOrEqual(6);
    expect(g.principles.length).toBeGreaterThanOrEqual(4);
  });
});

describe('determinism + never-throws-on-empty', () => {
  it('is deterministic — same state yields deep-equal output', () => {
    expect(buildExperienceHome(state())).toEqual(buildExperienceHome(state()));
  });

  it('never throws on an empty snapshot and still yields a complete home', () => {
    expect(() => buildExperienceHome(emptyState())).not.toThrow();
    expect(() => buildExperienceDecisions(emptyState())).not.toThrow();
    expect(() => buildExperienceSummaries(emptyState())).not.toThrow();
    const h = buildExperienceHome(emptyState());
    expect(h.roleViews).toHaveLength(8);
    expect(h.oneDecision).toBeNull();
    expect(h.businessHealth.headline).toMatch(/critical/i);
    expect(bandFor(0)).toBe('critical');
  });
});
