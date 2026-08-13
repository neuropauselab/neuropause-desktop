/**
 * PROGRAM 13C ROUND 3 — regressions for the findings the SWEEP found, after the
 * planned work was already done.
 *
 * Every case here was discovered by the adversarial pass run at the end of this
 * session, not by the plan that started it. Two of them are in code this session
 * wrote, which is the part worth stating plainly: a new mechanism is not safer
 * than the code it replaces until somebody has attacked it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { TenantMemo } from '../tenantMemo';
import { TenantOwnership } from '../tenantOwnedStore';
import { createFeedbackStore } from '../../feedback/feedbackService';
import { GatewayStore } from '../../ecosystem/gateway/gatewayStore';
import { DeveloperStore } from '../../ecosystem/developer/developerStore';
import { MARKER_A, MARKER_B, TENANT_A, TENANT_B } from './twoTenantFixture';

let scope: TenantScope | null = TENANT_A;

/* ── The hole in the memo primitive itself ──────────────────────────────── */

describe('TenantMemo — the projection cell cannot outlive its tenant', () => {
  interface Snap {
    marker: string;
  }
  function make(): TenantMemo<Snap> {
    return new TenantMemo<Snap>(`sweep-${randomUUID()}`).bindScope(() => scope);
  }
  const compose = (): Snap => ({
    marker: scope?.tenantId === TENANT_A.tenantId ? MARKER_A : scope?.tenantId ? MARKER_B : '',
  });

  beforeEach(() => {
    scope = TENANT_A;
  });

  /**
   * THE BUG THE SWEEP FOUND IN THIS SESSION'S OWN CODE.
   *
   * `state()` returned early for an unresolved caller without clearing the
   * cell, and `projection()` read `this.cell` directly. So the previous
   * RESOLVED tenant's composed projections — the human-readable half — were
   * handed to the unresolved caller. The snapshot was keyed and the values
   * derived from it were not.
   */
  it('an unresolved caller cannot read the previous tenant’s projection', () => {
    const memo = make();
    scope = TENANT_A;
    memo.state(compose);
    expect(memo.projection('view', () => ({ label: MARKER_A })).label).toBe(MARKER_A);

    scope = null;
    memo.state(compose);
    expect(memo.cachedTenant()).toBeNull();
    const seen = memo.projection('view', () => ({ label: 'REBUILT' }));
    expect(seen.label).toBe('REBUILT');
    expect(JSON.stringify(seen)).not.toContain(MARKER_A);
  });

  /**
   * The second half. `projection()` re-checks the key rather than trusting the
   * convention that `state()` was called first — because the sweep found one
   * call site of seventy-nine that skipped it.
   */
  it('a caller who skips state() cannot read or poison another tenant’s cell', () => {
    const memo = make();
    scope = TENANT_A;
    memo.state(compose);
    memo.projection('view', () => ({ label: MARKER_A }));

    scope = TENANT_B; // switched, and deliberately NOT calling state()
    const seen = memo.projection('view', () => ({ label: MARKER_B }));
    expect(seen.label).toBe(MARKER_B);

    scope = TENANT_A; // A's cell must be unchanged, not overwritten by B's build
    memo.state(compose);
    expect(memo.projection('view', () => ({ label: 'SHOULD-NOT-BUILD' })).label).toBe(MARKER_A);
  });
});

/* ── A bad bind must be loud at the bind ────────────────────────────────── */

describe('bindScope refuses a non-function', () => {
  /**
   * A composition root passed `deps.scope` where `scope` was undefined.
   * `scopeSource` became `undefined`, which is not `null`, so `hasScope()`
   * reported TRUE and the startup gate passed — then reads threw. Passing every
   * check and failing later is the worst of the three outcomes.
   */
  it('throws, naming the store, rather than reporting a boundary it does not have', () => {
    const t = new TenantOwnership('sweep-bad-bind');
    expect(() => t.bindScope(undefined as unknown as () => TenantScope | null)).toThrow(
      /sweep-bad-bind/,
    );
    expect(t.hasScope()).toBe(false);
  });
});

/* ── Feedback ───────────────────────────────────────────────────────────── */

