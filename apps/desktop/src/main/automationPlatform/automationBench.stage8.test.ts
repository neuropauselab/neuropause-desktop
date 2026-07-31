/**
 * Phase 6 Stage 8 — performance evidence at the audit's load model
 * (500 sessions · 500 awaiting jobs · 100 rules · 24 playbooks · 200 run
 * records). Budgets (doc-locked): catalog ≤ 100 ms · plan (compile + policy +
 * approvals) ≤ 50 ms · monitor ≤ 100 ms · dashboard ≤ 500 ms. A discarded
 * warm-up pass precedes each measurement (the Stage 7 cold-JIT lesson).
 * Numbers below are MEASURED in this suite — never asserted from hope.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRule, AutomationRunRecord, PlaybookDefinition } from '@neuropause/shared';
import { PLAYBOOK_REGISTRY, POLICY_DEFAULTS_REGISTRY } from './automationRegistry';
import { buildCatalog } from './automationCatalog';
import { buildMonitorReport } from './executionMonitor';
import { compilePlaybook } from './playbookComposer';
import { planRollback } from './rollbackPlanner';
import { previewApprovals, resolvePolicy } from './policyResolver';
import { composeAutomationDashboard, composeExplainability, composePoliciesView } from './automationModel';

const NOW = new Date(2026, 6, 15, 12, 0).getTime();
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

/* ── the load model ───────────────────────────────────────────────────────── */

const RULES: AutomationRule[] = Array.from({ length: 100 }, (_, i) => ({
  id: `rule-${i}`,
  name: `Rule ${i}`,
  trigger:
    i % 3 === 0
      ? { type: 'schedule', schedule: i % 9 === 0 ? 'whenever' : `daily ${(i % 12) + 1}am` }
      : { type: 'connector-event', connectorId: 'slack', event: 'message' },
  conditions: [],
  conditionLogic: 'all',
  actions: [{ id: 'a1', type: 'notify', label: 'Notify', config: {} }],
  status: i % 11 === 0 ? 'error' : 'active',
  createdAt: iso(90 * 86_400_000),
  updatedAt: iso(86_400_000),
}));

const RUNS: AutomationRunRecord[] = Array.from({ length: 200 }, (_, i) => ({
  id: `run-${i}`,
  ruleId: `rule-${i % 100}`,
  ruleName: `Rule ${i % 100}`,
  triggeredBy: 'manual',
  startedAt: iso((i % 48) * 3_600_000),
  completedAt: iso((i % 48) * 3_600_000 - 60_000),
  ok: i % 7 !== 0,
  durationMs: 1_000 + i,
  actions: [],
  ...(i % 7 === 0 ? { error: `failure ${i}` } : {}),
}));

const SESSIONS = Array.from({ length: 500 }, (_, i) => ({
  id: `s-${i}`,
  kind: 'worker' as const,
  label: `Session ${i}`,
  state: (i % 9 === 0 ? 'running' : 'completed') as 'running' | 'completed',
  startedAt: iso((i % 6) * 3_600_000),
}));

const JOBS = Array.from({ length: 500 }, (_, i) => ({ id: `j-${i}`, createdAt: iso((i % 72) * 3_600_000) }));

// 24 playbooks: the 4 real ones + 20 structural clones (same shape/size class).
const PLAYBOOKS: PlaybookDefinition[] = [
  ...PLAYBOOK_REGISTRY,
  ...Array.from({ length: 20 }, (_, i) => ({
    ...PLAYBOOK_REGISTRY[i % PLAYBOOK_REGISTRY.length],
    id: `clone-${i}`,
    name: `Clone ${i}`,
  })),
];

const KNOWN = [{ id: 'worker:operations', skills: ['briefing', 'recommend', 'remind', 'note'] }];

function measure(fn: () => void): number {
  fn(); // discarded warm-up (JIT + shape caches)
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function catalogOnce(): ReturnType<typeof buildCatalog> {
  return buildCatalog({
    nowMs: NOW,
    rules: RULES,
    workflowRuns: [],
    playbooks: PLAYBOOKS,
    deliverySources: Array.from({ length: 12 }, (_, i) => ({ key: `source-${i}` })),
    scheduledValidations: { pipelines: 5, scheduled: 3 },
    autoOpsPlans: 9,
    assistantRows: [{ id: 'assistant:brief', name: 'Briefings' }],
    failures: {},
  });
}

function monitorOnce(): ReturnType<typeof buildMonitorReport> {
  return buildMonitorReport({
    nowMs: NOW,
    sessions: SESSIONS,
    runRecords: RUNS,
    rules: RULES,
    workflowRuns: [],
    jobsAwaiting: JOBS,
    failures: {},
  });
}

function planOnce(): void {
  for (const pb of PLAYBOOK_REGISTRY) {
    const compiled = compilePlaybook(pb, KNOWN);
    const rollback = planRollback(pb, []);
    const policy = resolvePolicy({ playbook: pb, trigger: pb.approvalTrigger, defaults: POLICY_DEFAULTS_REGISTRY[0], chains: [], autoAllowedTriggers: [], rollback, nowMs: NOW });
    composeExplainability(pb, compiled, { policy }, 1);
    previewApprovals(pb.approvalTrigger, [], [], policy.autoExecutable);
  }
}

describe('Stage 8 performance budgets (500 sessions · 500 jobs · 100 rules · 24 playbooks · 200 runs)', () => {
  it('catalog build ≤ 100 ms', () => {
    const ms = measure(() => {
      catalogOnce();
    });
    expect(catalogOnce().totals.entries).toBeGreaterThan(120); // the load model is real
    expect(ms, `catalog took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(100);
  });

  it('plan (compile + policy + approvals for all four registry playbooks) ≤ 50 ms', () => {
    const ms = measure(planOnce);
    expect(ms, `plan took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(50);
  });

  it('monitor scan ≤ 100 ms', () => {
    const ms = measure(() => {
      monitorOnce();
    });
    const report = monitorOnce();
    expect(report.findings.length).toBeGreaterThan(10); // the scan found the seeded problems
    expect(ms, `monitor took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(100);
  });

  it('dashboard composition ≤ 500 ms end to end', () => {
    const ms = measure(() => {
      const catalog = catalogOnce();
      const monitor = monitorOnce();
      const policies = composePoliciesView(POLICY_DEFAULTS_REGISTRY, [], [], new Date(NOW).toISOString());
      composeAutomationDashboard({ catalog, monitor, playbooks: PLAYBOOKS, policies, nowIso: new Date(NOW).toISOString() });
    });
    expect(ms, `dashboard took ${ms.toFixed(1)} ms`).toBeLessThanOrEqual(500);
  });
});
