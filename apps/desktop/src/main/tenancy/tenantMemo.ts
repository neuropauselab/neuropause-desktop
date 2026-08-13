/**
 * A MEMOISED PROJECTION THAT CANNOT BE SERVED TO THE WRONG TENANT.
 *
 * WHAT WAS ACTUALLY WRONG
 *
 * This application computes roughly two dozen composed read models — operations
 * overviews, strategy portfolios, process-mining assessments, trust scores — by
 * fanning out reads across dozens of stores and memoising the result behind a
 * short TTL. Every one of those stores is now tenant-scoped, so the COMPOSITION
 * is correct: a snapshot built while tenant A is active contains only A's data.
 *
 * The defect was never the composition. It was that the memo had no key. A
 * snapshot built for A sat in a `let cache` variable and was handed to whoever
 * asked next.
 *
 * WHY THE TWO EXISTING MITIGATIONS ARE BOTH INSUFFICIENT
 *
 * 1. TTL. A 2.5-3 second window is not an authorization boundary, it is a race
 *    the attacker does not even have to win quickly. The renderer's reload after
 *    an organization switch lands inside it, which makes "switch org, open
 *    dashboard" — the single most common action on a multi-tenant install — the
 *    exploit.
 *
 * 2. SWITCH INVALIDATION. Dropping the cache when the user switches organization
 *    closes the interactive path, and it is worth keeping. But it assumes every
 *    tenant change is a SWITCH, and the background fan-out is a counterexample:
 *    `forEachTenant` runs a job once per tenant under each tenant's own
 *    principal, back to back, announcing nothing. Tenant A's pass builds the
 *    memo; tenant B's pass — microseconds later, well inside any TTL, with no
 *    switch to observe — reads it. `backgroundFanOut` runs those passes
 *    SEQUENTIALLY and its comment claims that is what keeps the caches safe. It
 *    is not: sequencing stops two tenants interleaving inside one build, and
 *    does nothing about the build persisting across the boundary between them.
 *
 * So the key is the fix and the other two are defence in depth. This class makes
 * the keyed form the easy one to write, because the unkeyed form is what
 * everybody wrote by hand twenty-odd times.
 *
 * FAIL-CLOSED IS "DO NOT CACHE"
 *
 * When no tenant resolves, the snapshot is composed fresh and NEVER STORED. An
 * unresolved caller therefore cannot be served anybody's cache, and — the half
 * that is easy to miss — cannot POISON the cache for the resolved caller who
 * comes next.
 */
import type { TenantScope } from '@neuropause/shared';
import { tenantKey } from '@neuropause/shared';
import { TenantOwnership } from './tenantOwnedStore';

interface Cell<S> {
  /** The tenant this snapshot was composed for. Never null — null is not cached. */
  key: string;
  atMs: number;
  snapshot: S;
  /** Projections derived from THIS snapshot, and therefore from this tenant. */
  projections: Map<string, unknown>;
}

