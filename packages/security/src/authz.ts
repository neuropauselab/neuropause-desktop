/**
 * Enterprise Authorization (NCEA 14.0, Phase 3). The ONE authorization model:
 * RBAC (roles → permissions) fused with ABAC (attribute conditions from the
 * policy engine), least-privilege by default (no grant ⇒ deny), and explicit
 * deny wins. Supports delegation (time-bounded), audited impersonation,
 * just-in-time elevation, and a single decision function every protected action
 * flows through. Decisions are auditable via `enforce()`.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SecurityAudit } from './audit';

export interface Role {
  id: string;
  name: string;
  permissions: string[]; // `${resourceType}:${action}`, with `*` / `type:*` / `*:action` wildcards
}

export interface Subject {
  id: string;
  roles: string[];
  attributes?: Record<string, unknown>;
}

export interface Resource {
  type: string;
  id?: string;
  tenant?: string;
  attributes?: Record<string, unknown>;
}

export interface AccessRequest {
  subject: Subject;
  action: string;
  resource: Resource;
  environment?: Record<string, unknown>;
}

export interface Decision {
  allowed: boolean;
  reason: string;
  effect: 'permit' | 'deny';
  matched?: string;
}

/** An ABAC evaluator (the policy engine) — returns permit/deny/not-applicable. */
export type AbacEvaluator = (req: AccessRequest) => { effect: 'permit' | 'deny' | 'not-applicable'; reason?: string; policyId?: string };

interface Delegation {
  id: string;
  fromId: string;
  toId: string;
  permissions: string[];
  expiresAt: number;
  revoked: boolean;
}

interface JitGrant {
  subjectId: string;
  permission: string;
  expiresAt: number;
  approvedBy: string;
}

export interface ImpersonationSession {
  id: string;
  actorId: string;
  targetId: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
}

function permMatches(granted: string, needed: string): boolean {
  if (granted === '*' || granted === needed) return true;
  const [gType, gAct] = granted.split(':');
  const [nType, nAct] = needed.split(':');
  return (gType === '*' || gType === nType) && (gAct === '*' || gAct === nAct);
}

export class AuthorizationEngine {
  private readonly roles = new Map<string, Role>();
  private readonly delegations = new Map<string, Delegation>();
  private readonly jit: JitGrant[] = [];
  private readonly impersonations = new Map<string, ImpersonationSession>();

  constructor(
    private readonly clock: Clock,
    private readonly audit: SecurityAudit,
  ) {}

  defineRole(role: Role): Role {
    this.roles.set(role.id, role);
    return role;
  }
  role(id: string): Role | undefined {
    return this.roles.get(id);
  }

  /** All permissions a subject effectively holds now: roles + delegations + active JIT. */
  effectivePermissions(subject: Subject, now = this.clock.now()): string[] {
    const perms = new Set<string>();
    for (const roleId of subject.roles) for (const p of this.roles.get(roleId)?.permissions ?? []) perms.add(p);
    for (const d of this.delegations.values()) if (d.toId === subject.id && !d.revoked && d.expiresAt > now) for (const p of d.permissions) perms.add(p);
    for (const g of this.jit) if (g.subjectId === subject.id && g.expiresAt > now) perms.add(g.permission);
    return [...perms];
  }

  /** The single decision function. Explicit ABAC deny wins; else RBAC/ABAC permit; else deny-by-default. */
  authorize(req: AccessRequest, abac?: AbacEvaluator): Decision {
    const needed = `${req.resource.type}:${req.action}`;
    const abacResult = abac?.(req);
    if (abacResult?.effect === 'deny') return { allowed: false, effect: 'deny', reason: abacResult.reason ?? 'policy deny', ...(abacResult.policyId ? { matched: abacResult.policyId } : {}) };
    const perms = this.effectivePermissions(req.subject);
    const granted = perms.find((p) => permMatches(p, needed));
    if (granted) return { allowed: true, effect: 'permit', reason: 'rbac grant', matched: granted };
    if (abacResult?.effect === 'permit') return { allowed: true, effect: 'permit', reason: abacResult.reason ?? 'policy permit', ...(abacResult.policyId ? { matched: abacResult.policyId } : {}) };
    return { allowed: false, effect: 'deny', reason: 'no matching grant (least privilege default deny)' };
  }

  /** Authorize AND record the decision; throws when denied. The enforced path. */
  async enforce(req: AccessRequest, opts: { abac?: AbacEvaluator; tenant?: string } = {}): Promise<Decision> {
    const decision = this.authorize(req, opts.abac);
    await this.audit.record({
      category: 'authorization',
      action: decision.allowed ? 'permit' : 'deny',
      actor: req.subject.id,
      ...(opts.tenant ? { tenant: opts.tenant } : req.resource.tenant ? { tenant: req.resource.tenant } : {}),
      target: `${req.resource.type}:${req.resource.id ?? '*'}`,
      meta: { action: req.action, reason: decision.reason },
    });
    if (!decision.allowed) throw new Error(`access denied: ${decision.reason}`);
    return decision;
  }

  // ── delegation ──
  async delegate(fromId: string, toId: string, permissions: string[], expiresAt: number): Promise<Delegation> {
    const delegation: Delegation = { id: randomId('dlg'), fromId, toId, permissions, expiresAt, revoked: false };
    this.delegations.set(delegation.id, delegation);
    await this.audit.record({ category: 'authorization', action: 'delegate', actor: fromId, target: toId, meta: { permissions } });
    return delegation;
  }
  async revokeDelegation(id: string, actor = 'system'): Promise<void> {
    const d = this.delegations.get(id);
    if (d) d.revoked = true;
    await this.audit.record({ category: 'authorization', action: 'delegation.revoke', actor, target: id });
  }

  // ── just-in-time elevation ──
  async grantJit(subjectId: string, permission: string, expiresAt: number, approvedBy: string): Promise<JitGrant> {
    const grant: JitGrant = { subjectId, permission, expiresAt, approvedBy };
    this.jit.push(grant);
    await this.audit.record({ category: 'authorization', action: 'jit.grant', actor: approvedBy, target: subjectId, meta: { permission, expiresAt } });
    return grant;
  }

  // ── audited impersonation ──
  async impersonate(actorId: string, targetId: string, reason: string): Promise<ImpersonationSession> {
    if (!reason.trim()) throw new Error('impersonation requires a reason');
    const session: ImpersonationSession = { id: randomId('imp'), actorId, targetId, reason, startedAt: this.clock.now() };
    this.impersonations.set(session.id, session);
    await this.audit.record({ category: 'authorization', action: 'impersonation.start', actor: actorId, target: targetId, meta: { reason, sessionId: session.id } });
    return session;
  }
  async endImpersonation(sessionId: string): Promise<void> {
    const s = this.impersonations.get(sessionId);
    if (s) s.endedAt = this.clock.now();
    await this.audit.record({ category: 'authorization', action: 'impersonation.end', actor: s?.actorId ?? 'system', target: s?.targetId ?? sessionId, meta: { sessionId } });
  }
}
