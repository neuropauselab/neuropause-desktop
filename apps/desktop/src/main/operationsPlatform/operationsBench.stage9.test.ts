/**
 * Phase 6 Stage 9 — performance evidence at the audit's load model
 * (500 sessions · 500 jobs · 100 rules · 5 k entities · 90-day history).
 * Budgets (doc-locked): catalog ≤ 100 ms · health ≤ 100 ms · readiness ≤
 * 100 ms · continuity ≤ 50 ms · dashboard ≤ 500 ms. A discarded warm-up pass
 * precedes each measurement (the Stage 7 cold-JIT lesson). Numbers are
 * MEASURED in this suite — never asserted from hope.
 */
import { describe, expect, it } from 'vitest';
import type { InsightHealthFramework, InsightIncidentView } from '@neuropause/shared';
import { buildServiceCatalog, type CatalogSignals } from './serviceCatalog';
import { buildSlaReport } from './slaFramework';
import { buildOperationalHealth } from './operationalHealth';
import { buildIncidentReport } from './incidentModel';
import { buildCapacityView } from './capacityPlanner';
import { buildContinuityView } from './continuityPlanner';
import { buildProcessReport } from './businessProcesses';
import { buildKpiCatalog, buildReadiness, composeOperationsDashboard, type ReadinessSignals } from './operationsModel';

const NOW_MS = Date.parse('2026-07-15T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();
const iso = (msAgo: number): string => new Date(NOW_MS - msAgo).toISOString();

/* ── the load model ───────────────────────────────────────────────────────── */

// 5k entities appear as incident resource ids + connector fleet size class.
const RESOURCES = Array.from({ length: 5_000 }, (_, i) => `res-${i}`);

const INCIDENTS: InsightIncidentView[] = Array.from({ length: 40 }, (_, i) => ({
  id: `inc-${i}`,
  title: i % 3 === 0 ? 'Connector sync failures' : i % 3 === 1 ? 'Workflow job backlog' : 'Automation rule failures',
  severity: i % 5 === 0 ? 'critical' : i % 2 === 0 ? 'warning' : 'info',
  startTs: NOW_MS - (i + 1) * 3_600_000,
  endTs: i % 4 === 0 ? NOW_MS - 60_000 : 0,
  eventIds: Array.from({ length: 12 }, (_, k) => `ev-${i}-${k}`),
  resourceIds: RESOURCES.slice(i * 100, i * 100 + 25),
  rootCauseLabel: i % 2 === 0 ? 'token expired' : null,
  rootCauseConfidence: 0.7,
  blastRadius: 25,
  recommendedActions: i % 2 === 0 ? ['re-authenticate'] : [],
}));

const FRAMEWORK: InsightHealthFramework = {
  domains: (['organization', 'departments', 'projects', 'workflows', 'automations', 'ai', 'connectors', 'approvals'] as const).map((key) => ({
    key,
    label: key,
    score: 80,
    band: 'healthy' as const,
    explanation: ['computed'],
    evidence: ['e1', 'e2'],
    confidence: 0.9,
    signals: ['s1'],
    unavailable: null,
  })),
  overall: 80,
  band: 'healthy',
  confidence: { dataAvailability: 1, signalQuality: 0.9, historicalCoverage: 1, correlationStrength: 0.8, overall: 0.9 },
  generatedAt: NOW_ISO,
};

const HISTORY = Array.from({ length: 90 }, (_, i) => ({ day: iso(i * 86_400_000).slice(0, 10), overall: 70 + (i % 20) }));

const CONNECTORS = Array.from({ length: 40 }, (_, i) => ({
  id: `conn-${i}`,
  name: `Connector ${i}`,
  configured: i % 2 === 0,
  health: i % 6 === 0 ? 'degraded' : 'healthy',
}));

const UNITS = [
  { id: 'u-ops', name: 'Operations', leadUserId: 'p1' },
  { id: 'u-it', name: 'IT', leadUserId: null },
  { id: 'u-ai', name: 'AI Team', leadUserId: null },
  { id: 'u-pe', name: 'Product & Engineering', leadUserId: null },
  { id: 'u-biz', name: 'Business', leadUserId: null },
];
const USERS = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));

const SIGNALS: CatalogSignals = {
  executions: { active: 20, queued: 30, successRate: 0.88, averageRuntimeMs: 4_000 }, // 500-session engine window aggregate
  workforce: { queueDepth: 60, awaitingApproval: 120, oldestApprovalHours: 40 }, // 500-job store aggregate
  automation: { running: 5, completed: 800, failed: 120, paused: 3 }, // 100-rule engine aggregate
  connectors: CONNECTORS,
  aiState: 'ready',
  kpiKeys: ['engineering-health', 'ai-adoption', 'connector-health', 'org-health', 'active-members'],
  units: UNITS,
  users: USERS,
};

