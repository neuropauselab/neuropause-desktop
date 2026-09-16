/**
 * NeuroPause Platform — workflow / approval runtime (ERP Session 20, Track B).
 *
 * The smallest reusable workflow runtime for the DEFINED repository policy:
 *
 *   business event → evaluate (POLICY) → REQUIRES_APPROVAL?
 *      no  → ALLOW (proceed to the domain command directly)
 *      yes → durable PENDING approval → (approver) decide → APPROVED/REJECTED
 *              → dispatch the gated DOMAIN COMMAND through the command bus
 *
 * It NEVER mutates ERP state directly: on a decision it either records durable
 * approval state + audit, and dispatches an authorized domain command through the
 * canonical bus — the transaction stays authoritative. It reuses the Session
 * 17/18 command bus, durable journal (event + outbox), and audit sink — no second
 * authorization, event or audit engine. Electron/React/IPC-free.
 *
 * Only the DEFINED policy is modelled: a Purchase Request requires human approval
 * before it becomes a Purchase Order (deny-by-default; NO threshold, hierarchy,
 * delegation, escalation, expiration or self-approval rule — those are undefined
 * policy per §22 and are absent, not invented).
 */
import type { EnterpriseModuleContext, EnterpriseModuleRegistry } from '../../enterprise/framework';
import { dispatchCommand } from '../command/commandBus';
import type { DurableCommandJournal } from '../command/durableCommandJournal';
import type { CommandResult, DomainCommandType } from '../command/domainCommand';
import type { Principal } from '../application/requestContext';
import type { ApprovalInstanceStore } from './approvalInstanceStore';
import type { ApprovalInstance, WorkflowDecision, WorkflowRequest } from './workflowContract';

/** The permission required to DECIDE an approval (authorization, not segregation). */
const DECIDE_PERMISSION = 'procurement:manage' as const;

export interface WorkflowDeps {
  approvals: ApprovalInstanceStore;
  registry: EnterpriseModuleRegistry;
  journal: DurableCommandJournal;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  now?: () => string;
}

/**
 * POLICY evaluation — pure, deterministic. A submitted Purchase Request requires
 * approval before conversion (the defined deny-by-default policy). Everything else
 * is allowed here. Returns only the decision kind + an opaque policy label.
 */
export function evaluateWorkflow(req: WorkflowRequest): WorkflowDecision {
  if (req.operation === 'SubmitPurchaseRequest' && req.targetModule === 'procurement-requests') {
    return { kind: 'REQUIRES_APPROVAL', policy: 'purchase-request-requires-approval' };
  }
  return { kind: 'ALLOW' };
}

export interface RequestApprovalResult {
  decision: WorkflowDecision;
  approval?: ApprovalInstance;
}

/**
 * Evaluate the policy for a submitted PR and, when approval is required, create
 * (idempotently) the durable PENDING approval that gates its `ApprovePurchaseRequest`.
 */
export async function requestApprovalFor(
  input: { targetId: string; requester: Principal; correlationId: string },
  deps: WorkflowDeps,
): Promise<RequestApprovalResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const decision = evaluateWorkflow({ operation: 'SubmitPurchaseRequest', targetModule: 'procurement-requests', targetId: input.targetId, tenantId: input.requester.tenantId, actor: input.requester.actor });
  if (decision.kind !== 'REQUIRES_APPROVAL') return { decision };
  const approval = await deps.approvals.requestApproval({
    tenantId: input.requester.tenantId,
    ...(input.requester.workspaceId ? { workspaceId: input.requester.workspaceId } : {}),
    targetModule: 'procurement-requests',
    targetId: input.targetId,
    gatedCommand: 'ApprovePurchaseRequest',
    requester: input.requester.actor,
    correlationId: input.correlationId,
    now: now(),
  });
  deps.audit({ action: 'approval.requested', target: `procurement-requests:${input.targetId}`, summary: `Approval ${approval.id} requested by ${input.requester.actor}` });
  return { decision, approval };
}

export interface DecideResult {
  ok: boolean;
  approval?: ApprovalInstance;
  replayed?: boolean;
  error?: 'NOT_FOUND' | 'UNAUTHORIZED' | 'CONFLICT';
  commandResult?: CommandResult;
}

/**
 * Decide an approval. Authorizes the approver, transitions the durable approval
 * idempotently (single-flight), audits the FRESH decision, and dispatches the
 * gated domain command through the command bus (idempotent — one economic
 * effect). A foreign-tenant approval is invisible (NOT_FOUND). It never mutates
 * ERP state directly.
 */
export async function decideApproval(
  input: { approvalId: string; decision: 'APPROVE' | 'REJECT'; approver: Principal; correlationId: string; idempotencyKey?: string },
  deps: WorkflowDeps,
): Promise<DecideResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const p = input.approver;

  await deps.approvals.load();
  // Tenant-scoped: a foreign approval is invisible.
  if (!deps.approvals.get(p.tenantId, input.approvalId)) return { ok: false, error: 'NOT_FOUND' };
  // AUTHORIZATION before any transition — the approver must be permitted to decide.
  if (!p.permissions.includes(DECIDE_PERMISSION)) return { ok: false, error: 'UNAUTHORIZED' };

  const outcome = await deps.approvals.decide({ tenantId: p.tenantId, approvalId: input.approvalId, decision: input.decision, approver: p.actor, now: now() });
  if (!outcome.ok || !outcome.approval) return { ok: false, error: outcome.error };
  const decided = outcome.approval;

  // AUDIT the FRESH decision (governance evidence) — reuse the audit sink.
  if (!outcome.replayed) {
    deps.audit({
      action: input.decision === 'APPROVE' ? 'approval.approved' : 'approval.rejected',
      target: `${decided.targetModule}:${decided.targetId}`,
      summary: `Approval ${decided.id} ${decided.status} by ${p.actor}`,
    });
  }

  // Dispatch the gated DOMAIN COMMAND through the canonical bus (idempotent — the
  // journal keys on this approval + decision, so one economic effect even on
  // replay/concurrency). Approval → ApprovePurchaseRequest; Reject → RejectPurchaseRequest.
  const gated: DomainCommandType = input.decision === 'APPROVE' ? 'ApprovePurchaseRequest' : 'RejectPurchaseRequest';
  const cmdCtx: EnterpriseModuleContext = {
    authorize: (perm) => { if (!p.permissions.includes(perm)) throw new Error('unauthorized'); },
    audit: deps.audit,
    broadcast: () => undefined,
    actor: () => p.actor,
    now,
  };
  const commandResult = await dispatchCommand(
    {
      commandId: `cmd_apr_${decided.id}_${input.decision}`,
      type: gated,
      tenantId: p.tenantId,
      actor: p.actor,
      target: { id: decided.targetId },
      payload: {},
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ?? `approval:${decided.id}:${input.decision}`,
      timestamp: now(),
      source: 'api',
    },
    { registry: deps.registry, ctx: cmdCtx, resolveScope: () => ({ tenantId: p.tenantId, workspaceId: p.workspaceId ?? '' }), journal: deps.journal },
  );

  return { ok: true, approval: decided, ...(outcome.replayed ? { replayed: true } : {}), commandResult };
}
