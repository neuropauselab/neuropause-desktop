/**
 * Phase 6 Stage 8 — the Automation Platform registries (typed, versioned data;
 * doc-locked to docs/desktop/automation/AUTOMATION-PLATFORM.md by test — the
 * Stage 6 signal-map / Stage 7 asset-registry precedent).
 *
 * PLAYBOOKS are code-shipped definitions that COMPILE to the EXISTING
 * `WorkflowSpec` (D-2): every worker step references a REAL built-in worker +
 * skill (`worker:operations` briefing/recommend/remind/note — read-only
 * operational skills), every side-effecting step declares itself and receives
 * a human checkpoint at compile time, and versions are monotonic (the
 * promptManager precedent — a revision adds a version, never rewrites history).
 *
 * POLICY DEFAULTS are the registry half of policy resolution (D-4): windows,
 * retry, escalation, connector restrictions. Approval CHAINS always win over
 * anything here, and auto-execution exists only through the reused P19
 * `computeAutoExecutable` invariant.
 *
 * The registries store nothing and fabricate nothing — they are data.
 */
import type { PlaybookDefinition, PolicyDefaults } from '@neuropause/shared';

/* ── policy defaults ──────────────────────────────────────────────────────── */

export const POLICY_DEFAULTS_REGISTRY: readonly PolicyDefaults[] = [
  {
    id: 'standard-ops',
    label: 'Standard operations',
    allowedConnectors: null,
    executionWindow: { days: [1, 2, 3, 4, 5], startMinutes: 8 * 60, endMinutes: 18 * 60 },
    retry: { maxAttempts: 2, backoffMs: 60_000 },
    escalation: { afterMs: 24 * 60 * 60 * 1000, note: 'Escalate to the pending-approvals inbox after 24 h.' },
    requiresApprovalOverride: false,
  },
  {
    id: 'maintenance-window',
    label: 'Maintenance window',
    allowedConnectors: null,
    executionWindow: { days: [0, 6], startMinutes: 6 * 60, endMinutes: 20 * 60 },
    retry: { maxAttempts: 3, backoffMs: 5 * 60_000 },
    escalation: { afterMs: 12 * 60 * 60 * 1000, note: 'Escalate stalled maintenance after 12 h.' },
    requiresApprovalOverride: false,
  },
  {
    id: 'critical-response',
    label: 'Critical response',
    allowedConnectors: null,
    executionWindow: null,
    retry: { maxAttempts: 3, backoffMs: 30_000 },
    escalation: { afterMs: 60 * 60 * 1000, note: 'Escalate unacknowledged critical response after 1 h.' },
    // Even an explicit autonomous-allow policy never auto-runs critical response.
    requiresApprovalOverride: true,
  },
] as const;

export const POLICY_DEFAULTS_BY_ID: ReadonlyMap<string, PolicyDefaults> = new Map(
  POLICY_DEFAULTS_REGISTRY.map((p) => [p.id, p]),
);

/* ── playbooks (every worker step references a REAL built-in worker/skill) ── */

