/**
 * PROGRAM 13C ROUND 3 — H-3: the developer, billing and gateway surface.
 *
 * This surface was ONE PARTITION for the whole install. There is a single
 * developer account (`dev-owner`, seeded to the literal `ORG_ID`) and every API
 * key, OAuth application and usage row hung off its `developerId`; billing had
 * one subscription, one seat pool, one licence ledger and one purchase ledger,
 * all stamped from the seed.
 *
 * The sharpest assertions in this file are therefore NOT the listings. They are:
 *
 *   • A cannot REVOKE B's API key — production access, cut by a bare payload id.
 *   • A cannot DELETE B's OAuth application — unrecoverable, because the client
 *     secret existed exactly once.
 *   • A cannot RELEASE B's seat, or change B's plan.
 *   • A's traffic is not counted against B's metered invoice.
 *
 * And one non-assertion worth stating: `verifyKey` stays unscoped on purpose. It
 * resolves a PRESENTED credential, which is what establishes a tenant in the
 * first place, so scoping it could only ever deny. It is tested here to prove it
 * still works, not to prove it is filtered.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope } from '@neuropause/shared';
import { DeveloperStore } from '../../ecosystem/developer/developerStore';
import { BillingStore } from '../../ecosystem/billing/billingStore';
import { GatewayStore } from '../../ecosystem/gateway/gatewayStore';
import { MARKER_A, MARKER_B, TENANT_A, TENANT_B } from './twoTenantFixture';

const DEV = 'dev-owner';
const SEED_DEV = { id: DEV, name: 'Owner', email: 'o@x.io', organization: 'X', orgId: 'org-seed' };
const SEED_BILL = { orgId: TENANT_A.tenantId, ownerUserId: 'user-a', ownerName: 'Owner A' };

let scope: TenantScope | null = TENANT_A;
let dir: string;
let developers: DeveloperStore;
let billing: BillingStore;
let gateway: GatewayStore;

beforeEach(async () => {
  dir = join(tmpdir(), `np-dev-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const src = (): TenantScope | null => scope;
  developers = new DeveloperStore(join(dir, 'dev.json'), SEED_DEV).bindScope(src);
  billing = new BillingStore(join(dir, 'bill.json'), SEED_BILL).bindScope(src);
  gateway = new GatewayStore(join(dir, 'gw.json')).bindScope(src);
  await developers.load();
  await billing.load();
  await gateway.load();
  scope = TENANT_A;
});

afterEach(async () => {
  await Promise.all([
    developers.flush().catch(() => {}),
    billing.flush().catch(() => {}),
    gateway.flush().catch(() => {}),
  ]);
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

/* ── API keys ───────────────────────────────────────────────────────────── */

