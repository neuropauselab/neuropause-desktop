/**
 * The Governance Runtime — the single gate every worker action passes through.
 *
 * It composes the pure decision core (`evaluateAction`, see policyEngine.ts) with
 * a live policy set and the append-only audit log. For each proposed action it
 * runs the four checks (permission, trust, evidence, policy), returns the most
 * restrictive `GovernanceVerdict`, and records the decision. Workers can only
 * ever *propose*; this runtime decides whether a proposal may proceed, needs a
 * human, or is denied — and nothing it decides goes unaudited.
 */
import { randomUUID } from 'node:crypto';
import type {
  ActionRequest,
  GovernanceVerdict,
  PolicyRule,
  WorkforceAuditEntry,
  WorkforceAuditPage,
  Worker,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { evaluateAction, DEFAULT_POLICIES } from './policyEngine';
import type { AuditLog, AuditQuery } from './auditLog';

const log = createLogger('workforce-governance');

export class GovernanceRuntime {
  private policies: PolicyRule[];

  constructor(
    private readonly audit: AuditLog,
    policies: PolicyRule[] = DEFAULT_POLICIES,
    private readonly newId: () => string = randomUUID,
  ) {
    this.policies = [...policies];
  }

  /** Gate a proposed action and record the decision. */
  evaluate(req: ActionRequest, worker: Worker, now: string): GovernanceVerdict {
    const verdict = evaluateAction(req, { worker, policies: this.policies, now });
    const entry: WorkforceAuditEntry = {
      id: this.newId(),
      at: now,
      workerId: req.workerId,
      workerRole: req.workerRole,
      skillId: req.skillId,
      requestId: req.id,
      decision: verdict.decision,
      risk: req.risk,
      summary: req.title,
    };
    this.audit.record(entry);
    return verdict;
  }

  listPolicies(): PolicyRule[] {
    return [...this.policies];
  }

  /** Replace the active policy set (e.g. from operator configuration). */
  setPolicies(policies: PolicyRule[]): void {
    this.policies = [...policies];
    log.info('Governance policies updated', { count: this.policies.length });
  }

  auditPage(query: AuditQuery = {}): WorkforceAuditPage {
    return this.audit.page(query);
  }
}

export { evaluateAction, DEFAULT_POLICIES } from './policyEngine';
export type { EvaluateInput } from './policyEngine';
export { AuditLog } from './auditLog';
export type { AuditQuery } from './auditLog';
