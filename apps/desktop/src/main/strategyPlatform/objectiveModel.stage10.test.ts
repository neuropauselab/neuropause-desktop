/**
 * Phase 6 Stage 10 — objectives: measures read ONLY existing aggregates, health
 * is computed (never asserted), unreadable measures degrade to honest unknown,
 * the company objective cannot outrank its worst rolling-up department, and
 * ownership gaps are declared.
 */
import { describe, expect, it } from 'vitest';
import { buildObjectivesReport, healthFrom, readMeasure, type MeasureSignals } from './objectiveModel';

const NOW = '2026-07-31T12:00:00.000Z';

const HEALTHY: MeasureSignals = {
  kpis: [
    { key: 'org-health', band: 'healthy', display: '82' },
    { key: 'engineering-health', band: 'healthy', display: '78' },
    { key: 'ai-adoption', band: 'healthy', display: '64%' },
    { key: 'connector-health', band: 'healthy', display: '100%' },
    { key: 'license-status', band: null, display: 'active' },
    { key: 'active-members', band: null, display: '12' },
  ],
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
  ].map((targetId) => ({ targetId, status: 'met' as const, detail: `${targetId} within target` })),
  domains: ['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'].map(
    (key) => ({ key, band: 'healthy', score: 90 }),
  ),
};

const UNITS = [
  { id: 'u1', name: 'Operations', leadUserId: 'p1' },
  { id: 'u2', name: 'Business', leadUserId: null },
  { id: 'u3', name: 'AI Team', leadUserId: 'p2' },
  { id: 'u4', name: 'IT', leadUserId: 'p1' },
  { id: 'u5', name: 'Engineering', leadUserId: 'p2' },
  { id: 'u6', name: 'Legal', leadUserId: null },
  { id: 'u7', name: 'Support', leadUserId: null },
];
const USERS = [
  { id: 'p1', name: 'Ada' },
  { id: 'p2', name: 'Lin' },
];

describe('readMeasure — existing aggregates only, honest unknowns', () => {
  it('KPI: healthy band → good; bandless → unknown (status metric); missing → unknown', () => {
    expect(readMeasure({ kind: 'kpi', ref: 'org-health', good: 'healthy-band' }, HEALTHY).state).toBe('good');
    expect(readMeasure({ kind: 'kpi', ref: 'license-status', good: 'healthy-band' }, HEALTHY).state).toBe('unknown');
    expect(readMeasure({ kind: 'kpi', ref: 'org-health', good: 'healthy-band' }, { ...HEALTHY, kpis: [] }).state).toBe('unknown');
  });

  it('SLA: met → good; breached → bad; declared unmeasurable → unknown WITH the reason', () => {
    const s: MeasureSignals = {
      ...HEALTHY,
      slaStatuses: [
        { targetId: 'exec-success-rate', status: 'breached', detail: 'success 82% < 90%' },
        { targetId: 'approval-age', status: 'unmeasurable', detail: 'no approvals in the window' },
      ],
    };
    expect(readMeasure({ kind: 'sla', ref: 'exec-success-rate', good: 'met' }, s).state).toBe('bad');
    const un = readMeasure({ kind: 'sla', ref: 'approval-age', good: 'met' }, s);
    expect(un.state).toBe('unknown');
    expect(un.detail).toContain('no approvals in the window');
  });

  it('domain: healthy → good; at-risk band → bad; unknown domain → unknown', () => {
    const s: MeasureSignals = {
      ...HEALTHY,
      domains: [
        { key: 'workflows', band: 'at-risk', score: 40 },
        { key: 'organization', band: 'unknown', score: null },
      ],
    };
    expect(readMeasure({ kind: 'insight-domain', ref: 'workflows', good: 'healthy-band' }, s).state).toBe('bad');
    expect(readMeasure({ kind: 'insight-domain', ref: 'organization', good: 'healthy-band' }, s).state).toBe('unknown');
    expect(readMeasure({ kind: 'insight-domain', ref: 'approvals', good: 'healthy-band' }, s).state).toBe('unknown');
  });
});

