/**
 * Phase 6 Stage 9 — the operations model: the seven-dimension readiness
 * assessment (honest unknown test-locked), the STRUCTURAL Principle-C lock
 * (mkRecommendation throws on an incomplete recommendation), recommendation
 * composition from breaches/readiness/incidents/capacity/continuity, the KPI
 * catalog dedupe, the dashboard compose (three disclosures always), the ten
 * question resolvers with FIVE-WAY disjointness (S5/S6/S7/S8/S9, both
 * directions), and the ten read-only answers.
 */
import { describe, expect, it } from 'vitest';
import type { ContinuityView, OperationsRecommendation } from '@neuropause/shared';
import { recommendationIssues } from '@neuropause/shared';
import { resolveInsightQuestion } from '../insight/insightModel';
import { resolveKnowledgeQuestion } from '../knowledgeAssets/knowledgeModel';
import { resolveAutomationQuestion } from '../automationPlatform/automationModel';
import { resolveBriefRequest, resolveMeetingPrep, resolveWorkSummary } from '../assistant/assistantModel';
import { buildServiceCatalog, type CatalogSignals } from './serviceCatalog';
import { buildSlaReport } from './slaFramework';
import { buildOperationalHealth } from './operationalHealth';
import { buildIncidentReport } from './incidentModel';
import { buildCapacityView } from './capacityPlanner';
import { buildContinuityView } from './continuityPlanner';
import { buildProcessReport } from './businessProcesses';
import {
  answerOperationsQuestion,
  buildKpiCatalog,
  buildReadiness,
  composeOperationsDashboard,
  composeRecommendations,
  mkRecommendation,
  OPERATIONS_DISCLOSURES,
  resolveOperationsQuestion,
  type OperationsQuestionContext,
  type ReadinessSignals,
} from './operationsModel';

