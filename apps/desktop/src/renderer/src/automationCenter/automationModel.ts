/**
 * Automation Center v1.0 — the automation model (pure data; no React, no I/O; tested).
 *
 * The Automation Center is a REUSE-ONLY lens that surfaces the already-real but UI-less automation rule engine
 * (`ipc.automations.*` — monitor, run history, rule list) alongside the Enterprise governance "business rules"
 * and the AI Workforce job runner. It creates NO engine, scheduler, workflow builder, or store, and mutates
 * nothing — every authoring action deep-links to the existing AI Workforce Automation Studio. This file only
 * labels/tones/summarises that real data, and records — honestly — the automation capabilities the platform
 * does NOT have (each verified ABSENT from source), so the center never fabricates a working builder/scheduler.
 *
 * Section id (wired by the coordinator): `automation-center`.
 */
import type {
  AutomationMonitor,
  AutomationRule,
  AutomationRunRecord,
  AutomationStatus,
  AutomationTriggerSource,
  AutomationTriggerType,
  GovernanceConfig,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';
import type { OpsTone } from '@renderer/operations/lib';

/* ── trigger + status → label / tone / icon maps (reuse the ops tone system) ─── */

/** Human label for the event source that starts an automation. */
export function triggerLabel(type: AutomationTriggerType): string {
  switch (type) {
    case 'connector-event':
      return 'Connector event';
    case 'schedule':
      return 'Schedule';
    case 'manual':
      return 'Manual';
    case 'activity-event':
      return 'Activity event';
  }
}

/** A stable glyph for each trigger type. */
export function triggerIcon(type: AutomationTriggerType): IconName {
  switch (type) {
    case 'connector-event':
      return 'connectors';
    case 'schedule':
      return 'clock';
    case 'manual':
      return 'play';
    case 'activity-event':
      return 'activity';
  }
}

/** Human label for how a recorded run was initiated (AutomationRunRecord.triggeredBy). */
export function triggerSourceLabel(source: AutomationTriggerSource): string {
  switch (source) {
    case 'connector':
      return 'Connector';
    case 'manual':
      return 'Manual';
    case 'schedule':
      return 'Schedule';
    case 'voice':
      return 'Voice';
    case 'activity':
      return 'Activity';
  }
}

/** Lifecycle tone: active → green, paused → orange, error → red, draft → gray. */
export function statusTone(status: AutomationStatus): OpsTone {
  switch (status) {
    case 'active':
      return 'green';
    case 'paused':
      return 'orange';
    case 'error':
      return 'red';
    case 'draft':
      return 'gray';
  }
}

/** Human, capitalised lifecycle label. */
export function statusLabel(status: AutomationStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'paused':
      return 'Paused';
    case 'error':
      return 'Error';
    case 'draft':
      return 'Draft';
  }
}

/** Run-outcome tone/label for a single execution record. */
export function runTone(ok: boolean): OpsTone {
  return ok ? 'green' : 'red';
}

export function runLabel(ok: boolean): string {
  return ok ? 'Succeeded' : 'Failed';
}

/* ── the honest automation-gap catalog (verified ABSENT in-app; never fabricated) ── */

/** Every gap shares one honest status — the capability needs new architecture to exist. */
export const AUTOMATION_GAP_STATUS = 'Requires architecture' as const;
export const AUTOMATION_GAP_TONE: OpsTone = 'gray';

export interface AutomationGap {
  /** Which part of the workspace the gap belongs to (used to filter the panel per tab). */
  area: string;
  capability: string;
  reason: string;
}

/**
 * Automation capabilities the platform does NOT have — each VERIFIED ABSENT from source, never fabricated as
 * working. These are the honest counterpart to the read-only lens: the engine records rules and runs, but the
 * builder, scheduler, and AI-action execution below simply do not exist yet.
 */
