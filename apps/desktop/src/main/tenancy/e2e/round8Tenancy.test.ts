/**
 * PROGRAM 13C ROUND 8 — THREE TENANTS AGAINST WHAT THE SCOPE GATE FOUND.
 *
 * WHY THIS SUITE EXISTS AT ALL
 *
 * Round 8's primary objective was structural: make it impossible to add a
 * persistent store without declaring a scope. The gate was built first, and the
 * moment it ran it produced twenty-one undeclared persistent stores and, in
 * classifying them, SIX FINDINGS — four customer-derived stores with no working
 * filter, two false globals, and four more install-wide retention caps.
 *
 * That is the argument for the mechanism, and this suite is the argument that the
 * fixes are real. Every test uses THREE tenants with DIFFERENT, POSITIVE data and
 * deliberately COLLIDING ids, because:
 *
 *   - two tenants cannot distinguish "A leaks to B" from "the pair share one slot"
 *   - identical ids across tenants are the production shape, and the shape that
 *     found `platformId:accountId`, `workspace-default` and `profileKey ?? 'default'`
 *   - a count of zero is not a count: Finding 7 was a dead feature whose isolation
 *     tests passed because zero equals zero on both sides
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { AutomationRunHistory } from '../../enterprise/automationRunHistory';
import { DEFAULT_ORG_POLICY, OrgPolicyStore } from '../../marketplace/orgPolicyStore';
import { CompanionDeviceStore } from '../../companion/deviceRegistryStore';
import { WorkerRegistry } from '../../workforce/registry/workerRegistry';
import { MappingMemoryStore } from '../../dataPlane/mappingMemory';

const A: TenantScope = { tenantId: 'org-alpha', workspaceId: 'ws-alpha' };
const B: TenantScope = { tenantId: 'org-bravo', workspaceId: 'ws-bravo' };
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'ws-charlie' };

let current: TenantScope | null = A;
const scope = (): TenantScope | null => current;
const as = <T,>(t: TenantScope | null, fn: () => T): T => {
  const prev = current;
  current = t;
  try {
    return fn();
  } finally {
    current = prev;
  }
};

let dir: string;
beforeEach(async () => {
  current = A;
  dir = join(tmpdir(), `nps-r8-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/* ── Finding 1 — automation run history ──────────────────────────────────── */

describe('automation run history', () => {
  /** COLLIDING RUN IDS, on purpose. */
  const run = (n: number, ok: boolean): never =>
    ({
      id: 'RUN-001',
      ruleId: 'RULE-001',
      ruleName: `Rule for tenant ${n}`,
      triggeredBy: `actor-${n}@example.com`,
      ok,
      durationMs: 10 * n,
      at: `2026-08-1${n}T00:00:00.000Z`,
      actions: [],
    }) as never;

  it('A, B and C each read their OWN runs — same run id throughout', () => {
    const h = new AutomationRunHistory().bindScope(scope);
    as(A, () => h.add(run(1, true)));
    as(B, () => h.add(run(2, false)));
    as(C, () => h.add(run(3, true)));

    // PRESENCE first: every tenant HAS a run.
    for (const t of [A, B, C]) expect(as(t, () => h.list())).toHaveLength(1);
    // …and it is its own, identified by content rather than by count.
    expect(as(A, () => h.list())[0]!.ruleName).toBe('Rule for tenant 1');
    expect(as(B, () => h.list())[0]!.ruleName).toBe('Rule for tenant 2');
    expect(as(C, () => h.list())[0]!.ruleName).toBe('Rule for tenant 3');
    // The actor's address never crosses.
    expect(JSON.stringify(as(A, () => h.list()))).not.toContain('actor-2@');
  });

  /**
   * The monitor aggregates the same array the listing filters. Five separate
   * findings in this program have been an unscoped aggregate beside a scoped list.
   */
  it('the monitor counts only the caller’s runs', () => {
    const h = new AutomationRunHistory().bindScope(scope);
    as(A, () => h.add(run(1, true)));
    as(B, () => h.add(run(2, false)));
    as(B, () => h.add(run(2, false)));

    expect(as(A, () => h.monitor())).toMatchObject({ completed: 1, failed: 0 });
    expect(as(B, () => h.monitor())).toMatchObject({ completed: 0, failed: 2 });
    // C has none — asserted by content, not by emptiness alone.
    expect(as(C, () => h.monitor())).toMatchObject({ completed: 0, failed: 0 });
  });

  it('an unresolved caller reads nothing and its writes reach nobody', () => {
    const h = new AutomationRunHistory().bindScope(scope);
    as(null, () => h.add(run(9, true)));
    for (const t of [A, B, C]) expect(as(t, () => h.list())).toEqual([]);
    expect(as(null, () => h.list())).toEqual([]);
  });
});