describe('H-3 — API keys', () => {
  function seedBoth(): { a: string; b: string; aSecret: string } {
    scope = TENANT_A;
    const a = developers.createKey(DEV, `Key ${MARKER_A}`, ['marketplace:read']);
    scope = TENANT_B;
    const b = developers.createKey(DEV, `Key ${MARKER_B}`, ['marketplace:read']);
    scope = TENANT_A;
    return { a: a.key.id, b: b.key.id, aSecret: a.secret };
  }

  it('A lists only A’s keys; B only B’s — same developer account', () => {
    seedBoth();
    scope = TENANT_A;
    const mine = developers.keysFor(DEV);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).toContain(MARKER_A);
    expect(JSON.stringify(mine)).not.toContain(MARKER_B);

    scope = TENANT_B;
    expect(developers.keysFor(DEV)).toHaveLength(1);
  });

  /** The cross-tenant WRITE. Revoking a key cuts live API access. */
  it('A cannot REVOKE B’s key', () => {
    const { b } = seedBoth();
    scope = TENANT_A;
    expect(developers.revokeKey(b)).toBeNull();

    scope = TENANT_B;
    expect(developers.keysFor(DEV)[0]?.revokedAt).toBeNull();
  });

  it('A cannot ROTATE B’s key — rotation revokes the original', () => {
    const { b } = seedBoth();
    scope = TENANT_A;
    expect(developers.rotateKey(b)).toBeNull();
    scope = TENANT_B;
    expect(developers.keysFor(DEV)).toHaveLength(1);
    expect(developers.keysFor(DEV)[0]?.revokedAt).toBeNull();
  });

  it('a foreign id and an invented id are indistinguishable', () => {
    const { b } = seedBoth();
    scope = TENANT_A;
    expect(developers.revokeKey(b)).toEqual(developers.revokeKey('key_invented'));
  });

  it('each tenant CAN revoke its own — the gate is not simply "no"', () => {
    const { a } = seedBoth();
    scope = TENANT_A;
    expect(developers.revokeKey(a)?.revokedAt).not.toBeNull();
  });

  /**
   * DELIBERATELY UNSCOPED. Possession of the secret IS the authentication, and
   * this runs before any tenant exists to scope against.
   */
  it('verifyKey still resolves a presented secret, from any scope', () => {
    const { aSecret } = seedBoth();
    scope = TENANT_B;
    expect(developers.verifyKey(aSecret)).not.toBeNull();
  });

  it('an unresolved caller sees no keys and cannot mint one', () => {
    seedBoth();
    scope = null;
    expect(developers.keysFor(DEV)).toEqual([]);
    expect(() => developers.createKey(DEV, 'orphan', [])).toThrow(/no owner/i);
  });
});

/* ── OAuth applications ─────────────────────────────────────────────────── */

