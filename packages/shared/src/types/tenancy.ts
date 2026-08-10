/**
 * The tenant boundary, as types.
 *
 * WHAT THIS FILE IS FOR
 *
 * Before P11 the app had a workspace id that eleven of fifteen call sites used
 * as an audit stamp, one organization row that could never be joined by a
 * second, and a permission engine whose only input was a string. Tenancy was a
 * label. This file is the vocabulary that makes it a boundary.
 *
 * THREE IDEAS, AND WHY EACH IS SEPARATE
 *
 * 1. `TenantScope` — WHERE data lives. Two ids and nothing else. It is what a
 *    store accepts. Deliberately tiny: a scope that carried a role or a
 *    permission would invite a store to make an authorization decision, and a
 *    store is the wrong place to decide anything.
 *
 * 2. `TenantContext` — WHO is asking, resolved. Carries the scope plus the
 *    identity, role and permissions behind it. Assembled once per request by
 *    exactly one resolver, never by a caller.
 *
 * 3. `TenantRefusal` — WHY there is no context. A refusal is a value, not an
 *    exception and not a null. The reason has to survive to the surface,
 *    because "no tenant" and "empty tenant" look identical to a user and are
 *    opposite facts.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No `Tenant` interface. The tenant is `Organization` in `./enterprise` — the
 * entity that already drove every permission decision. A second entity here
 * would be a second authority, and two authorities on the same question is the
 * failure mode this program exists to remove.
 *
 * No default, no fallback, no `ANY_TENANT`, no wildcard. There is no value in
 * this file that means "all tenants", because a type that can express it is a
 * type someone will eventually construct.
 */
import type { EnterprisePermission } from './enterprise';

/**
 * Where a resource lives. The only thing a scoped store accepts.
 *
 * Both ids are REQUIRED and non-empty. An optional field here would be the
 * whole boundary undone: `{ tenantId: undefined }` reads as "unscoped" to every
 * filter written by hand, and one such filter is enough.
 */
export interface TenantScope {
  /** The organization id. This is the tenant. */
  tenantId: string;
  /** The active workspace inside that tenant. */
  workspaceId: string;
}

/** Who is acting. Reuses the identity vocabulary from Program 10. */
export type TenantActorType = 'human' | 'service' | 'system';

/**
 * A resolved authorization context. Assembled by ONE resolver.
 *
 * The fields are the operating chain, in order: identity → tenant → workspace →
 * role → permissions. `requestId` is last because it is bookkeeping, not
 * authority — but it is required, because an audit line that cannot be joined
 * to the request that produced it answers a different question than the one it
 * appears to answer.
 */
export interface TenantContext {
  requestId: string;
  /** The signed-in account's stable id — an email today. Null for a service. */
  userId: string | null;
  /** The org member row backing this context. Null for a service or the system. */
  memberId: string | null;
  tenantId: string;
  workspaceId: string;
  /** Role names, for display and for separation-of-duties. Never for a gate. */
  roles: string[];
  /** The effective permission set. Already unioned; never widened downstream. */
  permissions: readonly EnterprisePermission[];
  actorType: TenantActorType;
  /** For an audit line that reads like a sentence. */
  label: string;
}

/** The scope half of a context, for handing to a store. */
export function scopeOf(ctx: TenantContext): TenantScope {
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
}

/**
 * Why no context could be resolved.
 *
 * Every one of these is a DENY. They are enumerated rather than collapsed to a
 * boolean because the operator-facing message differs sharply — "sign in" and
 * "this workspace belongs to an organization you are not a member of" need
 * different actions from the person reading them — and because a single
 * `false` would have hidden the cold-start case, which is the one that bit
 * Program 10.
 */
export type TenantRefusalReason =
  /** No authenticated session. */
  | 'not_signed_in'
  /** The stores have not been read yet. The cold-start case. */
  | 'not_loaded'
  /** No workspace is active. */
  | 'no_workspace'
  /** The active workspace names an organization that does not exist. */
  | 'workspace_orphaned'
  /** The signed-in account is not a member of the workspace's organization. */
  | 'not_a_member'
  /** A member of the tenant, but not of this workspace. */
  | 'not_in_workspace'
  /** The member exists but is suspended or invited, not active. */
  | 'member_inactive'
  /** The tenant is suspended or archived. */
  | 'tenant_not_operable';

export interface TenantRefusal {
  reason: TenantRefusalReason;
  /** Plain words, shown as-is. Never names another tenant. */
  message: string;
}

export type TenantResolution =
  | { ok: true; context: TenantContext }
  | { ok: false; refusal: TenantRefusal };

/**
 * The message for each refusal.
 *
 * NONE of these confirm the existence of anything the caller is not entitled
 * to know about. `not_a_member` says the workspace belongs to an organization
 * you are not in — it does not name the organization, because naming it turns a
 * denial into a disclosure.
 */
