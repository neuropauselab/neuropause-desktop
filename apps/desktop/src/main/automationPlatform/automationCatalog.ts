/**
 * Phase 6 Stage 8 — the Automation Catalog (D-1): the audit's §4 inventory as
 * a LIVE computed surface. Every entry is a classification of something that
 * already exists (automation rules, workflow runs, delivery sources, scheduled
 * validations, autoOps plans, assistant flows, registry playbooks); nothing is
 * stored, and the audit's structural disclosures ship on every catalog:
 * the in-memory workflow-run map and the declared-but-unregistered 'workflow'
 * ExecutionKind. Per-source failures isolate into `unavailable`. Pure.
 */
import type {
  AutomationCatalog,
  AutomationCatalogEntry,
  AutomationCapabilityKind,
  AutomationRule,
  AutomationUnavailable,
  PlaybookDefinition,
  WorkflowRun,
  WorkflowSpec,
} from '@neuropause/shared';
import { parseScheduleLabel, nextDueIso } from './scheduleParser';

export interface CatalogInput {
  nowMs: number;
  rules: AutomationRule[] | null;
  workflowRuns: { run: WorkflowRun; spec: WorkflowSpec }[] | null;
  playbooks: readonly PlaybookDefinition[];
  /** Registered delivery-source keys (the engine's listSources() — keys only). */
  deliverySources: { key: string }[] | null;
  scheduledValidations: { pipelines: number; scheduled: number } | null;
  autoOpsPlans: number | null;
  assistantRows: readonly { id: string; name: string }[];
  failures: Record<string, string>;
}

export const CATALOG_DISCLOSURES: readonly string[] = [
  "Workflow runs live in an in-memory map (jobs persist; the run list does not survive a restart).",
  "The 'workflow' ExecutionKind is declared in the shared union but no executor is registered for it — runs start only through the existing WorkforceWorkflowRun path.",
  'Scheduled automation rules never fired before Stage 8 — the schedule tick introduced here is the first emitter.',
] as const;

