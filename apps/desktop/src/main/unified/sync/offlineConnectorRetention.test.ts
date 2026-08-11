/**
 * PROGRAM 13C ROUND 7 — THE OFFLINE EDGE: BOUNDED, PER TENANT, NEVER SILENT.
 *
 * WHAT THIS GUARDS
 *
 * `connector.offline` is what `eventNotifications` turns into a `connector-issue`
 * inbox item. It is the only way a tenant learns their data pipeline has stopped.
 * Round 6 found it keyed on the bare `connectorId`, so the first workspace whose
 * GitHub failed claimed `'github'` and every other tenant's failure published
 * nothing — the tenant was simply never told, and a missing alert is
 * indistinguishable from health.
 *
 * Round 6 fixed the key and left the structure unbounded. This round bounds it,
 * which introduces eviction — and eviction is exactly where the original bug
 * would come back wearing a retention policy. So these tests assert the
 * DIRECTION of every failure:
 *
 *   eviction  → the tenant is told AGAIN (a duplicate notice)
 *   never     → the tenant is not told (silence)
 *
 * Duplicate is the acceptable failure. Silence is the defect.
 *
 * These exercise `TenantDedupe` through the orchestrator's exact usage — the
 * scope shape, the composite account id, `claim`/`hasSeen`/`forget` in the same
 * order the sync path calls them — rather than the orchestrator itself, which
 * would need an entire connector world stood up to observe one boolean. The
 * primitive's own suite proves the primitive; this proves the USE.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import { TenantDedupe } from '../../tenancy/tenantDedupe';

/** The scope shape `SyncOrchestrator.offlineScope()` builds. */
const scopeFor = (tenantId: string | null): TenantScope | null =>
  tenantId === null ? null : { tenantId, workspaceId: '' };

const A = scopeFor('org-alpha');
const B = scopeFor('org-bravo');
const C = scopeFor('org-charlie');

/** The composite id `SyncOrchestrator.accountKey()` builds. */
const key = (connectorId: string, accountId: string): string => `${connectorId}::${accountId}`;

let clock = 0;
beforeEach(() => {
  clock = 0;
});

/** The orchestrator's real configuration. */
function offline(opts: { ttlMs?: number; maxPerTenant?: number } = {}): TenantDedupe {
  return new TenantDedupe('sync-offline-announced', {
    ttlMs: opts.ttlMs ?? 12 * 60 * 60 * 1000,
    maxPerTenant: opts.maxPerTenant ?? 500,
    now: () => clock,
  });
}

/* ── Isolation ───────────────────────────────────────────────────────────── */

describe('three tenants, the same connector', () => {
  /**
   * THE ROUND 6 FINDING, RE-ASSERTED AGAINST THE BOUNDED VERSION.
   *
   * Each tenant has its own GitHub account, and each must be told when its own
   * goes down. Asserting only that B "was not suppressed" would pass against a
   * dedupe that suppressed nobody because it recorded nothing.
   */
  it('each is announced its OWN outage, and each is deduped on its own repeat', () => {
    const d = offline();
    expect(d.claim(A, key('github', 'acct-a'))).toBe(true);
    expect(d.claim(B, key('github', 'acct-b'))).toBe(true);
    expect(d.claim(C, key('github', 'acct-c'))).toBe(true);

    // The second tick does not re-announce — the dedupe still dedupes.
    expect(d.claim(A, key('github', 'acct-a'))).toBe(false);
    expect(d.claim(B, key('github', 'acct-b'))).toBe(false);
    expect(d.claim(C, key('github', 'acct-c'))).toBe(false);
  });

  /**
   * Two workspaces sharing an account id would be a bug in a different layer, but
   * the boundary must hold even then: the tenant is in the key, so the same id
   * under two tenants is two facts.
   */
  it('an identical account id under two tenants does not collide', () => {
    const d = offline();
    expect(d.claim(A, key('github', 'shared-id'))).toBe(true);
    expect(d.claim(B, key('github', 'shared-id'))).toBe(true);
    expect(d.hasSeen(A, key('github', 'shared-id'))).toBe(true);
    expect(d.hasSeen(C, key('github', 'shared-id'))).toBe(false);
  });

  it('two accounts of the SAME provider in one tenant are announced separately', () => {
    // The pre-Round-6 bug had no tenancy in it at all: `Set<connectorId>` also
    // collapsed a tenant's two GitHub accounts into one alert.
    const d = offline();
    expect(d.claim(A, key('github', 'work'))).toBe(true);
    expect(d.claim(A, key('github', 'personal'))).toBe(true);
  });
});

/* ── Recovery ────────────────────────────────────────────────────────────── */

describe('recovery', () => {
  it('clearing A’s edge re-arms A and leaves B and C armed', () => {
    const d = offline();
    for (const [t, a] of [
      [A, 'acct-a'],
      [B, 'acct-b'],
      [C, 'acct-c'],
    ] as const) {
      d.claim(t, key('github', a));
    }

    expect(d.forget(A, key('github', 'acct-a'))).toBe(true);
    // A will be told again if it fails again…
    expect(d.claim(A, key('github', 'acct-a'))).toBe(true);
    // …and B and C are untouched: still deduped, not re-announced.
    expect(d.hasSeen(B, key('github', 'acct-b'))).toBe(true);
    expect(d.hasSeen(C, key('github', 'acct-c'))).toBe(true);
  });

  /**
   * `forget` reports whether anything was there, and the orchestrator publishes
   * `connector.online` only when it was. A recovery notice sent to a tenant that
   * never saw the failure would be a small leak of another tenant's operational
   * state, and a confusing one.
   */
  it('forgetting something this tenant never had reports false', () => {
    const d = offline();
    d.claim(A, key('github', 'acct-a'));
    expect(d.forget(B, key('github', 'acct-a'))).toBe(false);
    expect(d.forget(C, key('github', 'acct-c'))).toBe(false);
    // A's edge survived B's and C's attempts.
    expect(d.hasSeen(A, key('github', 'acct-a'))).toBe(true);
  });
});

