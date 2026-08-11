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
  TenantScope,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { buildSeed, OWNER_USER_ID } from './seed';
import { declareStoreScope } from '../../tenancy/storeScope';
import { registerTenantStore } from '../../tenancy/tenantOwnedStore';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'organization-directory',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'The worker prune is confined to one organization; there is no other removal.',
  reason: 'Member names, emails, titles and the org chart. Every row but Organization itself carries orgId. The cross-org read filter lives in tenantDirectory, and that borrowed guarantee is recorded here rather than assumed.',
});

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

  /**
   * The authoritative caller tenant. P13C ROUND 10 — NEW-H6.
   *
   * Bound at the composition root to the PRINCIPAL-AWARE resolver. Round 9's
   * enterprise finding was a store bound to the session-only resolver while
   * every sibling used the principal-aware one, so the binding site names which
   * it wants and `resolverAttachment.test.ts` asserts it.
   *
   * Unbound answers null, and null denies every mutation below. That is the
   * correct state before the app knows who it is acting for.
   */
  private scopeSource: (() => TenantScope | null) | null = null;

  constructor(private readonly filePath: string) {
    super();
    /**
     * P13C ROUND 10 — the startup gate must be able to see this seam.
     *
     * Round 9's enterprise finding was a boundary bound to the wrong resolver
     * while every "is it bound?" invariant passed. Registering here means the
     * opposite failure — a boundary that is never bound at all — makes the
     * application refuse to start rather than serving one tenant's directory to
     * another.
     */
    registerTenantStore('organization-directory', () => this.hasScope());
  }

  /* ── ownership: the ONE gate every mutation goes through — P13C ROUND 10 ── */

  /**
   * NEW-H6 — TENANT TAKEOVER. THE MOST SEVERE FINDING OF ROUND 9.
   *
   * `createUnit`/`createUser`/`createRole` stamped `orgId` from the authoritative
   * resolver. **Update and delete did not.** Each was a bare `this.<map>.get(id)`
   * over one install-wide Map — the read-scoped, write-unscoped split this
   * program has now found in the marketplace, the connectors, the desktop
   * sessions and here.
   *
   * WHY THIS ONE WAS WORSE THAN THE OTHERS. This store decides WHO EVERYONE IS.
   * Membership is resolved by matching the signed-in email against an `OrgUser`
   * row (`tenantDirectory`, `tenantContext`), so an attacker who can rewrite a
   * row's `email` does not merely edit a record — they become that row's holder.
   * The proven chain:
   *
   *   1. Create an organization. Anyone may; you are its Owner.
   *   2. Call `enterprise:org.updateUser` with `{ id: 'user-owner', email: <you> }`.
   *      `guardOwnerUserPatch` strips `roleIds` and `status` — NOT `email`.
   *   3. That row lives in the VICTIM's organization and holds `role-owner`.
   *   4. You are now the victim tenant's Owner.
   *
   * `user-owner` and the thirteen seeded unit ids are COMPILE-TIME CONSTANTS, so
   * there was no id to discover.
   *
   * WHY THE PERMISSION CHECK DID NOT STOP IT. `createAuthorize` resolves the
   * caller's member row in the caller's OWN active organization and never sees
   * the target record. `people:manage` was evaluated in the attacker's org B and
   * the write landed in org A. A permission answers "may this person do this
   * kind of thing"; only ownership answers "to THIS row".
   *
   * WHAT IS DELIBERATELY NOT GATED, and why that is safe:
   *
   * The `orgId`-parameterised reads — `usersFor`, `rolesFor`, `unitsFor`,
   * `organization`, and `user(OWNER_USER_ID)` behind `ownerMember` — are the
   * INPUTS TO THE TENANT RESOLVER ITSELF. `tenantContext` calls them to decide
   * which tenant the caller is in. Gating them on the answer to that question
   * would be circular and would resolve nobody, on any install, ever. They are
   * safe because each takes the organization id as an explicit argument and no
   * IPC handler passes a renderer-supplied value to one: every handler goes
   * through `requireActiveOrg()`. `noRendererIdToRawAccessor` in the Round 10
   * suite asserts that property rather than trusting it.
   */
  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  /** Whether the seam is live. For the startup gate. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The caller's organization, authoritatively. Never from an argument. */
  private callerOrgId(): string | null {
    const id = this.scopeSource?.()?.tenantId ?? null;
    return id === null || id === '' ? null : id;
  }

  /**
   * Does `row` belong to the caller's organization?
   *
   * Fails closed on every ambiguity: no bound seam, no resolved tenant, unknown
   * id, or a row whose `orgId` is absent. A row with no organization is not
   * owned by whoever asks — it is owned by nobody, and a mutation on it is
   * refused.
   */
  private owns(row: { orgId?: string | null } | null | undefined): boolean {
    if (!row) return false;
    const mine = this.callerOrgId();
    if (mine === null) return false;
    return typeof row.orgId === 'string' && row.orgId !== '' && row.orgId === mine;
  }

  /** The unit the caller's organization owns, or null. */
  private ownedUnit(id: string): OrgUnit | null {
    const unit = this.units.get(id);
    return this.owns(unit) ? (unit ?? null) : null;
  }

  /** The member the caller's organization owns, or null. */
  private ownedUser(id: string): OrgUser | null {
    const user = this.users.get(id);
    return this.owns(user) ? (user ?? null) : null;
  }

  /** The role the caller's organization owns, or null. */
  private ownedRole(id: string): OrgRole | null {
    const role = this.roles.get(id);
    return this.owns(role) ? (role ?? null) : null;
  }

  /**
   * The organization the caller IS, or null.
   *
   * `Organization` has no `orgId` field — it IS the organization — so the
   * comparison is against its own id.
   */
  private ownedOrganization(id: string): Organization | null {
    const mine = this.callerOrgId();
    if (mine === null || id !== mine) return null;
    return this.organizations.get(id) ?? null;
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
    // P13C ROUND 10 NEW-H6 — suspending ANOTHER tenant's organization is a
    // cross-tenant denial of service. Was `this.organizations.get(id)`.
    const org = this.ownedOrganization(id);
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
    // P13C ROUND 10 NEW-H6 — ownership, not identity. Was `this.units.get(id)`.
    const unit = this.ownedUnit(id);
    if (!unit) return null;
    const next: OrgUnit = { ...unit, ...patch, updatedAt: new Date().toISOString() };
    this.units.set(id, next);
    this.touch();
    return next;
  }

  deleteUnit(id: string): boolean {
    // P13C ROUND 10 NEW-H6 — the thirteen seeded unit ids are compile-time
    // constants, so this needed no discovery. Was `this.units.get(id)`.
    const unit = this.ownedUnit(id);
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
    // P13C ROUND 10 NEW-H6 — THE TAKEOVER. Rewriting `email` on another
    // tenant's owner row made the attacker that tenant's Owner, because
    // membership is decided by email on this row. Was `this.users.get(id)`.
    const user = this.ownedUser(id);
    if (!user) return null;
    const next: OrgUser = { ...user, ...patch, updatedAt: new Date().toISOString() };
    this.users.set(id, next);
    this.touch();
    return next;
  }

  deleteUser(id: string): boolean {
    // P13C ROUND 10 NEW-H6 — ownership, not identity. Was `this.users.get(id)`.
    const user = this.ownedUser(id);
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
    // P13C ROUND 10 NEW-H6 — renaming or re-permissioning another tenant's
    // roles. Was `this.roles.get(id)`.
    const role = this.ownedRole(id);
    if (!role) return null;
    const next: OrgRole = { ...role, ...patch, updatedAt: new Date().toISOString() };
    this.roles.set(id, next);
    this.touch();
    return next;
  }

  deleteRole(id: string): boolean {
    // P13C ROUND 10 NEW-H6 — deleting another tenant's custom role also strips
    // it from every holder below. Was `this.roles.get(id)`.
    const role = this.ownedRole(id);
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
    // P13C ROUND 10 NEW-H6 — OWNER_USER_ID is a compile-time constant naming a
    // row in the SEEDED organization. Claiming it from another tenant's session
    // is the takeover by a second door. Was `this.users.get(OWNER_USER_ID)`.
    const owner = this.ownedUser(OWNER_USER_ID);
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
  /**
   * Fold the live AI workforce into ONE organization's chart.
   *
   * P13C REMEDIATION — FINDING 1. This took no tenant at all and resolved its
   * organization with `this.defaultOrg()`, the first-inserted one. Three
   * separate cross-tenant defects came out of that single line, and the third
   * was the worst:
   *
   *  1. WRITE. Every tenant's workers were created as members of the first
   *     organization, where they appeared in that tenant's roster, its org
   *     graph and its headcount.
   *  2. UPDATE. `existingByWorker` was built by scanning EVERY user in the
   *     store, so a worker already recorded in tenant B was found and mutated
   *     while the sync was notionally running for A.
   *  3. DELETE — unreported, and the reason this function needed rewriting
   *     rather than patching. The prune loop also scanned every organization,
   *     so running the sync with tenant A's worker list REMOVED tenant B's AI
   *     members whose ids were absent from A's list. A read of A's registry
   *     silently deleted B's records.
   *
   * WHAT THE WORKER REGISTRY ACTUALLY IS
   *
   * `Worker` carries no tenant, and cannot: the registry is an install-level
   * CATALOGUE of AI worker packages — versions, skills, a `builtIn` flag — in
   * the same category as installed plugins. So "each worker's authoritative
   * tenant" is not a fact the data holds, and inventing one would be a guess.
   *
   * The honest split is between the catalogue and the MEMBERSHIP. The
   * catalogue is install-level; the member rows this function writes are not.
   * Each tenant therefore gets its own rows for the same catalogue, and the
   * caller runs this once per tenant under that tenant's principal. That
   * discloses nothing across the boundary — a package name is product data —
   * while making the write, the update and the prune all tenant-local.
   *
   * `orgId` IS REQUIRED AND HAS NO DEFAULT. A caller that cannot name an
   * organization must not call this; there is no argument that would let it
   * mean "the usual one".
   */
  syncWorkers(orgId: string, workers: WorkerSeedRef[], roleToUnitId: Record<string, string>): number {
    const org = this.organizations.get(orgId);
    /**
     * FAIL CLOSED on an unknown organization.
     *
     * Returning 0 rather than throwing because this runs from a fan-out over
     * live tenants, and one deleted organization mid-sweep must not abort every
     * later tenant's sync. Nothing is written, which is the part that matters.
     */
    if (!org) return 0;

    const aiRole = [...this.roles.values()].find((r) => r.orgId === org.id && r.name === 'AI Worker');
    const existingByWorker = new Map<string, OrgUser>();
    for (const u of this.users.values()) {
      // Scoped to THIS organization. Unscoped, this map was the update and
      // delete half of the defect above.
      if (u.orgId !== org.id) continue;
      if (u.kind === 'ai_worker' && u.workerId) existingByWorker.set(u.workerId, u);
    }

    const liveIds = new Set(workers.map((w) => w.id));
    let changed = 0;
    const now = new Date().toISOString();

    for (const w of workers) {
      const unitId = roleToUnitId[w.role] ?? roleToUnitId['*'] ?? null;
      /**
       * A unit belongs to an organization too.
       *
       * `roleToUnitId` maps a worker role to one of the SEEDED unit ids, so
       * outside the seeded organization the lookup finds a unit owned by
       * somebody else. Ignoring a foreign unit leaves the member unfiled rather
       * than filing it under another tenant's department.
       */
      const candidate = unitId ? this.units.get(unitId) ?? null : null;
      const unit = candidate && candidate.orgId === org.id ? candidate : null;
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
    // Prune AI members whose worker is gone — WITHIN this organization only.
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
