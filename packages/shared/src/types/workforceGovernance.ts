/**
 * AI Workforce — governance model.
 *
 * Every worker action is proposed as an `ActionRequest` and must pass the
 * Governance Runtime, which runs four checks — permission verification, trust,
 * evidence validation, and policy evaluation — and returns a `GovernanceVerdict`
 * of allow / deny / require_approval. The verdict is the most restrictive
 * outcome across all checks, so governance fails safe. Every decision is
 * audited.
 *
 * Names here are intentionally distinct from the Governance Trace™ types in
 * trace.ts (which explain decisions after the fact); these gate actions before
 * they happen.
 *
 * Types-only.
 */
import type { WorkerPermissionScope, WorkerRole } from './worker';

export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Conditions under which a policy rule applies. All present fields must hold;
 *  an empty match applies to every action. */
export interface PolicyMatch {
  roles?: WorkerRole[];
  skills?: string[];
  permissions?: WorkerPermissionScope[];
  sideEffects?: boolean;
  /** Applies at or above this risk level. */
  minRisk?: RiskLevel;
}

/** A declarative governance rule. */
export interface PolicyRule {
  id: string;
  title: string;
  description: string;
  effect: PolicyEffect;
  match: PolicyMatch;
  /** Higher priority wins when multiple rules match. */
  priority: number;
  enabled: boolean;
  /** For trust-gated rules: the worker's trust must be ≥ this to satisfy it. */
  minTrust?: number;
}

export interface ActionEvidence {
  kind: string;
  id: string;
}

/** A proposed action — the unit the Governance Runtime gates. */
export interface ActionRequest {
  id: string;
  workerId: string;
  workerRole: WorkerRole;
  skillId: string;
  title: string;
  summary: string;
  sideEffects: boolean;
  permissions: WorkerPermissionScope[];
  risk: RiskLevel;
  /** Evidence grounding the action (entity/graph/memory/timeline refs). */
  evidence: ActionEvidence[];
  payload: Record<string, unknown>;
  requestedAt: string;
}

export type VerdictDecision = 'allow' | 'deny' | 'require_approval';

export type GovernanceCheckKind = 'permission' | 'trust' | 'evidence' | 'policy';

export interface GovernanceCheck {
  kind: GovernanceCheckKind;
  /** allow / deny / require_approval contributed by this check. */
  outcome: VerdictDecision;
  pass: boolean;
  detail: string;
}

export interface PolicyEvaluation {
  ruleId: string;
  title: string;
  effect: PolicyEffect;
  matched: boolean;
  reason: string;
}

export interface GovernanceVerdict {
  requestId: string;
  workerId: string;
  skillId: string;
  decision: VerdictDecision;
  reasons: string[];
  checks: GovernanceCheck[];
  evaluations: PolicyEvaluation[];
  trustScore: number;
  risk: RiskLevel;
  decidedAt: string;
}

export interface WorkforceAuditEntry {
  /**
   * The organization this entry belongs to (P13C Round 2, H3).
   *
   * Absent means UNRESOLVED — shown to nobody. Entries written before this
   * round are not back-filled: an audit trail that silently adopted an owner
   * would be worse than one with a gap, because the gap is visible.
   */
  tenantId?: string | null;
  id: string;
  at: string;
  workerId: string;
  workerRole: WorkerRole;
  skillId: string;
  requestId: string;
  decision: VerdictDecision;
  risk: RiskLevel;
  summary: string;
}

export interface WorkforceAuditPage {
  entries: WorkforceAuditEntry[];
  total: number;
}