export interface TenantMemoOptions {
  /**
   * Freshness window in ms. Upstream sources change without emitting an event,
   * so a TTL still earns its place — as a FRESHNESS mechanism. It is not, and
   * must never be described as, an isolation mechanism.
   */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class TenantMemo<S> {
  private readonly tenancy: TenantOwnership;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cell: Cell<S> | null = null;

  /**
   * @param name Stable and human-readable. It appears verbatim in the startup
   *             error when this memo is never bound, so it has to be enough to
   *             find the file from the message alone.
   */
  constructor(name: string, opts: TenantMemoOptions = {}) {
    this.tenancy = new TenantOwnership(name);
    this.ttlMs = opts.ttlMs ?? 3000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * WHY THIS CLASS DOES NOT REGISTER AN `onWorkspaceSwitch` LISTENER.
   *
   * The obvious move is to also drop the cell whenever the application announces
   * a switch, and call it defence in depth. It is not defence: after a switch,
   * `scopeOrDeny()` returns the new tenant, the key differs, and the cell is
   * recomposed on the very next read. The listener could not change an outcome.
   *
   * What it WOULD change is that every construction of a memo appends a
   * permanent entry to a module-level listener array with no removal API, which
   * in a test suite constructing services thousands of times is a real leak. A
   * no-op that leaks, added so the diff looks more thorough, is worse than
   * nothing — and it is the same species of mistake as the TTL: a mechanism
   * described as protection that protects against nothing.
   *
   * Subsystems that hold OTHER tenant-derived state keep their own switch
   * listeners. Those are about state this class does not own.
   */

  /** Bind the boundary. An unbound memo fails the startup gate. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }

  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  /** Drop everything. For backing-store change events and `dispose()`. */
  invalidate(): void {
    this.cell = null;
  }

  /** The tenant whose snapshot is currently held, or null. For tests and reports. */
  cachedTenant(): string | null {
    return this.cell?.key ?? null;
  }

  /**
   * The snapshot for the CALLER'S tenant.
   *
   * Recomposes when the cell is absent, stale, or — the line this class exists
   * for — belongs to somebody else.
   */
  state(compose: () => S): S {
    const key = this.key();
    if (key === null) {
      /**
       * No tenant resolved. Compose, answer, store NOTHING — and DROP the cell.
       *
       * The drop is the part the first version of this class got wrong. It
       * returned early without touching `this.cell`, so the previous resolved
       * tenant's cell survived, and `projection()` — which reads `this.cell`
       * directly — would hand that tenant's composed projections to the
       * unresolved caller. The snapshot was keyed and the values derived from it
       * were not, which is precisely the defect this class exists to remove, one
       * level down.
       *
       * Found by the adversarial sweep of this same session, in the primitive
       * the whole round rests on. Worth recording plainly: a new mechanism is
       * not safer than the code it replaces until someone has attacked it.
       *
       * The composing reads are themselves scoped and will return empty, so the
       * answer is an honest empty one rather than a refusal — matching how every
       * other unresolved read in this program behaves.
       */
      this.cell = null;
      return compose();
    }
    const t = this.now();
    const c = this.cell;
    if (c !== null && c.key === key && t - c.atMs < this.ttlMs) return c.snapshot;
    const snapshot = compose();
    this.cell = { key, atMs: t, snapshot, projections: new Map() };
    return snapshot;
  }

  /**
   * A projection memoised INSIDE the caller's own cell.
   *
   * Intended to be called immediately after `state()`, which establishes the
   * cell — but it does NOT trust that. The key is re-checked here.
   *
   * WHY THE RE-CHECK, WHEN THE CONVENTION ALREADY SAYS TO CALL `state()` FIRST.
   *
   * Because a convention is a comment. The sweep of this session found one
   * caller of seventy-nine that skipped `state()` — `developerPlatformService.
   * templates()` — and it happened to build from a static catalogue, so it was
   * harmless. The next one will not be. A convention that is violated 1.3% of
   * the time and is load-bearing for tenant isolation is not a control, so the
   * check moved into the method that depends on it.
   *
   * A caller whose key does not match the cell gets a freshly built value that
   * is NOT stored, so it can neither read the other tenant's projection nor
   * write its own into that tenant's cell.
   */
  projection<V>(name: string, build: () => V): V {
    const c = this.cell;
    if (c === null || c.key !== this.key()) return build();
    if (c.projections.has(name)) return c.projections.get(name) as V;
    const value = build();
    c.projections.set(name, value);
    return value;
  }

  /**
   * The caller's cache key, or null when nothing resolves.
   *
   * Both halves of the scope are in the key. A background principal carries an
   * empty workspace where an interactive session carries a real one, so the two
   * get separate cells even within a tenant. That costs a recomposition and buys
   * the guarantee that a workspace-scoped projection is never handed across
   * workspaces — the cheaper trade by a wide margin.
   */
  private key(): string | null {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return null;
    return tenantKey(scope);
  }
}
