/**
 * PROGRAM 13C ROUND 6 — EDGE-TRIGGER STATE, WITH THREE TENANTS.
 *
 * WHY THESE TESTS ASSERT DELIVERY AND NOT JUST ISOLATION
 *
 * Round 5 shipped a test that asserted a non-seeded organization had zero
 * approval chains, and I read that emptiness as isolation working. It was the
 * breakage. **Empty is not isolation.** A dedupe test is especially prone to it:
 * "B received nothing" is indistinguishable from "B was correctly suppressed"
 * and from "B has no data at all".
 *
 * So every test below establishes that each tenant HAS something, that each
 * tenant RECEIVES its own, and only then that one tenant's state does not reach
 * another. Identical ids across all three tenants throughout, because that is
 * the actual production shape: recommendation ids in this codebase are
 * deterministic constants like `opsrec:capacity:saturated`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantScope } from '@neuropause/shared';
import { TenantDedupe } from '../tenantDedupe';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-c' };

/** The production shape: the same id for every tenant. */
const REC = 'opsrec:capacity:saturated';

let clock = 0;
const now = (): number => clock;

beforeEach(() => {
  clock = 0;
});

function make(opts: { ttlMs?: number; maxPerTenant?: number } = {}): TenantDedupe {
  return new TenantDedupe('test-dedupe', { ...opts, now });
}

/* ── The fan-out ────────────────────────────────────────────────────────── */

describe('the per-tenant fan-out', () => {
  /**
   * THE WHOLE FINDING, IN ONE TEST.
   *
   * Under the old `Set<string>`, A claimed `REC` and B and C were dropped
   * forever. Note that every tenant is asserted to RECEIVE — an assertion that
   * only B and C were "not suppressed" would pass against a dedupe that
   * suppressed nobody because it recorded nothing.
   */
  it('A, B and C each receive the SAME recommendation id', () => {
    const dedupe = make();
    expect(dedupe.claim(A, REC)).toBe(true);
    expect(dedupe.claim(B, REC)).toBe(true);
    expect(dedupe.claim(C, REC)).toBe(true);
  });

  it('and each is suppressed on its OWN second pass — the dedupe still dedupes', () => {
    const dedupe = make();
    for (const tenant of [A, B, C]) {
      expect(dedupe.claim(tenant, REC)).toBe(true);
      expect(dedupe.claim(tenant, REC)).toBe(false);
    }
  });

  it('A marking seen leaves B and C still able to receive', () => {
    const dedupe = make();
    dedupe.markSeen(A, REC);
    expect(dedupe.hasSeen(A, REC)).toBe(true);
    expect(dedupe.hasSeen(B, REC)).toBe(false);
    expect(dedupe.hasSeen(C, REC)).toBe(false);
    expect(dedupe.claim(B, REC)).toBe(true);
    expect(dedupe.claim(C, REC)).toBe(true);
  });

  /**
   * Interleaved rather than sequential. The fan-out is sequential today, but a
   * dedupe that only works because callers happen not to interleave is a
   * property of the caller, not of the dedupe.
   */
  it('interleaved passes keep their own state', () => {
    const dedupe = make();
    const order = [A, B, C, A, B, C, C, B, A];
    const results = order.map((t) => dedupe.claim(t, REC));
    // The first three are firsts; every later pass is a repeat for that tenant.
    expect(results).toEqual([true, true, true, false, false, false, false, false, false]);
  });
});

/* ── Fail toward the duplicate, never toward the silence ────────────────── */

describe('an unresolved caller', () => {
  /**
   * The asymmetry that matters: an unowned pass RE-DELIVERS rather than claiming
   * ids. Claiming would let a background pass with no tenant silently suppress
   * every real tenant — the exact failure this round exists to remove, arriving
   * through the fail-open path instead.
   */
  it('never claims an id, so it cannot suppress a real tenant', () => {
    const dedupe = make();
    expect(dedupe.claim(null, REC)).toBe(true);
    expect(dedupe.claim(null, REC)).toBe(true); // still true — nothing was recorded
    expect(dedupe.hasSeen(A, REC)).toBe(false);
    expect(dedupe.claim(A, REC)).toBe(true);
  });

  it('an empty tenantId is treated as unresolved, not as a tenant named ""', () => {
    const dedupe = make();
    const blank: TenantScope = { tenantId: '', workspaceId: 'ws' };
    dedupe.markSeen(blank, REC);
    expect(dedupe.hasSeen(blank, REC)).toBe(false);
    expect(dedupe.claim(A, REC)).toBe(true);
  });
});

/* ── Retention: eviction may re-deliver, never suppress ─────────────────── */

