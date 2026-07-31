/**
 * Enterprise Automation Platform — shared types (Phase 6 Stage 8).
 *
 * Stage 8 is orchestration-layer COMPOSITION over engines that already exist:
 * the ExecuteEngine, the workforce orchestrator (the ONLY workflow runtime),
 * the Automation Builder, governance approval chains, the P19 autonomous-ops
 * policy invariant, the sandbox scenario runner, and the delivery engine.
 * These types describe:
 *
 *   - the Automation Catalog (a computed inventory of every automation-capable
 *     capability — nothing here is stored),
 *   - Playbooks as code-shipped, versioned data that COMPILE to the EXISTING
 *     `WorkflowSpec` (no playbook store, no second workflow engine),
 *   - deterministic schedule parsing for the Automation Builder's declared-but-
 *     never-fired `schedule` trigger (the tick emits through the EXISTING
 *     runner; no new scheduler class),
 *   - policy resolution (approval chains ALWAYS win; auto-execution only via
 *     the reused P19 `computeAutoExecutable` invariant — Principle C),
 *   - structurally mandatory explainability on every plan (Principle D),
 *   - honest rollback availability (external side effects have no undo),
 *   - the execution monitor, simulation compile (sandbox reuse), dashboard,
 *     and the assistant's six automation questions.
 *
 * Types + small pure constants only. No engine, store, scheduler, or executor
 * lives here — or anywhere else in Stage 8.
 */
import type { WorkflowSpec } from './workforceJobs';
import type { EnterpriseScenarioSpec } from './enterpriseScenario';
import type { OpsApprovalRequirement } from './autonomousOperations';

/* ── Principle D — structurally mandatory explainability ─────────────────── */

/** Every automation plan MUST expose all seven fields — tests reject absence. */
export interface AutomationExplainability {
  why: string;
  /** Real record references (playbook id, rule ids, SOP asset ids, run ids). */
  evidence: string[];
  triggeringConditions: string[];
  expectedOutcome: string;
  /** Summary of the honest rollback plan (full detail in `RollbackAvailability`). */
  rollback: string;
  /** 0..1 — composition confidence, never invented. */
  confidence: number;
  affectedSystems: string[];
}

/* ── rollback (honest availability, never fabricated undo) ────────────────── */

export type RollbackKind =
  | 'workflow-replay' // the EXISTING orchestrator recover() — replays failed steps only
  | 'version-rollback' // the EXISTING worker-package rollback (previous version retained)
  | 'compensating-suggestion' // a suggested manual/compensating step (never auto-run)
  | 'none'; // external side effect — cannot be undone (stated honestly)

export interface RollbackStepPlan {
  stepId: string;
  label: string;
  kind: RollbackKind;
  detail: string;
}

export interface RollbackAvailability {
  /** True when at least one mechanism beyond 'none' applies. */
  available: boolean;
  kinds: RollbackKind[];
  steps: RollbackStepPlan[];
  note: string;
}

/* ── playbooks (code-shipped, versioned; compile to the EXISTING WorkflowSpec) ── */

export type PlaybookCategory =
  | 'operations'
  | 'maintenance'
  | 'incident-response'
  | 'onboarding'
  | 'reporting';

export interface PlaybookStep {
  id: string;
  kind: 'worker' | 'approval';
  label: string;
  /** For kind 'worker' — must reference an EXISTING worker + skill. */
  workerId?: string;
  skillId?: string;
  input?: Record<string, unknown>;
  dependsOn: string[];
  retry?: number;
  timeoutMs?: number;
  /** For kind 'approval' — the human checkpoint prompt. */
  approvalPrompt?: string;
  /** Declared when the step's skill produces side effects (forces a checkpoint). */
  sideEffects: boolean;
  affectedSystems: string[];
}

export interface PlaybookDefinition {
  id: string;
  /** Monotonic content version (the promptManager precedent — revisions bump it). */
  version: number;
  name: string;
  description: string;
  category: PlaybookCategory;
  steps: PlaybookStep[];
  /** Principle D inputs — authored with the playbook, surfaced on every plan. */
  why: string;
  triggeringConditions: string[];
  expectedOutcome: string;
  affectedSystems: string[];
  /** The ApprovalTrigger this playbook's side effects map to (P19 vocabulary). */
  approvalTrigger: string;
  /** Stage 7 knowledge links (SOP/ADR record ids or topic tokens). */
  knowledgeRefs: string[];
  /** Policy-defaults entry applied when resolving this playbook. */
  policyDefaultsId: string;
}

