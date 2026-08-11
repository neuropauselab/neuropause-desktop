/**
 * THE TENANT SEAM, AS A COMPOSABLE OBJECT — and the gate that makes an unscoped
 * store impossible to ship.
 *
 * WHY THIS EXISTS RATHER THAN A FOURTH BASE CLASS
 *
 * Four security sweeps have now found the same defect in four different places,
 * and the shape is identical every time:
 *
 *     legacy subsystem → no tenant field → no scope seam →
 *     public or base-role IPC → bare id or global collection → exposure
 *
 * The sandbox fix worked because all five of its stores shared one
 * `PersistentStore` base, so the seam could go there once. The stores this round
 * has to fix — automation rules, executive decisions, workforce jobs, execution
 * sessions, the relationship queue — share NO base class at all. Three are plain
 * classes, one extends `EventEmitter`, and rewriting five inheritance chains to
 * introduce a common ancestor would be a refactor with a security fix hidden
 * inside it, which is the hardest kind to review.
 *
 * So the seam is an OBJECT a store holds, not a class it inherits. Same
 * behaviour, same vocabulary, no inheritance:
 *
 *     private readonly tenancy = new TenantOwnership('automation-rules');
 *
 * WHY THE REGISTRY IS THE MORE IMPORTANT HALF
 *
 * Every audit so far has been a search for stores somebody forgot to bind. That
 * approach finds what the searcher happened to walk, which is exactly why four
 * sweeps each found new subsystems the previous one had missed — the risk was
 * never in the audited code.
 *
 * `assertAllTenantStoresBound()` inverts it. A tenant-sensitive store REGISTERS
 * itself at construction; the composition root asserts, at startup, that every
 * registered store has a scope. A store that is never bound therefore cannot
 * reach a user: the application refuses to start. That converts this entire
 * class of finding from "found by audit" to "cannot ship", which is the only
 * form of the fix that survives the next subsystem nobody thought to check.
 *
 * SYSTEM-GLOBAL STORES ARE DECLARED, NOT ASSUMED. A store that genuinely holds
 * no tenant data calls `declareSystemGlobal()` with a reason. That reason is
 * readable in the registry, so "this one is fine" becomes a claim somebody
 * wrote down rather than an omission nobody noticed.
 */
import type { TenantScope } from '@neuropause/shared';

/** Anything a tenant can own. `tenantId` absent ⇒ unresolved ⇒ nobody's. */
export interface TenantOwned {
  tenantId?: string | null;
}

type Classification = 'tenant-scoped' | 'system-global';

interface Registration {
  name: string;
  classification: Classification;
  reason: string | null;
  hasScope: () => boolean;
}

/**
 * Every store that has declared itself, process-wide.
 *
 * Module-level and deliberately so: registration happens at construction, which
 * is spread across a dozen composition roots, and the assertion happens once at
 * startup. This is a REGISTRY of declarations, not tenant state — it holds no
 * scope, no ids and no data, so it is not the "module-level mutable tenant
 * state" the program forbids.
 */
const registry = new Map<string, Registration>();

/** For tests: forget every registration. Never called in production. */
export function resetTenantStoreRegistryForTests(): void {
  registry.clear();
}

/**
 * Register a store that already OWNS its tenant seam.
 *
 * P13C ROUND 3 — PHASE 4. Eighteen classes in this application implement
 * `bindScope` themselves, most of them long before `TenantOwnership` existed,
 * and only five of them registered. The gate therefore protected five stores
 * while its own doc-comment implied it protected the class.
 *
 * Converting eighteen working stores to hold a `TenantOwnership` would be a
 * large refactor with a security change buried inside it. This is the small
 * alternative: a store keeps its own seam and hands the registry a predicate
 * over it. Registration becomes one line in a constructor, which is cheap enough
 * that there is no excuse for the next store to skip it.
 *
 * `hasScope` is a FUNCTION, not a boolean, because binding happens at a
 * composition root long after construction. Capturing the value here would
 * record every store as unbound forever.
 */
