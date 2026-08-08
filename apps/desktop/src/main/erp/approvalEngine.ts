/**
 * Phase 6 — Reusable ERP approval engine + segregation of duties.
 *
 * The recon found that every "approve" across the 104 modules was a single-actor
 * state flip: the creator could approve their own expense, purchase order or
 * journal. This generalizes the pattern the Data Plane proved (import rights ≠
 * approval rights) into a configurable engine any module can adopt.
 *
 * Two independent controls, deliberately separate:
 *   - POLICY decides how many approvals, from whom, at what threshold.
 *   - SEGREGATION OF DUTIES decides who is disqualified regardless of role.
 * A user can hold the required role and still be barred from approving because
 * they created the document. Conflating the two is how SoD quietly disappears.
 *
 * Pure and deterministic: no storage, no clock, no IO. The caller persists the
 * request and records the audit.
 */

export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalStep {
  id: string;
  label: string;
  /** Any ONE of these roles satisfies the step. */
  roles: readonly string[];
  /** Step applies only at or above this amount. Omit for always-on. */
  minAmount?: number;
  /** Step applies only below this amount. */
  maxAmount?: number;
  /** Approver must belong to the document's department. */
  sameDepartment?: boolean;
}

export type SodRule =
  | 'creator_cannot_approve'
  | 'creator_cannot_final_approve'
  | 'approver_cannot_repeat_step'
  | 'requester_cannot_approve_own_payment';

export interface ApprovalPolicy {
  id: string;
  /** Document kind this policy governs, e.g. `purchaseOrder`. */
  documentType: string;
  steps: readonly ApprovalStep[];
  sod: readonly SodRule[];
  /** When true, an amount with no matching step is refused rather than auto-approved. */
  refuseWhenNoStepMatches?: boolean;
}

export interface Approver {
  userId: string;
  roles: readonly string[];
  department?: string;
}

export interface ApprovalRecord {
  stepId: string;
  userId: string;
  decision: ApprovalDecision;
  at: string;
  note?: string;
}