const NOW_MS = Date.parse('2026-07-31T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

/* ── shared fixtures (built with the REAL builders) ───────────────────────── */

const UNITS = [
  { id: 'u-ops', name: 'Operations', leadUserId: 'p1' },
  { id: 'u-it', name: 'IT', leadUserId: null },
  { id: 'u-ai', name: 'AI Team', leadUserId: null },
  { id: 'u-pe', name: 'Product & Engineering', leadUserId: null },
  { id: 'u-biz', name: 'Business', leadUserId: null },
];
const USERS = [{ id: 'p1', name: 'Priya' }];

function signals(over: Partial<CatalogSignals> = {}): CatalogSignals {
  return {
    executions: { active: 1, queued: 2, successRate: 0.95, averageRuntimeMs: 1500 },
    workforce: { queueDepth: 3, awaitingApproval: 1, oldestApprovalHours: 2 },
    automation: { running: 0, completed: 10, failed: 1, paused: 0 },
    connectors: [{ id: 'slack', name: 'Slack', configured: true, health: 'healthy' }],
    aiState: 'ready',
    kpiKeys: ['engineering-health', 'ai-adoption', 'connector-health', 'org-health', 'active-members'],
    units: UNITS,
    users: USERS,
    ...over,
  };
}

function readinessSignals(over: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return {
    validation: { totalRuns: 5, certifies: 2, latestCertification: 'release-candidate' },
    compliance: [{ ruleId: 'approval_chain_defined', ruleName: 'Approval chain defined', severity: 'critical', status: 'pass' }],
    connectors: { configured: 1, healthy: 1 },
    automation: { completed: 10, failed: 1, errorRules: 0 },
    workforce: { healthy: 3, degraded: 0, unhealthy: 0, unknown: 1, queueDepth: 3 },
    aiState: 'ready',
    governance: { enabledChains: 2 },
    ...over,
  };
}

function ctx(over: Partial<OperationsQuestionContext> = {}): OperationsQuestionContext {
  const catalog = buildServiceCatalog({ nowIso: NOW_ISO, signals: signals(), failures: {} });
  const sla = buildSlaReport({
    nowIso: NOW_ISO,
    measurements: {
      executions: { successRate: 0.95, averageRuntimeMs: 1500 },
      workforce: { queueDepth: 3, oldestApprovalHours: 2 },
      automation: { completed: 10, failed: 1 },
      connectors: { configured: 1, healthy: 1 },
      aiState: 'ready',
    },
    failures: {},
  });
  const readiness = buildReadiness(NOW_ISO, readinessSignals(), {});
  const incidents = buildIncidentReport({ nowIso: NOW_ISO, nowMs: NOW_MS, incidents: [], units: UNITS, users: USERS, knowledgeMatch: null, failures: {} });
  const capacity = buildCapacityView({ nowIso: NOW_ISO, executions: { active: 1, queued: 2, successRate: 0.95 }, workforce: { queueDepth: 3, awaitingApproval: 1 }, automation: { running: 0, failed: 1, paused: 0 }, bottlenecks: [], predictions: [], failures: {} });
  const continuity: ContinuityView = buildContinuityView({ nowIso: NOW_ISO, posture: { haEnabled: false, multiRegion: false, rpoTargetSeconds: 300, rtoTargetSeconds: 3600, lastDrillAt: null, score: 40 }, replicas: [], validations: [], localBackups: [], supervisor: { recoveryCount: 0, recentFailures: 0 }, failures: {} });
  const health = buildOperationalHealth({ nowIso: NOW_ISO, framework: null, system: { score: 90, level: 'good' }, workforce: { healthy: 3, degraded: 0, unhealthy: 0, unknown: 1 }, connectors: { total: 1, configured: 1, healthy: 1 }, history: [], failures: {} });
  const processes = buildProcessReport({ nowIso: NOW_ISO, mined: [], failures: {} });
  const kpis = buildKpiCatalog([{ key: 'org-health', label: 'Org health', display: '82', value: 82, band: 'healthy' }], null);
  const dashboard = composeOperationsDashboard({ nowIso: NOW_ISO, catalog, health, sla, readiness, incidents, capacity, continuity, kpis, units: UNITS, users: USERS });
  return { catalog, health, sla, readiness, incidents, capacity, continuity, processes, dashboard, nowIso: NOW_ISO, ...over };
}

/* ── readiness ────────────────────────────────────────────────────────────── */

describe('buildReadiness — seven dimensions, four honest states', () => {
  it('healthy signals → 7 dimensions with certification-backed deployment ready', () => {
    const r = buildReadiness(NOW_ISO, readinessSignals(), {});
    expect(r.dimensions).toHaveLength(7);
    expect(r.dimensions.map((d) => d.key).sort()).toEqual(['ai', 'automation', 'connectors', 'deployment', 'governance', 'organization', 'workforce']);
    expect(r.totals.ready).toBe(7);
    const dep = r.dimensions.find((d) => d.key === 'deployment')!;
    expect(dep.detail).toContain('release-candidate');
  });

  it('unknown stays unknown: zero finished automation runs is NOT assumed ready', () => {
    const r = buildReadiness(NOW_ISO, readinessSignals({ automation: { completed: 0, failed: 0, errorRules: 0 } }), {});
    const auto = r.dimensions.find((d) => d.key === 'automation')!;
    expect(auto.state).toBe('unknown');
    expect(auto.detail).toContain('unknown, not assumed');
    expect(auto.missing).toContain('no finished automation runs recorded to judge from');
  });

  it('null signals → unknown; failing signals → not-ready with the missing items named', () => {
    const r = buildReadiness(
      NOW_ISO,
      readinessSignals({
        validation: null,
        compliance: [{ ruleId: 'every_unit_has_lead', ruleName: 'Every unit has a lead', severity: 'critical', status: 'fail' }],
        aiState: 'needs-setup',
        governance: { enabledChains: 0 },
      }),
      {},
    );
    expect(r.dimensions.find((d) => d.key === 'deployment')!.state).toBe('unknown');
    const org = r.dimensions.find((d) => d.key === 'organization')!;
    expect(org.state).toBe('not-ready');
    expect(org.missing).toContain('fix: Every unit has a lead');
    const ai = r.dimensions.find((d) => d.key === 'ai')!;
    expect(ai.state).toBe('not-ready');
    expect(ai.missing).toContain('configure an AI provider');
    expect(r.dimensions.find((d) => d.key === 'governance')!.state).toBe('degraded');
  });

  it('every-worker-unknown is honestly unknown', () => {
    const r = buildReadiness(NOW_ISO, readinessSignals({ workforce: { healthy: 0, degraded: 0, unhealthy: 0, unknown: 4, queueDepth: 0 } }), {});
    expect(r.dimensions.find((d) => d.key === 'workforce')!.state).toBe('unknown');
  });
});

/* ── Principle C (structural) ─────────────────────────────────────────────── */

describe('Principle C — the seven-field recommendation lock', () => {
  const complete: OperationsRecommendation = {
    id: 'r1',
    title: 'T',
    detail: 'D',
    priority: 'high',
    suggestedAction: 'Act via the existing surface',
    evidence: ['e1'],
    reasoning: 'because measured',
    confidence: 0.9,
    affectedSystems: ['workflows'],
    operationalImpact: 'work waits',
    expectedBusinessOutcome: 'work flows',
    rollbackImplications: 'read-only analysis; execution parks for approval',
  };

  it('recommendationIssues is empty for a complete recommendation and names every missing field', () => {
    expect(recommendationIssues(complete)).toEqual([]);
    const broken = { ...complete, evidence: [], reasoning: ' ', confidence: 0, affectedSystems: [], operationalImpact: '', expectedBusinessOutcome: ' ', rollbackImplications: '' };
    const issues = recommendationIssues(broken);
    expect(issues).toHaveLength(7);
  });

  it('mkRecommendation THROWS on incompleteness — an unexplained recommendation is a defect', () => {
    expect(mkRecommendation(complete)).toBe(complete);
    expect(() => mkRecommendation({ ...complete, reasoning: '' })).toThrow(/recommendation incomplete/);
  });

  it('composed recommendations all carry the seven fields (SLA breach / readiness / capacity / continuity)', () => {
    const base = ctx();
    const breachedSla = buildSlaReport({
      nowIso: NOW_ISO,
      measurements: { executions: { successRate: 0.4, averageRuntimeMs: 500_000 }, workforce: { queueDepth: 100, oldestApprovalHours: 90 }, automation: { completed: 1, failed: 9 }, connectors: { configured: 4, healthy: 0 }, aiState: 'error' },
      failures: {},
    });
    const notReady = buildReadiness(NOW_ISO, readinessSignals({ aiState: 'error' }), {});
    const highCap = buildCapacityView({ nowIso: NOW_ISO, executions: { active: 9, queued: 40, successRate: 0.4 }, workforce: { queueDepth: 80, awaitingApproval: 40 }, automation: { running: 0, failed: 9, paused: 0 }, bottlenecks: [{ scope: 'worker', key: 'w1', kind: 'failure-rate', reason: 'r', value: 0.7, sampleSize: 12 }], predictions: [], failures: {} });
    const recs = composeRecommendations({ sla: breachedSla, readiness: notReady, incidents: base.incidents, capacity: highCap, continuity: base.continuity });
    expect(recs.length).toBeGreaterThanOrEqual(9); // 7 breaches + ai not-ready + pressure + no-backups
    for (const r of recs) expect(recommendationIssues(r), r.id).toEqual([]);
    expect(recs.some((r) => r.id === 'opsrec:capacity:pressure')).toBe(true);
    expect(recs.some((r) => r.id === 'opsrec:continuity:no-backups')).toBe(true);
  });
});

/* ── KPI catalog + dashboard ──────────────────────────────────────────────── */

describe('KPI catalog + dashboard compose', () => {
  it('catalogs existing producers with source attribution and first-wins dedupe', () => {
    const rows = buildKpiCatalog(
      [{ key: 'org-health', label: 'Org health', display: '82', value: 82, band: 'healthy' }],
      [
        { key: 'org-health', label: 'dup', display: 'x', value: 1 },
        { key: 'process-throughput', label: 'Throughput', display: '12/wk', value: null },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ key: 'org-health', label: 'Org health', display: '82', value: 82, band: 'healthy', source: 'executive-center' });
    expect(rows[1].source).toBe('process-mining');
  });

  it('the dashboard always ships the three structural disclosures and deduped unavailable', () => {
    const d = ctx().dashboard;
    expect(d.disclosures).toEqual([...OPERATIONS_DISCLOSURES]);
    expect(OPERATIONS_DISCLOSURES).toHaveLength(3);
    expect(d.catalog.services).toBe(7);
    expect(d.objectives).toHaveLength(4);
    const ownerless = d.objectives.find((o) => o.id === 'trustworthy-automation')!;
    expect(ownerless.owner?.unitName).toBe('IT'); // resolved, lead null (honest)
    expect(ownerless.owner?.leadName).toBeNull();
  });
});

/* ── the ten resolvers + five-way disjointness ────────────────────────────── */

describe('resolveOperationsQuestion — ten keys', () => {
  it('routes the ten canonical phrasings', () => {
    expect(resolveOperationsQuestion('Operations status, please')).toBe('ops-status');
    expect(resolveOperationsQuestion('Which services are degraded?')).toBe('service-health');
    expect(resolveOperationsQuestion('Where are the operational bottlenecks?')).toBe('bottlenecks');
    expect(resolveOperationsQuestion('Are we ready for production?')).toBe('readiness');
    expect(resolveOperationsQuestion('What is our business continuity posture?')).toBe('continuity');
    expect(resolveOperationsQuestion('Show me the open incidents')).toBe('incidents');
    expect(resolveOperationsQuestion('Are we meeting our SLAs?')).toBe('sla');
    expect(resolveOperationsQuestion('What is the business impact of the current issues?')).toBe('business-impact');
    expect(resolveOperationsQuestion('Do we have enough capacity?')).toBe('capacity');
    expect(resolveOperationsQuestion('Review our operational objectives')).toBe('ops-planning');
  });

  it('FIVE-WAY disjointness: every stage answers its own questions and no one else’s', () => {
    const battery: { text: string; owner: 'insight' | 'knowledge' | 'automation' | 'operations' | 'none' }[] = [
      { text: 'Summarize the current enterprise health', owner: 'insight' },
      { text: 'Show me operational anomalies', owner: 'insight' },
      { text: 'Which workflows keep failing?', owner: 'insight' },
      { text: 'What is our deployment policy?', owner: 'knowledge' },
      { text: 'Which documents conflict?', owner: 'knowledge' },
      { text: 'What is the status of my automations?', owner: 'automation' },
      { text: 'Explain the daily-ops-review playbook', owner: 'automation' },
      { text: 'Operations status, please', owner: 'operations' },
      { text: 'Are we meeting our SLAs?', owner: 'operations' },
      { text: 'What is our business continuity posture?', owner: 'operations' },
      { text: 'Show me the open incidents', owner: 'operations' },
      { text: 'draft an email to the team', owner: 'none' },
    ];
    for (const { text, owner } of battery) {
      expect(resolveInsightQuestion(text) !== null, `insight vs "${text}"`).toBe(owner === 'insight');
      expect(resolveKnowledgeQuestion(text) !== null, `knowledge vs "${text}"`).toBe(owner === 'knowledge');
      expect(resolveAutomationQuestion(text) !== null, `automation vs "${text}"`).toBe(owner === 'automation');
      expect(resolveOperationsQuestion(text) !== null, `operations vs "${text}"`).toBe(owner === 'operations');
    }
  });

  it('operations phrasings do not trip the Stage 5 productivity resolvers', () => {
    for (const text of ['Operations status, please', 'Are we meeting our SLAs?', 'operational readiness']) {
      expect(resolveBriefRequest(text), text).toBeNull();
      expect(resolveWorkSummary(text), text).toBe(false);
      expect(resolveMeetingPrep(text), text).toBe(false);
    }
  });

  it('empty and unrelated text resolve to null', () => {
    expect(resolveOperationsQuestion('')).toBeNull();
    expect(resolveOperationsQuestion('what is the capital of France')).toBeNull();
  });
});

/* ── the ten answers ──────────────────────────────────────────────────────── */

describe('the ten answers — read-only, evidence-cited', () => {
  it("every answer rides the existing 'intelligence' report kind and is grounded", () => {
    const c = ctx();
    for (const key of ['ops-status', 'service-health', 'bottlenecks', 'readiness', 'continuity', 'incidents', 'sla', 'business-impact', 'capacity', 'ops-planning'] as const) {
      const r = answerOperationsQuestion(key, c);
      expect(r.kind, key).toBe('intelligence');
      expect(r.grounded, key).toBe(true);
      expect(r.sections.length, key).toBeGreaterThan(0);
    }
  });

  it('the SLA answer names the declared-unmeasurable targets', () => {
    const r = answerOperationsQuestion('sla', ctx());
    const text = r.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('UNMEASURABLE');
    expect(text).toContain('2 target(s) declared unmeasurable');
  });

  it('the incidents answer states transience and the decision-conversion path on empty', () => {
    const r = answerOperationsQuestion('incidents', ctx());
    const text = r.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('transient');
    expect(text).toContain('governed decision');
  });

  it('the business-impact answer is qualitative and never invents currency', () => {
    const r = answerOperationsQuestion('business-impact', ctx());
    const text = r.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('none are invented');
    expect(text).not.toMatch(/\$\s?\d/);
  });

  it('the continuity answer carries the honest zeros', () => {
    const r = answerOperationsQuestion('continuity', ctx());
    const text = r.sections.flatMap((s) => s.lines).join(' ');
    expect(text).toContain('ZERO recovery validations');
    expect(text).toContain('ZERO local backups');
  });
});
