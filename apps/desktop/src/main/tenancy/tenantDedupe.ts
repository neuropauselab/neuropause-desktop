/**
 * EDGE-TRIGGER STATE THAT CANNOT SUPPRESS ANOTHER TENANT.
 *
 * WHAT THIS IS FOR
 *
 * A dozen subsystems produce recommendations, incidents and alerts, and each
 * one needs to remember what it already delivered so a daily source does not
 * re-announce the same thing every tick. Every one of them reached for the
 * obvious thing:
 *
 *     const seen = new Set<string>();
 *     if (seen.has(rec.id)) continue;
 *     seen.add(rec.id);
 *
 * That is correct on a single-tenant install and wrong the moment `produce()`
 * is called once per tenant by `forEachTenant`. Recommendation ids in this
 * codebase are deterministic CONSTANTS — `efedrec:governance:pending-approvals`,
 * `opsrec:capacity:saturated` — so they are identical across tenants by
 * construction. The first tenant in the fan-out claims each id permanently and
 * every other tenant's identical alert is dropped, forever, with no TTL and
 * nothing to clear it.
 *
 * WHY THIS IS ITS OWN PRIMITIVE AND NOT TWELVE FIXES
 *
 * Round 3 fixed eleven memoised caches by name and Round 4 found a twelfth with
 * the identical shape. Round 5 fixed one dedupe set (F8) and the sweep found
 * twelve more. The lesson, recorded twice in this program's own reports: A LIST
 * OF INSTANCES IS NOT A DEFINITION OF A CLASS. So this file defines the class,
 * and a thirteenth subsystem gets the behaviour by using the type rather than by
 * somebody remembering.
 *
 * WHY SUPPRESSION IS WORTH A PRIMITIVE AT ALL
 *
 * It is not a disclosure — no content crosses. What crosses is the DECISION NOT
 * TO DELIVER, which is quieter and, for a critical incident alert, not obviously
 * less serious: one customer silently stops receiving warnings because another
 * customer received the same category of warning first. Nothing looks wrong.
 *
 * THE EVICTION RULE, WHICH IS THE PART THAT IS EASY TO GET BACKWARDS
 *
 * Bounded memory is mandatory — a fix that leaks is not a fix. But eviction must
 * only ever cause RE-DELIVERY of the evicting tenant's own entries. It must
 * never cause suppression, and it must never let one tenant's volume push
 * another tenant's entries out. So the cap is applied PER TENANT rather than
 * across the structure: a noisy tenant re-announces its own alerts sooner, and a
 * quiet tenant is untouched. That is the same trade `TenantOwnership.pruneOwn`
 * already makes for records, for the same reason.
 */
import type { TenantScope } from '@neuropause/shared';

/** One tenant's entries: id → the epoch millisecond it was marked. */
type Bucket = Map<string, number>;