export function buildCatalog(input: CatalogInput): AutomationCatalog {
  const entries: AutomationCatalogEntry[] = [];
  const unavailable: AutomationUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  for (const r of input.rules ?? []) {
    const isSchedule = r.trigger.type === 'schedule';
    const parsed = isSchedule ? parseScheduleLabel(r.trigger.schedule) : null;
    entries.push({
      id: `rule:${r.id}`,
      kind: 'automation-rule',
      name: r.name,
      owner: null,
      authority: 'org-defined',
      executionPath: 'automation runner → actions (connector writes confirmation-gated) · execute:run kind automation',
      approval: 'operations:manage gates rule CRUD/run; connector-write actions re-check confirmation',
      rollback: ['none'],
      confidence: r.status === 'error' ? 0.5 : 1,
      persistence: 'automationStore (persisted JSON)',
      recovery: 'run records retained; failures recorded per run',
      observability: 'automations:monitor + history + timeline events',
      dependencies: [r.trigger.type === 'connector-event' ? `connector:${r.trigger.connectorId ?? '?'}` : r.trigger.type],
      consumers: ['Automation Center', 'Hub', 'insight signals'],
      status: r.status,
      schedule: isSchedule
        ? {
            label: r.trigger.schedule ?? '',
            parsed: parsed?.spec ?? null,
            issue: parsed?.issue ?? null,
            nextDue: parsed?.spec ? nextDueIso(parsed.spec, input.nowMs) : null,
          }
        : null,
    });
  }

  for (const p of input.playbooks) {
    entries.push({
      id: `playbook:${p.id}`,
      kind: 'playbook',
      name: `${p.name} (v${p.version})`,
      owner: 'platform (code-shipped)',
      authority: 'versioned-library',
      executionPath: 'compiled WorkflowSpec → EXISTING orchestrator → jobs → WorkerRuntime → ExecuteEngine',
      approval: `checkpoint per side-effecting step + '${p.approvalTrigger}' chain routing; proposals still park`,
      rollback: ['workflow-replay', 'compensating-suggestion'],
      confidence: 1,
      persistence: 'none — registry data; runs persist as jobs/events',
      recovery: 'orchestrator recover() replays failed steps only',
      observability: 'workflow.* events + run health + correlation ids',
      dependencies: [...new Set(p.steps.filter((s) => s.kind === 'worker').map((s) => s.workerId ?? ''))],
      consumers: ['Automation Platform tab', 'assistant'],
      status: 'available',
      schedule: null,
    });
  }

  for (const w of input.workflowRuns ?? []) {
    entries.push({
      id: `wfrun:${w.run.id}`,
      kind: 'workflow-run',
      name: w.spec.name,
      owner: null,
      authority: 'derived',
      executionPath: 'orchestrator (existing) — this is a run, not a definition',
      approval: 'approval steps + proposal parking (as executed)',
      rollback: ['workflow-replay'],
      confidence: 1,
      persistence: 'in-memory run map (jobs persisted) — disclosed',
      recovery: 'recover() on failure',
      observability: 'workflow.* events',
      dependencies: [w.spec.id],
      consumers: ['workforce UI', 'Stage 7 lineage'],
      status: w.run.status,
      schedule: null,
    });
  }

  for (const s of input.deliverySources ?? []) {
    entries.push({
      id: `source:${s.key}`,
      kind: 'delivery-source',
      name: s.key,
      owner: 'platform (code-shipped)',
      authority: 'versioned-library',
      executionPath: 'delivery engine → governed items only (never actions)',
      approval: 'n/a — produces recommendation items',
      rollback: ['none'],
      confidence: 1,
      persistence: 'none (engine state)',
      recovery: 'n/a',
      observability: 'source fire logs + inbox',
      dependencies: [],
      consumers: ['notification inbox', 'Hub'],
      status: 'registered',
      schedule: null,
    });
  }

  if (input.scheduledValidations) {
    entries.push({
      id: 'validation:pipelines',
      kind: 'scheduled-validation',
      name: `Continuous validation (${input.scheduledValidations.pipelines} pipelines, ${input.scheduledValidations.scheduled} scheduled)`,
      owner: 'sandbox platform',
      authority: 'versioned-library',
      executionPath: 'sandbox executors — NO production side effects',
      approval: 'sandbox:manage gates runs',
      rollback: ['none'],
      confidence: 1,
      persistence: 'pipelines persisted',
      recovery: 'per-run detail',
      observability: 'validation dashboards + certification exports',
      dependencies: ['sandbox'],
      consumers: ['release gates'],
      status: 'active',
      schedule: null,
    });
  }

  if (input.autoOpsPlans !== null) {
    entries.push({
      id: 'autoops:plans',
      kind: 'autoops-plans',
      name: `Autonomous-operations advisory plans (${input.autoOpsPlans})`,
      owner: 'P19 (read-only layer)',
      authority: 'derived',
      executionPath: 'NONE — candidate plans never advance themselves (P19 invariant)',
      approval: 'per-chain requirements; computeAutoExecutable default false',
      rollback: ['compensating-suggestion'],
      confidence: 1,
      persistence: 'none (computed)',
      recovery: 'n/a',
      observability: 'autonomousops:* reads',
      dependencies: ['insight', 'governance'],
      consumers: ['Autonomous Operations center'],
      status: 'advisory',
      schedule: null,
    });
  }

  for (const a of input.assistantRows) {
    entries.push({
      id: a.id,
      kind: 'assistant-capability',
      name: a.name,
      owner: 'platform (code-shipped)',
      authority: 'versioned-library',
      executionPath: 'assistant → approval cards → ExecuteEngine (side effects only via gated plan steps)',
      approval: 'AssistantPlanDecide approval cards',
      rollback: ['none'],
      confidence: 1,
      persistence: 'conversations persisted',
      recovery: 'cancel + conversation history',
      observability: 'trace + timeline correlation',
      dependencies: [],
      consumers: ['user'],
      status: 'available',
      schedule: null,
    });
  }

  const byKindMap = new Map<AutomationCapabilityKind, number>();
  for (const e of entries) byKindMap.set(e.kind, (byKindMap.get(e.kind) ?? 0) + 1);

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    entries,
    totals: {
      byKind: [...byKindMap.entries()].map(([kind, count]) => ({ kind, count })),
      entries: entries.length,
    },
    disclosures: [...CATALOG_DISCLOSURES],
    unavailable,
  };
}
