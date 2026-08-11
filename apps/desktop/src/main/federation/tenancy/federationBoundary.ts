/**
 * THE FEDERATION BOUNDARY — relationship-scoped, not owner-scoped.
 *
 * WHY FEDERATION NEEDS ITS OWN SEAM
 *
 * Every other store in this program answers one question: "is this record
 * MINE?" `TenantOwnership.mine()` compares one `tenantId` against the caller's
 * and that is the whole rule. Federation cannot use that rule, because a
 * federation record is ABOUT TWO ORGANIZATIONS BY CONSTRUCTION. An invitation
 * has a sender and a recipient. A trust relationship has a local side and a
 * peer. A shared resource has an owner and a participant. Collapsing any of
 * those to a single `tenantId` would either hide the record from the party that
 * legitimately needs it, or expose it to an install.
 *
 * So the rule here is PARTY MEMBERSHIP: you may see a federation record if you
 * are one of the organizations it names. Two parties, and the caller must be
 * one of them.
 *
 * WHAT WAS ACTUALLY WRONG (finding S-10)
 *
 * The subsystem had no tenant dimension at all. `FederationRuntimeStore` takes a
 * `homeOrgId` in its CONSTRUCTOR, wired to the seeded `ORG_ID`, so "home" was a
 * property of the install rather than of the caller. Every tenant looked at the
 * same home organization, the same peer list, the same invitations and the same
 * shares. `listOrgs()`, `listInvitations()`, `listTrust()`, `listShared()` and
 * `listArtifacts()` each returned everything, and `revokeShare(id)`,
 * `rollback(artifactId)`, `setVerification(...)` and `publishVersion(...)` each
 * took a bare payload id.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID
 *
 * The tempting fix is to stamp `tenantId = activeTenantScope()` on every
 * federation row and filter on it. That produces a system where federation
 * cannot federate: tenant A shares a resource with tenant B and B cannot see
 * it, which looks like working isolation and is actually a broken product. The
 * program's own rule applies here in reverse — a store that denies every read
 * fails loudly, and someone will "fix" it by removing the filter.
 *
 * CROSS-TENANT RELATIONSHIP IS NOT GLOBAL AUTHORITY. A relationship makes
 * exactly two organizations parties to exactly one record. Everybody else is
 * denied, including on a direct id.
 */
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';

/**
 * The organizations a federation record names.
 *
 * `owner` is the side that created or holds the record; `peer` is the other
 * side. Either may be null for a record that has only one party (an artifact
 * has a publisher and no counterparty until someone installs it).
 */
export interface FederationParties {
  owner: string | null;
  peer: string | null;
}

/**
 * A caller's relationship to one record.
 *
 * Distinguished rather than collapsed to a boolean because the WRITE rules
 * differ by side: an owner may revoke a share outright, a participant may only
 * withdraw its own participation, and a stranger may do neither. A boolean
 * would force every caller to re-derive that from the parties.
 */
export type PartyRole = 'owner' | 'peer' | 'none';

export class FederationBoundary {
  private readonly tenancy: TenantOwnership;

  /**
   * @param name Stable and human-readable. Appears verbatim in the startup
   *             error if this store is never bound.
   */
  constructor(name: string) {
    this.tenancy = new TenantOwnership(name);
  }

  /** Bind the boundary. UNBOUND DENIES. Chainable, like every other store. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }

  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /**
   * The calling ORGANIZATION, or null.
   *
   * Federation is an organization-level concern, so this deliberately reads
   * only the tenant half of the scope and ignores the workspace. A share
   * between two organizations does not stop existing because the user switched
   * workspace inside their own org.
   */
  callerOrg(): string | null {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return null;
    return scope.tenantId;
  }

  /**
   * The calling organization, or a refusal.
   *
   * Writes throw where reads return empty, for the reason the rest of the
   * program already gives: a read with no tenant has an honest empty answer,
   * and a write with no tenant would have to invent a publisher.
   */
  requireCallerOrg(): string {
    const org = this.callerOrg();
    if (org === null) {
      throw new Error('No organization is active, so this federation record has no party.');
    }
    return org;
  }

  /** Which side of the record the caller is on. `none` means DENY. */
  roleIn(parties: FederationParties): PartyRole {
    const me = this.callerOrg();
    if (me === null) return 'none';
    if (parties.owner === me) return 'owner';
    if (parties.peer === me) return 'peer';
    return 'none';
  }

  /** Whether the caller is a party to this record at all. */
  isParty(parties: FederationParties): boolean {
    return this.roleIn(parties) !== 'none';
  }

  /**
   * Only the records the caller is a party to.
   *
   * The one filter every federation read goes through. An unresolved caller
   * gets an empty list — never "everything", which is what these accessors
   * previously returned.
   */
  onlyMine<T>(rows: readonly T[], parties: (row: T) => FederationParties): T[] {
    if (this.callerOrg() === null) return [];
    return rows.filter((r) => this.isParty(parties(r)));
  }

  /**
   * Every organization the caller has ANY federation relationship with,
   * plus the caller itself.
   *
   * This is the honest answer to "which organizations may I know exist?".
   * `listOrgs()` previously returned the entire install directory, which on a
   * multi-tenant machine tells one customer the names and regions of every
   * other customer — before any federation relationship exists between them.
   *
   * Derived from relationships rather than stored, so it cannot drift: an
   * organization becomes visible the moment a record names both of us and stops
   * being visible when the last such record goes.
   */
  relatedOrgs(relationships: readonly FederationParties[]): Set<string> {
    const me = this.callerOrg();
    const seen = new Set<string>();
    if (me === null) return seen;
    seen.add(me);
    for (const r of relationships) {
      if (r.owner === me && r.peer) seen.add(r.peer);
      if (r.peer === me && r.owner) seen.add(r.owner);
    }
    return seen;
  }

  /**
   * Ownership counts across every row, ignoring scope.
   *
   * For the migration inventory's evidence that pre-Round-4 rows exist and are
   * visible to nobody. A row is "assigned" once it names an owner.
   */
  countOwnership(rows: readonly FederationParties[]): {
    total: number;
    assigned: number;
    unresolved: number;
  } {
    let assigned = 0;
    for (const r of rows) if (typeof r.owner === 'string' && r.owner !== '') assigned += 1;
    return { total: rows.length, assigned, unresolved: rows.length - assigned };
  }
}