export interface TenantDedupeOptions {
  /**
   * How long an entry suppresses re-delivery. Default one day, which matches
   * the daily cadence of the sources that use this.
   *
   * A TTL here is a FRESHNESS mechanism — "announce this again tomorrow" — and
   * carries none of the isolation. That is the key's job, and conflating the two
   * is the mistake this program removed from fourteen caches.
   */
  ttlMs?: number;
  /**
   * Maximum entries retained PER TENANT. Exceeding it evicts that tenant's
   * oldest, and only that tenant's.
   */
  maxPerTenant?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class TenantDedupe {
  private readonly buckets = new Map<string, Bucket>();
  private readonly ttlMs: number;
  private readonly maxPerTenant: number;
  private readonly now: () => number;

  /**
   * @param name Stable and human-readable. Appears in `stats()` and exists so a
   *             leak or an unexpected size can be attributed to a subsystem.
   */
  constructor(
    private readonly name: string,
    opts: TenantDedupeOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxPerTenant = opts.maxPerTenant ?? 1_000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The bucket key for a scope, or null when nothing resolves.
   *
   * TENANT ONLY, not tenant+workspace. These are organization-level alerts —
   * "your governance has pending approvals" — and keying by workspace would
   * re-announce the same alert once per workspace, which is a different bug in
   * the same family. A caller that genuinely needs per-workspace edges passes a
   * workspace-qualified id.
   */
  private keyOf(scope: TenantScope | null): string | null {
    if (scope === null || !scope.tenantId) return null;
    return scope.tenantId;
  }

  /**
   * Whether this tenant has already been told about `id`.
   *
   * An UNRESOLVED caller is told "no" — it has seen nothing — and `markSeen`
   * will then refuse to record for it. That combination is deliberate: an
   * unowned pass re-delivers rather than silently claiming ids that would
   * suppress a real tenant later. Fail toward the duplicate, never toward the
   * silence.
   */
  hasSeen(scope: TenantScope | null, id: string): boolean {
    const key = this.keyOf(scope);
    if (key === null) return false;
    const bucket = this.buckets.get(key);
    if (bucket === undefined) return false;
    const at = bucket.get(id);
    if (at === undefined) return false;
    if (this.now() - at >= this.ttlMs) {
      bucket.delete(id);
      return false;
    }
    return true;
  }

  /** Record that this tenant has been told about `id`. No-op when unresolved. */
  markSeen(scope: TenantScope | null, id: string): void {
    const key = this.keyOf(scope);
    if (key === null) return;
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = new Map();
      this.buckets.set(key, bucket);
    }
    bucket.set(id, this.now());
    this.prune(bucket);
  }

  /**
   * `hasSeen` and `markSeen` in one call: returns true if this is the FIRST time
   * this tenant has been told, and records it.
   *
   * Provided because the two-call form is where the bug lives — every one of the
   * twelve sites wrote `if (seen.has(id)) continue; seen.add(id);` and a
   * thirteenth will too. One call cannot be half-applied.
   */
  claim(scope: TenantScope | null, id: string): boolean {
    if (this.hasSeen(scope, id)) return false;
    this.markSeen(scope, id);
    return true;
  }

  /**
   * Forget ONE id for ONE tenant, so the next occurrence is announced again.
   *
   * P13C ROUND 7. Added for edge triggers whose condition can CLEAR — a connector
   * that went offline and came back. Without it the caller has to choose between
   * `clear()` (which drops that tenant's other edges as collateral) and leaving
   * the entry until the TTL expires (so a genuine second outage is silent for up
   * to a day). Both are wrong, and the second is wrong in the dangerous
   * direction.
   *
   * Returns whether anything was actually forgotten, so a caller can distinguish
   * "this tenant was told, and now recovered" from "this tenant was never told" —
   * publishing a recovery notice to someone who never saw the failure is its own
   * small cross-tenant leak of another tenant's operational state.
   */
  forget(scope: TenantScope | null, id: string): boolean {
    const key = this.keyOf(scope);
    if (key === null) return false;
    return this.buckets.get(key)?.delete(id) ?? false;
  }

  /** Forget everything for one tenant. For sign-out and explicit resets. */
  clear(scope: TenantScope | null): void {
    const key = this.keyOf(scope);
    if (key !== null) this.buckets.delete(key);
  }

  /** Forget everything, every tenant. For `dispose()` and tests. */
  clearAll(): void {
    this.buckets.clear();
  }

  /**
   * Live sizes, for the startup report and for a leak to be attributable.
   *
   * Counts only — no ids — because an id here names a recommendation another
   * tenant received.
   */
  stats(): { name: string; tenants: number; entries: number } {
    let entries = 0;
    for (const bucket of this.buckets.values()) entries += bucket.size;
    return { name: this.name, tenants: this.buckets.size, entries };
  }

  /**
   * Expire and cap ONE tenant's bucket.
   *
   * Scoped to the bucket rather than the structure. A global cap would let a
   * noisy tenant push a quiet tenant's entries out — which is cross-tenant
   * suppression arriving through the retention policy instead of through the
   * key, and it is exactly the mistake `pruneOwn` exists to prevent for records.
   */
  private prune(bucket: Bucket): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, at] of bucket) if (at < cutoff) bucket.delete(id);
    if (bucket.size <= this.maxPerTenant) return;
    // Map preserves insertion order and entries are never re-inserted while
    // live, so the front is the oldest.
    const excess = bucket.size - this.maxPerTenant;
    let dropped = 0;
    for (const id of bucket.keys()) {
      if (dropped >= excess) break;
      bucket.delete(id);
      dropped += 1;
    }
  }
}
