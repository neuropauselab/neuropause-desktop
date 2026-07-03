/**
 * The Billing store: the organization's subscription, seat assignments, the
 * license ledger, and the marketplace purchase ledger. Seeded with a Free
 * subscription bound to the organization owner. Electron-free.
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
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import { PLAN_CATALOG } from './billing';

const log = createLogger('billing');

interface BillingFile {
  subscription: Subscription | null;
  seats: SeatAssignment[];
  licenses: License[];
  purchases: MarketplacePurchase[];
  seeded: boolean;
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
  private subscription: Subscription | null = null;
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

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<BillingFile>;
      this.subscription = data.subscription ?? null;
      for (const s of data.seats ?? []) if (s?.id) this.seats.set(s.id, s);
      for (const l of data.licenses ?? []) if (l?.id) this.licenses.set(l.id, l);
      this.purchases = Array.isArray(data.purchases) ? data.purchases : [];
      if (!data.seeded || !this.subscription) this.applySeed();
    } catch {
      this.applySeed();
    }
    this.loaded = true;
    log.info('Billing ready', { plan: this.subscription?.planTier, seats: this.seats.size, licenses: this.licenses.size });
  }

  private applySeed(): void {
    const now = new Date().toISOString();
    const renews = new Date(Date.now() + 30 * 86_400_000).toISOString();
    this.subscription = {
      id: `sub_${this.seed.orgId}`,
      orgId: this.seed.orgId,
      planTier: 'free',
      seats: seatsForPlan('free'),
      seatsUsed: 1,
      status: 'active',
      startedAt: now,
      renewsAt: renews,
    };
    const seatId = `seat_${randomUUID()}`;
    this.seats.set(seatId, { id: seatId, userId: this.seed.ownerUserId, userName: this.seed.ownerName, assignedAt: now });
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: BillingFile = {
      subscription: this.subscription,
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

  getSubscription(): Subscription {
    if (!this.subscription) this.applySeed();
    return this.subscription as Subscription;
  }
  seatAssignments(): SeatAssignment[] {
    return [...this.seats.values()];
  }
  listLicenses(): License[] {
    return [...this.licenses.values()].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }
  listPurchases(): MarketplacePurchase[] {
    return [...this.purchases].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  }

  /* ── mutations ── */

  setPlan(tier: PlanTier): Subscription {
    const sub = this.getSubscription();
    const next: Subscription = { ...sub, planTier: tier, seats: seatsForPlan(tier) };
    this.subscription = next;
    this.schedulePersist();
    this.emit('changed');
    return next;
  }

  assignSeat(userId: string, userName: string): SeatAssignment | { error: string } {
    const sub = this.getSubscription();
    if (this.seats.size >= sub.seats) return { error: 'No seats available on the current plan.' };
    if ([...this.seats.values()].some((s) => s.userId === userId)) return { error: 'User already has a seat.' };
    const seat: SeatAssignment = { id: `seat_${randomUUID()}`, userId, userName, assignedAt: new Date().toISOString() };
    this.seats.set(seat.id, seat);
    this.subscription = { ...sub, seatsUsed: this.seats.size };
    this.schedulePersist();
    this.emit('changed');
    return seat;
  }

  releaseSeat(seatId: string): boolean {
    const ok = this.seats.delete(seatId);
    if (ok && this.subscription) {
      this.subscription = { ...this.subscription, seatsUsed: this.seats.size };
      this.schedulePersist();
      this.emit('changed');
    }
    return ok;
  }

  issueLicense(input: { listingId: string; listingName: string; kind: LicenseKind; seats: number; expiresAt?: string | null }): License {
    const license: License = {
      id: `lic_${randomUUID()}`,
      orgId: this.seed.orgId,
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
      orgId: this.seed.orgId,
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

  periodSpend(period: string): number {
    return this.purchases.filter((p) => p.purchasedAt.slice(0, 7) === period).reduce((n, p) => n + p.amount, 0);
  }
}
