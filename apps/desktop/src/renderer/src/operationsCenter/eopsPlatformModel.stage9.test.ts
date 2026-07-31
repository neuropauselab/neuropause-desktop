/**
 * Phase 6 Stage 9 — the Platform tab's pure view-model (lives beside the
 * Operations Center tests so the existing operationsCenter/** vitest glob
 * collects it): total tone maps, honest header stats, rows that surface gaps
 * and declared-unmeasurable targets, and the deduped honesty strips.
 */
import { describe, expect, it } from 'vitest';
import type {
  IncidentLifecycleReport,
  OperationsDashboard,
  ReadinessAssessment,
  ServiceCatalog,
  SlaReport,
} from '@neuropause/shared';
import {
  continuityRows,
  eopsHeaderStats,
  gapLines,
  incidentRows,
  pressureTone,
  processRows,
  readinessRows,
  readinessTone,
  recommendationRows,
  serviceRows,
  serviceStateTone,
  severityTone,
  slaRows,
  slaTone,
  unavailableLines,
} from '../operationsPlatform/eopsPlatformModel';

function dashboard(over: Partial<OperationsDashboard> = {}): OperationsDashboard {
  return {
    generatedAt: 'x',
    catalog: { services: 7, operational: 5, degraded: 1, failed: 0, unknown: 1, gaps: 3 },
    health: { overall: 82, band: 'healthy', domains: [] },
    sla: { targets: 9, met: 7, breached: 0, unmeasurable: 2 },
    readiness: { ready: 6, degraded: 1, notReady: 0, unknown: 0 },
    incidents: { open: 1, critical: 0 },
    capacity: { pressure: 'low', bottlenecks: 0 },
    continuity: { score: 40, validations: 0, localBackups: 0 },
    kpis: [],
    objectives: [],
    recommendations: [],
    disclosures: ['d1', 'd2', 'd3'],
    unavailable: [],
    ...over,
  };
}

describe('total tone maps', () => {
  it('cover every state honestly (unknown/unmeasurable stay gray)', () => {
    expect(serviceStateTone('operational')).toBe('green');
    expect(serviceStateTone('degraded')).toBe('orange');
    expect(serviceStateTone('failed')).toBe('red');
    expect(serviceStateTone('unknown')).toBe('gray');
    expect(readinessTone('ready')).toBe('green');
    expect(readinessTone('not-ready')).toBe('red');
    expect(readinessTone('unknown')).toBe('gray');
    expect(slaTone('met')).toBe('green');
    expect(slaTone('breached')).toBe('red');
    expect(slaTone('unmeasurable')).toBe('gray');
    expect(severityTone('critical')).toBe('red');
    expect(severityTone('warning')).toBe('orange');
    expect(severityTone('info')).toBe('blue');
    expect(pressureTone('high')).toBe('red');
    expect(pressureTone('unknown')).toBe('gray');
  });
});

describe('header stats', () => {
  it('projects six chips with honest tones and hints', () => {
    const stats = eopsHeaderStats(dashboard());
    expect(stats.map((s) => s.label)).toEqual(['Services', 'SLA', 'Readiness', 'Incidents', 'Capacity', 'Continuity']);
    expect(stats[0].tone).toBe('orange'); // one degraded service
    expect(stats[1].hint).toContain('2 declared unmeasurable');
    expect(stats[3].tone).toBe('orange'); // open non-critical incident
    expect(stats[5].tone).toBe('gray'); // zero validations → continuity undemonstrated
    const critical = eopsHeaderStats(dashboard({ incidents: { open: 2, critical: 1 }, catalog: { services: 7, operational: 4, degraded: 1, failed: 2, unknown: 0, gaps: 0 } }));
    expect(critical[0].tone).toBe('red');
    expect(critical[3].tone).toBe('red');
  });
});