export interface ApprovalRequest {
  documentType: string;
  documentId: string;
  amount: number;
  createdBy: string;
  department?: string;
  approvals: readonly ApprovalRecord[];
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'blocked';

export interface ApprovalStatus {
  state: ApprovalState;
  /** Steps that apply to this amount, in order. */
  requiredSteps: ApprovalStep[];
  satisfiedStepIds: string[];
  /** The next step awaiting a decision, if any. */
  nextStep: ApprovalStep | null;
  reasons: string[];
}

export interface SodVerdict {
  allowed: boolean;
  /** Rules the attempt violates. Empty when allowed. */
  violations: { rule: SodRule; message: string }[];
}

/** Steps whose threshold window contains this amount, in declaration order. */
export function applicableSteps(policy: ApprovalPolicy, amount: number): ApprovalStep[] {
  return policy.steps.filter((s) => {
    if (s.minAmount !== undefined && amount < s.minAmount) return false;
    if (s.maxAmount !== undefined && amount >= s.maxAmount) return false;
    return true;
  });
}

/**
 * Can this person approve this step, right now?
 *
 * Checks role eligibility AND segregation of duties. Returns every violation
 * rather than the first, so a reviewer sees the whole picture.
 */
export function canApprove(
  policy: ApprovalPolicy,
  request: ApprovalRequest,
  step: ApprovalStep,
  approver: Approver,
): SodVerdict {
  const violations: { rule: SodRule; message: string }[] = [];
  const steps = applicableSteps(policy, request.amount);
  const isFinalStep = steps.length > 0 && steps[steps.length - 1]?.id === step.id;

  for (const rule of policy.sod) {
    switch (rule) {
      case 'creator_cannot_approve':
        if (approver.userId === request.createdBy) {
          violations.push({ rule, message: 'The person who created this document may not approve it.' });
        }
        break;
      case 'creator_cannot_final_approve':
        if (approver.userId === request.createdBy && isFinalStep) {
          violations.push({ rule, message: 'The creator may not give final approval.' });
        }
        break;
      case 'approver_cannot_repeat_step':
        if (request.approvals.some((a) => a.userId === approver.userId && a.decision === 'approved')) {
          violations.push({ rule, message: 'This person has already approved an earlier step.' });
        }
        break;
      case 'requester_cannot_approve_own_payment':
        if (approver.userId === request.createdBy) {
          violations.push({ rule, message: 'The requester may not approve payment of their own request.' });
        }
        break;
      default:
        break;
    }
  }

  return { allowed: violations.length === 0 && hasRole(step, approver) && inDepartment(step, request, approver), violations };
}

function hasRole(step: ApprovalStep, approver: Approver): boolean {
  return step.roles.length === 0 || step.roles.some((r) => approver.roles.includes(r));
}

function inDepartment(step: ApprovalStep, request: ApprovalRequest, approver: Approver): boolean {
  if (step.sameDepartment !== true) return true;
  if (!request.department) return false;
  return approver.department === request.department;
}

/** Current state of an approval request against its policy. */
export function evaluateApproval(policy: ApprovalPolicy, request: ApprovalRequest): ApprovalStatus {
  const reasons: string[] = [];
  const required = applicableSteps(policy, request.amount);

  const rejected = request.approvals.find((a) => a.decision === 'rejected');
  if (rejected) {
    return {
      state: 'rejected',
      requiredSteps: required,
      satisfiedStepIds: [],
      nextStep: null,
      reasons: [`Rejected at step "${rejected.stepId}" by ${rejected.userId}.`],
    };
  }

  if (required.length === 0) {
    if (policy.refuseWhenNoStepMatches === true) {
      return {
        state: 'blocked',
        requiredSteps: [],
        satisfiedStepIds: [],
        nextStep: null,
        reasons: [
          `No approval step covers an amount of ${request.amount}; the policy refuses rather than auto-approving.`,
        ],
      };
    }
    return { state: 'approved', requiredSteps: [], satisfiedStepIds: [], nextStep: null, reasons: ['No approval required at this amount.'] };
  }

  const satisfied = required
    .filter((s) => request.approvals.some((a) => a.stepId === s.id && a.decision === 'approved'))
    .map((s) => s.id);

  const next = required.find((s) => !satisfied.includes(s.id)) ?? null;
  if (next !== null) reasons.push(`Awaiting "${next.label}".`);

  return {
    state: next === null ? 'approved' : 'pending',
    requiredSteps: required,
    satisfiedStepIds: satisfied,
    nextStep: next,
    reasons,
  };
}

/**
 * Record a decision, refusing when the approver is ineligible.
 * Returns the updated request and the resulting status, or the refusal.
 */
export function applyDecision(
  policy: ApprovalPolicy,
  request: ApprovalRequest,
  step: ApprovalStep,
  approver: Approver,
  decision: ApprovalDecision,
  at: string,
  note?: string,
): { ok: boolean; request: ApprovalRequest; status: ApprovalStatus; violations: { rule: SodRule; message: string }[]; error: string | null } {
  const verdict = canApprove(policy, request, step, approver);
  if (!verdict.allowed) {
    const error =
      verdict.violations.length > 0
        ? verdict.violations.map((v) => v.message).join(' ')
        : `${approver.userId} does not hold a role required for "${step.label}".`;
    return { ok: false, request, status: evaluateApproval(policy, request), violations: verdict.violations, error };
  }
  const updated: ApprovalRequest = {
    ...request,
    approvals: [...request.approvals, { stepId: step.id, userId: approver.userId, decision, at, ...(note ? { note } : {}) }],
  };
  return { ok: true, request: updated, status: evaluateApproval(policy, updated), violations: [], error: null };
}

/**
 * A worked default for spend approval. Illustrative and configurable — the
 * thresholds are data, not logic, and an operator is expected to replace them.
 */
export const DEFAULT_SPEND_POLICY: ApprovalPolicy = {
  id: 'spend-default',
  documentType: 'purchaseOrder',
  steps: [
    { id: 'manager', label: 'Manager approval', roles: ['manager', 'admin'] },
    { id: 'finance', label: 'Finance approval', roles: ['finance', 'admin'], minAmount: 10_000 },
    { id: 'executive', label: 'Executive approval', roles: ['executive', 'admin'], minAmount: 100_000 },
  ],
  sod: ['creator_cannot_approve', 'approver_cannot_repeat_step'],
};
