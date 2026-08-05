/**
 * Identity & Roles (NCEA 10.5, Phase 2). ONE principal model for every actor —
 * human users, AI employees, service accounts, guests, and external
 * collaborators are the SAME Principal type, differing only by `type`. ONE
 * permission model: effective permissions resolve from direct grants + role
 * templates + permission sets + membership roles + active delegations into a
 * single flat grant set, the same grants strings the connector/task executors
 * gate on. Impersonation is always audited. No duplicate identity or permission
 * system is introduced anywhere in the platform.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export const PRINCIPAL_TYPES = ['human', 'ai-employee', 'service-account', 'guest', 'external'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export interface Principal {
  id: string;
  type: PrincipalType;
  displayName: string;
  permissions: string[];
  roleIds: string[];
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: number;
}

export interface PermissionSet {
  id: string;
  name: string;
  permissions: string[];
}

export interface RoleTemplate {
  id: string;
  name: string;
  permissionSetIds: string[];
  description?: string;
}

export type MembershipScope = 'organization' | 'team' | 'workspace';

export interface Membership {
  id: string;
  principalId: string;
  scope: MembershipScope;
  targetId: string;
  roleIds: string[];
  createdAt: number;
}

export interface Delegation {
  id: string;
  fromPrincipalId: string;
  toPrincipalId: string;
  permissions: string[];
  expiresAt?: number;
  revoked: boolean;
  createdAt: number;
}

export interface ImpersonationSession {
  id: string;
  actorPrincipalId: string;
  targetPrincipalId: string;
  reason: string;
  startedAt: number;
  endedAt?: number;
}

export interface RegisterPrincipalInput {
  type: PrincipalType;
  displayName: string;
  permissions?: string[];
  roleIds?: string[];
  metadata?: Record<string, unknown>;
  actor?: string;
}

/** True if a granted permission (supporting `*` and `prefix:*`) covers `needed`. */
function grantMatches(granted: string, needed: string): boolean {
  if (granted === '*' || granted === needed) return true;
  if (granted.endsWith(':*')) return needed.startsWith(granted.slice(0, -1));
  return false;
}

export class IdentityDirectory {
  private readonly principals = new Map<string, Principal>();
  private readonly permissionSets = new Map<string, PermissionSet>();
  private readonly roles = new Map<string, RoleTemplate>();
  private readonly memberships: Membership[] = [];
  private readonly delegations = new Map<string, Delegation>();
  private readonly impersonations = new Map<string, ImpersonationSession>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  // --- principals -----------------------------------------------------------
  async registerPrincipal(input: RegisterPrincipalInput): Promise<Principal> {
    const principal: Principal = {
      id: randomId(input.type === 'ai-employee' ? 'aiemp' : 'prin'),
      type: input.type,
      displayName: input.displayName,
      permissions: input.permissions ?? [],
      roleIds: input.roleIds ?? [],
      metadata: input.metadata ?? {},
      active: true,
      createdAt: this.clock.now(),
    };
    this.principals.set(principal.id, principal);
    await this.governance.record({
      domain: 'identity',
      action: `principal.register.${input.type}`,
      entity: principal.id,
      actor: input.actor ?? 'system',
      approval: 'not-required',
      ok: true,
      meta: { displayName: principal.displayName },
    });
    return principal;
  }

  getPrincipal(id: string): Principal | undefined {
    return this.principals.get(id);
  }

  listPrincipals(type?: PrincipalType): Principal[] {
    const all = [...this.principals.values()];
    return type ? all.filter((p) => p.type === type) : all;
  }

  async setActive(principalId: string, active: boolean, actor = 'system'): Promise<Principal> {
    const principal = this.requirePrincipal(principalId);
    principal.active = active;
    await this.governance.record({
      domain: 'identity',
      action: active ? 'principal.activate' : 'principal.deactivate',
      entity: principalId,
      actor,
      approval: 'not-required',
      ok: true,
    });
    return principal;
  }

  // --- roles & permission sets ---------------------------------------------
  definePermissionSet(set: PermissionSet): PermissionSet {
    if (this.permissionSets.has(set.id)) throw new Error(`permission set '${set.id}' already exists`);
    this.permissionSets.set(set.id, set);
    return set;
  }

  defineRole(role: RoleTemplate): RoleTemplate {
    if (this.roles.has(role.id)) throw new Error(`role '${role.id}' already exists`);
    for (const psId of role.permissionSetIds) {
      if (!this.permissionSets.has(psId)) throw new Error(`role '${role.id}' references unknown permission set '${psId}'`);
    }
    this.roles.set(role.id, role);
    return role;
  }

  role(id: string): RoleTemplate | undefined {
    return this.roles.get(id);
  }

  async assignRole(principalId: string, roleId: string, actor = 'system'): Promise<Principal> {
    const principal = this.requirePrincipal(principalId);
    if (!this.roles.has(roleId)) throw new Error(`role '${roleId}' not found`);
    if (!principal.roleIds.includes(roleId)) principal.roleIds.push(roleId);
    await this.governance.record({
      domain: 'identity',
      action: 'role.assign',
      entity: principalId,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { roleId },
    });
    return principal;
  }

  async grant(principalId: string, permission: string, actor = 'system'): Promise<Principal> {
    const principal = this.requirePrincipal(principalId);
    if (!principal.permissions.includes(permission)) principal.permissions.push(permission);
    await this.governance.record({
      domain: 'identity',
      action: 'permission.grant',
      entity: principalId,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { permission },
    });
    return principal;
  }