describe('rows', () => {
  it('service rows surface ownership gaps and missing KPI joins', () => {
    const catalog = {
      generatedAt: 'x',
      entries: [
        {
          serviceId: 's1',
          name: 'S1',
          description: '',
          domain: 'workflows',
          signal: 'execution-stats',
          state: 'operational',
          stateDetail: 'success rate 95%',
          owner: { unitId: 'u1', unitName: 'Operations', leadUserId: null, leadName: null },
          slaTargetIds: [],
          kpiKeys: [{ key: 'engineering-health', present: false }],
          dependsOn: [],
          evidence: [],
        },
        {
          serviceId: 's2',
          name: 'S2',
          description: '',
          domain: 'ai',
          signal: 'none-measured',
          state: 'unknown',
          stateDetail: 'declared',
          owner: null,
          slaTargetIds: [],
          kpiKeys: [],
          dependsOn: [],
          evidence: [],
        },
      ],
      domains: [],
      gaps: [{ kind: 'ownership', subject: 'ai', detail: 'no unit' }],
      totals: { services: 2, operational: 1, degraded: 0, failed: 0, unknown: 1 },
      unavailable: [],
    } as unknown as ServiceCatalog;
    const rows = serviceRows(catalog);
    expect(rows[0].ownerText).toBe('Operations · no lead assigned');
    expect(rows[0].kpiText).toBe('engineering-health (missing)');
    expect(rows[1].ownerText).toBe('NO OWNER RESOLVED (gap)');
    expect(gapLines(catalog)).toEqual(['ownership: ai — no unit']);
  });

  it('sla + readiness + incident rows carry states, tones, and honest details', () => {
    const sla = {
      generatedAt: 'x',
      statuses: [
        { targetId: 't1', serviceId: 's1', label: 'L1', metric: 'success-rate', comparator: 'gte', target: 0.9, unit: 'ratio', measured: null, status: 'unmeasurable', detail: 'DECLARED unmeasurable', evidence: [], windowLabel: 'n/a' },
      ],
      totals: { targets: 1, met: 0, breached: 0, unmeasurable: 1 },
      unavailable: [],
    } as unknown as SlaReport;
    expect(slaRows(sla)[0].tone).toBe('gray');

    const readiness = {
      generatedAt: 'x',
      dimensions: [{ key: 'automation', label: 'Automation', state: 'unknown', evidence: [], missing: ['no finished runs'], detail: 'unknown, not assumed' }],
      totals: { ready: 0, degraded: 0, notReady: 0, unknown: 1 },
      unavailable: [],
    } as unknown as ReadinessAssessment;
    const rrows = readinessRows(readiness);
    expect(rrows[0].tone).toBe('gray');
    expect(rrows[0].missingText).toBe('no finished runs');

    const incidents = {
      generatedAt: 'x',
      incidents: [
        {
          incident: { id: 'i1', title: 'T', severity: 'critical', startTs: 0, endTs: 0, eventIds: [], resourceIds: [], rootCauseLabel: null, rootCauseConfidence: 0, blastRadius: 1, recommendedActions: [] },
          transient: true,
          domain: 'connectors',
          owner: null,
          stage: 'detected',
          stageDetail: 'detected',
          sopRefs: [],
          conversion: { available: true, how: 'convert to a governed decision' },
          investigation: { rootCauseLabel: null, rootCauseConfidence: 0, eventIds: [], replayHint: 'replay on the timeline' },
        },
      ],
      totals: { open: 1, bySeverity: [{ severity: 'critical', count: 1 }] },
      unavailable: [],
    } as unknown as IncidentLifecycleReport;
    const irows = incidentRows(incidents);
    expect(irows[0].ownerText).toBe('ownership gap');
    expect(irows[0].conversionHow).toContain('governed decision');
  });

  it('process, continuity, and recommendation rows project honestly', () => {
    const p = processRows({
      generatedAt: 'x',
      rows: [
        { processId: 'p1', name: 'P1', domain: 'departments', minedType: 'order_to_cash', metrics: { type: 'order_to_cash', cases: 3, medianDurationMs: 7_200_000, onTimeRate: 0.5 }, status: 'mined' },
        { processId: 'p2', name: 'P2', domain: 'organization', minedType: null, metrics: null, status: 'not-mined' },
      ],
      gaps: [],
      totals: { registered: 2, mined: 1, unregistered: 0 },
      unavailable: [],
    });
    expect(p[0].metricsText).toBe('3 case(s) · median 2.0 h · completion 50%');
    expect(p[1].metricsText).toBe('not mined (declared)');

    const c = continuityRows({
      generatedAt: 'x',
      posture: null,
      replication: null,
      validations: null,
      localBackups: null,
      supervisor: null,
      mechanisms: [{ name: 'M', kind: 'backup', detail: 'ZERO local backups', evidence: [] }],
      unavailable: [],
    });
    expect(c[0].hasEvidence).toBe(false);

    const r = recommendationRows(
      dashboard({
        recommendations: [
          {
            id: 'r1',
            title: 'T',
            detail: 'D',
            priority: 'critical',
            suggestedAction: 'act',
            evidence: ['e1', 'e2'],
            reasoning: 'because',
            confidence: 0.8,
            affectedSystems: ['x'],
            operationalImpact: 'impact',
            expectedBusinessOutcome: 'outcome',
            rollbackImplications: 'rollback',
          },
        ],
      }),
    );
    expect(r[0].tone).toBe('red');
    expect(r[0].principleC).toContain('Impact: impact');
    expect(r[0].principleC).toContain('80%');
    expect(r[0].principleC).toContain('2 evidence ref(s)');
  });
});

describe('honesty strips', () => {
  it('unavailable lines dedupe across parts; gapLines handles null', () => {
    expect(gapLines(null)).toEqual([]);
    const lines = unavailableLines([
      { unavailable: [{ system: 'insight', reason: 'offline' }] },
      { unavailable: [{ system: 'insight', reason: 'offline' }, { system: 'dr-store', reason: 'unreadable' }] },
    ]);
    expect(lines).toEqual(['insight: offline', 'dr-store: unreadable']);
  });
});
