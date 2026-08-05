/**
 * Phase 6 Stage 10 — the initiative portfolio: sources read EXISTING records,
 * milestones are observable conditions (satisfied / unmet / not-evaluable —
 * never dates), state composes honestly (done / blocked-with-evidence /
 * advancing / stalled / unknown), and `decisions-executed` counts the REAL
 * terminal status 'completed'.
 */
import { describe, expect, it } from 'vitest';
import { buildPortfolio, evaluateMilestone, readSource, type PortfolioSignals } from './initiativePortfolio';

const NOW = '2026-07-31T12:00:00.000Z';

const MET = (targetId: string) => ({ targetId, status: 'met' as const, detail: `${targetId} within target` });

function healthySignals(): PortfolioSignals {
  return {
    slaStatuses: [
      'exec-success-rate',
      'exec-avg-runtime',
      'jobs-queue-depth',
      'approval-age',
      'automation-failure-ratio',
      'connector-healthy-ratio',
      'ai-engine-ready',
      'assistant-response-latency',
      'notification-latency',
    ].map(MET),
    readiness: ['deployment', 'organization', 'connectors', 'automation', 'workforce', 'ai', 'governance'].map((key) => ({
      key,
      state: 'ready',
      detail: `${key} ready`,
    })),
    kpis: [
      { key: 'engineering-health', band: 'healthy', display: '78' },
      { key: 'connector-health', band: 'healthy', display: '100%' },
    ],
    apFindings: [],
    playbooks: [
      { id: 'daily-ops-review', version: 1 },
      { id: 'incident-first-response', version: 1 },
      { id: 'weekly-maintenance-review', version: 1 },
      { id: 'quarterly-ops-report', version: 1 },
    ],
    s9Services: [
      'execution-runtime',
      'workforce-jobs',
      'automation-rules',
      'connector-fleet',
      'ai-runtime',
      'assistant-experience',
      'notification-delivery',
    ].map((serviceId) => ({ serviceId, state: 'operational', stateDetail: 'measured healthy' })),
    projects: [{ id: 'proj-1', title: 'Apollo', syncState: 'active', status: 'active' }],
    decisions: [{ id: 'd1', category: 'growth', status: 'completed' }],
    minedTypes: ['order_to_cash', 'procure_to_pay', 'make_to_complete'],
  };
}

const UNITS = [
  { id: 'u1', name: 'Operations', leadUserId: 'p1' },
  { id: 'u2', name: 'Engineering', leadUserId: null },
  { id: 'u3', name: 'Support', leadUserId: null },
];
const USERS = [{ id: 'p1', name: 'Ada' }];

describe('readSource — existing records only', () => {
  it('reads playbooks, services, projects, decisions, and mined processes; unreadable stores are declared', () => {
    const s = healthySignals();
    expect(readSource({ kind: 'playbook', ref: 'daily-ops-review' }, s)).toMatchObject({ available: true });
    expect(readSource({ kind: 's9-service', ref: 'ai-runtime' }, s).summary).toContain('operational');
    expect(readSource({ kind: 'project-entities', ref: 'project' }, s).summary).toContain('1 active project entity');
    expect(readSource({ kind: 'decision-category', ref: 'growth' }, s).summary).toContain('1 governed decision(s)');
    expect(readSource({ kind: 'mined-process', ref: 'order_to_cash' }, s).summary).toContain('mined from real events');
    expect(readSource({ kind: 'project-entities', ref: 'project' }, { ...s, projects: null }).available).toBe(false);
  });
});

describe('evaluateMilestone — observable conditions, never dates', () => {
  it('evaluates all five predicate kinds against live signals', () => {
    const s = healthySignals();
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'sla-met', targetId: 'jobs-queue-depth' } }, s).satisfied).toBe(true);
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'readiness-ready', dimension: 'ai' } }, s).satisfied).toBe(true);
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'kpi-healthy', key: 'engineering-health' } }, s).satisfied).toBe(true);
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'monitor-clear', findingKind: 'stuck-execution' } }, s).satisfied).toBe(true);
    expect(
      evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'decisions-executed', category: 'growth', atLeast: 1 } }, s).satisfied,
    ).toBe(true);
  });

  it('unreadable signals → satisfied null WITH the reason (not evaluable, never guessed)', () => {
    const s: PortfolioSignals = { ...healthySignals(), slaStatuses: null, readiness: null, decisions: null };
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'sla-met', targetId: 'approval-age' } }, s)).toMatchObject({
      satisfied: null,
    });
    expect(evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'readiness-ready', dimension: 'ai' } }, s).satisfied).toBeNull();
    expect(
      evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'decisions-executed', category: 'growth', atLeast: 1 } }, s).satisfied,
    ).toBeNull();
  });

  it("decisions-executed counts ONLY the real terminal status 'completed' — never a fictional 'executed'", () => {
    const s: PortfolioSignals = {
      ...healthySignals(),
      decisions: [
        { id: 'd1', category: 'growth', status: 'executed' }, // not a real DecisionStatus — must not count
        { id: 'd2', category: 'growth', status: 'in_progress' },
      ],
    };
    const m = evaluateMilestone({ id: 'm', label: 'l', predicate: { kind: 'decisions-executed', category: 'growth', atLeast: 1 } }, s);
    expect(m.satisfied).toBe(false);
    expect(m.detail).toContain("0 completed decision(s) in 'growth'");
  });
});