/* ── Finding 3 — the marketplace policy ──────────────────────────────────── */

describe('the marketplace policy', () => {
  async function open(): Promise<OrgPolicyStore> {
    const s = new OrgPolicyStore(join(dir, `policy-${randomUUID()}.json`)).bindScope(scope);
    await s.load();
    return s;
  }

  /**
   * THE FINDING. One record for the whole machine, so A relaxing `requireApproval`
   * relaxed it for B — and A's `blockedPublishers`, a list of vendors A has decided
   * not to trust, was readable by everyone.
   */
  it('each organization has its own policy, and one cannot relax another’s', async () => {
    const s = await open();
    as(A, () => s.set({ requireApproval: false, blockedPublishers: ['ACME-BLOCKED-BY-ALPHA'], requireSignature: true, minPublisherTier: 'verified' } as never));
    as(B, () => s.set({ requireApproval: true, blockedPublishers: [], requireSignature: true, minPublisherTier: 'verified' } as never));

    // A explicitly relaxed; B explicitly required.
    expect(as(A, () => s.get()).requireApproval).toBe(false);
    expect(as(B, () => s.get()).requireApproval).toBe(true);
    /**
     * C never set one, so it gets the SHIPPED DEFAULT — which is
     * `requireApproval: false`. Asserted against the constant rather than a
     * literal, because the point is that C inherits the DEFAULT and not B's
     * explicit `true`: before this change there was one record, so whoever wrote
     * last decided for everyone.
     */
    expect(as(C, () => s.get()).requireApproval).toBe(DEFAULT_ORG_POLICY.requireApproval);
    expect(as(C, () => s.get()).requireApproval).not.toBe(as(B, () => s.get()).requireApproval);
    // And A's blocklist — a commercially meaningful statement — never crosses.
    expect(JSON.stringify(as(B, () => s.get()))).not.toContain('ALPHA');
    expect(JSON.stringify(as(C, () => s.get()))).not.toContain('ALPHA');
  });

  it('survives a restart with ownership intact', async () => {
    const path = join(dir, 'policy-restart.json');
    const first = new OrgPolicyStore(path).bindScope(scope);
    await first.load();
    as(A, () => first.set({ requireApproval: false, blockedPublishers: ['ONLY-ALPHA'], requireSignature: true, minPublisherTier: 'verified' } as never));
    await first.flush();

    // A genuinely new instance, as a restart produces.
    const second = new OrgPolicyStore(path).bindScope(scope);
    await second.load();
    expect(as(A, () => second.get()).blockedPublishers).toEqual(['ONLY-ALPHA']);
    expect(as(B, () => second.get()).blockedPublishers).toEqual([]);
    expect(JSON.stringify(as(B, () => second.get()))).not.toContain('ONLY-ALPHA');
  });

  it('an unresolved caller reads the default and cannot write', async () => {
    const s = await open();
    expect(as(null, () => s.get())).toEqual(DEFAULT_ORG_POLICY);
    expect(() => as(null, () => s.set({ requireApproval: false, blockedPublishers: [], requireSignature: true, minPublisherTier: 'verified' } as never))).toThrow(/no owner/i);
  });
});

/* ── The scope gate's own finding — companion devices ─────────────────────── */