export function registerTenantStore(name: string, hasScope: () => boolean): void {
  registry.set(name, { name, classification: 'tenant-scoped', reason: null, hasScope });
}

/**
 * Register a store that holds NO tenant data, and say why.
 *
 * The reason is mandatory for the same reason it is mandatory on
 * `TenantOwnership.declareSystemGlobal`: "this one is global" is precisely the
 * sentence that has been wrong at every previous round of this program. Written
 * down, it is reviewable; omitted, it is indistinguishable from an oversight.
 */
export function declareSystemGlobalStore(name: string, reason: string): void {
  if (reason.trim() === '') throw new Error(`System-global store ${name} must state its reason.`);
  registry.set(name, { name, classification: 'system-global', reason, hasScope: () => true });
}

/** How many stores are registered, split by classification and binding. */
export function tenantStoreCoverage(): {
  registered: number;
  tenantScoped: number;
  bound: number;
  unbound: number;
  systemGlobal: number;
} {
  const all = [...registry.values()];
  const scoped = all.filter((r) => r.classification === 'tenant-scoped');
  const bound = scoped.filter((r) => r.hasScope());
  return {
    registered: all.length,
    tenantScoped: scoped.length,
    bound: bound.length,
    unbound: scoped.length - bound.length,
    systemGlobal: all.length - scoped.length,
  };
}

