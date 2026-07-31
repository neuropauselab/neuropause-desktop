/**
 * Phase 6 Stage 8 — the Automation Platform tab's pure view-model (no DOM, no
 * React, no I/O; tested). Projects the read-only `ap:*` surfaces — the computed
 * catalog, versioned playbooks, compiled plans (Principle C + D), policy
 * resolution, and the execution monitor — into presentation rows. Everything
 * here renders what the main-process composition computed; nothing is invented,
 * and the structural disclosures + unavailable reasons always ride along.
 */
import type {
  AutomationCapabilityKind,
  AutomationCatalog,
  AutomationFinding,
  AutomationMonitorReport,
  AutomationPlan,
  AutomationPlatformDashboard,
  AutomationPoliciesView,
  PlaybookDefinition,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7 knowledgeAssets pattern — accepted by StatusBadge). */
export type ApTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── kind + severity maps ─────────────────────────────────────────────────── */

export function capabilityKindLabel(kind: AutomationCapabilityKind): string {
  switch (kind) {
    case 'automation-rule':
      return 'Automation rule';
    case 'playbook':
      return 'Playbook';
    case 'workflow-run':
      return 'Workflow run';
    case 'delivery-source':
      return 'Delivery source';
    case 'scheduled-validation':
      return 'Scheduled validation';
    case 'autoops-plans':
      return 'Advisory plans';
    case 'assistant-capability':
      return 'Assistant flow';
  }
}

export function capabilityKindIcon(kind: AutomationCapabilityKind): IconName {
  switch (kind) {
    case 'automation-rule':
      return 'automations';
    case 'playbook':
      return 'checklist';
    case 'workflow-run':
      return 'play';
    case 'delivery-source':
      return 'bell';
    case 'scheduled-validation':
      return 'shield';
    case 'autoops-plans':
      return 'gauge';
    case 'assistant-capability':
      return 'sparkles';
  }
}

export function severityTone(severity: AutomationFinding['severity']): ApTone {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'high':
      return 'red';
    case 'medium':
      return 'orange';
    case 'low':
      return 'gray';
  }
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface ApStat {
  label: string;
  value: string;
  hint: string;
  tone: ApTone;
  icon: IconName;
}

export function apHeaderStats(d: AutomationPlatformDashboard): ApStat[] {
  return [
    {
      label: 'Catalog entries',
      value: String(d.catalog.entries),
      hint: `${d.catalog.byKind.length} capability kind(s) — computed, never stored`,
      tone: d.catalog.entries > 0 ? 'green' : 'gray',
      icon: 'list',
    },
    {
      label: 'Playbooks',
      value: String(d.playbooks.count),
      hint: `${d.playbooks.categories.length} categorie(s), code-shipped & versioned`,
      tone: d.playbooks.count > 0 ? 'green' : 'gray',
      icon: 'checklist',
    },
    {
      label: 'Schedule rules',
      value: String(d.schedules.rules),
      hint:
        d.schedules.rules === 0
          ? 'none defined'
          : `${d.schedules.parseable} parseable · ${d.schedules.unparseable} flagged`,
      tone: d.schedules.unparseable > 0 ? 'orange' : d.schedules.rules > 0 ? 'green' : 'gray',
      icon: 'clock',
    },
    {
      label: 'Monitor findings',
      value: String(d.monitor.findings),
      hint: `${d.monitor.critical} critical · ${d.monitor.high} high`,
      tone: d.monitor.critical > 0 ? 'red' : d.monitor.high > 0 ? 'orange' : 'green',
      icon: 'pulse',
    },
    {
      label: 'Auto-executable triggers',
      value: String(d.policies.autoAllowedTriggers.length),
      hint:
        d.policies.autoAllowedTriggers.length === 0
          ? 'everything requires human approval (default)'
          : `${d.policies.governedTriggers} governed trigger(s) still chain-gated`,
      tone: 'blue',
      icon: 'shield',
    },
  ];
}

/* ── catalog rows ─────────────────────────────────────────────────────────── */

