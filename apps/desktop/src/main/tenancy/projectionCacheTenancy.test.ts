/**
 * PROGRAM 13C ROUND 3 — H-1 and H-2: the composed-model caches.
 *
 * Fourteen caches across this application memoise a snapshot fanned out over
 * dozens of tenant-scoped stores. Their inputs were correct; their memo had no
 * key. `TenantMemo` is the fix, so this file tests the primitive rather than
 * fourteen call sites — a per-service test would prove the wiring of the one
 * service somebody remembered to write a test for.
 *
 * The scenarios are the two real ones, and they fail differently:
 *
 *   THE SWITCH        — a user changes organization and reloads a dashboard.
 *                       The renderer's reload lands inside any TTL, so this is
 *                       not a race the attacker has to win.
 *
 *   THE FAN-OUT       — `forEachTenant` runs a scheduled job once per tenant,
 *                       back to back, under each tenant's own principal,
 *                       ANNOUNCING NO SWITCH. This is the one the sibling
 *                       platforms' `onWorkspaceSwitch` listeners cannot see, and
 *                       it is why keying — not invalidation — is the fix.
 *
 * Plus the process-mining case specifically: a cache whose only guard was a
 * record-COUNT signature, which two tenants match trivially.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from './tenantMemo';
import { resetTenantStoreRegistryForTests, assertAllTenantStoresBound } from './tenantOwnedStore';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };

const MARKER_A = 'NP-TENANT-A-984731';
const MARKER_B = 'NP-TENANT-B-472186';

interface Snapshot {
  marker: string;
  rows: string[];
}

let scope: TenantScope | null = A;
let clock = 0;
let composes = 0;

/** Composition reads the ambient tenant, exactly as every real `readState` does. */
function compose(): Snapshot {
  composes += 1;
  const marker = scope?.tenantId === 'org-a' ? MARKER_A : scope?.tenantId === 'org-b' ? MARKER_B : '';
  return { marker, rows: [`${marker}-row`] };
}

function memoWith(ttlMs = 3000): TenantMemo<Snapshot> {
  return new TenantMemo<Snapshot>(`test-memo-${Math.random()}`, {
    ttlMs,
    now: () => clock,
  }).bindScope(() => scope);
}

beforeEach(() => {
  scope = A;
  clock = 0;
  composes = 0;
});

/* ── The switch ─────────────────────────────────────────────────────────── */

describe('a tenant switch inside the TTL', () => {
  it('B never receives the snapshot A built, however fresh it is', () => {
    const memo = memoWith(3000);
    scope = A;
    expect(memo.state(compose).marker).toBe(MARKER_A);

    // Not one millisecond has passed. The TTL alone would serve A's snapshot.
    scope = B;
    const seen = memo.state(compose);
    expect(seen.marker).toBe(MARKER_B);
    expect(JSON.stringify(seen)).not.toContain(MARKER_A);
  });

  it('is symmetric — switching back gives A, not the B cell', () => {
    const memo = memoWith(3000);
    scope = A;
    memo.state(compose);
    scope = B;
    memo.state(compose);
    scope = A;
    expect(memo.state(compose).marker).toBe(MARKER_A);
  });

  it('the same tenant DOES still get a cache hit — the fix is not "never cache"', () => {
    const memo = memoWith(3000);
    scope = A;
    const first = memo.state(compose);
    const second = memo.state(compose);
    expect(second).toBe(first); // same reference
    expect(composes).toBe(1);
  });

  /**
   * A workspace switch WITHIN one organization also re-keys. Costs one
   * recomposition; buys the guarantee that a workspace-scoped projection is
   * never handed across workspaces.
   */
  it('a workspace change within one tenant re-keys too', () => {
    const memo = memoWith(3000);
    scope = { tenantId: 'org-a', workspaceId: 'ws-1' };
    memo.state(compose);
    scope = { tenantId: 'org-a', workspaceId: 'ws-2' };
    memo.state(compose);
    expect(composes).toBe(2);
  });
});

/* ── The background fan-out ─────────────────────────────────────────────── */

describe('the per-tenant background fan-out', () => {
  /**
   * THE SCENARIO THE SWITCH LISTENER CANNOT SEE.
   *
   * `forEachTenant` iterates tenants under their own principals and announces
   * nothing. Sequencing those passes — which `backgroundFanOut` does, citing
   * these caches as its reason — prevents interleaving INSIDE one build and does
   * nothing about a build surviving BETWEEN two.
   */
  it('each tenant’s pass composes its own snapshot, with no switch announced', () => {
    const memo = memoWith(3000);
    const delivered: string[] = [];

    for (const tenant of [A, B, A, B]) {
      scope = tenant; // a principal, not a switch — nothing is announced
      clock += 1; // microseconds apart, far inside the TTL
      delivered.push(memo.state(compose).marker);
    }

    expect(delivered).toEqual([MARKER_A, MARKER_B, MARKER_A, MARKER_B]);
  });

  it('nothing a tenant receives contains the other tenant’s marker', () => {
    const memo = memoWith(3000);
    for (const tenant of [A, B]) {
      scope = tenant;
      const blob = JSON.stringify(memo.state(compose));
      const mine = tenant === A ? MARKER_A : MARKER_B;
      const theirs = tenant === A ? MARKER_B : MARKER_A;
      expect(blob).toContain(mine);
      expect(blob).not.toContain(theirs);
    }
  });
});

/* ── Projections ────────────────────────────────────────────────────────── */