/* ── policy (composition; Governance always wins) ─────────────────────────── */

export interface ExecutionWindow {
  /** 0=Sun … 6=Sat (local, matching the delivery engine's local-minutes convention). */
  days: number[];
  startMinutes: number;
  endMinutes: number;
}

export interface PolicyDefaults {
  id: string;
  label: string;
  /** null = no connector restriction declared by this policy. */
  allowedConnectors: string[] | null;
  /** null = no execution window (always open). */
  executionWindow: ExecutionWindow | null;
  retry: { maxAttempts: number; backoffMs: number };
  escalation: { afterMs: number; note: string };
  /** Force human approval even when a global policy would allow auto-execution. */
  requiresApprovalOverride: boolean;
}

export interface AutomationPolicyResolution {
  playbookId: string | null;
  approvalTrigger: string;
  /** From the EXISTING governance chains (reused shape — P19 vocabulary). */
  requiredApprovals: OpsApprovalRequirement[];
  /** ONLY via the reused P19 `computeAutoExecutable` AND no defaults override. */
  autoExecutable: boolean;
  allowedConnectors: string[] | null;
  executionWindow: ExecutionWindow | null;
  /** Whether the window is open at resolution time (true when no window). */
  windowOpenNow: boolean;
  retry: { maxAttempts: number; backoffMs: number };
  escalation: { afterMs: number; note: string };
  rollback: RollbackAvailability;
  /** Which sources composed this resolution (chains / global policies / defaults). */
  basis: string[];
}

export interface ApprovalPreviewStep {
  order: number;
  name: string;
  roleId: string;
  roleName: string | null;
}

export interface ApprovalPreview {
  trigger: string;
  governed: boolean;
  chainName: string | null;
  steps: ApprovalPreviewStep[];
  autoExecutable: boolean;
  note: string;
}

/* ── schedules (deterministic parser for the Builder's schedule labels) ───── */

export type ScheduleSpec =
  | { kind: 'daily'; atMinutes: number }
  | { kind: 'weekly'; dayOfWeek: number; atMinutes: number }
  | { kind: 'hourly'; atMinute: number }
  | { kind: 'interval'; everyMinutes: number };

export interface ParsedSchedule {
  spec: ScheduleSpec | null;
  /** Present when the label is outside the deterministic subset (a finding, never silent). */
  issue: string | null;
}

/* ── the catalog (computed; the §4 audit inventory as a live surface) ─────── */

export type AutomationCapabilityKind =
  | 'automation-rule'
  | 'playbook'
  | 'workflow-run'
  | 'delivery-source'
  | 'scheduled-validation'
  | 'autoops-plans'
  | 'assistant-capability';

export interface AutomationCatalogEntry {
  id: string;
  kind: AutomationCapabilityKind;
  name: string;
  owner: string | null;
  authority: 'org-defined' | 'versioned-library' | 'governed' | 'derived';
  executionPath: string;
  approval: string;
  rollback: RollbackKind[];
  confidence: number;
  persistence: string;
  recovery: string;
  observability: string;
  dependencies: string[];
  consumers: string[];
  status: string;
  schedule: { label: string; parsed: ScheduleSpec | null; issue: string | null; nextDue: string | null } | null;
}

export interface AutomationUnavailable {
  system: string;
  reason: string;
}

export interface AutomationCatalog {
  generatedAt: string;
  entries: AutomationCatalogEntry[];
  totals: { byKind: { kind: AutomationCapabilityKind; count: number }[]; entries: number };
  /** Structural honesty the audit locked: in-memory run map, unregistered kind, … */
  disclosures: string[];
  unavailable: AutomationUnavailable[];
}

/* ── the compiled plan (Principle C + D together) ─────────────────────────── */

export interface PlaybookCompileIssue {
  stepId: string | null;
  message: string;
}