export interface CatalogRow {
  id: string;
  kindLabel: string;
  icon: IconName;
  name: string;
  executionPath: string;
  approval: string;
  status: string;
  scheduleText: string | null;
  scheduleTone: ApTone;
}

export function catalogRows(c: AutomationCatalog): CatalogRow[] {
  return c.entries.map((e) => ({
    id: e.id,
    kindLabel: capabilityKindLabel(e.kind),
    icon: capabilityKindIcon(e.kind),
    name: e.name,
    executionPath: e.executionPath,
    approval: e.approval,
    status: e.status,
    scheduleText: e.schedule
      ? e.schedule.issue
        ? `“${e.schedule.label}” — ${e.schedule.issue}`
        : e.schedule.nextDue
          ? `next due ${e.schedule.nextDue}`
          : e.schedule.label
      : null,
    scheduleTone: e.schedule?.issue ? 'orange' : 'gray',
  }));
}

export interface KindCountRow {
  kind: AutomationCapabilityKind;
  label: string;
  count: number;
}

export function kindCountRows(c: AutomationCatalog): KindCountRow[] {
  return c.totals.byKind.map((k) => ({ kind: k.kind, label: capabilityKindLabel(k.kind), count: k.count }));
}

/* ── playbook rows ────────────────────────────────────────────────────────── */

export interface PlaybookRow {
  id: string;
  name: string;
  versionText: string;
  category: string;
  stepsText: string;
  sideEffectSteps: number;
  approvalTrigger: string;
  why: string;
}

export function playbookRows(playbooks: PlaybookDefinition[]): PlaybookRow[] {
  return playbooks.map((p) => {
    const workers = p.steps.filter((s) => s.kind === 'worker').length;
    const sideEffectSteps = p.steps.filter((s) => s.sideEffects).length;
    return {
      id: p.id,
      name: p.name,
      versionText: `v${p.version}`,
      category: p.category,
      stepsText: `${p.steps.length} step(s) · ${workers} worker · ${sideEffectSteps} side-effecting`,
      sideEffectSteps,
      approvalTrigger: p.approvalTrigger,
      why: p.why,
    };
  });
}

/* ── plan projection (Principle C + D, made visible) ──────────────────────── */

export interface PlanView {
  playbookId: string;
  title: string;
  workflowStepRows: { id: string; kindLabel: string; isInsertedGate: boolean; detail: string }[];
  insertedGates: number;
  issueLines: string[];
  explainabilityLines: { label: string; text: string }[];
  policyLines: string[];
  approvalLines: string[];
  rollbackLines: string[];
  simulationNote: string;
  knowledgeLines: string[];
}

/** True when the ap:plan response is a compiled plan (vs the not-found shape). */
export function isPlan(resp: AutomationPlan | { playbookId: string; found: false }): resp is AutomationPlan {
  return 'workflow' in resp;
}