describe('H-3 — OAuth applications', () => {
  function seedBoth(): { a: string; b: string } {
    scope = TENANT_A;
    const a = developers.createApp(DEV, `App ${MARKER_A}`, [`https://${MARKER_A}.example`], [], ['authorization_code']);
    scope = TENANT_B;
    const b = developers.createApp(DEV, `App ${MARKER_B}`, [`https://${MARKER_B}.example`], [], ['authorization_code']);
    scope = TENANT_A;
    return { a: a.application.id, b: b.application.id };
  }

  it('A lists only A’s applications — redirect URIs are an integration map', () => {
    seedBoth();
    scope = TENANT_A;
    const blob = JSON.stringify(developers.appsFor(DEV));
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  /**
   * The sharpest write in the file. A key revocation can be replaced; an OAuth
   * application cannot — its client secret was returned exactly once at
   * creation and is stored only as a hash.
   */
  it('A cannot DELETE B’s OAuth application', () => {
    const { b } = seedBoth();
    scope = TENANT_A;
    expect(developers.deleteApp(b)).toBe(false);
    scope = TENANT_B;
    expect(developers.appsFor(DEV)).toHaveLength(1);
  });

  it('each tenant can delete its own', () => {
    const { a } = seedBoth();
    scope = TENANT_A;
    expect(developers.deleteApp(a)).toBe(true);
    expect(developers.appsFor(DEV)).toHaveLength(0);
  });
});

/* ── Usage and the metered invoice ──────────────────────────────────────── */

describe('H-3 — the usage ledger is a billing boundary', () => {
  function use(tenant: TenantScope, n: number): void {
    scope = tenant;
    for (let i = 0; i < n; i += 1) {
      developers.recordUsage({
        developerId: DEV,
        apiKeyId: null,
        at: new Date().toISOString(),
        method: 'GET',
        path: '/v1/x',
        version: 'v1',
        status: 200,
        latencyMs: 1,
        computeUnits: 1,
      });
    }
  }

  it('A’s traffic is not counted against B’s quota', () => {
    use(TENANT_A, 5);
    use(TENANT_B, 2);
    scope = TENANT_A;
    expect(developers.countSince(DEV, 0)).toBe(5);
    scope = TENANT_B;
    expect(developers.countSince(DEV, 0)).toBe(2);
  });

  it('an explicit owner beats the ambient scope — the credential decides', () => {
    scope = TENANT_A;
    developers.recordUsage({
      tenantId: TENANT_B.tenantId, // a request authenticated as B, served while A is open
      developerId: DEV,
      apiKeyId: null,
      at: new Date().toISOString(),
      method: 'GET',
      path: '/v1/x',
      version: 'v1',
      status: 200,
      latencyMs: 1,
      computeUnits: 1,
    });
    scope = TENANT_A;
    expect(developers.countSince(DEV, 0)).toBe(0);
    scope = TENANT_B;
    expect(developers.countSince(DEV, 0)).toBe(1);
  });
});

/* ── Billing ────────────────────────────────────────────────────────────── */

describe('H-3 — subscriptions, seats, licences and purchases', () => {
  it('each organization gets its OWN subscription, created on first read', () => {
    scope = TENANT_A;
    expect(billing.getSubscription().orgId).toBe(TENANT_A.tenantId);
    scope = TENANT_B;
    expect(billing.getSubscription().orgId).toBe(TENANT_B.tenantId);
  });

  it('A cannot change B’s plan', () => {
    scope = TENANT_B;
    expect(billing.getSubscription().planTier).toBe('free');
    scope = TENANT_A;
    billing.setPlan('enterprise');
    scope = TENANT_B;
    expect(billing.getSubscription().planTier).toBe('free');
  });

  it('A sees only A’s seated users', () => {
    // A is the seeded organization, so its single Free seat is already taken by
    // the owner. Upgrading first is what the product does; it also keeps this
    // test about isolation rather than about the Free plan's seat count.
    scope = TENANT_A;
    billing.setPlan('pro');
    billing.assignSeat('u-a', MARKER_A);
    scope = TENANT_B;
    billing.assignSeat('u-b', MARKER_B);

    scope = TENANT_A;
    const blob = JSON.stringify(billing.seatAssignments());
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  /** The bare-id delete. `seats.delete(seatId)` with no ownership resolve. */
  it('A cannot RELEASE B’s seat', () => {
    scope = TENANT_B;
    const seat = billing.assignSeat('u-b', MARKER_B);
    const seatId = (seat as { id: string }).id;

    scope = TENANT_A;
    expect(billing.releaseSeat(seatId)).toBe(false);

    scope = TENANT_B;
    expect(billing.seatAssignments().some((s) => s.id === seatId)).toBe(true);
  });

  it('a tenant CAN release its own seat', () => {
    scope = TENANT_B;
    const seat = billing.assignSeat('u-b', MARKER_B);
    expect(billing.releaseSeat((seat as { id: string }).id)).toBe(true);
  });

  /**
   * The seat cap counted the INSTALL, so one tenant filling its plan exhausted
   * every other tenant's seats. Free is a small plan, which made this reachable
   * rather than theoretical.
   */
  it('the seat cap counts the caller’s seats, not the install’s', () => {
    scope = TENANT_A;
    const cap = billing.getSubscription().seats;
    for (let i = 0; i < cap + 2; i += 1) billing.assignSeat(`u-a-${i}`, `A${i}`);

    scope = TENANT_B;
    // B's plan is untouched by A having filled its own.
    expect(billing.assignSeat('u-b', MARKER_B)).toHaveProperty('id');
  });

  it('licences and purchases are stamped with the CALLER’s org, not the seed', () => {
    scope = TENANT_B;
    const { purchase, license } = billing.purchase({
      listingId: 'lst_1',
      listingName: MARKER_B,
      versionId: null,
      model: 'one_time',
      amount: 100,
      currency: 'USD',
      feePct: 0.2,
    });
    expect(purchase.orgId).toBe(TENANT_B.tenantId);
    expect(license.orgId).toBe(TENANT_B.tenantId);

    scope = TENANT_A;
    expect(billing.listPurchases()).toEqual([]);
    expect(billing.listLicenses()).toEqual([]);
    expect(billing.periodSpend(purchase.purchasedAt.slice(0, 7))).toBe(0);

    scope = TENANT_B;
    expect(billing.periodSpend(purchase.purchasedAt.slice(0, 7))).toBe(100);
  });

  it('an unresolved caller reads nothing and cannot seat anyone', () => {
    scope = null;
    expect(billing.seatAssignments()).toEqual([]);
    expect(billing.listLicenses()).toEqual([]);
    expect(billing.listPurchases()).toEqual([]);
    expect(() => billing.assignSeat('x', 'X')).toThrow(/no owner/i);
  });
});

/* ── Gateway audit ──────────────────────────────────────────────────────── */

describe('H-3 — the gateway audit trail', () => {
  function record(tenant: TenantScope, marker: string): void {
    gateway.record({
      at: '2026-08-11T00:00:00.000Z',
      tenantId: tenant.tenantId,
      keyId: `key-${marker}`,
      developerId: DEV,
      method: 'GET',
      path: `/v1/${marker}`,
      version: 'v1',
      status: 200,
      reason: 'ok',
      latencyMs: 5,
    });
  }

  it('A reads only A’s entries — the path carries the resource name', () => {
    record(TENANT_A, MARKER_A);
    record(TENANT_B, MARKER_B);
    scope = TENANT_A;
    const blob = JSON.stringify(gateway.auditEntries(100));
    expect(blob).toContain(MARKER_A);
    expect(blob).not.toContain(MARKER_B);
  });

  it('metrics count only the caller’s traffic', () => {
    record(TENANT_A, MARKER_A);
    record(TENANT_A, MARKER_A);
    record(TENANT_B, MARKER_B);
    scope = TENANT_A;
    expect(gateway.metrics(7, Date.parse('2026-08-11T01:00:00.000Z')).requests).toBe(2);
    scope = TENANT_B;
    expect(gateway.metrics(7, Date.parse('2026-08-11T01:00:00.000Z')).requests).toBe(1);
  });

  /**
   * THE CHAIN IS THE POINT. The output is filtered and the array never is, so
   * integrity must still verify across BOTH tenants' entries — and the totals
   * stay install-wide, because they are statements about the chain.
   */
  it('scoping the output does not break the tamper-evident chain', () => {
    record(TENANT_A, MARKER_A);
    record(TENANT_B, MARKER_B);
    expect(gateway.verifyAuditIntegrity().ok).toBe(true);
    expect(gateway.totalAudit()).toBe(2);
    expect(gateway.ownershipCounts()).toEqual({ total: 2, assigned: 2, unresolved: 0 });
  });

  /**
   * `limit` is applied AFTER the filter. Applied before, a tenant asking for two
   * could receive fewer than two of its own — and the shortfall would report the
   * install's traffic mix.
   */
  it('the limit counts the caller’s rows, not the install’s', () => {
    record(TENANT_B, MARKER_B);
    record(TENANT_B, MARKER_B);
    record(TENANT_A, MARKER_A);
    scope = TENANT_A;
    expect(gateway.auditEntries(2)).toHaveLength(1);
    scope = TENANT_B;
    expect(gateway.auditEntries(2)).toHaveLength(2);
  });

  it('an unresolved caller reads no audit at all', () => {
    record(TENANT_A, MARKER_A);
    scope = null;
    expect(gateway.auditEntries(100)).toEqual([]);
    expect(gateway.metrics(7, Date.now()).requests).toBe(0);
  });

  /**
   * Pre-Round-3 rows have no owner. They must be invisible to everybody AND
   * hash exactly as they did before, so an upgrading install does not raise an
   * integrity violation indistinguishable from real tampering.
   */
  it('an UNOWNED legacy row is shown to nobody, and the chain still verifies', () => {
    gateway.record({
      at: '2026-01-01T00:00:00.000Z',
      keyId: null,
      developerId: DEV,
      method: 'GET',
      path: '/v1/legacy',
      version: 'v1',
      status: 200,
      reason: 'ok',
      latencyMs: 1,
    });
    record(TENANT_A, MARKER_A);

    scope = TENANT_A;
    expect(gateway.auditEntries(100)).toHaveLength(1);
    scope = TENANT_B;
    expect(gateway.auditEntries(100)).toHaveLength(0);
    expect(gateway.verifyAuditIntegrity().ok).toBe(true);
    expect(gateway.ownershipCounts()).toEqual({ total: 2, assigned: 1, unresolved: 1 });
  });
});
