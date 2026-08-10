/**
 * Who a memory belongs to, and who may read it.
 *
 * WHY MEMORY NEEDS ITS OWN VOCABULARY
 *
 * Every other store in this system answers "may I see this?" with
 * `recordInScope(record, scope)` from `./tenancy` — two ids, tenant and
 * workspace, and that is the whole question. Memory cannot use it unchanged,
 * because memory has a fourth case the record stores do not: a PERSONAL memory,
 * which belongs to one human inside one workspace inside one tenant and must
 * stay invisible to their colleagues.
 *
 * `TenantScope` has no `userId`, and adding one to it would push a person into
 * the type every ERP store filters on — where it would mean nothing, and where
 * some future filter would eventually compare it. So this file extends the
 * vocabulary rather than widening the shared one, and the extension is
 * deliberately narrow: one enum, one owner, one viewer, one predicate.
 *
 * THE FOUR VISIBILITIES, AND WHY THE ORDER MATTERS
 *
 *   SYSTEM     — belongs to the product, not to a customer. Readable by any
 *                resolved viewer because it contains no tenant data by
 *                construction. NOT creatable through the authoring path (see
 *                `AuthoredMemoryVisibility`), so nothing can launder a tenant
 *                fact into it.
 *   TENANT     — readable by any authorized viewer in that tenant.
 *   WORKSPACE  — readable only inside the owning workspace.
 *   PERSONAL   — readable only by the owning identity.
 *
 * Each is strictly narrower than the one above. `memoryVisibleTo` is written as
 * a chain of widening refusals in that order, so a new visibility added later
 * fails closed until someone gives it a case.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No "all tenants" owner, no wildcard viewer, no `MemoryOwner` whose tenantId
 * may be an empty string and still match. An unowned memory is denied to
 * everyone — the same load-bearing line `ownershipOf` draws for record stores,
 * drawn again here because memory is where the previous audit found it missing.
 */

/** How widely a memory may be read. Ordered widest to narrowest. */
export type MemoryVisibility = 'system' | 'tenant' | 'workspace' | 'personal';

/**
 * The visibilities a CALLER may author.
 *
 * `system` is excluded at the type level rather than checked at runtime. A
 * runtime check is a line someone can delete and a test can miss; a type
 * excluded here means `remember(..., { visibility: 'system' })` does not
 * compile anywhere in the repository, which is the same guarantee enforced by
 * the compiler instead of by vigilance.
 */
export type AuthoredMemoryVisibility = Exclude<MemoryVisibility, 'system'>;

/**
 * The authoritative owner stamped onto a memory at creation.
 *
 * Every field is nullable because the shape must be able to represent a SYSTEM
 * memory (no tenant) and a TENANT memory (no workspace, no user) without
 * inventing sentinel values. Which fields must be present is decided by
 * `memoryOwnerIsWellFormed`, not by the type — because a malformed owner
 * arriving from a sync payload is a thing that happens, and it has to be
 * rejectable rather than unrepresentable.
 */
export interface MemoryOwner {
  visibility: MemoryVisibility;
  /** The organization. Null ONLY for `system`. */
  tenantId: string | null;
  /** Set for `workspace` and `personal`. Null otherwise. */
  workspaceId: string | null;
  /** The owning identity. Set for `personal` only. */
  userId: string | null;
}

/**
 * Who is asking, resolved from the tenant chain — never from a caller.
 *
 * `userId` is nullable because a service principal has no human identity
 * (`TenantContext.userId` is null for one). A null-identity viewer therefore
 * cannot read PERSONAL memory, which is the correct answer: a background job
 * acting for a tenant has no business reading one person's private notes.
 */
export interface MemoryViewer {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
}

/** Whether a memory has an owner at all. Mirrors `ownershipOf` for records. */
export function memoryOwnershipOf(item: {
  owner?: MemoryOwner | null;
}): 'assigned' | 'unresolved' {
  return memoryOwnerIsWellFormed(item.owner) ? 'assigned' : 'unresolved';
}

/**
 * Whether an owner names everything its own visibility requires.
 *
 * Checked rather than assumed because owners arrive from two places that are
 * not the local authoring path: a store file written by an older build, and a
 * sync payload written by another device. Both can present an owner whose
 * visibility says `personal` and whose `userId` is null — and a personal memory
 * with no owning person would otherwise match every viewer in the workspace,
 * which is precisely the widening this file exists to prevent.
 */
