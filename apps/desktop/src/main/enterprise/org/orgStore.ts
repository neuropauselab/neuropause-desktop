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
import { readStoreFile } from '../../storage/storeEnvelope';
import { buildSeed, BUILT_IN_ROLE_SPECS, ORG_ID as SEED_ORG_ID, OWNER_USER_ID } from './seed';
import { decideOwnerClaim } from '../authzGate';
import { declareStoreScope } from '../../tenancy/storeScope';
import { registerTenantStore } from '../../tenancy/tenantOwnedStore';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'organization-directory',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  /** P13C ROUND 10 — the enum form. Re-read against the code, not against the fix note. */
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'Four removals, and every one resolves ownership FIRST — the `ownedUnit` / `ownedUser` / ' +
    '`ownedRole` gate added for NEW-H6 this round. (1) `deleteUnit`, (2) `deleteUser` and ' +
    '(3) `deleteRole` were each a bare `this.<map>.get(id)` over one install-wide Map reached by a ' +
    'renderer-supplied id, and the thirteen seeded unit ids plus `user-owner` are COMPILE-TIME ' +
    'CONSTANTS, so there was nothing to discover. They now return false for a row the caller does ' +
    'not own, and `owns()` fails closed on an unbound seam, an unresolved tenant, an unknown id ' +
    'and a row with no orgId. Their cascades (re-parenting children, detaching members, clearing ' +
    '`leadUserId`, stripping a deleted role from its holders) scan the whole Map by id equality ' +
    'and can only match rows that reference the OWNED row being deleted. (4) `syncWorkers` prunes ' +
    'AI members whose worker package is gone, from `existingByWorker`, which is built with an ' +
    "explicit `u.orgId !== org.id` skip — unscoped, it deleted another tenant's AI members whose " +
    'ids were absent from the list being synced. There is no cap, no TTL and no eviction anywhere ' +
    'in this store; an org chart is not rotated.',
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
  /**
   * Round 40: set ONLY by provisioning for the spec-derived role set. The IPC
   * create-role schema has no such field, so callers over the wire cannot
   * mint undeletable roles.
   */
  builtIn?: boolean;
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
   *      `guardOwnerUserPatch` stripped `roleIds` and `status` — NOT `email`.
   *      (Round 32 / O-13 later closed the email door too, same-tenant included;
   *      this narrative records the exploit as it existed in Round 9.)
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
    /**
     * P13C ROUND 33 — QUARANTINE, NEVER RESEED OVER A CORRUPT FILE.
     *
     * This store decides WHO EVERYONE IS, and its old load path was
     * `catch { applySeed() }` — which cannot tell a first run from a truncated
     * write, and whose seed schedules a persist that RENAMES THE DEMO DATA
     * OVER the customer's real org chart: organizations, units, roles, every
     * member row including the emails membership is decided by. One torn
     * write, and the install silently becomes a fresh demo, permanently.
     *
     * `readStoreFile` (Phase 8's quarantine-not-reset envelope, adopted by 21
     * stores and skipped by exactly the ones that mattered most) preserves the
     * unreadable file beside itself for support/recovery; legacy un-stamped
     * files still read as v1, so existing installs load unchanged.
     */
    const read = await readStoreFile<Partial<OrgFile>>(this.filePath);
    if (read.state === 'loaded' && read.data !== null) {
      const data = read.data;
      for (const o of data.organizations ?? []) if (o?.id) this.organizations.set(o.id, o);
      for (const u of data.units ?? []) if (u?.id) this.units.set(u.id, u);
      for (const r of data.roles ?? []) if (r?.id) this.roles.set(r.id, r);
      for (const u of data.users ?? []) if (u?.id) this.users.set(u.id, u);
      if (!data.seeded || this.organizations.size === 0) this.applySeed();
      else this.reconcileBuiltInRoles();
      this.healProvisionedOwnerAnchors();
    } else {
      if (read.state !== 'first-run') {
        log.error('Org store unreadable — original preserved, starting from seed', {
          state: read.state,
          quarantinedTo: read.quarantinedTo,
        });
      }
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

  /**
   * P13C ROUND 40 — GATE 27. Provisioned-owner protection for PRE-round-40
   * stores. Provisioning now records `Organization.ownerUserId` and marks the
   * spec roles built-in at creation; organizations provisioned before that
   * have neither, which is exactly the reported exploit surface: any Manager
   * could edit/suspend/delete the creator, any Admin could delete the Owner
   * role. On load:
   *
   *  1. A non-seeded organization without an owner anchor is healed from its
   *     rows when UNAMBIGUOUS: exactly one human member titled 'Owner' holding
   *     this org's role named 'Owner' (the shape provisioning always wrote).
   *     Zero or several candidates → left unanchored and logged — inventing a
   *     root of trust would be worse than admitting there isn't one.
   *  2. Roles in non-seeded organizations whose name matches a built-in spec
   *     are re-marked `builtIn` (provisioning created them from the specs but
   *     `createRole` hardcoded false). A user-made custom role that reuses a
   *     spec name is caught too — deliberate: freezing a role named 'Owner'
   *     fails closed, deleting it fails open.
   */
  private healProvisionedOwnerAnchors(): void {
    const specNames = new Set(BUILT_IN_ROLE_SPECS.map((s) => s.name));
    let changed = false;
    for (const role of this.roles.values()) {
      if (role.orgId !== SEED_ORG_ID && !role.builtIn && specNames.has(role.name)) {
        this.roles.set(role.id, { ...role, builtIn: true });
        changed = true;
      }
    }
    for (const org of this.organizations.values()) {
      if (org.id === SEED_ORG_ID || org.ownerUserId) continue;
      const ownerRoleIds = new Set(
        [...this.roles.values()].filter((r) => r.orgId === org.id && r.name === 'Owner').map((r) => r.id),
      );
      const candidates = [...this.users.values()].filter(
        (u) =>
          u.orgId === org.id &&
          u.kind === 'human' &&
          u.title === 'Owner' &&
          u.roleIds.some((id) => ownerRoleIds.has(id)),
      );
      if (candidates.length === 1 && candidates[0]) {
        this.organizations.set(org.id, { ...org, ownerUserId: candidates[0].id });
        changed = true;
      } else {
        log.warn('Provisioned organization has no unambiguous owner to anchor', {
          orgId: org.id,
          candidates: candidates.length,
        });
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
      // The write failed AFTER `dirty` was cleared, so without this line the
      // pending change would never be retried — a transient ENOSPC/EPERM
      // silently lost the mutation until the next unrelated edit. Re-marking
      // dirty means the next schedulePersist (or flush) tries again.
      this.dirty = true;
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
   * P13C ROUND 40 — GATE 27. The protected owner of a tenant, if it has one.
   * Seeded organization → the compile-time root of trust; provisioned →
   * whatever provisioning recorded (or the load-time heal derived).
   */
  ownerUserIdFor(orgId: string): string | null {
    if (orgId === SEED_ORG_ID) return OWNER_USER_ID;
    return this.organizations.get(orgId)?.ownerUserId ?? null;
  }

  /**
   * The owner id the root-of-trust guards must compare a mutation TARGET
   * against. Resolved from the target's OWN organization, so the guards hold
   * in every tenant, not just the seeded one. A target with no resolvable
   * anchor falls back to the seeded literal — exactly the pre-round-40
   * behaviour, never less protection.
   */
  protectedOwnerIdForTarget(userId: string): string {
    const target = this.users.get(userId);
    const ownerId = target ? this.ownerUserIdFor(target.orgId) : null;
    return ownerId ?? OWNER_USER_ID;
  }

  /**
   * Record the provisioned owner, once. First-set-wins like the seeded claim
   * rule: the anchor is written by provisioning in the same act that creates
   * the owner row, and no later caller — not even another provisioning run —
   * may re-point it. Refuses the seeded org (its anchor is compile-time), an
   * already-anchored org, and a user outside the org.
   */
  assignProvisionedOwner(orgId: string, userId: string): boolean {
    if (orgId === SEED_ORG_ID) return false;
    const org = this.organizations.get(orgId);
    if (!org || org.ownerUserId) return false;
    const user = this.users.get(userId);
    if (!user || user.orgId !== orgId) return false;
    this.organizations.set(orgId, { ...org, ownerUserId: userId, updatedAt: new Date().toISOString() });
    this.touch();
    return true;
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
    /**
     * P13C ROUND 31 — O-11. A PARTIAL PATCH MEANS "THESE FIELDS", NOT "THESE
     * FIELDS PLUS UNDEFINED FOR THE REST".
     *
     * Object spread copies own enumerable keys REGARDLESS of value, so
     * `{ ...user, ...{ email: undefined } }` SETS `email` to `undefined` — it
     * does not leave the previous value alone. Every caller builds its patch as
     * an object literal (see the `EnterpriseOrgUpdateUser` handler), so a
     * request that simply omits a field arrives here carrying that field with
     * the value `undefined`, and erases it.
     *
     * On the owner row that is not cosmetic. `email` is the key membership is
     * decided by; `JSON.stringify` drops undefined, so the erasure survives a
     * restart; and the resolver's `m.email !== null` check then called `.trim()`
     * on it. One optional field left out of one member edit could take tenant
     * resolution down for every subsequent request in the process.
     *
     * Deleting the key is right rather than coercing to null, because null is a
     * MEANINGFUL value here — an unclaimed owner — so a patch that genuinely
     * wants to clear a field says `null` and still can.
     */
    const applied: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) applied[k] = v;
    }
    const next: OrgUser = { ...user, ...applied, updatedAt: new Date().toISOString() };
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
      // Round 40: provisioning marks its spec-derived roles built-in (the
      // Owner role above all — a deletable root of trust was the exploit).
      // The IPC create-role handler never passes this; user roles stay custom.
      builtIn: input.builtIn ?? false,
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

  /**
   * Bind the seeded owner to the signed-in account, under the first-claim rule.
   *
   * P13C ROUND 32 — O-12. NARROW AUTHORITY, DECIDED HERE, NOT BY THE CALLER.
   *
   * The Round 10 version (`setOwnerIdentity`) went through `ownedUser`, which
   * requires a RESOLVED caller tenant. That gate is right for every ordinary
   * mutation and wrong for this one, twice over:
   *
   *  1. It made the claim depend on unrelated mutable state. Ownership is
   *     "the first account to SIGN IN claims the seeded org" — an install-level
   *     rule. Whether the active workspace happened to belong to the seeded
   *     organization at that moment is not part of the rule, yet it decided the
   *     outcome.
   *  2. It made recovery impossible (O-12). Once tenant resolution refuses,
   *     `scope()` is null, `ownedUser` returns null, and the only non-IPC
   *     writer of the owner row silently no-ops for the life of the process —
   *     the reason the Windows outage is permanent until a restart.
   *
   * The authority granted instead is EXACTLY the claim rule, not a general
   * write: the decision lives inside this method (`decideOwnerClaim`), so no
   * caller can use this path to bind an arbitrary identity to the row. The
   * cross-tenant guard Round 10 added is preserved STRUCTURALLY rather than by
   * caller scope — the method can only ever touch `OWNER_USER_ID` inside the
   * SEEDED organization, both compile-time constants:
   *
   *  - a CLAIMED owner is never rebound to a different account (first-claim-wins);
   *  - a CORRUPT row (email present but not string-or-null — the O-11 shape)
   *    refuses rather than becoming claimable by whoever signs in next;
   *  - an owner row that is missing, or somehow not in the seeded org, refuses.
   *
   * Returns true when a write happened, so the caller can log the claim.
   */
  claimOwnerIdentity(session: { name: string; email: string }): boolean {
    const owner = this.users.get(OWNER_USER_ID);
    if (!owner) return false;
    if (owner.orgId !== SEED_ORG_ID) return false;
    // The O-11 disk shape: an email key that was erased loads as undefined.
    // Fail closed — a corrupt root of trust is repaired by support, not claimed.
    if (owner.email !== null && typeof owner.email !== 'string') return false;
    const claim = decideOwnerClaim({ name: owner.name, email: owner.email }, session);
    if (!claim) return false;
    this.users.set(owner.id, {
      ...owner,
      name: claim.name,
      email: claim.email,
      updatedAt: new Date().toISOString(),
    });
    this.touch();
    return true;
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