describe('healthFrom — computed, never asserted', () => {
  const good = { kind: 'kpi' as const, ref: 'x', reading: '1', state: 'good' as const, detail: '' };
  const bad = { kind: 'kpi' as const, ref: 'y', reading: '0', state: 'bad' as const, detail: '' };
  const unk = { kind: 'kpi' as const, ref: 'z', reading: null, state: 'unknown' as const, detail: '' };

  it('any failing measure drags to at-risk; ≥ half failing → off-track', () => {
    expect(healthFrom([good, good, bad]).health).toBe('at-risk');
    expect(healthFrom([good, bad]).health).toBe('off-track');
    expect(healthFrom([bad]).health).toBe('off-track');
  });

  it('nothing readable → unknown (never assumed good); good + declared-unknown stays on-track with the note', () => {
    expect(healthFrom([unk, unk]).health).toBe('unknown');
    expect(healthFrom([unk, unk]).detail).toContain('unknown, not assumed');
    const mixed = healthFrom([good, unk]);
    expect(mixed.health).toBe('on-track');
    expect(mixed.detail).toContain('unmeasurable/unreadable declared');
  });
});

describe('buildObjectivesReport — rollup + ownership honesty', () => {
  it('all measures healthy → every objective on-track; totals add up; owner resolves live units', () => {
    const r = buildObjectivesReport({ nowIso: NOW, signals: HEALTHY, units: UNITS, users: USERS, failures: {} });
    expect(r.company).toHaveLength(5);
    expect(r.departments).toHaveLength(6);
    expect(r.totals.onTrack).toBe(11);
    expect(r.totals.atRisk + r.totals.offTrack + r.totals.unknown).toBe(0);
    const ops = r.company.find((o) => o.id === 'co-reliable-execution')!;
    expect(ops.owner?.unitName).toBe('Operations');
    expect(ops.owner?.leadName).toBe('Ada');
    expect(ops.rollup.sort()).toEqual(['do-eng-delivery', 'do-ops-flow']);
  });

  it('a company objective CANNOT outrank its worst rolling-up department', () => {
    // Break ONLY the department-level queue SLA: do-ops-flow goes off-track;
    // co-reliable-execution's own measures stay good but the rollup drags it.
    const signals: MeasureSignals = {
      ...HEALTHY,
      slaStatuses: HEALTHY.slaStatuses!.map((s) =>
        s.targetId === 'jobs-queue-depth' || s.targetId === 'approval-age'
          ? { ...s, status: 'breached' as const, detail: `${s.targetId} BREACHED` }
          : s,
      ),
    };
    const r = buildObjectivesReport({ nowIso: NOW, signals, units: UNITS, users: USERS, failures: {} });
    const dept = r.departments.find((d) => d.id === 'do-ops-flow')!;
    expect(dept.health).toBe('off-track');
    const company = r.company.find((o) => o.id === 'co-reliable-execution')!;
    expect(company.health).toBe('off-track');
    expect(company.healthDetail).toContain('dragged by department rollup');
    expect(company.healthDetail).toContain('do-ops-flow');
  });

  it('units without leads and unknown units are DECLARED ownership gaps', () => {
    const r = buildObjectivesReport({
      nowIso: NOW,
      signals: HEALTHY,
      units: UNITS.filter((u) => u.name !== 'IT'),
      users: USERS,
      failures: {},
    });
    // Business exists but has no lead → gap; IT missing entirely → gap.
    expect(r.gaps.some((g) => g.kind === 'ownership' && g.detail.includes('no lead assigned'))).toBe(true);
    expect(r.gaps.some((g) => g.kind === 'ownership' && g.detail.includes('"IT"'))).toBe(true);
  });

  it('failed source reads surface as unavailable entries, and measures degrade to unknown — never invented', () => {
    const r = buildObjectivesReport({
      nowIso: NOW,
      signals: { kpis: null, slaStatuses: null, domains: null },
      units: null,
      users: null,
      failures: { 'executive-kpis': 'snapshot read failed' },
    });
    expect(r.unavailable).toContainEqual({ system: 'executive-kpis', reason: 'snapshot read failed' });
    expect(r.totals.unknown).toBe(11);
    for (const o of [...r.company, ...r.departments]) expect(o.health).toBe('unknown');
  });
});