export interface SimulationPlan {
  /** A valid EnterpriseScenarioSpec for the EXISTING sandbox runner (D-7). */
  scenario: EnterpriseScenarioSpec;
  /** Deterministic scenario key (`ap-sim:<playbookId>@v<version>`). */
  scenarioKey: string;
  /** Latest matching sandbox execution, when one exists — never fabricated. */
  lastRun: { id: string; status: string; startedAt: string } | null;
  note: string;
}

export interface AutomationPlan {
  playbookId: string;
  version: number;
  name: string;
  /** Compiled for the EXISTING orchestrator — run via the EXISTING WorkforceWorkflowRun. */
  workflow: WorkflowSpec;
  /** Compile findings (unknown worker/skill, dangling deps) — declared, never silent. */
  issues: PlaybookCompileIssue[];
  explainability: AutomationExplainability;
  policy: AutomationPolicyResolution;
  approvals: ApprovalPreview;
  simulation: SimulationPlan;
  /** Stage 7 knowledge joins (matched = a knowledge asset backs the ref). */
  knowledge: { ref: string; matched: boolean }[];
}

/* ── the execution monitor ────────────────────────────────────────────────── */

export type AutomationFindingKind =
  | 'stuck-execution'
  | 'failed-run'
  | 'awaiting-approval'
  | 'error-rule'
  | 'schedule-unparseable'
  | 'schedule-never-fired';

export interface AutomationFinding {
  id: string;
  kind: AutomationFindingKind;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  evidence: string[];
  affectedSystems: string[];
  suggestedAction: string;
  confidence: number;
}

export interface AutomationMonitorReport {
  generatedAt: string;
  findings: AutomationFinding[];
  totals: { byKind: { kind: AutomationFindingKind; count: number }[]; findings: number };
  unavailable: AutomationUnavailable[];
}

/* ── policies view + dashboard ────────────────────────────────────────────── */

export interface AutomationPoliciesView {
  generatedAt: string;
  defaults: PolicyDefaults[];
  /** From the EXISTING global governance policies via the reused P19 derivation. */
  autoAllowedTriggers: string[];
  /** Enabled approval chains, by trigger (reused governance data, summarized). */
  chains: { trigger: string; chainName: string; steps: number }[];
  note: string;
}

export interface AutomationPlatformDashboard {
  generatedAt: string;
  catalog: { entries: number; byKind: { kind: AutomationCapabilityKind; count: number }[] };
  playbooks: { count: number; categories: { category: PlaybookCategory; count: number }[] };
  schedules: { rules: number; parseable: number; unparseable: number; nextDue: string | null };
  monitor: { findings: number; critical: number; high: number; top: AutomationFinding[] };
  policies: { defaults: number; autoAllowedTriggers: string[]; governedTriggers: number };
  disclosures: string[];
  unavailable: AutomationUnavailable[];
}

/* ── assistant questions (D-8) ────────────────────────────────────────────── */

export type AutomationQuestionKey =
  | 'build-automation'
  | 'explain-automation'
  | 'simulate-automation'
  | 'execute-automation'
  | 'monitor-automation'
  | 'debug-automation';

export const AUTOMATION_QUESTION_KEYS: readonly AutomationQuestionKey[] = [
  'build-automation',
  'explain-automation',
  'simulate-automation',
  'execute-automation',
  'monitor-automation',
  'debug-automation',
] as const;

/* ── Principle D structural check (pure; used by tests + composition) ─────── */

export function explainabilityIssues(e: AutomationExplainability): string[] {
  const issues: string[] = [];
  if (e.why.trim().length === 0) issues.push('why is empty');
  if (e.evidence.length === 0) issues.push('evidence is empty');
  if (e.triggeringConditions.length === 0) issues.push('triggeringConditions is empty');
  if (e.expectedOutcome.trim().length === 0) issues.push('expectedOutcome is empty');
  if (e.rollback.trim().length === 0) issues.push('rollback is empty');
  if (!(e.confidence > 0 && e.confidence <= 1)) issues.push('confidence must be in (0,1]');
  if (e.affectedSystems.length === 0) issues.push('affectedSystems is empty');
  return issues;
}
