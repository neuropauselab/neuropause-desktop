/**
 * Phase 6 Stage 8 — the execution monitor: stuck sessions, failed runs, aged
 * approvals, error rules, and the two schedule honesty findings (unparseable
 * labels; schedule rules that have never fired — true for every pre-Stage-8
 * rule). Findings are evidence-cited and feed the `automation-watch` delivery
 * source as governed ITEMS only. Pure; reads injected.
 */
import type {
  AutomationFinding,
  AutomationFindingKind,
  AutomationMonitorReport,
  AutomationRule,
  AutomationRunRecord,
  AutomationUnavailable,
  ExecutionSession,
  WorkflowRun,
} from '@neuropause/shared';
import { parseScheduleLabel } from './scheduleParser';

const STUCK_AFTER_MS = 30 * 60 * 1000;
const APPROVAL_AGED_MS = 24 * 60 * 60 * 1000;
const FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MonitorInput {
  nowMs: number;
  sessions: Pick<ExecutionSession, 'id' | 'kind' | 'label' | 'state' | 'startedAt'>[] | null;
  runRecords: AutomationRunRecord[] | null;
  rules: AutomationRule[] | null;
  workflowRuns: Pick<WorkflowRun, 'id' | 'workflowId' | 'status' | 'startedAt'>[] | null;
  jobsAwaiting: { id: string; createdAt: string }[] | null;
  failures: Record<string, string>;
}

const SEVERITY_RANK: Record<AutomationFinding['severity'], number> = { critical: 3, high: 2, medium: 1, low: 0 };

function finding(
  kind: AutomationFindingKind,
  key: string,
  over: Omit<AutomationFinding, 'id' | 'kind'>,
): AutomationFinding {
  return { id: `af:${kind}:${key.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)}`, kind, ...over };
}

export function buildMonitorReport(input: MonitorInput): AutomationMonitorReport {
  const findings: AutomationFinding[] = [];
  const unavailable: AutomationUnavailable[] = Object.entries(input.failures).map(([system, reason]) => ({
    system,
    reason,
  }));

  for (const s of input.sessions ?? []) {
    if (s.state !== 'running' && s.state !== 'waiting') continue;
    const age = input.nowMs - Date.parse(s.startedAt);
    if (!Number.isFinite(age) || age < STUCK_AFTER_MS) continue;
    findings.push(
      finding('stuck-execution', s.id, {
        severity: age > 4 * STUCK_AFTER_MS ? 'high' : 'medium',
        title: `Stuck execution: ${s.label}`,
        detail: `Session ${s.id} (${s.kind}) has been ${s.state} for ${Math.round(age / 60_000)} min.`,
        evidence: [s.id],
        affectedSystems: [s.kind],
        suggestedAction: 'Inspect the session; cancel via the existing execute:cancel if it will not settle.',
        confidence: 0.9,
      }),
    );
  }

  for (const r of input.runRecords ?? []) {
    if (r.ok) continue;
    const age = input.nowMs - Date.parse(r.startedAt);
    if (!Number.isFinite(age) || age > FAILED_WINDOW_MS) continue;
    findings.push(
      finding('failed-run', r.id, {
        severity: 'high',
        title: `Automation run failed: ${r.ruleName}`,
        detail: `${r.error ?? 'Run failed'} (triggered by ${r.triggeredBy}).`,
        evidence: [r.id, r.ruleId],
        affectedSystems: ['automation'],
        suggestedAction: 'Open the run in the Automation Center monitor and fix the failing action.',
        confidence: 1,
      }),
    );
  }

  const awaiting = input.jobsAwaiting ?? [];
  const aged = awaiting.filter((j) => input.nowMs - Date.parse(j.createdAt) > APPROVAL_AGED_MS);
  if (aged.length > 0) {
    findings.push(
      finding('awaiting-approval', 'jobs', {
        severity: 'high',
        title: `${aged.length} approval(s) waiting > 24 h`,
        detail: 'Parked side-effect proposals are aging without a decision — work is blocked, not lost.',
        evidence: aged.slice(0, 6).map((j) => j.id),
        affectedSystems: ['workforce'],
        suggestedAction: 'Decide the parked proposals in the approvals inbox (approve or reject).',
        confidence: 1,
      }),
    );
  }
  for (const w of input.workflowRuns ?? []) {
    if (w.status !== 'awaiting_approval') continue;
    const age = input.nowMs - Date.parse(w.startedAt);
    if (!Number.isFinite(age) || age < APPROVAL_AGED_MS) continue;
    findings.push(
      finding('awaiting-approval', w.id, {
        severity: 'medium',
        title: `Workflow awaiting approval > 24 h`,
        detail: `Run ${w.id} of ${w.workflowId} has been parked at a checkpoint for ${Math.round(age / 3_600_000)} h.`,
        evidence: [w.id, w.workflowId],
        affectedSystems: ['workforce'],
        suggestedAction: 'Approve or reject the checkpoint via the existing workflow decision surface.',
        confidence: 1,
      }),
    );
  }

  const ruleRunCounts = new Map<string, number>();
  for (const r of input.runRecords ?? []) ruleRunCounts.set(r.ruleId, (ruleRunCounts.get(r.ruleId) ?? 0) + 1);
  for (const rule of input.rules ?? []) {
    if (rule.status === 'error') {
      findings.push(
        finding('error-rule', rule.id, {
          severity: 'high',
          title: `Rule in error state: ${rule.name}`,
          detail: rule.lastRun?.message ?? 'The rule is marked error by the Builder.',
          evidence: [rule.id],
          affectedSystems: ['automation'],
          suggestedAction: 'Fix the rule in the Automation Builder and re-activate it.',
          confidence: 1,
        }),
      );
    }
    if (rule.trigger.type !== 'schedule' || rule.status !== 'active') continue;
    const parsed = parseScheduleLabel(rule.trigger.schedule);
    if (parsed.issue) {
      findings.push(
        finding('schedule-unparseable', rule.id, {
          severity: 'medium',
          title: `Unparseable schedule: ${rule.name}`,
          detail: `${parsed.issue} — the rule cannot fire until the label is inside the deterministic subset.`,
          evidence: [rule.id],
          affectedSystems: ['automation'],
          suggestedAction: 'Rewrite the schedule label (e.g. "daily 9am", "every 15 minutes", "weekly monday 9am").',
          confidence: 1,
        }),
      );
    } else if ((ruleRunCounts.get(rule.id) ?? 0) === 0) {
      findings.push(
        finding('schedule-never-fired', rule.id, {
          severity: 'medium',
          title: `Scheduled rule has never fired: ${rule.name}`,
          detail: 'No run record exists for this schedule rule (before Stage 8 nothing emitted schedule events).',
          evidence: [rule.id],
          affectedSystems: ['automation'],
          suggestedAction: 'The Stage 8 tick will fire it at the next due occurrence; verify the schedule label is intended.',
          confidence: 0.9,
        }),
      );
    }
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.id < b.id ? -1 : 1));

  const byKindMap = new Map<AutomationFindingKind, number>();
  for (const f of findings) byKindMap.set(f.kind, (byKindMap.get(f.kind) ?? 0) + 1);

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    findings,
    totals: {
      byKind: [...byKindMap.entries()].map(([kind, count]) => ({ kind, count })),
      findings: findings.length,
    },
    unavailable,
  };
}