describe('retention is per tenant', () => {
  it('the TTL expires an entry and re-delivery resumes — for that tenant only', () => {
    const dedupe = make({ ttlMs: 1_000 });
    dedupe.markSeen(A, REC);
    dedupe.markSeen(B, REC);

    clock += 1_500;
    expect(dedupe.hasSeen(A, REC)).toBe(false); // expired → A is told again
    expect(dedupe.claim(A, REC)).toBe(true);
    // And B expiring is B's own business, not a consequence of A.
    expect(dedupe.hasSeen(B, REC)).toBe(false);
  });

  /**
   * THE EVICTION RULE, STATED AS A TEST.
   *
   * A noisy tenant filling its bucket must evict its OWN oldest entries and
   * nobody else's. A global cap would push a quiet tenant's entry out — which is
   * cross-tenant suppression arriving through the retention policy rather than
   * through the key, and it is subtle enough that fixing isolation while
   * introducing it would look like success.
   */
  it('a noisy tenant evicts its OWN oldest, never a quiet tenant’s', () => {
    const dedupe = make({ maxPerTenant: 3 });

    dedupe.markSeen(B, 'b-only');
    expect(dedupe.hasSeen(B, 'b-only')).toBe(true);

    for (let i = 0; i < 50; i += 1) {
      clock += 1;
      dedupe.markSeen(A, `a-${i}`);
    }

    // B is untouched by A's 50 writes.
    expect(dedupe.hasSeen(B, 'b-only')).toBe(true);
    // A kept only its most recent three.
    expect(dedupe.hasSeen(A, 'a-49')).toBe(true);
    expect(dedupe.hasSeen(A, 'a-0')).toBe(false);
    expect(dedupe.stats().entries).toBe(4); // 3 of A's + 1 of B's
  });

  it('eviction causes RE-DELIVERY, which is the acceptable failure', () => {
    const dedupe = make({ maxPerTenant: 1 });
    dedupe.markSeen(A, 'first');
    clock += 1;
    dedupe.markSeen(A, 'second');
    // 'first' was evicted, so A will be told about it again. A duplicate
    // notification is the cost; a silent drop would not have been.
    expect(dedupe.claim(A, 'first')).toBe(true);
  });

  it('memory is bounded across many tenants', () => {
    const dedupe = make({ maxPerTenant: 2 });
    for (let t = 0; t < 25; t += 1) {
      const tenant: TenantScope = { tenantId: `org-${t}`, workspaceId: 'w' };
      for (let i = 0; i < 20; i += 1) {
        clock += 1;
        dedupe.markSeen(tenant, `rec-${i}`);
      }
    }
    const stats = dedupe.stats();
    expect(stats.tenants).toBe(25);
    expect(stats.entries).toBe(50); // 25 tenants × 2, not 25 × 20
  });
});

/* ── Sign-out and switching ─────────────────────────────────────────────── */

describe('clearing', () => {
  it('clearing A does not clear B or C', () => {
    const dedupe = make();
    for (const t of [A, B, C]) dedupe.markSeen(t, REC);
    dedupe.clear(A);
    expect(dedupe.hasSeen(A, REC)).toBe(false);
    expect(dedupe.hasSeen(B, REC)).toBe(true);
    expect(dedupe.hasSeen(C, REC)).toBe(true);
  });

  it('clearing an unresolved scope clears nothing', () => {
    const dedupe = make();
    dedupe.markSeen(A, REC);
    dedupe.clear(null);
    expect(dedupe.hasSeen(A, REC)).toBe(true);
  });

  /**
   * Switching organizations is not an event this primitive observes, and it does
   * not need to be: state is addressed by tenant, so switching to B reads B's
   * bucket and switching back reads A's, unchanged.
   */
  it('A → B → C → A returns each tenant’s own state', () => {
    const dedupe = make();
    dedupe.markSeen(A, 'a-rec');
    dedupe.markSeen(B, 'b-rec');

    expect(dedupe.hasSeen(B, 'a-rec')).toBe(false);
    expect(dedupe.hasSeen(C, 'a-rec')).toBe(false);
    expect(dedupe.hasSeen(C, 'b-rec')).toBe(false);
    expect(dedupe.hasSeen(A, 'a-rec')).toBe(true);
    expect(dedupe.hasSeen(B, 'b-rec')).toBe(true);
  });

  it('stats report counts, never ids', () => {
    const dedupe = make();
    dedupe.markSeen(A, 'SECRET-REC-NAME');
    expect(JSON.stringify(dedupe.stats())).not.toContain('SECRET-REC-NAME');
    expect(dedupe.stats()).toEqual({ name: 'test-dedupe', tenants: 1, entries: 1 });
  });
});
