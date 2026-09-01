/**
 * NeuroPause Platform — workflow / approval contract (ERP Session 20, Track B).
 *
 * Transport-neutral. Distinguishes the FOUR governance layers the session keeps
 * strictly separate (§9):
 *   AUTHORIZATION — is this principal allowed to perform this operation?
 *   POLICY        — under what business conditions is it allowed?
 *   WORKFLOW      — does it require an approval process?   ← this contract
 *   TRANSACTION   — perform the authorized mutation.
 *
 * A `WorkflowDecision` exposes only ALLOW / DENY / REQUIRES_APPROVAL and an
 * opaque policy label — never a raw internal policy object.
 *
 * IMPORTANT: only the states the repository's defined policy supports are
 * modelled — PENDING → APPROVED / REJECTED. Expiration, cancellation, delegation,
 * escalation, hierarchy and thresholds are UNDEFINED policy (§22) and are
 * deliberately absent, not invented.
 */
export type WorkflowDecisionKind = 'ALLOW' | 'DENY' | 'REQUIRES_APPROVAL';

export interface WorkflowRequest {
  /** The operation the client wants to perform (a domain command type or verb). */
  operation: string;
  targetModule?: string;
  targetId?: string;
  tenantId: string;
  actor: string;
}

export interface WorkflowDecision {
  kind: WorkflowDecisionKind;
  /** A stable, opaque policy label — NOT the internal policy object. */
  policy?: string;
  /** A safe reason for a DENY. */
  reason?: string;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A durable approval-instance lifecycle (the workflow's own state). */
export interface ApprovalInstance {
  id: string;
  tenantId: string;
  workspaceId?: string;
  /** The entity whose action is gated (e.g. a Purchase Request). */
  targetModule: string;
  targetId: string;
  /** The domain command the APPROVED decision will dispatch. */
  gatedCommand: string;
  requester: string;
  approver?: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  correlationId: string;
}
