/**
 * The Organization Runtime — in-memory home of the org chart (organizations →
 * business units → departments → teams → people + AI workers), persisted as
 * JSON. On first run it seeds a default organization with a full unit hierarchy
 * and the built-in roles; the live AI workforce is folded in via `syncWorkers`.
 *
 * Electron-free by construction (the file path is injected), so it unit-tests on
 * a temp file. The `app.getPath('userData')` singleton lives in orgInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  EnterprisePermission,
  Organization,
  OrgRole,
  OrgUnit,
  OrgUnitKind,
  OrgUser,
  OrgUserStatus,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { buildSeed, OWNER_USER_ID } from './seed';

const log = createLogger('org-runtime');

interface OrgFile {
  organizations: Organization[];
  units: OrgUnit[];
  roles: OrgRole[];
  users: OrgUser[];
  seeded: boolean;
}

export interface CreateUnitInput {
  orgId: string;
  kind: OrgUnitKind;
  name: string;
  parentId?: string | null;
  leadUserId?: string | null;
}

export interface CreateUserInput {
  orgId: string;
  name: string;
  email?: string | null;
  title: string;
  kind?: 'human' | 'ai_worker';
  workerId?: string | null;
  unitId?: string | null;
  roleIds?: string[];
  status?: OrgUserStatus;
}

export interface CreateRoleInput {
  orgId: string;
  name: string;
  description: string;
  permissions: EnterprisePermission[];
}

/** A live worker summary, just enough to fold into the org chart. */
export interface WorkerSeedRef {
  id: string;
  name: string;
  role: string;
}