describe('paired companion devices', () => {
  async function open(): Promise<CompanionDeviceStore> {
    const s = new CompanionDeviceStore(join(dir, `devices-${randomUUID()}.json`)).bindScope(scope);
    await s.load();
    return s;
  }
  const reg = (name: string, key: string) =>
    ({ name, platform: 'ios' as const, model: 'iPhone17,1', publicKeyB64: key, boundMember: 'someone@example.com', now: '2026-08-11T00:00:00.000Z' });

  /**
   * `boundTenantId` had been on the row since the subsystem shipped and NO READ
   * CONSULTED IT — while the list channel was PUBLIC and revoke was `org:manage`.
   * Found by the scope gate, not by a sweep.
   */
  it('each organization sees only the phones it paired', async () => {
    const s = await open();
    const a = await as(A, () => s.register(reg('ALPHA phone', 'PK-A')));
    const b = await as(B, () => s.register(reg('BRAVO phone', 'PK-B')));
    await as(C, () => s.register(reg('CHARLIE phone', 'PK-C')));

    expect(as(A, () => s.list()).map((d) => d.name)).toEqual(['ALPHA phone']);
    expect(as(B, () => s.list()).map((d) => d.name)).toEqual(['BRAVO phone']);
    expect(JSON.stringify(as(C, () => s.list()))).not.toContain('ALPHA');

    // A bare id from another tenant resolves to nothing.
    expect(as(B, () => s.get(a.id))).toBeNull();
    expect(as(C, () => s.get(a.id))).toBeNull();
    expect(as(A, () => s.get(a.id))).not.toBeNull();
    void b;
  });

  /** Unpairing another organization's phone is a control mutation, not a read. */
  it('a bare id cannot revoke another organization’s phone', async () => {
    const s = await open();
    const a = await as(A, () => s.register(reg('ALPHA phone', 'PK-A')));
    await as(B, () => s.register(reg('BRAVO phone', 'PK-B')));

    expect(await as(B, () => s.revoke(a.id))).toBe(false);
    expect(await as(C, () => s.revoke(a.id))).toBe(false);
    // Still paired, and A can still revoke its own — a boundary, not a freeze.
    expect(as(A, () => s.get(a.id))?.revoked).toBe(false);
    expect(await as(A, () => s.revoke(a.id))).toBe(true);
  });

  it('the owner is stamped from the resolver, not from the caller’s input', async () => {
    const s = await open();
    // A caller claiming to pair for another tenant is ignored: the resolver wins.
    const d = await as(A, () => s.register({ ...reg('claimed', 'PK-X'), boundTenantId: 'org-bravo' } as never));
    expect(d.boundTenantId).toBe('org-alpha');
    expect(as(B, () => s.list())).toEqual([]);
  });
});

/* ── The false global — worker execution counters ─────────────────────────── */