export const TENANT_REFUSAL_MESSAGE: Record<TenantRefusalReason, string> = {
  not_signed_in: 'Sign in to continue.',
  not_loaded: 'The workspace is still opening. Try again in a moment.',
  no_workspace: 'No workspace is open, so there is nothing to read or change.',
  workspace_orphaned:
    'This workspace is not attached to an organization that exists here. It cannot be opened until that is resolved.',
  not_a_member: 'This workspace belongs to an organization you are not a member of.',
  not_in_workspace: 'You are a member of this organization but not of this workspace.',
  member_inactive: 'Your membership is not active.',
  tenant_not_operable: 'This organization is suspended, so its data cannot be read or changed.',
};

export function tenantRefusal(reason: TenantRefusalReason): TenantResolution {
  return { ok: false, refusal: { reason, message: TENANT_REFUSAL_MESSAGE[reason] } };
}

/* ── Record ownership ──────────────────────────────────────────────────── */

/**
 * Whether a stored record's owner is known.
 *
 * `unresolved` is the state every record written before P11 is in. It is not an
 * error and not a placeholder for "probably the default tenant" — it is the
 * honest answer, and an unresolved record is visible to NO tenant. Guessing an
 * owner is the one thing a migration must never do, because the guess is
 * silent, permanent, and indistinguishable from a correct answer afterwards.
 */
export type RecordOwnership = 'assigned' | 'unresolved';

export function ownershipOf(record: { tenantId?: string | null }): RecordOwnership {
  const id = record.tenantId;
  return typeof id === 'string' && id !== '' ? 'assigned' : 'unresolved';
}

/**
 * Whether a record is visible within a scope.
 *
 * The workspace half is deliberately permissive about ABSENCE: a record with a
 * tenant but no workspace belongs to the tenant as a whole and is visible
 * across its workspaces. That is a real case — a tenant-level record, and the
 * shape every record has immediately after a tenant claims it. A record with a
 * DIFFERENT workspace is denied.
 *
 * A record with no tenant is denied everywhere. That is the load-bearing line.
 */
export function recordInScope(
  record: { tenantId?: string | null; workspaceId?: string | null },
  scope: TenantScope,
): boolean {
  if (ownershipOf(record) === 'unresolved') return false;
  if (record.tenantId !== scope.tenantId) return false;
  const ws = record.workspaceId;
  if (ws === undefined || ws === null || ws === '') return true;
  return ws === scope.workspaceId;
}

/* ── Cache keys ───────────────────────────────────────────────────────── */

/**
 * A cache key that cannot accidentally omit its scope.
 *
 * The audit found roughly twenty-five caches and one of them was scoped. The
 * failure is never deliberate — it is a `Map<string, X>` keyed on a record id
 * that was correct while there was one tenant. A helper does not prevent that,
 * but it makes the scoped form shorter to write than the unscoped one, which is
 * most of what a convention can achieve.
 *
 * JSON-encoded rather than joined, so an id containing the separator cannot
 * collapse two different keys into one.
 */
export function tenantKey(scope: TenantScope, ...parts: readonly string[]): string {
  return JSON.stringify([scope.tenantId, scope.workspaceId, ...parts]);
}

/** The tenant half only, for something shared across a tenant's workspaces. */
export function tenantOnlyKey(tenantId: string, ...parts: readonly string[]): string {
  return JSON.stringify([tenantId, ...parts]);
}

/* ── Migration inventory ──────────────────────────────────────────────── */

/**
 * How far one store has actually got. Reported from real counts, never asserted.
 *
 * `PARTIAL` exists because it is the truthful answer for most of this system
 * right now, and a status vocabulary without it would force every store into
 * either a lie or a failure.
 */
export type TenantMigrationStatus =
  /** Scope is enforced on every read, and no unresolved records remain. */
  | 'COMPLETE'
  /** Scope is enforced, but unresolved records are still present. */
  | 'PARTIAL'
  /** Scope is not enforced here yet. Reads are not tenant-filtered. */
  | 'REQUIRES_MIGRATION'
  /** Cannot be scoped as it stands — says why. */
  | 'BLOCKED';

export interface TenantMigrationEntry {
  /** The store or subsystem, in the words the codebase uses. */
  store: string;
  status: TenantMigrationStatus;
  /** Records the store holds, when it can count them. */
  total: number;
  /** Of those, how many have a known owner. */
  assigned: number;
  /** Of those, how many do not — these are invisible to every tenant. */
  unresolved: number;
  /** Plain words. For BLOCKED, the reason. */
  note: string;
}

export interface TenantMigrationInventory {
  generatedAt: string;
  entries: TenantMigrationEntry[];
  /** Sums across every entry, so the headline cannot disagree with the rows. */
  totals: { stores: number; records: number; assigned: number; unresolved: number };
}