export function planView(plan: AutomationPlan): PlanView {
  const gateIds = new Set(
    plan.workflow.steps.filter((s) => s.kind === 'approval' && s.id.endsWith(':approval')).map((s) => s.id),
  );
  const e = plan.explainability;
  const p = plan.policy;
  return {
    playbookId: plan.playbookId,
    title: `${plan.name} (v${plan.version})`,
    workflowStepRows: plan.workflow.steps.map((s) => ({
      id: s.id,
      kindLabel: s.kind === 'approval' ? 'Approval checkpoint' : `Worker ${s.workerId ?? ''} · ${s.skillId ?? ''}`,
      isInsertedGate: gateIds.has(s.id),
      detail:
        s.kind === 'approval'
          ? (s.approvalPrompt ?? 'Human decision required')
          : `dependsOn [${s.dependsOn.join(', ')}]`,
    })),
    insertedGates: gateIds.size,
    issueLines: plan.issues.map((i) => (i.stepId ? `${i.stepId}: ${i.message}` : i.message)),
    explainabilityLines: [
      { label: 'Why', text: e.why },
      { label: 'Evidence', text: e.evidence.join(' · ') },
      { label: 'Triggers when', text: e.triggeringConditions.join(' · ') },
      { label: 'Expected outcome', text: e.expectedOutcome },
      { label: 'Rollback', text: e.rollback },
      { label: 'Confidence', text: `${Math.round(e.confidence * 100)}%` },
      { label: 'Affected systems', text: e.affectedSystems.join(', ') },
    ],
    policyLines: [
      p.autoExecutable
        ? 'Auto-executable: YES — explicitly allowed by a global governance policy (P19 invariant).'
        : 'Auto-executable: no — human approval required (the default; chains always win).',
      p.requiredApprovals.length > 0
        ? `Approval chains: ${p.requiredApprovals.map((r) => `${r.trigger} → ${r.chainName ?? 'ungoverned'}`).join(' · ')}`
        : 'Approval chains: none bound to this trigger (proposals still park for a human).',
      p.executionWindow
        ? `Execution window: days [${p.executionWindow.days.join(',')}] ${p.executionWindow.startMinutes}–${p.executionWindow.endMinutes} min · ${p.windowOpenNow ? 'open now' : 'CLOSED now'}`
        : 'Execution window: none (always open).',
      `Retry ${p.retry.maxAttempts}× (backoff ${p.retry.backoffMs} ms) · escalate after ${Math.round(p.escalation.afterMs / 60_000)} min — ${p.escalation.note}`,
      `Basis: ${p.basis.join(' · ')}`,
    ],
    approvalLines:
      plan.approvals.steps.length > 0
        ? plan.approvals.steps.map(
            (s) => `${s.order}. ${s.name}${s.roleName ? ` — ${s.roleName}` : ''} (${s.roleId})`,
          )
        : [plan.approvals.note],
    rollbackLines: plan.policy.rollback.steps.map((s) => `${s.label}: ${s.detail}`),
    simulationNote:
      plan.simulation.lastRun === null
        ? `No sandbox run recorded for ${plan.simulation.scenarioKey} yet. ${plan.simulation.note}`
        : `Last sandbox run ${plan.simulation.lastRun.id} (${plan.simulation.lastRun.status}) at ${plan.simulation.lastRun.startedAt}. ${plan.simulation.note}`,
    knowledgeLines: plan.knowledge.map((k) => `${k.ref} — ${k.matched ? 'backed by a knowledge asset' : 'no matching knowledge asset (honest miss)'}`),
  };
}

/* ── monitor + policies rows ──────────────────────────────────────────────── */

export interface FindingRow {
  id: string;
  severity: string;
  tone: ApTone;
  title: string;
  detail: string;
  suggestedAction: string;
  evidenceCount: number;
}

export function findingRows(m: AutomationMonitorReport): FindingRow[] {
  return m.findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    tone: severityTone(f.severity),
    title: f.title,
    detail: f.detail,
    suggestedAction: f.suggestedAction,
    evidenceCount: f.evidence.length,
  }));
}

export interface PolicyDefaultRow {
  id: string;
  label: string;
  windowText: string;
  retryText: string;
  overrideText: string | null;
}

export function policyDefaultRows(v: AutomationPoliciesView): PolicyDefaultRow[] {
  return v.defaults.map((d) => ({
    id: d.id,
    label: d.label,
    windowText: d.executionWindow
      ? `window days [${d.executionWindow.days.join(',')}] ${d.executionWindow.startMinutes}–${d.executionWindow.endMinutes} min`
      : 'no execution window',
    retryText: `retry ${d.retry.maxAttempts}× / ${d.retry.backoffMs} ms · escalate ${Math.round(d.escalation.afterMs / 60_000)} min`,
    overrideText: d.requiresApprovalOverride ? 'always requires human approval (override)' : null,
  }));
}

export function chainRows(v: AutomationPoliciesView): { trigger: string; text: string }[] {
  return v.chains.map((c) => ({ trigger: c.trigger, text: `${c.chainName} (${c.steps} step(s))` }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

export function disclosureLines(c: AutomationCatalog | null, d: AutomationPlatformDashboard | null): string[] {
  return c?.disclosures ?? d?.disclosures ?? [];
}

export function unavailableLines(
  parts: { unavailable: { system: string; reason: string }[] }[],
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