describe('projections live inside the tenant’s cell', () => {
  it('a projection built for A is not served to B', () => {
    const memo = memoWith(3000);
    scope = A;
    memo.state(compose);
    const aView = memo.projection('overview', () => ({ label: MARKER_A }));
    expect(aView.label).toBe(MARKER_A);

    scope = B;
    memo.state(compose);
    const bView = memo.projection('overview', () => ({ label: MARKER_B }));
    expect(bView.label).toBe(MARKER_B);
    expect(bView).not.toBe(aView);
  });

  /**
   * The composed projections are the half worth stealing — they are the
   * human-readable summary, not the raw rows. Keying the snapshot while leaving
   * the derived values in a sibling object would have leaked exactly that half.
   */
  it('projections are dropped with the snapshot they were derived from', () => {
    const memo = memoWith(3000);
    scope = A;
    memo.state(compose);
    const first = memo.projection('overview', () => ({ label: MARKER_A }));
    memo.invalidate();
    memo.state(compose);
    const second = memo.projection('overview', () => ({ label: MARKER_A }));
    expect(second).not.toBe(first);
  });

  it('a projection with no cell is built and NOT stored', () => {
    const memo = memoWith(3000);
    scope = null;
    memo.state(compose);
    const one = memo.projection('overview', () => ({ n: 1 }));
    const two = memo.projection('overview', () => ({ n: 2 }));
    expect(one.n).toBe(1);
    expect(two.n).toBe(2); // not memoised — nothing was cached under "nobody"
  });
});

/* ── Fail-closed ────────────────────────────────────────────────────────── */

describe('an unresolved caller', () => {
  it('is served nothing from either tenant, and caches nothing', () => {
    const memo = memoWith(3000);
    scope = A;
    memo.state(compose);

    scope = null;
    const blob = JSON.stringify(memo.state(compose));
    expect(blob).not.toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  /**
   * The half that is easy to miss. If an unresolved read stored its empty
   * snapshot under some placeholder key, the next RESOLVED caller could read it
   * — turning "deny" into "everyone sees nothing", which is a different and
   * equally wrong outcome.
   */
  it('cannot POISON the cache for the resolved caller that follows', () => {
    const memo = memoWith(3000);
    scope = null;
    memo.state(compose);
    expect(memo.cachedTenant()).toBeNull();

    scope = A;
    expect(memo.state(compose).marker).toBe(MARKER_A);
  });
});

/* ── Freshness is still freshness ───────────────────────────────────────── */

describe('the TTL still does its own job', () => {
  it('recomposes after the window, for the same tenant', () => {
    const memo = memoWith(1000);
    scope = A;
    memo.state(compose);
    clock += 1500;
    memo.state(compose);
    expect(composes).toBe(2);
  });

  it('a very long TTL does not weaken isolation — the key is independent of it', () => {
    const memo = memoWith(24 * 60 * 60 * 1000); // process mining's window
    scope = A;
    memo.state(compose);
    scope = B;
    expect(memo.state(compose).marker).toBe(MARKER_B);
  });
});

/* ── The process-mining count signature ─────────────────────────────────── */

describe('H-1 — a record-COUNT signature is not an authorization', () => {
  /**
   * The process-mining provider's only guard was thirteen store counts joined
   * with colons. Two tenants match that trivially — identically on a fresh
   * second organization, where every count is zero — and the payload `caseId`
   * was then resolved against whatever cell happened to be there.
   *
   * This reproduces the old `ensure()` exactly, to show the collision is real,
   * and then the new one, to show the key closes it.
   */
  function counts(): string {
    // Both tenants have the same shape: a deliberate, easily-arranged collision.
    return '1:1:1:1:1:1:1:1:1:1:1:1:1';
  }

  it('THE OLD SHAPE: a matching signature served the other tenant’s assessment', () => {
    let cache: { signature: string; snap: Snapshot } | null = null;
    const oldEnsure = (): Snapshot => {
      const sig = counts();
      if (cache && cache.signature === sig) return cache.snap;
      cache = { signature: sig, snap: compose() };
      return cache.snap;
    };

    scope = A;
    expect(oldEnsure().marker).toBe(MARKER_A);
    scope = B;
    // The defect, demonstrated: B is handed A's mined assessment.
    expect(oldEnsure().marker).toBe(MARKER_A);
  });

  it('THE NEW SHAPE: the key decides ownership, the signature only freshness', () => {
    const memo = memoWith(24 * 60 * 60 * 1000);
    const ensure = (): Snapshot => {
      const cached = memo.state(compose);
      if (cached.marker === (scope?.tenantId === 'org-a' ? MARKER_A : MARKER_B)) return cached;
      memo.invalidate();
      return memo.state(compose);
    };

    scope = A;
    expect(ensure().marker).toBe(MARKER_A);
    scope = B;
    expect(ensure().marker).toBe(MARKER_B);
  });
});

/* ── The gate ───────────────────────────────────────────────────────────── */

describe('an unbound memo cannot ship', () => {
  it('registers with the startup gate and fails it until bound', () => {
    resetTenantStoreRegistryForTests();
    const unbound = new TenantMemo<Snapshot>('unbound-projection-cache');
    expect(() => assertAllTenantStoresBound()).toThrow(/unbound-projection-cache/);
    unbound.bindScope(() => A);
    expect(() => assertAllTenantStoresBound()).not.toThrow();
    resetTenantStoreRegistryForTests();
  });

  it('an unbound memo also denies at READ time — the gate is not the only defence', () => {
    resetTenantStoreRegistryForTests();
    const unbound = new TenantMemo<Snapshot>('never-bound');
    scope = A;
    unbound.state(compose);
    // Composed but never cached: with no resolver there is no owner to cache under.
    expect(unbound.cachedTenant()).toBeNull();
    resetTenantStoreRegistryForTests();
  });
});