export const PLAYBOOK_REGISTRY: readonly PlaybookDefinition[] = [
  {
    id: 'daily-ops-review',
    version: 1,
    name: 'Daily operations review',
    description: 'Compose the operational briefing, derive recommendations, and record the review note.',
    category: 'operations',
    why: 'A recurring, evidence-grounded operational review keeps the organization ahead of failures instead of behind them.',
    triggeringConditions: ['Start of the working day', 'Operator runs the playbook on demand'],
    expectedOutcome: 'An operational briefing with recommendations and a durable review note.',
    affectedSystems: ['workforce', 'memory', 'notifications'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['sop', 'operations'],
    policyDefaultsId: 'standard-ops',
    steps: [
      { id: 'brief', kind: 'worker', label: 'Compose the operational briefing', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'recommend', kind: 'worker', label: 'Derive next-action recommendations', workerId: 'worker:operations', skillId: 'recommend', dependsOn: ['brief'], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'note', kind: 'worker', label: 'Record the review note into AI memory', workerId: 'worker:operations', skillId: 'note', input: { title: 'Daily operations review' }, dependsOn: ['recommend'], retry: 1, timeoutMs: 60_000, sideEffects: true, affectedSystems: ['memory'] },
    ],
  },
  {
    id: 'incident-first-response',
    version: 1,
    name: 'Incident first response',
    description: 'Brief the incident context, propose the response, and park the response for human approval.',
    category: 'incident-response',
    why: 'First response must be fast AND governed: the platform prepares everything, a human approves the action.',
    triggeringConditions: ['A critical insight incident is detected', 'Operator invokes incident response'],
    expectedOutcome: 'A briefed, human-approved first-response with a recorded decision trail.',
    affectedSystems: ['workforce', 'notifications', 'memory'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['incident', 'sop'],
    policyDefaultsId: 'critical-response',
    steps: [
      { id: 'context', kind: 'worker', label: 'Brief the incident context', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'propose', kind: 'worker', label: 'Propose the response actions', workerId: 'worker:operations', skillId: 'recommend', dependsOn: ['context'], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'record', kind: 'worker', label: 'Record the incident response note', workerId: 'worker:operations', skillId: 'note', input: { title: 'Incident first response' }, dependsOn: ['propose'], retry: 2, timeoutMs: 60_000, sideEffects: true, affectedSystems: ['memory'] },
    ],
  },
  {
    id: 'weekly-maintenance-review',
    version: 1,
    name: 'Weekly maintenance review',
    description: 'Review operational health on the maintenance window and schedule the follow-up reminder.',
    category: 'maintenance',
    why: 'Maintenance drifts unless it is reviewed on a fixed cadence with a durable reminder for follow-ups.',
    triggeringConditions: ['Weekend maintenance window opens', 'Operator runs the playbook on demand'],
    expectedOutcome: 'A maintenance review note and a scheduled follow-up reminder.',
    affectedSystems: ['workforce', 'notifications', 'memory'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['maintenance', 'sop'],
    policyDefaultsId: 'maintenance-window',
    steps: [
      { id: 'review', kind: 'worker', label: 'Compose the maintenance review briefing', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'remind', kind: 'worker', label: 'Schedule the follow-up reminder', workerId: 'worker:operations', skillId: 'remind', input: { title: 'Maintenance follow-up' }, dependsOn: ['review'], retry: 1, timeoutMs: 60_000, sideEffects: true, affectedSystems: ['notifications'] },
      { id: 'log', kind: 'worker', label: 'Record the maintenance note', workerId: 'worker:operations', skillId: 'note', input: { title: 'Weekly maintenance review' }, dependsOn: ['remind'], retry: 1, timeoutMs: 60_000, sideEffects: true, affectedSystems: ['memory'] },
    ],
  },
  {
    id: 'quarterly-ops-report',
    version: 1,
    name: 'Quarterly operations report',
    description: 'Compose the quarterly review pack: briefing, recommendations, and the durable report note — all human-approved before anything is recorded.',
    category: 'reporting',
    why: 'Executive reporting should be assembled from real evidence by the platform and approved by a human before it becomes the record.',
    triggeringConditions: ['Quarter end', 'Operator requests the report pack'],
    expectedOutcome: 'An approved quarterly operations report recorded into memory.',
    affectedSystems: ['workforce', 'memory'],
    approvalTrigger: 'workforce_side_effect',
    knowledgeRefs: ['reporting', 'standard'],
    policyDefaultsId: 'standard-ops',
    steps: [
      { id: 'brief', kind: 'worker', label: 'Compose the quarterly briefing', workerId: 'worker:operations', skillId: 'briefing', dependsOn: [], retry: 1, timeoutMs: 120_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'recommend', kind: 'worker', label: 'Derive quarterly recommendations', workerId: 'worker:operations', skillId: 'recommend', dependsOn: ['brief'], retry: 1, timeoutMs: 60_000, sideEffects: false, affectedSystems: ['workforce'] },
      { id: 'gate', kind: 'approval', label: 'Executive sign-off', approvalPrompt: 'Approve the quarterly operations report for the record?', dependsOn: ['recommend'], sideEffects: false, affectedSystems: [] },
      { id: 'record', kind: 'worker', label: 'Record the approved report', workerId: 'worker:operations', skillId: 'note', input: { title: 'Quarterly operations report' }, dependsOn: ['gate'], retry: 1, timeoutMs: 60_000, sideEffects: true, affectedSystems: ['memory'] },
    ],
  },
] as const;

export const PLAYBOOK_BY_ID: ReadonlyMap<string, PlaybookDefinition> = new Map(
  PLAYBOOK_REGISTRY.map((p) => [p.id, p]),
);

/* ── the assistant's built-in automation-capable flows (catalog rows) ─────── */

export const ASSISTANT_CAPABILITY_ROWS: readonly { id: string; name: string }[] = [
  { id: 'assistant:brief', name: 'Daily / period briefings' },
  { id: 'assistant:work-summary', name: 'Work summary' },
  { id: 'assistant:meeting-prep', name: 'Meeting preparation' },
  { id: 'assistant:tasks', name: 'Task commands' },
  { id: 'assistant:reminders', name: 'Reminders' },
  { id: 'assistant:intelligence', name: 'Enterprise intelligence Q&A (Stage 6)' },
  { id: 'assistant:knowledge', name: 'Knowledge platform Q&A (Stage 7)' },
] as const;

/* ── integrity (mirrors the Stage 6/7 registry locks) ─────────────────────── */

export function registryIntegrityIssues(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const p of PLAYBOOK_REGISTRY) {
    if (seen.has(p.id)) issues.push(`duplicate playbook id: ${p.id}`);
    seen.add(p.id);
    if (!Number.isInteger(p.version) || p.version < 1) issues.push(`${p.id}: version must be a positive integer`);
    if (!POLICY_DEFAULTS_BY_ID.has(p.policyDefaultsId)) issues.push(`${p.id}: unknown policyDefaultsId ${p.policyDefaultsId}`);
    if (p.why.trim().length === 0) issues.push(`${p.id}: empty why`);
    if (p.expectedOutcome.trim().length === 0) issues.push(`${p.id}: empty expectedOutcome`);
    if (p.triggeringConditions.length === 0) issues.push(`${p.id}: no triggering conditions`);
    if (p.affectedSystems.length === 0) issues.push(`${p.id}: no affected systems`);
    if (p.steps.length === 0) issues.push(`${p.id}: no steps`);
    const stepIds = new Set<string>();
    for (const s of p.steps) {
      if (stepIds.has(s.id)) issues.push(`${p.id}/${s.id}: duplicate step id`);
      stepIds.add(s.id);
      if (s.kind === 'worker' && (!s.workerId || !s.skillId)) issues.push(`${p.id}/${s.id}: worker step missing workerId/skillId`);
      if (s.kind === 'approval' && !s.approvalPrompt) issues.push(`${p.id}/${s.id}: approval step missing prompt`);
      for (const d of s.dependsOn) if (!p.steps.some((x) => x.id === d)) issues.push(`${p.id}/${s.id}: dangling dependsOn ${d}`);
    }
  }
  const polSeen = new Set<string>();
  for (const d of POLICY_DEFAULTS_REGISTRY) {
    if (polSeen.has(d.id)) issues.push(`duplicate policy defaults id: ${d.id}`);
    polSeen.add(d.id);
    if (d.retry.maxAttempts < 1) issues.push(`${d.id}: retry.maxAttempts must be ≥ 1`);
    if (d.executionWindow) {
      for (const day of d.executionWindow.days) if (day < 0 || day > 6) issues.push(`${d.id}: window day out of range`);
      if (d.executionWindow.startMinutes >= d.executionWindow.endMinutes) issues.push(`${d.id}: window start must precede end`);
    }
  }
  return issues;
}
