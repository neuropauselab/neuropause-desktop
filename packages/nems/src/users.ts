/**
 * User Management (Wave 1, Module 3). Users, roles, permissions, status. Users are
 * persisted (durable), tenant-scoped, and their authorization runs through the ONE
 * security authorization model (RBAC+ABAC) — NEMS does not reimplement authz. Built-
 * in roles (admin/executive/manager/contributor/viewer) plus custom roles. Every
 * mutation is audited + published.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { SqlDriver } from '@neuropause/persistence';
import type { AuthorizationEngine } from '@neuropause/security';
import { one, many, run, toJson } from './db';
import { recordMutation, type Gov } from './governance';
import { hashPassword } from './credentials';
import type { MutationContext } from './types';

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deactivated';

export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  title?: string;
  status: UserStatus;
  roles: string[];
  mfaEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Credentials {
  id: string;
  status: UserStatus;
  hash: string;
  salt: string;
  mfaSecret: string | null;
  roles: string[];
}

interface UserRow {
  id: string; tenant_id: string; email: string; display_name: string; title: string | null;
  status: UserStatus; roles: string[]; mfa_secret: string | null; created_at: string | number; updated_at: string | number;
}
const num = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
function mapUser(r: UserRow): User {
  return { id: r.id, tenantId: r.tenant_id, email: r.email, displayName: r.display_name, ...(r.title ? { title: r.title } : {}), status: r.status, roles: r.roles ?? [], mfaEnabled: r.mfa_secret != null, createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
}

export class UserService {
  constructor(
    private readonly db: SqlDriver,
    private readonly clock: Clock,
    private readonly gov: Gov,
    private readonly authz: AuthorizationEngine,
  ) {}

  async create(ctx: MutationContext, input: { email: string; password: string; displayName: string; title?: string; roles?: string[]; status?: UserStatus }): Promise<User> {
    const id = randomId('usr');
    const at = this.clock.now();
    const { hash, salt } = hashPassword(input.password);
    const roles = input.roles ?? ['viewer'];
    await run(
      this.db,
      `INSERT INTO nems_users (id, tenant_id, email, password_hash, password_salt, display_name, title, status, roles, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'{}'::jsonb,$10,$10)`,
      [id, ctx.tenantId, input.email.toLowerCase(), hash, salt, input.displayName, input.title ?? null, input.status ?? 'active', toJson(roles), at],
    );
    for (const role of roles) await this.recordAssignment(ctx.tenantId, id, role);
    const user = (await this.get(ctx.tenantId, id))!;
    await recordMutation(this.gov, { ctx, entity: 'user', entityId: id, operation: 'create', after: { email: user.email, roles }, event: 'nems.user.created', eventPayload: { email: user.email } });
    return user;
  }

  async get(tenantId: string, id: string): Promise<User | undefined> {
    const r = await one<UserRow>(this.db, `SELECT id,tenant_id,email,display_name,title,status,roles,mfa_secret,created_at,updated_at FROM nems_users WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
    return r ? mapUser(r) : undefined;
  }
  async list(tenantId: string, filter: { status?: UserStatus } = {}): Promise<User[]> {
    const rows = filter.status
      ? await many<UserRow>(this.db, `SELECT id,tenant_id,email,display_name,title,status,roles,mfa_secret,created_at,updated_at FROM nems_users WHERE tenant_id=$1 AND status=$2 ORDER BY created_at`, [tenantId, filter.status])
      : await many<UserRow>(this.db, `SELECT id,tenant_id,email,display_name,title,status,roles,mfa_secret,created_at,updated_at FROM nems_users WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]);
    return rows.map(mapUser);
  }

  /** Internal — credentials for the identity service (never exposed on the API). */
  async credentials(tenantId: string, email: string): Promise<Credentials | undefined> {
    const r = await one<{ id: string; status: UserStatus; password_hash: string; password_salt: string; mfa_secret: string | null; roles: string[] }>(
      this.db, `SELECT id,status,password_hash,password_salt,mfa_secret,roles FROM nems_users WHERE tenant_id=$1 AND email=$2`, [tenantId, email.toLowerCase()]);
    return r ? { id: r.id, status: r.status, hash: r.password_hash, salt: r.password_salt, mfaSecret: r.mfa_secret, roles: r.roles ?? [] } : undefined;
  }

  async setStatus(ctx: MutationContext, id: string, status: UserStatus): Promise<User> {
    const before = await this.get(ctx.tenantId, id);
    await run(this.db, `UPDATE nems_users SET status=$3, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, status, this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'user', entityId: id, operation: 'update', before: { status: before?.status }, after: { status }, event: 'nems.user.updated' });
    return (await this.get(ctx.tenantId, id))!;
  }

  async assignRole(ctx: MutationContext, id: string, role: string): Promise<User> {
    const user = await this.get(ctx.tenantId, id);
    if (!user) throw new Error(`user '${id}' not found`);
    if (!user.roles.includes(role)) {
      const roles = [...user.roles, role];
      await run(this.db, `UPDATE nems_users SET roles=$3::jsonb, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, toJson(roles), this.clock.now()]);
      await this.recordAssignment(ctx.tenantId, id, role);
      await recordMutation(this.gov, { ctx, entity: 'user', entityId: id, operation: 'update', before: { roles: user.roles }, after: { roles }, event: 'nems.user.updated' });
    }
    return (await this.get(ctx.tenantId, id))!;
  }

  async updateProfile(ctx: MutationContext, id: string, patch: { displayName?: string; title?: string }): Promise<User> {
    const before = await this.get(ctx.tenantId, id);
    if (!before) throw new Error(`user '${id}' not found`);
    await run(this.db, `UPDATE nems_users SET display_name=$3, title=$4, updated_at=$5 WHERE tenant_id=$1 AND id=$2`, [ctx.tenantId, id, patch.displayName ?? before.displayName, patch.title ?? before.title ?? null, this.clock.now()]);
    await recordMutation(this.gov, { ctx, entity: 'user', entityId: id, operation: 'update', before: { displayName: before.displayName }, after: { displayName: patch.displayName ?? before.displayName }, event: 'nems.user.updated' });
    return (await this.get(ctx.tenantId, id))!;
  }

  /** Authorization decision through the ONE security model. */
  can(user: User, action: string, resourceType: string): boolean {
    return this.authz.authorize({ subject: { id: user.id, roles: user.roles }, action, resource: { type: resourceType, tenant: user.tenantId } }).allowed;
  }

  private async recordAssignment(tenantId: string, userId: string, role: string): Promise<void> {
    const roleRow = await one<{ id: string }>(this.db, `SELECT id FROM nems_roles WHERE name=$1 AND (tenant_id IS NULL OR tenant_id=$2) ORDER BY tenant_id NULLS LAST LIMIT 1`, [role, tenantId]);
    if (!roleRow) return;
    await run(this.db, `INSERT INTO nems_role_assignments (id, tenant_id, user_id, role_id, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,user_id,role_id) DO NOTHING`, [randomId('ra'), tenantId, userId, roleRow.id, this.clock.now()]);
  }

  // internal setters for the identity service
  async setPassword(id: string, tenantId: string, hash: string, salt: string): Promise<void> {
    await run(this.db, `UPDATE nems_users SET password_hash=$3, password_salt=$4, updated_at=$5 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, hash, salt, this.clock.now()]);
  }
  async setMfaSecret(id: string, tenantId: string, secret: string | null): Promise<void> {
    await run(this.db, `UPDATE nems_users SET mfa_secret=$3, updated_at=$4 WHERE tenant_id=$1 AND id=$2`, [tenantId, id, secret, this.clock.now()]);
  }
}