export function memoryOwnerIsWellFormed(owner: MemoryOwner | null | undefined): owner is MemoryOwner {
  if (!owner) return false;
  const nonEmpty = (v: string | null): boolean => typeof v === 'string' && v !== '';
  switch (owner.visibility) {
    case 'system':
      return true;
    case 'tenant':
      return nonEmpty(owner.tenantId);
    case 'workspace':
      return nonEmpty(owner.tenantId) && nonEmpty(owner.workspaceId);
    case 'personal':
      return nonEmpty(owner.tenantId) && nonEmpty(owner.workspaceId) && nonEmpty(owner.userId);
    default:
      // An unknown visibility is not well-formed. Fails closed by construction.
      return false;
  }
}

/**
 * May this viewer read this memory?
 *
 * THE ONLY PLACE THIS QUESTION IS ANSWERED. `filterFor` calls it, which means
 * lexical recall, semantic recall, the hybrid merge and the degraded fallback
 * all call it — one predicate, four retrieval paths, no chance of the four
 * drifting apart. A second implementation of this function anywhere would be a
 * second opinion on the boundary, and the previous audit found that the
 * isolated vector half was defeated precisely because the lexical half had a
 * different (absent) opinion.
 *
 * A malformed owner is denied. An unowned memory is denied. There is no input
 * for which this returns true without a positive match.
 */
export function memoryVisibleTo(
  owner: MemoryOwner | null | undefined,
  viewer: MemoryViewer | null | undefined,
): boolean {
  if (!viewer) return false; // no resolved viewer ⇒ no reads at all
  if (!memoryOwnerIsWellFormed(owner)) return false; // unowned ⇒ visible to nobody

  // Product-level memory, carrying no customer data. Readable once a viewer has
  // resolved at all — the resolution is the authorization.
  if (owner.visibility === 'system') return true;

  // Everything below is tenant-sensitive, so the tenant must match FIRST. No
  // later clause can rescue a cross-tenant memory.
  if (owner.tenantId !== viewer.tenantId) return false;
  if (owner.visibility === 'tenant') return true;

  if (owner.workspaceId !== viewer.workspaceId) return false;
  if (owner.visibility === 'workspace') return true;

  // PERSONAL. Never widened to the workspace: a null viewer identity does not
  // match a null owner identity, because `memoryOwnerIsWellFormed` has already
  // guaranteed the owner's is a non-empty string.
  return owner.userId === viewer.userId;
}

/**
 * Build the owner for a memory being authored right now.
 *
 * Takes a VIEWER, not a caller-supplied tenant. That is the whole point: the
 * only way to obtain a `MemoryViewer` is from the tenant resolver, so there is
 * no expressible way to author a memory into a tenant you are not in.
 *
 * Returns null when the requested visibility cannot be satisfied — a personal
 * memory for a service principal with no identity. The caller must fail closed
 * on null rather than downgrade, because downgrading a personal memory to
 * workspace visibility is a disclosure dressed as a fallback.
 */
export function memoryOwnerFor(
  viewer: MemoryViewer,
  visibility: AuthoredMemoryVisibility,
): MemoryOwner | null {
  switch (visibility) {
    case 'tenant':
      return {
        visibility: 'tenant',
        tenantId: viewer.tenantId,
        workspaceId: null,
        userId: null,
      };
    case 'workspace':
      return {
        visibility: 'workspace',
        tenantId: viewer.tenantId,
        workspaceId: viewer.workspaceId,
        userId: null,
      };
    case 'personal':
      if (viewer.userId === null || viewer.userId === '') return null;
      return {
        visibility: 'personal',
        tenantId: viewer.tenantId,
        workspaceId: viewer.workspaceId,
        userId: viewer.userId,
      };
    default:
      return null;
  }
}

/**
 * Whether a memory may participate in org-scoped cloud sync.
 *
 * PERSONAL never syncs — the existing `MemorySyncFields` comment already
 * asserted this ("personal never syncs") while nothing enforced it, because
 * nothing knew which memories were personal. Now something does.
 *
 * SYSTEM does not sync either: it is seeded locally per install and has no
 * owning org to sync within.
 */
export function memoryMaySync(owner: MemoryOwner | null | undefined): boolean {
  if (!memoryOwnerIsWellFormed(owner)) return false;
  return owner.visibility === 'tenant' || owner.visibility === 'workspace';
}

/**
 * The org a memory syncs within, or null if it must not sync.
 *
 * Read from the OWNER rather than from the active organization. The previous
 * audit's highest-severity finding was an outbound bridge that enqueued every
 * synced memory under whichever org happened to be active; this function is the
 * replacement for that expression, and it cannot be given an active org to use.
 */
export function memorySyncOrgOf(owner: MemoryOwner | null | undefined): string | null {
  if (!memoryMaySync(owner)) return null;
  return owner?.tenantId ?? null;
}
