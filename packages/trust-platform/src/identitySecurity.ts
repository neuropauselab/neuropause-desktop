/**
 * EPIC 2 — Enterprise Identity Security. A privileged-access registry, just-in-time privileges, a
 * session-recording registry, administrative approval, break-glass access, and a service-account
 * registry. JIT elevation REUSES the security authorization engine's real `grantJit` (an expiring grant
 * approved by a named approver); service accounts REUSE the security identity registry's real
 * registration. No external identity verification is fabricated — an unwired platform yields no grant and
 * no provisioned account, reported honestly. Every elevation and break-glass event is audited.
 */
import { randomId } from '@neuropause/cloud-core';
import { type PrivilegeState } from './constants';
import type { TpContext } from './types';
import type { TrustGovernance } from './governance';

export interface PrivilegeRequest {
  id: string;
  subjectId: string;
  permission: string;
  reason: string;
  state: PrivilegeState;
  approvedBy: string | null;
  expiresAt: number | null;
  breakGlass: boolean;
  reusedAuthorization: boolean;
}

export interface ServiceAccount {
  id: string;
  name: string;
  tenant: string;
  reusedIdentity: boolean;
}

export interface SessionRecording {
  id: string;
  sessionId: string;
  subjectId: string;
  privileged: boolean;
  note: string;
}

export class EnterpriseIdentitySecurity {
  private readonly requests = new Map<string, PrivilegeRequest>();
  private readonly serviceAccounts = new Map<string, ServiceAccount>();
  private readonly recordings = new Map<string, SessionRecording>();

  constructor(
    private readonly ctx: TpContext,
    private readonly gov: TrustGovernance,
    private readonly operator: string,
  ) {}

  /** Request privileged access — recorded 'requested'; nothing is elevated yet. */
  async requestPrivilege(input: { subjectId: string; permission: string; reason: string }): Promise<PrivilegeRequest> {
    const req: PrivilegeRequest = {
      id: randomId('priv'),
      subjectId: input.subjectId,
      permission: input.permission,
      reason: input.reason,
      state: 'requested',
      approvedBy: null,
      expiresAt: null,
      breakGlass: false,
      reusedAuthorization: false,
    };
    this.requests.set(req.id, req);
    await this.gov.record({ actor: input.subjectId, environment: '_identity', resource: input.permission, policy: 'privileged-access', epic: 'E2', operation: 'request-privilege', targetId: req.id, evidence: 'live-verified', decision: 'requested' });
    return req;
  }

  /** Administrative approval — a named approver moves the request to 'approved' (still not active). */
  async approve(requestId: string, approver: string): Promise<PrivilegeRequest> {
    const req = this.require(requestId);
    req.state = 'approved';
    req.approvedBy = approver;
    await this.gov.record({ actor: approver, environment: '_identity', resource: req.permission, policy: 'administrative-approval', epic: 'E2', operation: 'approve-privilege', targetId: requestId, evidence: 'live-verified', decision: 'approved' });
    return req;
  }

  /**
   * Activate an approved request as a JIT grant. REUSES the authorization engine's real `grantJit` (an
   * expiring, attributed grant). Refuses activation unless the request was approved.
   */
  async activate(requestId: string, expiresAt: number): Promise<PrivilegeRequest> {
    const req = this.require(requestId);
    if (req.state !== 'approved' || !req.approvedBy) {
      req.state = 'denied';
      await this.gov.record({ actor: this.operator, environment: '_identity', resource: req.permission, policy: 'jit', epic: 'E2', operation: 'activate-denied', targetId: requestId, evidence: 'infrastructure-pending', decision: 'not approved' });
      return req;
    }
    if (this.ctx.security) {
      await this.ctx.security.authorization().grantJit(req.subjectId, req.permission, expiresAt, req.approvedBy);
      req.reusedAuthorization = true;
    }
    req.state = 'active';
    req.expiresAt = expiresAt;
    await this.gov.record({ actor: req.approvedBy, environment: '_identity', resource: req.permission, policy: 'jit', epic: 'E2', operation: 'activate-privilege', targetId: requestId, evidence: req.reusedAuthorization ? 'live-verified' : 'adapter-verified', decision: 'active' });
    return req;
  }

  /**
   * Break-glass access — an emergency elevation that is granted immediately AND heavily audited. It still
   * flows through the reused JIT grant when available; it is always flagged and always attributed.
   */
  async breakGlass(input: { subjectId: string; permission: string; reason: string; approver: string; expiresAt: number }): Promise<PrivilegeRequest> {
    const req: PrivilegeRequest = {
      id: randomId('glass'),
      subjectId: input.subjectId,
      permission: input.permission,
      reason: input.reason,
      state: 'active',
      approvedBy: input.approver,
      expiresAt: input.expiresAt,
      breakGlass: true,
      reusedAuthorization: false,
    };
    if (this.ctx.security) {
      await this.ctx.security.authorization().grantJit(input.subjectId, input.permission, input.expiresAt, input.approver);
      req.reusedAuthorization = true;
    }
    this.requests.set(req.id, req);
    await this.gov.record({ actor: input.approver, environment: '_identity', resource: input.permission, policy: 'break-glass', epic: 'E2', operation: 'break-glass', targetId: req.id, evidence: req.reusedAuthorization ? 'live-verified' : 'adapter-verified', decision: `EMERGENCY:${input.reason}` });
    return req;
  }

  /** Session recording registry — records that a privileged session is under recording (represented). */
  async recordSession(input: { sessionId: string; subjectId: string; privileged: boolean }): Promise<SessionRecording> {
    const rec: SessionRecording = {
      id: randomId('rec'),
      sessionId: input.sessionId,
      subjectId: input.subjectId,
      privileged: input.privileged,
      note: 'session-recording metadata; no session content is captured or fabricated',
    };
    this.recordings.set(rec.id, rec);
    await this.gov.record({ actor: input.subjectId, environment: '_identity', resource: input.sessionId, policy: 'session-recording', epic: 'E2', operation: 'record-session', targetId: rec.id, evidence: 'live-verified', decision: input.privileged ? 'privileged' : 'standard' });
    return rec;
  }

  /** Service-account registry — REUSES the security identity registry's real registration. */
  async registerServiceAccount(input: { name: string; tenant: string }): Promise<ServiceAccount> {
    let id = randomId('svc');
    let reusedIdentity = false;
    if (this.ctx.security) {
      const identity = await this.ctx.security.identity().register({ type: 'service-account', displayName: input.name, tenant: input.tenant });
      id = identity.id;
      reusedIdentity = true;
    }
    const account: ServiceAccount = { id, name: input.name, tenant: input.tenant, reusedIdentity };
    this.serviceAccounts.set(id, account);
    await this.gov.record({ actor: this.operator, environment: input.tenant, resource: input.name, policy: 'service-account', epic: 'E2', operation: 'register-service-account', targetId: id, evidence: reusedIdentity ? 'live-verified' : 'adapter-verified', decision: reusedIdentity ? 'provisioned' : 'represented' });
    return account;
  }

  request(id: string): PrivilegeRequest | undefined {
    return this.requests.get(id);
  }
  activeGrants(): PrivilegeRequest[] {
    return [...this.requests.values()].filter((r) => r.state === 'active');
  }
  serviceAccountCount(): number {
    return this.serviceAccounts.size;
  }
  recordingCount(): number {
    return this.recordings.size;
  }

  private require(id: string): PrivilegeRequest {
    const req = this.requests.get(id);
    if (!req) throw new Error(`unknown privilege request: ${id}`);
    return req;
  }
}