describe('user feedback is tenant-owned', () => {
  let dir: string;
  let store: ReturnType<typeof createFeedbackStore>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-fb-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    store = createFeedbackStore({ filePath: join(dir, 'feedback.json') }).bindScope(() => scope);
    await store.load();
    scope = TENANT_A;
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  async function seedBoth(): Promise<void> {
    scope = TENANT_A;
    await store.submit({ category: 'idea', message: `Feedback ${MARKER_A}` });
    scope = TENANT_B;
    await store.submit({ category: 'idea', message: `Feedback ${MARKER_B}` });
    scope = TENANT_A;
  }

  it('A lists only A’s feedback — the message is free text a user typed', async () => {
    await seedBoth();
    const blob = JSON.stringify(store.list());
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  /** `exportAll` is the one path whose result leaves userData. */
  it('the EXPORT — which is written to an arbitrary path — carries only A’s entries', async () => {
    await seedBoth();
    const blob = JSON.stringify(store.exportAll());
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  it('A cannot CLEAR B’s feedback', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(await store.clear()).toBe(1);
    scope = TENANT_B;
    expect(store.list()).toHaveLength(1);
  });

  it('an unresolved caller reads nothing and cannot submit', async () => {
    await seedBoth();
    scope = null;
    expect(store.list()).toEqual([]);
    expect(store.exportAll().entries).toEqual([]);
    await expect(store.submit({ category: 'idea', message: 'x' })).rejects.toThrow(/no owner/i);
  });
});

/* ── Gateway quota and retention ────────────────────────────────────────── */

describe('gateway counters and retention are per tenant', () => {
  let dir: string;
  let gateway: GatewayStore;
  const rate = { max: 1000, windowMs: 60_000 };
  const quota = { max: 100, period: 'month' as const };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-gwq-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    gateway = new GatewayStore(join(dir, 'gw.json'), { auditCap: 3 }).bindScope(() => scope);
    await gateway.load();
    scope = TENANT_A;
  });
  afterEach(async () => {
    await gateway.flush().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  /**
   * The ENFORCEMENT half of the quota, which the usage-ledger fix missed
   * because the two live in different files. `decideGateway` denies on
   * `quotaRemaining`, so a shared counter is a cross-tenant denial of service.
   */
  it('A burning the monthly quota does not deny B', () => {
    const now = Date.parse('2026-08-11T00:00:00.000Z');
    for (let i = 0; i < 50; i += 1) {
      gateway.commit('key-a', 'dev-owner', rate, quota, now, TENANT_A.tenantId);
    }
    expect(gateway.peek('key-a', 'dev-owner', rate, quota, now, TENANT_A.tenantId).quotaUsed).toBe(50);
    expect(gateway.peek('key-b', 'dev-owner', rate, quota, now, TENANT_B.tenantId).quotaUsed).toBe(0);
  });

  /**
   * P13C ROUND 9 — F13. THIS TEST USED TO ASSERT THE FINDING.
   *
   * As written for Round 8 it ended `expect(gateway.auditEntries(100)).toHaveLength(0)`
   * for tenant B after tenant A's traffic — B's audit row destroyed by a
   * neighbour, asserted as correct because "the hash chain only permits dropping
   * from the front". The chain constraint was real; the conclusion was not. One
   * chain PER TENANT makes the caller's oldest row the front of the caller's own
   * chain, so retention no longer reaches anybody else.
   *
   * The test is not weakened to accommodate that: the counts are the same
   * fixture, the assertions are stricter (B's row is now asserted to SURVIVE,
   * by identity), and the cross-owner case runs past the point where the old
   * "floor" gave out.
   */
  it('A’s traffic cannot evict B’s audit row, however long it runs', () => {
    const at = (n: number): string => `2026-08-11T00:00:${String(n).padStart(2, '0')}.000Z`;
    const row = (tenantId: string, i: number): string =>
      gateway.record({
        at: at(i),
        tenantId,
        keyId: null,
        developerId: 'dev-owner',
        method: 'GET',
        path: `/v1/${tenantId}`,
        version: 'v1',
        status: 200,
        reason: 'ok',
        latencyMs: 1,
      }).id;

    const bRow = row(TENANT_B.tenantId, 0); // B's single, OLDEST row on the install
    for (let i = 1; i <= 5; i += 1) row(TENANT_A.tenantId, i);

    // A is held to ITS OWN cap of 3 — it evicted two of its own — and B, which
    // owns the oldest row on the whole install, has lost nothing.
    scope = TENANT_B;
    expect(gateway.auditEntries(100)).toHaveLength(1);
    scope = TENANT_A;
    expect(gateway.auditEntries(100)).toHaveLength(3);
    expect(gateway.verifyAuditIntegrity().ok).toBe(true);

    // Well past the point where the Round 8 "floor" gave out and started taking
    // B's row. Eviction is now front-of-A's-own-chain, so B is untouchable.
    for (let i = 6; i <= 12; i += 1) row(TENANT_A.tenantId, i);
    scope = TENANT_B;
    const survived = gateway.auditEntries(100);
    expect(survived).toHaveLength(1);
    expect(survived[0]?.id).toBe(bRow);
    scope = TENANT_A;
    expect(gateway.auditEntries(100)).toHaveLength(3);
    expect(gateway.verifyAuditIntegrity().ok).toBe(true);
    expect(gateway.totalAudit()).toBe(13);
  });
});

/* ── Usage retention, without the install-wide fallback ─────────────────── */

describe('developer usage retention has no install-wide fallback', () => {
  let dir: string;
  let developers: DeveloperStore;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-usage-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    developers = new DeveloperStore(join(dir, 'dev.json'), {
      id: 'dev-owner',
      name: 'Owner',
      email: 'o@x.io',
      organization: 'X',
      orgId: 'org-seed',
    }).bindScope(() => scope);
    await developers.load();
    scope = TENANT_A;
  });
  afterEach(async () => {
    await developers.flush().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  /**
   * The first version of the H-3 fix pruned per tenant and then fell back to an
   * install-wide `slice()` if the array was still over the cap. With two
   * tenants under the cap each, the prune is a no-op and the fallback deletes
   * the other tenant's oldest billing rows. The fallback quietly restored the
   * defect the prune removed.
   */
  it('A’s traffic never deletes B’s billing rows', () => {
    scope = TENANT_B;
    developers.recordUsage({
      developerId: 'dev-owner',
      apiKeyId: null,
      at: '2020-01-01T00:00:00.000Z', // the OLDEST row on the install, by five years
      method: 'GET',
      path: '/v1/b',
      version: 'v1',
      status: 200,
      latencyMs: 1,
      computeUnits: 1,
    });

    scope = TENANT_A;
    for (let i = 0; i < 500; i += 1) {
      developers.recordUsage({
        developerId: 'dev-owner',
        apiKeyId: null,
        at: new Date(Date.parse('2026-08-11T00:00:00.000Z') + i).toISOString(),
        method: 'GET',
        path: '/v1/a',
        version: 'v1',
        status: 200,
        latencyMs: 1,
        computeUnits: 1,
      });
    }

    scope = TENANT_B;
    expect(developers.countSince('dev-owner', 0)).toBe(1);
  });
});