/* ── Retention ───────────────────────────────────────────────────────────── */

describe('bounded retention', () => {
  it('the TTL re-announces a still-broken connector, per tenant', () => {
    const d = offline({ ttlMs: 12 * 60 * 60 * 1000 });
    d.claim(A, key('slack', 'acct-a'));
    d.claim(B, key('slack', 'acct-b'));

    clock += 11 * 60 * 60 * 1000; // still inside the window
    expect(d.claim(A, key('slack', 'acct-a'))).toBe(false); // not nagged hourly

    clock += 2 * 60 * 60 * 1000; // now past 12h
    expect(d.claim(A, key('slack', 'acct-a'))).toBe(true); // told again
    // B's clock is B's own — A crossing the boundary is not an event for B.
    expect(d.claim(B, key('slack', 'acct-b'))).toBe(true);
  });

  /**
   * THE EVICTION RULE. A global cap would let one tenant's volume push another
   * tenant's entry out. Here that would only cause a duplicate notice rather than
   * silence — but the cost still lands on the wrong tenant, and a cap that
   * crosses the boundary is the shape this program has removed three times.
   */
  it('a tenant with many broken connectors evicts its OWN oldest, never another’s', () => {
    const d = offline({ maxPerTenant: 3 });

    d.claim(B, key('notion', 'quiet-b'));
    expect(d.hasSeen(B, key('notion', 'quiet-b'))).toBe(true);

    for (let i = 0; i < 50; i += 1) {
      clock += 1;
      d.claim(A, key('github', `acct-${i}`));
    }

    // B is untouched by A's fifty failures.
    expect(d.hasSeen(B, key('notion', 'quiet-b'))).toBe(true);
    // A kept its most recent, dropped its oldest.
    expect(d.hasSeen(A, key('github', 'acct-49'))).toBe(true);
    expect(d.hasSeen(A, key('github', 'acct-0'))).toBe(false);
    expect(d.stats().entries).toBe(4); // A's 3 + B's 1
  });

  it('eviction causes RE-ANNOUNCEMENT, never silence', () => {
    const d = offline({ maxPerTenant: 1 });
    d.claim(A, key('github', 'first'));
    clock += 1;
    d.claim(A, key('slack', 'second'));
    // 'first' was evicted, so its next failure is announced again. A duplicate
    // inbox item is the cost. A missing one would not have been.
    expect(d.claim(A, key('github', 'first'))).toBe(true);
  });

  it('memory is bounded across many tenants', () => {
    const d = offline({ maxPerTenant: 2 });
    for (let t = 0; t < 30; t += 1) {
      for (let i = 0; i < 10; i += 1) {
        clock += 1;
        d.claim(scopeFor(`org-${t}`), key('github', `acct-${i}`));
      }
    }
    expect(d.stats()).toEqual({ name: 'sync-offline-announced', tenants: 30, entries: 60 });
  });
});

/* ── Unresolved and interleaved ──────────────────────────────────────────── */

describe('a run with no resolved tenant', () => {
  /**
   * `activeTenantId()` returning null STOPS a sync run, so this should not arise.
   * Asserted anyway, because the guarantee must not depend on a caller elsewhere
   * behaving: an unowned pass must never claim ids, or it would suppress every
   * real tenant through the fail-open path.
   */
  it('never claims, so it cannot suppress a real tenant', () => {
    const d = offline();
    expect(d.claim(null, key('github', 'acct-a'))).toBe(true);
    expect(d.claim(null, key('github', 'acct-a'))).toBe(true); // nothing recorded
    expect(d.hasSeen(A, key('github', 'acct-a'))).toBe(false);
    expect(d.claim(A, key('github', 'acct-a'))).toBe(true); // A is still told
  });
});

describe('interleaved runs', () => {
  /**
   * `forEachTenantBackground(..., { perWorkspace: true })` runs tenants back to
   * back with no switch announced. Sequential today — but a structure that only
   * works because callers happen not to interleave is a property of the caller.
   */
  it('A/B/C interleaved keep their own edges', () => {
    const d = offline();
    const order = [A, B, C, A, B, C, C, A, B];
    const ids = ['github::x', 'github::x', 'github::x', 'github::x', 'github::x', 'github::x', 'github::x', 'github::x', 'github::x'];
    const results = order.map((t, i) => d.claim(t, ids[i]!));
    expect(results).toEqual([true, true, true, false, false, false, false, false, false]);
  });

  it('a recovery interleaved with another tenant’s failure does not cross', () => {
    const d = offline();
    d.claim(A, key('github', 'acct-a'));
    d.claim(B, key('github', 'acct-b'));

    d.forget(A, key('github', 'acct-a')); // A recovers…
    // …while B is still down, and stays deduped.
    expect(d.hasSeen(B, key('github', 'acct-b'))).toBe(true);
    expect(d.claim(B, key('github', 'acct-b'))).toBe(false);
  });
});
