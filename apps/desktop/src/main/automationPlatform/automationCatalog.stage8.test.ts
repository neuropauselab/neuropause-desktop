/**
 * Phase 6 Stage 8 — the computed Automation Catalog (D-1): every entry
 * classifies something that already exists, per-source failures isolate into
 * `unavailable`, the three structural disclosures ship on EVERY response, and
 * schedule rules carry their parse/next-due honesty inline.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationRule, WorkflowRun, WorkflowSpec } from '@neuropause/shared';
import { PLAYBOOK_REGISTRY } from './automationRegistry';
import { buildCatalog, CATALOG_DISCLOSURES, type CatalogInput } from './automationCatalog';

const NOW = new Date(2026, 6, 15, 8, 0).getTime();

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Notify on failure',
    trigger: { type: 'connector-event', connectorId: 'slack', event: 'message' },
    conditions: [],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', config: {} }],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function baseInput(over: Partial<CatalogInput> = {}): CatalogInput {
  return {
    nowMs: NOW,
    rules: [rule()],
    workflowRuns: [],
    playbooks: PLAYBOOK_REGISTRY,
    deliverySources: [{ key: 'automation-watch' }],
    scheduledValidations: { pipelines: 3, scheduled: 2 },
    autoOpsPlans: 7,
    assistantRows: [{ id: 'assistant:brief', name: 'Briefings' }],
    failures: {},
    ...over,
  };
}

describe('buildCatalog', () => {
  it('classifies every injected source into typed entries with correct totals', () => {
    const c = buildCatalog(baseInput());
    const kinds = new Map(c.totals.byKind.map((k) => [k.kind, k.count]));
    expect(kinds.get('automation-rule')).toBe(1);
    expect(kinds.get('playbook')).toBe(PLAYBOOK_REGISTRY.length);
    expect(kinds.get('delivery-source')).toBe(1);
    expect(kinds.get('scheduled-validation')).toBe(1);
    expect(kinds.get('autoops-plans')).toBe(1);
    expect(kinds.get('assistant-capability')).toBe(1);
    expect(c.totals.entries).toBe(c.entries.length);
  });

  it('the three structural disclosures ship on every catalog', () => {
    expect(CATALOG_DISCLOSURES).toHaveLength(3);
    const c = buildCatalog(baseInput({ rules: [], deliverySources: null, scheduledValidations: null, autoOpsPlans: null }));
    expect(c.disclosures).toEqual([...CATALOG_DISCLOSURES]);
    expect(c.disclosures.join(' ')).toContain("no executor is registered");
    expect(c.disclosures.join(' ')).toContain('never fired before Stage 8');
  });

  it('per-source failures isolate into unavailable — never fabricated rows', () => {
    const c = buildCatalog(baseInput({ rules: null, failures: { 'automation-rules': 'store exploded' } }));
    expect(c.entries.some((e) => e.kind === 'automation-rule')).toBe(false);
    expect(c.unavailable).toContainEqual({ system: 'automation-rules', reason: 'store exploded' });
    // Other sources still classify.
    expect(c.entries.some((e) => e.kind === 'playbook')).toBe(true);
  });

  it('a parseable schedule rule carries its spec + next due; an unparseable one carries the issue', () => {
    const c = buildCatalog(
      baseInput({
        rules: [
          rule({ id: 'r-sched', trigger: { type: 'schedule', schedule: 'daily 9am' } }),
          rule({ id: 'r-bad', trigger: { type: 'schedule', schedule: '0 9 * * *' } }),
        ],
      }),
    );
    const ok = c.entries.find((e) => e.id === 'rule:r-sched')!;
    expect(ok.schedule?.parsed).toEqual({ kind: 'daily', atMinutes: 540 });
    expect(ok.schedule?.issue).toBeNull();
    expect(ok.schedule?.nextDue).toBe(new Date(2026, 6, 15, 9, 0).toISOString()); // 8:00 → today 9:00
    const bad = c.entries.find((e) => e.id === 'rule:r-bad')!;
    expect(bad.schedule?.parsed).toBeNull();
    expect(bad.schedule?.issue).toContain('outside the deterministic subset');
    expect(bad.schedule?.nextDue).toBeNull();
  });

  it('workflow runs disclose the in-memory persistence and cite the existing orchestrator', () => {
    const spec: WorkflowSpec = { id: 'wf-1', name: 'WF', description: '', steps: [] };
    const run: WorkflowRun = { id: 'run-1', workflowId: 'wf-1', status: 'running', stepRuns: [], startedAt: '2026-07-15T07:00:00.000Z', finishedAt: null };
    const c = buildCatalog(baseInput({ workflowRuns: [{ run, spec }] }));
    const e = c.entries.find((x) => x.id === 'wfrun:run-1')!;
    expect(e.persistence).toContain('in-memory');
    expect(e.executionPath).toContain('orchestrator (existing)');
    expect(e.status).toBe('running');
  });

  it('playbook entries carry the compiled execution path + checkpoint approval story', () => {
    const c = buildCatalog(baseInput());
    const e = c.entries.find((x) => x.id === `playbook:${PLAYBOOK_REGISTRY[0].id}`)!;
    expect(e.executionPath).toContain('EXISTING orchestrator');
    expect(e.approval).toContain('checkpoint per side-effecting step');
    expect(e.authority).toBe('versioned-library');
    expect(e.dependencies).toContain('worker:operations');
  });

  it('autoops entry states the P19 no-self-advance invariant', () => {
    const c = buildCatalog(baseInput());
    const e = c.entries.find((x) => x.id === 'autoops:plans')!;
    expect(e.executionPath).toContain('never advance themselves');
  });
});
