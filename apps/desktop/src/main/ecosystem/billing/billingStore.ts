/**
 * The Billing store: each organization's subscription, seat assignments, license
 * ledger, and marketplace purchase ledger. Electron-free.
 *
 * P13C ROUND 3 — H-3. ONE INSTALL WAS ONE CUSTOMER.
 *
 * Every collection here was singular. There was ONE `subscription`, stamped with
 * the literal seeded `ORG_ID`; one `seats` map; one licence ledger; one purchase
 * ledger. `License` and `MarketplacePurchase` both CARRY an `orgId` field, and
 * it was written from `this.seed.orgId` rather than from the caller — so the
 * records looked correctly owned while every one of them claimed the same owner.
 * That is the most dangerous shape a tenancy defect takes, because an auditor
 * checking "do these rows have an organization?" gets yes.
 *
 * The consequences, in the order they matter:
 *
 *   releaseSeat(seatId)  — `this.seats.delete(seatId)` on a bare payload id. One
 *                          tenant could revoke another tenant's user's seat.
 *   setPlan(tier)        — mutated the single shared subscription, so one tenant
 *                          could downgrade another's plan and, through
 *                          `seatsForPlan`, its seat cap.
 *   seatAssignments()    — every tenant's seated users, by name and user id.
 *   listPurchases()      — every tenant's marketplace spend, itemised.
 *   periodSpend(period)  — install-wide sum, reported as one tenant's spend.
 *
 * Now partitioned by the AUTHORITATIVE tenant. A subscription is created lazily
 * per organization on first read, which is the honest reading of "a new customer
 * starts on Free" and removes the seeded org's privileged position entirely.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  License,
  LicenseKind,
  MarketplacePurchase,
  PlanTier,
  PricingModel,
  SeatAssignment,
  Subscription,
  TenantScope,
} from '@neuropause/shared';
import { TenantOwnership } from '../../tenancy/tenantOwnedStore';
import { createLogger } from '../../logger';
import { PLAN_CATALOG } from './billing';
import { declareStoreScope } from '../../tenancy/storeScope';

/**
 * P13C ROUND 10 — THE RETENTION DECLARATION THIS FILE COULD NOT MAKE.
 *
 * The store satisfied the scope gate by holding a `TenantOwnership`, which takes
 * no retention argument — the gap all three proven Round 9 findings went
 * through. The answer here is good, and stating it is the point: nothing in this
 * file is capped, so no tenant's volume can destroy another's billing record.
 */
declareStoreScope({
  name: 'ecosystem-billing',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retentionScope: 'OWNER',
  retentionAuthority: 'OWNER',
  retention:
    'NO CAP ANYWHERE, deliberately: subscriptions, seats, licences and the purchase ledger are ' +
    'commercial evidence, and a cap over a ledger is a cap over an invoice. Licences and purchases ' +
    'are never removed at all. The ONE removal is `releaseSeat(seatId)`, which resolves the seat and ' +
    'then requires `tenancy.mine(seat)` before deleting — it was `this.seats.delete(seatId)` on a ' +
    "bare payload id, so one organization could revoke another organization's user's seat. The seat " +
    "counter it updates afterwards is recomputed from the caller's own `seatAssignments()`.",
  reason:
    "One organization's subscription tier, seated users by name and user id, licence ledger and " +
    'itemised marketplace spend. Every collection here was SINGULAR before Round 3 — one ' +
    'subscription stamped with the literal seeded ORG_ID, one seat map, one ledger — and both ' +
    '`License` and `MarketplacePurchase` CARRY an `orgId` that was written from the seed rather than ' +
    'from the caller, so every row looked correctly owned while claiming the same owner. That is the ' +
    'most dangerous shape a tenancy defect takes: an auditor asking "do these rows have an ' +
    'organization?" gets yes. Binding is asserted by the TenantOwnership this class holds.',
});

const log = createLogger('billing');

interface BillingFile {
  /** Post-Round-3 shape: one row per organization. */
  subscriptions?: Subscription[];
  /** Pre-Round-3 shape: the single install-wide subscription. Read, never written. */
  subscription?: Subscription | null;
  seats: SeatAssignment[];
  licenses: License[];
  purchases: MarketplacePurchase[];
  seeded: boolean;
}