/** What is registered, for the migration inventory and the startup report. */
export function tenantStoreRegistrations(): {
  name: string;
  classification: Classification;
  reason: string | null;
  bound: boolean;
}[] {
  return [...registry.values()]
    .map((r) => ({
      name: r.name,
      classification: r.classification,
      reason: r.reason,
      bound: r.hasScope(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * THE STARTUP GATE. Throws when any tenant-scoped store lacks a boundary.
 *
 * Throwing rather than warning, for the reason the sandbox root already states:
 * a store that denies every read is a broken product somebody reports within
 * minutes, while a store that answers every read is a disclosure nobody sees.
 * Between a loud failure and a silent leak, the loud failure is the safe default.
 */
export function assertAllTenantStoresBound(): void {
  const unbound = [...registry.values()]
    .filter((r) => r.classification === 'tenant-scoped' && !r.hasScope())
    .map((r) => r.name);
  if (unbound.length > 0) {
    throw new Error(
      `Tenant-scoped stores have no tenant boundary: ${unbound.sort().join(', ')}. ` +
        'Call bindScope() at the composition root, or declare the store system-global with a reason.',
    );
  }
}

/**
 * The tenant boundary for one store.
 *
 * Holds no data — only the resolver and the store's own name — so a store can
 * own one of these as a private field without any change to how it persists.
 */
export class TenantOwnership {
  private scopeSource: (() => TenantScope | null) | null = null;
  private systemGlobalReason: string | null = null;

  /**
   * @param name  Stable, human-readable. Appears verbatim in the startup error,
   *              so it must be enough to find the store from the message alone.
   */
  constructor(private readonly name: string) {
    registry.set(name, {
      name,
      get classification(): Classification {
        return 'tenant-scoped';
      },
      reason: null,
      hasScope: () => this.scopeSource !== null || this.systemGlobalReason !== null,
    });
  }

  /**
   * Bind the boundary. UNBOUND DENIES. Chainable, matching every other store.
   *
   * THROWS on a non-function, and that is not defensive noise — it is the
   * failure this session actually hit. A composition root passed
   * `deps.scope` where `scope` was `undefined`; `scopeSource` became
   * `undefined`, which is not `null`, so `hasScope()` reported TRUE, the startup
   * gate passed, and the store failed at read time instead.
   *
   * That is the worst of the three possible outcomes: not fail-closed, not
   * fail-open, but "passes every check and breaks later somewhere else". A store
   * that claims a boundary it does not have is exactly what the gate exists to
   * prevent, so a bad bind must be loud at the bind.
   */
  bindScope(source: () => TenantScope | null): this {
    if (typeof source !== 'function') {
      throw new TypeError(
        `bindScope(${String(source)}) on "${this.name}": the tenant boundary must be a resolver function.`,
      );
    }
    this.scopeSource = source;
    return this;
  }

  /**
   * Declare that this store holds no tenant data, and say WHY.
   *
   * The reason is required because "this one is global" is exactly the sentence
   * that was wrong four times. Writing it down makes it reviewable.
   */
  declareSystemGlobal(reason: string): this {
    if (reason.trim() === '') throw new Error('A system-global store must state its reason.');
    this.systemGlobalReason = reason;
    const existing = registry.get(this.name);
    if (existing) {
      registry.set(this.name, {
        name: this.name,
        classification: 'system-global',
        reason,
        hasScope: existing.hasScope,
      });
    }
    return this;
  }

  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The caller's scope, or null. Null means DENY — never "everything". */
  scopeOrDeny(): TenantScope | null {
    return this.scopeSource === null ? null : this.scopeSource();
  }

  /**
   * The tenant a WRITE belongs to, or a refusal.
   *
   * Writes throw where reads return empty: a read with no tenant has an honest
   * empty answer, but a write with no tenant would have to invent an owner, and
   * the row would then be invisible to everyone while still consuming an id and
   * a retention slot.
   */
  requireTenant(): string {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) {
      throw new Error(`No organization is active, so this ${this.name} record has no owner.`);
    }
    return scope.tenantId;
  }

  /** Whether `record` is the caller's. An unowned record belongs to nobody. */
  mine(record: TenantOwned): boolean {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return false;
    const owner = record.tenantId;
    if (typeof owner !== 'string' || owner === '') return false; // pre-migration ⇒ unresolved
    return owner === scope.tenantId;
  }

  /** Only the caller's records. The one filter every read goes through. */
  onlyMine<T extends TenantOwned>(records: readonly T[]): T[] {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [];
    return records.filter((r) => typeof r.tenantId === 'string' && r.tenantId === scope.tenantId);
  }

  /**
   * Stamp a record with the caller's tenant. For writes.
   *
   * Returns a NEW object rather than mutating, so a caller cannot accidentally
   * hand the same object to two stores and have the second stamp overwrite the
   * first's.
   */
  stamp<T extends TenantOwned>(record: T): T {
    return { ...record, tenantId: this.requireTenant() };
  }

  /**
   * Ownership counts across EVERY record, ignoring scope.
   *
   * Deliberately unscoped: this is the migration inventory's evidence that
   * pre-migration rows exist and are visible to nobody. Three integers, no
   * content.
   */
  countOwnership(records: readonly TenantOwned[]): {
    total: number;
    assigned: number;
    unresolved: number;
  } {
    let assigned = 0;
    for (const r of records) if (typeof r.tenantId === 'string' && r.tenantId !== '') assigned += 1;
    return { total: records.length, assigned, unresolved: records.length - assigned };
  }

  /**
   * Evict the CALLER'S oldest record when a cap is exceeded, never anyone else's.
   *
   * P13C Round 2 — install-wide retention was a finding in its own right, and a
   * sharper one than it first appears: the caps are deterministic and
   * oldest-first, so a noisy tenant does not merely consume capacity, it CHOOSES
   * which of another tenant's records is destroyed. For automation rules and
   * executive decisions those are live business objects; for validation runs and
   * artifacts they are the compliance evidence a certification is built from.
   *
   * The cap therefore applies PER TENANT. An install with more tenants holds
   * more rows, which is the honest trade: the alternative is one customer able
   * to delete another's.
   */
  pruneOwn<T extends TenantOwned>(
    records: readonly T[],
    maxPerTenant: number,
    oldestFirst: (a: T, b: T) => number,
  ): T[] {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [...records];
    const tenantId = scope.tenantId;
    const mine = records.filter((r) => r.tenantId === tenantId);
    if (mine.length <= maxPerTenant) return [...records];
    const doomed = new Set(
      [...mine].sort(oldestFirst).slice(0, mine.length - maxPerTenant),
    );
    return records.filter((r) => !doomed.has(r));
  }
}