describe('buildPortfolio — honest state composition', () => {
  it('all conditions satisfied → every initiative done; owners resolve via the capability map', () => {
    const r = buildPortfolio({ nowIso: NOW, signals: healthySignals(), units: UNITS, users: USERS, failures: {} });
    expect(r.initiatives).toHaveLength(6);
    expect(r.totals).toEqual({ advancing: 0, blocked: 0, stalled: 0, done: 6, unknown: 0 });
    const cadence = r.initiatives.find((i) => i.id === 'init-operational-cadence')!;
    expect(cadence.owner?.unitName).toBe('Operations');
    expect(cadence.owner?.leadName).toBe('Ada');
    expect(cadence.dependsOn).toEqual([]);
    expect(r.initiatives.find((i) => i.id === 'init-incident-response')!.dependsOn).toEqual(['init-operational-cadence']);
  });

  it('an SLA breach on a milestone → BLOCKED with the milestone as evidence', () => {
    const signals = healthySignals();
    signals.slaStatuses = signals.slaStatuses!.map((s) =>
      s.targetId === 'connector-healthy-ratio' ? { ...s, status: 'breached' as const, detail: 'fleet ratio BREACHED: 60% < 90%' } : s,
    );
    const r = buildPortfolio({ nowIso: NOW, signals, units: UNITS, users: USERS, failures: {} });
    const fleet = r.initiatives.find((i) => i.id === 'init-integration-reliability')!;
    expect(fleet.state).toBe('blocked');
    expect(fleet.blockers.some((b) => b.reason.includes('SLA breach') && b.evidence.includes('m-fleet'))).toBe(true);
  });

  it('readable but nothing satisfied (no breach) → STALLED, stated as 0/N evaluable', () => {
    const signals = healthySignals();
    signals.slaStatuses = signals.slaStatuses!.map((s) =>
      s.targetId === 'connector-healthy-ratio' ? { ...s, status: 'breached' as const, detail: 'ratio 60% below target 90%' } : s,
    );
    signals.readiness = signals.readiness!.map((d) => (d.key === 'connectors' ? { ...d, state: 'degraded' } : d));
    const r = buildPortfolio({ nowIso: NOW, signals, units: UNITS, users: USERS, failures: {} });
    const fleet = r.initiatives.find((i) => i.id === 'init-integration-reliability')!;
    expect(fleet.state).toBe('stalled');
    expect(fleet.stateDetail).toContain('0/2 evaluable');
  });

  it('partial progress → ADVANCING with the satisfied count', () => {
    const signals = healthySignals();
    signals.slaStatuses = signals.slaStatuses!.map((s) =>
      s.targetId === 'approval-age' ? { ...s, status: 'breached' as const, detail: 'oldest approval 40h over the 24h bar' } : s,
    );
    const r = buildPortfolio({ nowIso: NOW, signals, units: UNITS, users: USERS, failures: {} });
    const cadence = r.initiatives.find((i) => i.id === 'init-operational-cadence')!;
    expect(cadence.state).toBe('advancing');
    expect(cadence.stateDetail).toContain('1/2');
  });

  it('nothing readable → UNKNOWN (never assumed), with every source gap declared', () => {
    const signals: PortfolioSignals = {
      slaStatuses: null,
      readiness: null,
      kpis: null,
      apFindings: null,
      playbooks: null,
      s9Services: null,
      projects: null,
      decisions: null,
      minedTypes: null,
    };
    const r = buildPortfolio({ nowIso: NOW, signals, units: null, users: null, failures: { 'service-catalog': 'read failed' } });
    expect(r.totals.unknown).toBe(6);
    for (const i of r.initiatives) expect(i.state).toBe('unknown');
    expect(r.gaps.some((g) => g.kind === 'source')).toBe(true);
    expect(r.unavailable).toContainEqual({ system: 'service-catalog', reason: 'read failed' });
  });
});