export const AUTOMATION_GAPS: AutomationGap[] = [
  {
    area: 'Builder',
    capability: 'Visual workflow builder',
    reason:
      'This workspace has no in-app trigger → condition → action canvas. The AI Workforce "Automation Studio" is the real builder — this center deep-links there rather than rebuilding it.',
  },
  {
    area: 'Triggers',
    capability: 'Schedule / cron triggers',
    // Phase 6 Stage 8 — updated honestly: the Automation Platform's 1-minute tick (riding the
    // EXISTING taskScheduler) now fires schedule rules whose labels parse in the deterministic
    // subset ("daily 9am", "weekly monday 9am", "hourly", "every 15 minutes"). Cron expressions
    // and free-form labels remain unsupported — they surface as `schedule-unparseable` findings
    // on the Platform tab instead of silently never firing.
    reason:
      'Cron expressions and free-form schedule labels are still unsupported — only the deterministic label subset fires (via the Stage 8 platform tick); anything else is flagged on the Platform tab, never guessed.',
  },
  {
    area: 'Actions',
    capability: 'AI-action execution',
    reason:
      'The `ai-summarize` / `ai-generate` action types are recorded as no-ops by the engine; no model call is made when they run.',
  },
  {
    area: 'Rules',
    capability: 'Reusable automation templates',
    // Phase 6 Stage 8 — scoped honestly: versioned PLAYBOOKS (code-shipped workflow templates
    // compiled to the existing WorkflowSpec) now live on the Platform tab; what is still absent
    // is a template/clone surface for trigger→condition→action RULES specifically.
    reason:
      'There is no rule-template catalog or clone-from-template surface; every rule is authored from scratch in the studio. (Versioned workflow playbooks are a Stage 8 Platform-tab capability, distinct from rule templates.)',
  },
  {
    area: 'Monitor',
    capability: 'Run trend / timeseries analytics',
    reason:
      'The monitor exposes point-in-time counters only; no historical timeseries or run-trend series is persisted or computed.',
  },
];

/* ── pure summaries over the real automation data ───────────────────────────── */

export interface MonitorSummary {
  running: number;
  completed: number;
  failed: number;
  paused: number;
  /** Runs with a decided outcome (completed + failed). */
  finished: number;
  /** completed / finished, 0..1; 0 when nothing has finished. */
  successRate: number;
  avgRuntimeMs: number;
  /** Overall tone: gray when nothing finished, orange if any failed, else green. */
  tone: OpsTone;
}

export function summarizeMonitor(monitor: AutomationMonitor | null): MonitorSummary {
  const running = monitor?.running ?? 0;
  const completed = monitor?.completed ?? 0;
  const failed = monitor?.failed ?? 0;
  const paused = monitor?.paused ?? 0;
  const finished = completed + failed;
  const successRate = finished > 0 ? completed / finished : 0;
  const avgRuntimeMs = monitor?.averageRuntimeMs ?? 0;
  const tone: OpsTone = finished === 0 ? 'gray' : failed > 0 ? 'orange' : 'green';
  return { running, completed, failed, paused, finished, successRate, avgRuntimeMs, tone };
}

export interface RulesSummary {
  total: number;
  active: number;
  paused: number;
  draft: number;
  error: number;
  /** Total action steps across all rules. */
  totalActions: number;
}

export function summarizeRules(rules: AutomationRule[]): RulesSummary {
  let active = 0;
  let paused = 0;
  let draft = 0;
  let error = 0;
  let totalActions = 0;
  for (const r of rules) {
    if (r.status === 'active') active += 1;
    else if (r.status === 'paused') paused += 1;
    else if (r.status === 'draft') draft += 1;
    else if (r.status === 'error') error += 1;
    totalActions += r.actions.length;
  }
  return { total: rules.length, active, paused, draft, error, totalActions };
}

export interface RunsSummary {
  total: number;
  ok: number;
  failed: number;
  /** ok / total, 0..1; 0 when there are no runs. */
  successRate: number;
}

export function summarizeRuns(records: AutomationRunRecord[]): RunsSummary {
  const ok = records.filter((r) => r.ok).length;
  const failed = records.length - ok;
  const successRate = records.length > 0 ? ok / records.length : 0;
  return { total: records.length, ok, failed, successRate };
}

export interface BusinessRulesSummary {
  rules: number;
  rulesEnabled: number;
  chains: number;
  chainsEnabled: number;
}

/** Enabled counts over the Enterprise governance config (the org-level "business rules"). */
export function summarizeBusinessRules(cfg: GovernanceConfig | null): BusinessRulesSummary {
  if (!cfg) return { rules: 0, rulesEnabled: 0, chains: 0, chainsEnabled: 0 };
  return {
    rules: cfg.complianceRules.length,
    rulesEnabled: cfg.complianceRules.filter((r) => r.enabled).length,
    chains: cfg.approvalChains.length,
    chainsEnabled: cfg.approvalChains.filter((c) => c.enabled).length,
  };
}
