/**
 * Module 3 — Approval Platform. Multi-level approval requests with quorum per level,
 * approver delegation, escalation, and digital sign-off (a hash-signed decision). No
 * workflow bypasses approval policy: a workflow approval step must reference a policy,
 * and the decision is recorded here and audited. In-process for Wave 4; every decision
 * flows through the one audit chain via governance.
 */
import { sha256Hex, randomId, type Clock } from '@neuropause/cloud-core';
import type { AutomationGovernance } from './governance';

export interface ApprovalLevel {
  approvers: string[];
  quorum: number;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  levels: ApprovalLevel[];
  escalationMs?: number;
}

export interface ApprovalDecision {
  approver: string;
  onBehalfOf?: string;
  decision: 'approve' | 'reject';
  level: number;
  at: number;
  signature: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';

export interface ApprovalRequest {
  id: string;
  policyId: string;
  tenantId: string;
  requester: string;
  executionId?: string;
  currentLevel: number;
  status: ApprovalStatus;
  decisions: ApprovalDecision[];
  delegations: Record<string, string>;
  createdAt: number;
  resolvedAt?: number;
}

export class ApprovalPlatform {
  private readonly policies = new Map<string, ApprovalPolicy>();
  private readonly requests = new Map<string, ApprovalRequest>();

  constructor(
    private readonly clock: Clock,
    private readonly governance?: AutomationGovernance,
  ) {}

  definePolicy(policy: ApprovalPolicy): void {
    if (policy.levels.length === 0) throw new Error(`approval policy '${policy.id}' needs at least one level`);
    this.policies.set(policy.id, policy);
  }
  getPolicy(id: string): ApprovalPolicy | undefined {
    return this.policies.get(id);
  }

  request(input: { tenantId: string; policyId: string; requester: string; executionId?: string }): ApprovalRequest {
    const policy = this.policies.get(input.policyId);
    if (!policy) throw new Error(`unknown approval policy '${input.policyId}'`);
    const req: ApprovalRequest = {
      id: randomId('appr'),
      policyId: input.policyId,
      tenantId: input.tenantId,
      requester: input.requester,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      currentLevel: 0,
      status: 'pending',
      decisions: [],
      delegations: {},
      createdAt: this.clock.now(),
    };
    this.requests.set(req.id, req);
    return req;
  }

  private authorized(policy: ApprovalPolicy, req: ApprovalRequest, approver: string): boolean {
    const level = policy.levels[req.currentLevel];
    if (!level) return false;
    if (level.approvers.includes(approver)) return true;
    // delegated authority: approver is a delegate of someone on this level
    return Object.entries(req.delegations).some(([from, to]) => to === approver && level.approvers.includes(from));
  }

  private sign(reqId: string, approver: string, decision: string, level: number): string {
    return sha256Hex(`${reqId}:${approver}:${decision}:${level}`);
  }

  approve(reqId: string, approver: string): ApprovalRequest {
    const req = this.requests.get(reqId);
    if (!req) throw new Error(`unknown approval request '${reqId}'`);
    if (req.status !== 'pending' && req.status !== 'escalated') return req;
    const policy = this.policies.get(req.policyId)!;
    if (!this.authorized(policy, req, approver)) throw new Error(`'${approver}' is not authorized to approve at level ${req.currentLevel}`);
    const onBehalf = Object.entries(req.delegations).find(([, to]) => to === approver)?.[0];
    req.decisions.push({ approver, ...(onBehalf ? { onBehalfOf: onBehalf } : {}), decision: 'approve', level: req.currentLevel, at: this.clock.now(), signature: this.sign(reqId, approver, 'approve', req.currentLevel) });
    void this.governance?.recordApproval(req.tenantId, reqId, approver, 'approve');
    // quorum met at this level?
    const level = policy.levels[req.currentLevel];
    const approvalsAtLevel = req.decisions.filter((d) => d.level === req.currentLevel && d.decision === 'approve').length;
    if (approvalsAtLevel >= level.quorum) {
      if (req.currentLevel === policy.levels.length - 1) {
        req.status = 'approved';
        req.resolvedAt = this.clock.now();
      } else {
        req.currentLevel += 1;
      }
    }
    return req;
  }

  reject(reqId: string, approver: string): ApprovalRequest {
    const req = this.requests.get(reqId);
    if (!req) throw new Error(`unknown approval request '${reqId}'`);
    const policy = this.policies.get(req.policyId)!;
    if (!this.authorized(policy, req, approver)) throw new Error(`'${approver}' is not authorized to reject at level ${req.currentLevel}`);
    req.decisions.push({ approver, decision: 'reject', level: req.currentLevel, at: this.clock.now(), signature: this.sign(reqId, approver, 'reject', req.currentLevel) });
    req.status = 'rejected';
    req.resolvedAt = this.clock.now();
    void this.governance?.recordApproval(req.tenantId, reqId, approver, 'reject');
    return req;
  }

  delegate(reqId: string, from: string, to: string): void {
    const req = this.requests.get(reqId);
    if (!req) throw new Error(`unknown approval request '${reqId}'`);
    req.delegations[from] = to;
  }

  /** Escalate to the next level (e.g. on timeout) without an approval decision. */
  escalate(reqId: string): ApprovalRequest {
    const req = this.requests.get(reqId);
    if (!req) throw new Error(`unknown approval request '${reqId}'`);
    const policy = this.policies.get(req.policyId)!;
    if (req.currentLevel < policy.levels.length - 1) req.currentLevel += 1;
    req.status = 'escalated';
    void this.governance?.recordApproval(req.tenantId, reqId, 'system', 'escalate');
    return req;
  }

  isApproved(reqId: string): boolean {
    return this.requests.get(reqId)?.status === 'approved';
  }
  get(reqId: string): ApprovalRequest | undefined {
    return this.requests.get(reqId);
  }
  list(tenantId: string): ApprovalRequest[] {
    return [...this.requests.values()].filter((r) => r.tenantId === tenantId);
  }
  pending(tenantId: string): ApprovalRequest[] {
    return this.list(tenantId).filter((r) => r.status === 'pending' || r.status === 'escalated');
  }
}