/** The shape `WorkerRegistry.register` expects, minimal but complete. */
function workerDef(id: string, name: string): never {
  return {
    worker: {
      identity: { id, name, version: '1.0.0', author: 'Publisher', description: '' },
      role: 'operations',
      goals: [],
      capabilities: [],
      permissions: [],
      skills: [],
      trustScore: 0.5,
      health: { state: 'healthy', lastCheckAt: null, successRate: 1, jobsRun: 0, jobsFailed: 0, message: null },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
  } as never;
}

describe('worker execution counters', () => {
  /**
   * The registry is genuinely install-level — one catalogue, one skill-resolution
   * seam. `trustScore` and `health.jobsRun` were not: they accumulated every
   * tenant's runs onto the shared row and were served install-wide, making the
   * worker list a live meter of another tenant's job volume and failure rate.
   *
   * A STORE CAN BE CORRECTLY CLASSIFIED AND STILL HOLD ONE FIELD THAT IS NOT.
   */
  it('the catalogue is shared and the counters are not', async () => {
    const r = new WorkerRegistry(join(dir, 'registry.json')).bindOutcomeScope(
      () => current?.tenantId ?? null,
    );
    await r.load();
    const def = workerDef('worker:shared', 'Shared');
    as(A, () => r.register(def, '2026-08-11T00:00:00.000Z'));

    // Both tenants see the SAME package — the catalogue is shared, by design.
    expect(as(A, () => r.list()).map((w) => w.identity.id)).toEqual(['worker:shared']);
    expect(as(B, () => r.list()).map((w) => w.identity.id)).toEqual(['worker:shared']);

    // A runs it three times, twice failing. B runs it once, succeeding.
    as(A, () => {
      r.recordOutcome('worker:shared', true);
      r.recordOutcome('worker:shared', false);
      r.recordOutcome('worker:shared', false);
    });
    as(B, () => r.recordOutcome('worker:shared', true));

    // Each tenant sees ITS OWN history on the shared row.
    expect(as(A, () => r.get('worker:shared'))!.health.jobsRun).toBe(3);
    expect(as(A, () => r.get('worker:shared'))!.health.jobsFailed).toBe(2);
    expect(as(B, () => r.get('worker:shared'))!.health.jobsRun).toBe(1);
    expect(as(B, () => r.get('worker:shared'))!.health.jobsFailed).toBe(0);
    // C has never run it: 0, and NOT the install total of 4.
    expect(as(C, () => r.get('worker:shared'))!.health.jobsRun).toBe(0);
    expect(as(A, () => r.healthSummaries())[0]!.jobsRun).toBe(3);
    expect(as(C, () => r.healthSummaries())[0]!.jobsRun).toBe(0);
  });

  it('counters survive a restart, per tenant', async () => {
    const path = join(dir, 'registry-restart.json');
    const def = workerDef('worker:p', 'P');
    const first = new WorkerRegistry(path).bindOutcomeScope(() => current?.tenantId ?? null);
    await first.load();
    as(A, () => first.register(def, '2026-08-11T00:00:00.000Z'));
    as(A, () => first.recordOutcome('worker:p', true));
    as(B, () => first.recordOutcome('worker:p', false));
    await first.flush();

    const second = new WorkerRegistry(path).bindOutcomeScope(() => current?.tenantId ?? null);
    await second.load();
    expect(as(A, () => second.get('worker:p'))!.health.jobsRun).toBe(1);
    expect(as(A, () => second.get('worker:p'))!.health.jobsFailed).toBe(0);
    expect(as(B, () => second.get('worker:p'))!.health.jobsFailed).toBe(1);
    expect(as(C, () => second.get('worker:p'))!.health.jobsRun).toBe(0);
  });
});

/* ── The retention class — a cap is a write ───────────────────────────────── */

describe('retention is per owner', () => {
  /**
   * Eighth install-wide cap this program has found behind correct read filters. A
   * lost mapping means the next import of that file silently guesses again.
   */
  it('a busy tenant’s imports do not delete another tenant’s remembered mappings', async () => {
    // Cap of 3, injected — the arithmetic is identical at 3 and at 5,000, and a
    // retention test that takes two minutes is a retention test that gets skipped.
    const m = new MappingMemoryStore(join(dir, 'mappings.json'), 3);
    await m.load();
    const ctx = (tenantId: string) => ({ tenantId, actor: 'a@b.com', now: '2026-08-11T00:00:00.000Z' });

    await m.save({ signature: 'sig-b', entityId: 'customer', columns: [] } as never, ctx('org-bravo'));
    expect(m.list('org-bravo')).toHaveLength(1);

    // A writes far past the cap.
    for (let i = 0; i < 10; i += 1) {
      await m.save({ signature: `sig-a-${i}`, entityId: 'customer', columns: [] } as never, ctx('org-alpha'));
    }

    // B's single mapping survives A's five thousand.
    expect(m.list('org-bravo')).toHaveLength(1);
    // And A capped its OWN rows rather than growing without bound.
    // A capped ITS OWN rows: three kept, the newest three.
    expect(m.list('org-alpha')).toHaveLength(3);
    expect(m.list('org-alpha').map((x) => x.signature)).toContain('sig-a-9');
    expect(m.list('org-alpha').map((x) => x.signature)).not.toContain('sig-a-0');
  });
});