  // --- memberships ----------------------------------------------------------
  async addMembership(
    principalId: string,
    scope: MembershipScope,
    targetId: string,
    roleIds: string[] = [],
    actor = 'system',
  ): Promise<Membership> {
    this.requirePrincipal(principalId);
    for (const roleId of roleIds) {
      if (!this.roles.has(roleId)) throw new Error(`membership references unknown role '${roleId}'`);
    }
    const membership: Membership = {
      id: randomId('mbr'),
      principalId,
      scope,
      targetId,
      roleIds,
      createdAt: this.clock.now(),
    };
    this.memberships.push(membership);
    await this.governance.record({
      domain: 'identity',
      action: `membership.add.${scope}`,
      entity: principalId,
      actor,
      ...(scope === 'workspace' ? { workspace: targetId } : {}),
      ...(scope === 'organization' ? { org: targetId } : {}),
      approval: 'not-required',
      ok: true,
      meta: { targetId, roleIds },
    });
    return membership;
  }

  membershipsOf(principalId: string): Membership[] {
    return this.memberships.filter((m) => m.principalId === principalId);
  }

  members(scope: MembershipScope, targetId: string): Principal[] {
    const ids = new Set(this.memberships.filter((m) => m.scope === scope && m.targetId === targetId).map((m) => m.principalId));
    return [...ids].map((id) => this.principals.get(id)).filter((p): p is Principal => Boolean(p));
  }

  // --- delegation -----------------------------------------------------------
  async delegate(
    fromPrincipalId: string,
    toPrincipalId: string,
    permissions: string[],
    options: { expiresAt?: number; actor?: string } = {},
  ): Promise<Delegation> {
    this.requirePrincipal(fromPrincipalId);
    this.requirePrincipal(toPrincipalId);
    const delegation: Delegation = {
      id: randomId('dlg'),
      fromPrincipalId,
      toPrincipalId,
      permissions,
      ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
      revoked: false,
      createdAt: this.clock.now(),
    };
    this.delegations.set(delegation.id, delegation);
    await this.governance.record({
      domain: 'identity',
      action: 'delegation.create',
      entity: toPrincipalId,
      actor: options.actor ?? fromPrincipalId,
      approval: 'not-required',
      ok: true,
      meta: { fromPrincipalId, permissions },
    });
    return delegation;
  }

  async revokeDelegation(delegationId: string, actor = 'system'): Promise<void> {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) throw new Error(`delegation '${delegationId}' not found`);
    delegation.revoked = true;
    await this.governance.record({
      domain: 'identity',
      action: 'delegation.revoke',
      entity: delegation.toPrincipalId,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { delegationId },
    });
  }

  private activeDelegationsTo(principalId: string): Delegation[] {
    const now = this.clock.now();
    return [...this.delegations.values()].filter(
      (d) => d.toPrincipalId === principalId && !d.revoked && (d.expiresAt === undefined || d.expiresAt > now),
    );
  }

  // --- effective permissions (the ONE resolution) ---------------------------
  effectivePermissions(principalId: string): string[] {
    const principal = this.principals.get(principalId);
    if (!principal || !principal.active) return [];
    const grants = new Set<string>(principal.permissions);
    // role templates → permission sets
    const roleIds = new Set<string>(principal.roleIds);
    for (const membership of this.membershipsOf(principalId)) for (const r of membership.roleIds) roleIds.add(r);
    for (const roleId of roleIds) {
      const role = this.roles.get(roleId);
      if (!role) continue;
      for (const psId of role.permissionSetIds) {
        for (const p of this.permissionSets.get(psId)?.permissions ?? []) grants.add(p);
      }
    }
    // active delegations
    for (const delegation of this.activeDelegationsTo(principalId)) for (const p of delegation.permissions) grants.add(p);
    return [...grants];
  }

  can(principalId: string, permission: string): boolean {
    return this.effectivePermissions(principalId).some((g) => grantMatches(g, permission));
  }

  // --- impersonation (always audited) --------------------------------------
  async impersonate(actorPrincipalId: string, targetPrincipalId: string, reason: string): Promise<ImpersonationSession> {
    this.requirePrincipal(actorPrincipalId);
    this.requirePrincipal(targetPrincipalId);
    if (!reason.trim()) throw new Error('impersonation requires a reason');
    const session: ImpersonationSession = {
      id: randomId('imp'),
      actorPrincipalId,
      targetPrincipalId,
      reason,
      startedAt: this.clock.now(),
    };
    this.impersonations.set(session.id, session);
    await this.governance.record({
      domain: 'identity',
      action: 'impersonation.start',
      entity: targetPrincipalId,
      actor: actorPrincipalId,
      approval: 'not-required',
      ok: true,
      meta: { reason, sessionId: session.id },
    });
    return session;
  }

  async endImpersonation(sessionId: string): Promise<ImpersonationSession> {
    const session = this.impersonations.get(sessionId);
    if (!session) throw new Error(`impersonation '${sessionId}' not found`);
    session.endedAt = this.clock.now();
    await this.governance.record({
      domain: 'identity',
      action: 'impersonation.end',
      entity: session.targetPrincipalId,
      actor: session.actorPrincipalId,
      approval: 'not-required',
      ok: true,
      meta: { sessionId },
    });
    return session;
  }

  impersonationHistory(): ImpersonationSession[] {
    return [...this.impersonations.values()];
  }

  private requirePrincipal(id: string): Principal {
    const principal = this.principals.get(id);
    if (!principal) throw new Error(`principal '${id}' not found`);
    return principal;
  }
}