const READINESS: ReadinessSignals = {
  validation: { totalRuns: 12, certifies: 2, latestCertification: null },
  compliance: Array.from({ length: 6 }, (_, i) => ({ ruleId: `rule-${i}`, ruleName: `Rule ${i}`, severity: i % 2 === 0 ? 'critical' : 'warning', status: i === 5 ? 'warn' : 'pass' })),
  connectors: { configured: 20, healthy: 17 },
  automation: { completed: 800, failed: 120, errorRules: 2 },
  workforce: { healthy: 20, degraded: 3, unhealthy: 1, unknown: 4, queueDepth: 60 },
  aiState: 'ready',
  governance: { enabledChains: 2 },
};

const BOTTLENECKS = Array.from({ length: 8 }, (_, i) => ({ scope: 'worker', key: `w-${i}`, kind: 'failure-rate', reason: 'threshold', value: 0.5, sampleSize: 30 }));

function measure(fn: () => void): number {
  fn(); // discarded warm-up
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const catalogOnce = () => buildServiceCatalog({ nowIso: NOW_ISO, signals: SIGNALS, failures: {} });
const healthOnce = () =>
  buildOperationalHealth({ nowIso: NOW_ISO, framework: FRAMEWORK, system: { score: 88, level: 'good' }, workforce: { healthy: 20, degraded: 3, unhealthy: 1, unknown: 4 }, connectors: { total: 40, configured: 20, healthy: 17 }, history: HISTORY, failures: {} });
const slaOnce = () =>
  buildSlaReport({ nowIso: NOW_ISO, measurements: { executions: { successRate: 0.88, averageRuntimeMs: 4_000 }, workforce: { queueDepth: 60, oldestApprovalHours: 40 }, automation: { completed: 800, failed: 120 }, connectors: { configured: 20, healthy: 17 }, aiState: 'ready' }, failures: {} });
const readinessOnce = () => buildReadiness(NOW_ISO, READINESS, {});
const incidentsOnce = () => buildIncidentReport({ nowIso: NOW_ISO, nowMs: NOW_MS, incidents: INCIDENTS, units: UNITS, users: USERS, knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: false })), failures: {} });
const capacityOnce = () => buildCapacityView({ nowIso: NOW_ISO, executions: { active: 20, queued: 30, successRate: 0.88 }, workforce: { queueDepth: 60, awaitingApproval: 120 }, automation: { running: 5, failed: 120, paused: 3 }, bottlenecks: BOTTLENECKS, predictions: [], failures: {} });
const continuityOnce = () =>
  buildContinuityView({
    nowIso: NOW_ISO,
    posture: { haEnabled: true, multiRegion: true, rpoTargetSeconds: 300, rtoTargetSeconds: 3600, lastDrillAt: iso(7 * 86_400_000), score: 78 },
    replicas: Array.from({ length: 6 }, (_, i) => ({ status: i % 3 === 0 ? 'lagging' : 'in_sync' })),
    validations: Array.from({ length: 25 }, (_, i) => ({ status: i % 5 === 0 ? ('fail' as const) : ('pass' as const), rpoSeconds: 120 + i, validatedAt: iso(i * 86_400_000) })),
    localBackups: Array.from({ length: 30 }, (_, i) => ({ createdAt: iso(i * 86_400_000), valid: i % 9 === 0 ? null : true })),
    supervisor: { recoveryCount: 12, recentFailures: 1 },
    failures: {},
  });

describe('Stage 9 performance budgets (500 sessions · 500 jobs · 100 rules · 5k entities · 90-day history)', () => {
  it('service catalog ≤ 100 ms', () => {
    const ms = measure(() => {
      catalogOnce();
    });
    expect(catalogOnce().totals.services).toBe(7);
    expect(ms, `catalog took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(100);
  });

  it('operational health compose ≤ 100 ms (8 domains + 90-day trend)', () => {
    const ms = measure(() => {
      healthOnce();
    });
    expect(healthOnce().trend).toHaveLength(90);
    expect(ms, `health took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(100);
  });

  it('readiness ≤ 100 ms', () => {
    const ms = measure(() => {
      readinessOnce();
    });
    expect(readinessOnce().dimensions).toHaveLength(7);
    expect(ms, `readiness took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(100);
  });

  it('continuity ≤ 50 ms', () => {
    const ms = measure(() => {
      continuityOnce();
    });
    expect(continuityOnce().validations?.total).toBe(25);
    expect(ms, `continuity took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(50);
  });

  it('dashboard composition ≤ 500 ms end to end (40 incidents over 5k resources included)', () => {
    const ms = measure(() => {
      const catalog = catalogOnce();
      const health = healthOnce();
      const sla = slaOnce();
      const readiness = readinessOnce();
      const incidents = incidentsOnce();
      const capacity = capacityOnce();
      const continuity = continuityOnce();
      const kpis = buildKpiCatalog(
        [{ key: 'org-health', label: 'Org health', display: '82', value: 82, band: 'healthy' }],
        null,
      );
      composeOperationsDashboard({ nowIso: NOW_ISO, catalog, health, sla, readiness, incidents, capacity, continuity, kpis, units: UNITS, users: USERS });
      buildProcessReport({ nowIso: NOW_ISO, mined: [{ type: 'order_to_cash', cases: 500, medianDurationMs: 3_600_000, onTimeRate: 0.9 }], failures: {} });
    });
    expect(ms, `dashboard took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(500);
  });
});