/**
 * Read either file shape.
 *
 * A pre-Round-3 file holds one `subscription` already stamped with its own
 * `orgId`, so it upgrades by being read into the map under that id — no guess,
 * no migration pass, and the existing customer keeps their plan.
 */
function subscriptionsFromFile(data: Partial<BillingFile>): Subscription[] {
  if (Array.isArray(data.subscriptions)) return data.subscriptions.filter((s) => !!s?.orgId);
  const single = data.subscription;
  return single && single.orgId ? [single] : [];
}

function freeSubscription(orgId: string, nowIso: string): Subscription {
  return {
    id: `sub_${orgId}`,
    orgId,
    planTier: 'free',
    seats: seatsForPlan('free'),
    seatsUsed: 1,
    status: 'active',
    startedAt: nowIso,
    renewsAt: new Date(Date.parse(nowIso) + 30 * 86_400_000).toISOString(),
  };
}

export interface SeedBilling {
  orgId: string;
  ownerUserId: string;
  ownerName: string;
}

function seatsForPlan(tier: PlanTier): number {
  const s = PLAN_CATALOG[tier].seats;
  return s < 0 ? 9999 : s;
}

export class BillingStore extends EventEmitter {
  /** The tenant boundary. Registered with the startup gate by construction. */
  private readonly tenancy = new TenantOwnership('ecosystem-billing');
  /** One subscription PER ORGANIZATION, created on first read. Was a single row. */
  private subscriptions = new Map<string, Subscription>();
  private seats = new Map<string, SeatAssignment>();
  private licenses = new Map<string, License>();
  private purchases: MarketplacePurchase[] = [];
  private loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly seed: SeedBilling) {
    super();
  }

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }
  /** Unscoped ownership counts across seats + licences + purchases, for the inventory. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.tenancy.countOwnership([
      ...this.seats.values(),
      ...[...this.licenses.values()].map((l) => ({ tenantId: l.orgId })),
      ...this.purchases.map((p) => ({ tenantId: p.orgId })),
    ]);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<BillingFile>;
      for (const sub of subscriptionsFromFile(data)) this.subscriptions.set(sub.orgId, sub);
      for (const s of data.seats ?? []) if (s?.id) this.seats.set(s.id, s);
      for (const l of data.licenses ?? []) if (l?.id) this.licenses.set(l.id, l);
      this.purchases = Array.isArray(data.purchases) ? data.purchases : [];
      if (!data.seeded || this.subscriptions.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Billing ready', {
      subscriptions: this.subscriptions.size,
      seats: this.seats.size,
      licenses: this.licenses.size,
    });
  }

  /**
   * Seed the OWNER'S organization only.
   *
   * Retained because a fresh install has one organization and its owner should
   * have a seat. It is no longer privileged: a second organization gets its own
   * Free subscription through `getSubscription()`, and the seeded row is not
   * reachable by anybody else.
   */
  private applySeed(): void {
    if (this.subscriptions.has(this.seed.orgId)) return;
    const now = new Date().toISOString();
    this.subscriptions.set(this.seed.orgId, freeSubscription(this.seed.orgId, now));
    const seatId = `seat_${randomUUID()}`;
    this.seats.set(seatId, {
      id: seatId,
      tenantId: this.seed.orgId,
      userId: this.seed.ownerUserId,
      userName: this.seed.ownerName,
      assignedAt: now,
    });
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: BillingFile = {
      subscriptions: [...this.subscriptions.values()],
      seats: [...this.seats.values()],
      licenses: [...this.licenses.values()],
      purchases: this.purchases,
      seeded: true,
    };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }
  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Billing persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /* ── reads ── */

  /**
   * The CALLER'S subscription, created on first read.
   *
   * A read with no tenant returns a detached Free row that is NOT stored. It has
   * to return something — every consumer dereferences `.planTier` — but writing
   * it would create a subscription owned by nobody, which is a permanent row
   * with no way to reach it.
   */
  getSubscription(): Subscription {
    const scope = this.tenancy.scopeOrDeny();
    const orgId = scope?.tenantId ?? '';
    if (orgId === '') return freeSubscription('', new Date().toISOString());
    const existing = this.subscriptions.get(orgId);
    if (existing) return existing;
    const created = freeSubscription(orgId, new Date().toISOString());
    this.subscriptions.set(orgId, created);
    this.schedulePersist();
    return created;
  }
  /** The CALLER'S seated users. Was every tenant's roster, by name and user id. */
  seatAssignments(): SeatAssignment[] {
    return this.tenancy.onlyMine([...this.seats.values()]);
  }
  listLicenses(): License[] {
    return this.mine([...this.licenses.values()]).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }
  listPurchases(): MarketplacePurchase[] {
    return this.mine([...this.purchases]).sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  }

  /**
   * Licences and purchases carry their owner in `orgId` rather than `tenantId`,
   * because that field predates this program and is read by the invoice and the
   * commercial projection. Filtering on the field that already exists is better
   * than adding a second owner that could disagree with it.
   */
  private mine<T extends { orgId: string }>(rows: readonly T[]): T[] {
    const scope = this.tenancy.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [];
    return rows.filter((r) => r.orgId === scope.tenantId);
  }

  /* ── mutations ── */

  setPlan(tier: PlanTier): Subscription {
    const sub = this.getSubscription();
    if (!sub.orgId) return sub; // unresolved caller changes nobody's plan
    const next: Subscription = { ...sub, planTier: tier, seats: seatsForPlan(tier) };
    this.subscriptions.set(next.orgId, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  assignSeat(userId: string, userName: string): SeatAssignment | { error: string } {
    const tenantId = this.tenancy.requireTenant();
    const sub = this.getSubscription();
    const mine = this.seatAssignments();
    // The cap counts the CALLER'S seats. It was the install total, so one tenant
    // filling its plan exhausted every other tenant's seats too.
    if (mine.length >= sub.seats) return { error: 'No seats available on the current plan.' };
    if (mine.some((s) => s.userId === userId)) return { error: 'User already has a seat.' };
    const seat: SeatAssignment = {
      id: `seat_${randomUUID()}`,
      tenantId,
      userId,
      userName,
      assignedAt: new Date().toISOString(),
    };
    this.seats.set(seat.id, seat);
    this.subscriptions.set(sub.orgId, { ...sub, seatsUsed: mine.length + 1 });
    this.schedulePersist();
    this.emit('changed');
    return seat;
  }

  /** Release one of the CALLER'S seats. Was `delete(seatId)` on a bare payload id. */
  releaseSeat(seatId: string): boolean {
    const seat = this.seats.get(seatId) ?? null;
    if (seat === null || !this.tenancy.mine(seat)) return false;
    this.seats.delete(seatId);
    const sub = this.subscriptions.get(seat.tenantId as string);
    if (sub) this.subscriptions.set(sub.orgId, { ...sub, seatsUsed: this.seatAssignments().length });
    this.schedulePersist();
    this.emit('changed');
    return true;
  }

  issueLicense(input: { listingId: string; listingName: string; kind: LicenseKind; seats: number; expiresAt?: string | null }): License {
    const license: License = {
      id: `lic_${randomUUID()}`,
      orgId: this.tenancy.requireTenant(),
      listingId: input.listingId,
      listingName: input.listingName,
      kind: input.kind,
      seats: input.seats,
      status: 'active',
      issuedAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
    };
    this.licenses.set(license.id, license);
    this.schedulePersist();
    this.emit('changed');
    return license;
  }

  purchase(input: { listingId: string; listingName: string; versionId: string | null; model: PricingModel; amount: number; currency: string; feePct: number }): { purchase: MarketplacePurchase; license: License } {
    const purchase: MarketplacePurchase = {
      id: `pur_${randomUUID()}`,
      orgId: this.tenancy.requireTenant(),
      listingId: input.listingId,
      listingName: input.listingName,
      versionId: input.versionId,
      model: input.model,
      amount: input.amount,
      currency: input.currency,
      feeAmount: Math.round(input.amount * input.feePct * 100) / 100,
      purchasedAt: new Date().toISOString(),
    };
    this.purchases.push(purchase);
    const license = this.issueLicense({ listingId: input.listingId, listingName: input.listingName, kind: 'organization', seats: -1 });
    this.schedulePersist();
    this.emit('changed');
    return { purchase, license };
  }

  /** The CALLER'S spend in a period. Was the install-wide sum, reported as theirs. */
  periodSpend(period: string): number {
    return this.mine(this.purchases)
      .filter((p) => p.purchasedAt.slice(0, 7) === period)
      .reduce((n, p) => n + p.amount, 0);
  }
}