export class OrgStore extends EventEmitter {
  private organizations = new Map<string, Organization>();
  private units = new Map<string, OrgUnit>();
  private roles = new Map<string, OrgRole>();
  private users = new Map<string, OrgUser>();
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<OrgFile>;
      for (const o of data.organizations ?? []) if (o?.id) this.organizations.set(o.id, o);
      for (const u of data.units ?? []) if (u?.id) this.units.set(u.id, u);
      for (const r of data.roles ?? []) if (r?.id) this.roles.set(r.id, r);
      for (const u of data.users ?? []) if (u?.id) this.users.set(u.id, u);
      if (!data.seeded || this.organizations.size === 0) this.applySeed();
      else this.reconcileBuiltInRoles();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Organization runtime ready', {
      orgs: this.organizations.size,
      units: this.units.size,
      roles: this.roles.size,
      users: this.users.size,
    });
  }

  private applySeed(): void {
    const seed = buildSeed();
    for (const o of seed.organizations) this.organizations.set(o.id, o);
    for (const u of seed.units) this.units.set(u.id, u);
    for (const r of seed.roles) this.roles.set(r.id, r);
    for (const u of seed.users) this.users.set(u.id, u);
    this.schedulePersist();
  }

  /**
   * Keep built-in roles' permission sets aligned with the current seed baseline. Built-in role
   * permissions are the calibrated RBAC baseline (immutable via `guardBuiltInRolePatch`), so on
   * load we refresh them from the seed. This backfills newly-added platform scopes (e.g. the P10
   * `federation:*` scopes) onto EXISTING installs whose persisted roles predate them — without
   * this, an upgraded install's Owner/Admin role would lack the new scope and the (now RBAC-gated)
   * channels would lock out. Custom roles, role names/descriptions, and all other data are untouched.
   */
  private reconcileBuiltInRoles(): void {
    let changed = false;
    for (const seedRole of buildSeed().roles) {
      const current = this.roles.get(seedRole.id);
      if (!current || !current.builtIn) continue;
      const same =
        current.permissions.length === seedRole.permissions.length &&
        seedRole.permissions.every((p) => current.permissions.includes(p));
      if (!same) {
        this.roles.set(seedRole.id, { ...current, permissions: [...seedRole.permissions] });
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: OrgFile = {
      organizations: [...this.organizations.values()],
      units: [...this.units.values()],
      roles: [...this.roles.values()],
      users: [...this.users.values()],
      seeded: true,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Org persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private touch(): void {
    this.schedulePersist();
    this.emit('changed');
  }

  /* ── reads ── */

  listOrganizations(): Organization[] {
    return [...this.organizations.values()];
  }

  defaultOrg(): Organization {
    const first = this.organizations.values().next().value as Organization | undefined;
    if (!first) {
      this.applySeed();
      return this.organizations.values().next().value as Organization;
    }
    return first;
  }

  organization(id: string): Organization | null {
    return this.organizations.get(id) ?? null;
  }

  unitsFor(orgId: string): OrgUnit[] {
    return [...this.units.values()].filter((u) => u.orgId === orgId);
  }

  unit(id: string): OrgUnit | null {
    return this.units.get(id) ?? null;
  }

  rolesFor(orgId: string): OrgRole[] {
    return [...this.roles.values()].filter((r) => r.orgId === orgId);
  }

  role(id: string): OrgRole | null {
    return this.roles.get(id) ?? null;
  }

  usersFor(orgId: string): OrgUser[] {
    return [...this.users.values()].filter((u) => u.orgId === orgId);
  }

  user(id: string): OrgUser | null {
    return this.users.get(id) ?? null;
  }

  /* ── mutations ── */

  /**
   * Create a tenant.
   *
   * P11 writes `type` and `status` explicitly for the same reason the seed does:
   * relying on the read-time compatibility default means a NEW tenant is
   * indistinguishable from a pre-P11 one, and the default exists only for data
   * that predates the field.
   *
   * Honest note: this method still has no caller and no IPC channel, so a second
   * tenant cannot be created from the product yet. It is correct rather than
   * reachable, and the report says so.
   */
  createOrganization(
    name: string,
    description = '',
    type: Organization['type'] = 'business',
  ): Organization {
    const now = new Date().toISOString();
    const org: Organization = {
      id: `org_${randomUUID()}`,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      description,
      type,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };
    this.organizations.set(org.id, org);
    this.touch();
    return org;
  }

  /**
   * Suspend or restore a tenant. All access fails closed while not `active`.
   *
   * The writer `organizationIsOperable` needed. Without it the function was a
   * predicate that could only ever return true.
   */
  setOrganizationStatus(id: string, status: Organization['status']): Organization | null {
    const org = this.organizations.get(id);
    if (!org) return null;
    const next: Organization = { ...org, status, updatedAt: new Date().toISOString() };
    this.organizations.set(id, next);
    this.touch();
    return next;
  }

  createUnit(input: CreateUnitInput): OrgUnit {
    const now = new Date().toISOString();
    const unit: OrgUnit = {
      id: `unit_${randomUUID()}`,
      orgId: input.orgId,
      kind: input.kind,
      name: input.name,
      parentId: input.parentId ?? null,
      leadUserId: input.leadUserId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.units.set(unit.id, unit);
    this.touch();
    return unit;
  }

  updateUnit(id: string, patch: Partial<Pick<OrgUnit, 'name' | 'parentId' | 'leadUserId'>>): OrgUnit | null {
    const unit = this.units.get(id);
    if (!unit) return null;
    const next: OrgUnit = { ...unit, ...patch, updatedAt: new Date().toISOString() };
    this.units.set(id, next);
    this.touch();
    return next;
  }

  deleteUnit(id: string): boolean {
    const unit = this.units.get(id);
    if (!unit) return false;
    // Re-parent children to this unit's parent, and detach members.
    for (const child of this.units.values()) {
      if (child.parentId === id) this.units.set(child.id, { ...child, parentId: unit.parentId });
    }
    for (const u of this.users.values()) {
      if (u.unitId === id) this.users.set(u.id, { ...u, unitId: null });
    }
    this.units.delete(id);
    this.touch();
    return true;
  }

  createUser(input: CreateUserInput): OrgUser {
    const now = new Date().toISOString();
    const user: OrgUser = {
      id: `user_${randomUUID()}`,
      orgId: input.orgId,
      name: input.name,
      email: input.email ?? null,
      title: input.title,
      kind: input.kind ?? 'human',
      workerId: input.workerId ?? null,
      unitId: input.unitId ?? null,
      roleIds: input.roleIds ?? [],
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    this.touch();
    return user;
  }

  /**
   * P11 — `workspaceIds` is writable.
   *
   * Without it `memberMayUseWorkspace` always returned true, so the
   * `not_in_workspace` refusal, its message and its test all described a
   * boundary the product could not express. A predicate with no writer is worse
   * than no predicate, because the docs and the inventory read as though
   * intra-tenant isolation existed.
   *
   * There is no UI for it yet; see the report's limitations. It is reachable
   * from the org-update channel, which already requires `people:manage`.
   */
  updateUser(
    id: string,
    patch: Partial<
      Pick<OrgUser, 'name' | 'email' | 'title' | 'unitId' | 'roleIds' | 'status' | 'workspaceIds'>
    >,
  ): OrgUser | null {
    const user = this.users.get(id);
    if (!user) return null;
    const next: OrgUser = { ...user, ...patch, updatedAt: new Date().toISOString() };
    this.users.set(id, next);
    this.touch();
    return next;
  }

  deleteUser(id: string): boolean {
    const user = this.users.get(id);
    if (!user || user.kind === 'ai_worker') return false; // workers are managed by the workforce
    for (const unit of this.units.values()) {
      if (unit.leadUserId === id) this.units.set(unit.id, { ...unit, leadUserId: null });
    }
    this.users.delete(id);
    this.touch();
    return true;
  }

  createRole(input: CreateRoleInput): OrgRole {
    const now = new Date().toISOString();
    const role: OrgRole = {
      id: `role_${randomUUID()}`,
      orgId: input.orgId,
      name: input.name,
      description: input.description,
      permissions: input.permissions,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(role.id, role);
    this.touch();
    return role;
  }

  updateRole(id: string, patch: Partial<Pick<OrgRole, 'name' | 'description' | 'permissions'>>): OrgRole | null {
    const role = this.roles.get(id);
    if (!role) return null;
    const next: OrgRole = { ...role, ...patch, updatedAt: new Date().toISOString() };
    this.roles.set(id, next);
    this.touch();
    return next;
  }

  deleteRole(id: string): boolean {
    const role = this.roles.get(id);
    if (!role || role.builtIn) return false;
    this.roles.delete(id);
    for (const u of this.users.values()) {
      if (u.roleIds.includes(id)) this.users.set(u.id, { ...u, roleIds: u.roleIds.filter((r) => r !== id) });
    }
    this.touch();
    return true;
  }

  /** Rename the seeded owner to the signed-in account (idempotent best-effort). */
  setOwnerIdentity(name: string, email: string | null): void {
    const owner = this.users.get(OWNER_USER_ID);
    if (!owner) return;
    this.users.set(owner.id, { ...owner, name, email, updatedAt: new Date().toISOString() });
    this.touch();
  }

  /**
   * Fold the live AI workforce into the org chart: each registered worker gets a
   * member record of kind 'ai_worker', placed on the team that matches its role.
   * Idempotent — existing worker members are refreshed, missing ones added,
   * and workers no longer registered are pruned.
   */
  syncWorkers(workers: WorkerSeedRef[], roleToUnitId: Record<string, string>): number {
    const org = this.defaultOrg();
    const aiRole = [...this.roles.values()].find((r) => r.orgId === org.id && r.name === 'AI Worker');
    const existingByWorker = new Map<string, OrgUser>();
    for (const u of this.users.values()) if (u.kind === 'ai_worker' && u.workerId) existingByWorker.set(u.workerId, u);

    const liveIds = new Set(workers.map((w) => w.id));
    let changed = 0;
    const now = new Date().toISOString();

    for (const w of workers) {
      const unitId = roleToUnitId[w.role] ?? roleToUnitId['*'] ?? null;
      const unit = unitId ? this.units.get(unitId) ?? null : null;
      const prev = existingByWorker.get(w.id);
      if (prev) {
        const next: OrgUser = { ...prev, name: w.name, title: `${cap(w.role)} AI`, unitId: unit?.id ?? prev.unitId, updatedAt: now };
        this.users.set(prev.id, next);
      } else {
        const user: OrgUser = {
          id: `user_${randomUUID()}`,
          orgId: org.id,
          name: w.name,
          email: null,
          title: `${cap(w.role)} AI`,
          kind: 'ai_worker',
          workerId: w.id,
          unitId: unit?.id ?? null,
          roleIds: aiRole ? [aiRole.id] : [],
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        this.users.set(user.id, user);
        changed++;
      }
    }
    // Prune AI members whose worker is gone.
    for (const [workerId, user] of existingByWorker) {
      if (!liveIds.has(workerId)) {
        this.users.delete(user.id);
        changed++;
      }
    }
    if (changed > 0) this.touch();
    return changed;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
