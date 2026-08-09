/**
 * Medical Device Pack — the batch/lot model, its lifecycle state machine, and
 * the quantity algebra both are enforced against.
 *
 * A lot is the unit a recall is executed in. Everything here is built around
 * one consequence of that: a lot's quantity must never be able to go wrong
 * quietly. So quantity is not a mutable number — it is a DERIVED value over an
 * immutable original plus two monotonically increasing counters:
 *
 *     remaining = quantity − consumedQuantity − splitQuantity
 *
 * There is no code path that sets `remaining`. Consumption and splitting each
 * add to their own counter and are refused when the result would exceed what
 * is left. That makes over-consumption, double-consumption and lossy splits
 * arithmetic impossibilities rather than bugs to be tested for individually.
 *
 * Pure: no I/O, no dates from the ambient clock, no persistence. Every decision
 * this file makes is testable by calling a function.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { IndustryTaxonomy } from './industryPack';

/* ── lifecycle ─────────────────────────────────────────────────────────────── */

/**
 * The lot lifecycle.
 *
 * `consumed` and `exhausted` both mean "nothing is left", and they are separate
 * states because the reason differs and the reason is what an investigator asks
 * for first:
 *   • `consumed`  — the remainder was issued to a downstream process.
 *   • `exhausted` — the remainder was divided into child lots; the material
 *                   still exists, under different lot numbers.
 * Collapsing them would lose the distinction between "used" and "renamed".
 */
export type LotStatus =
  | 'created'
  | 'quarantined'
  | 'released'
  | 'blocked'
  | 'partially_consumed'
  | 'consumed'
  | 'exhausted'
  | 'expired'
  | 'recalled';

export const LOT_STATUSES: readonly LotStatus[] = [
  'created',
  'quarantined',
  'released',
  'blocked',
  'partially_consumed',
  'consumed',
  'exhausted',
  'expired',
  'recalled',
];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  created: 'Created',
  quarantined: 'Quarantined',
  released: 'Released',
  blocked: 'Blocked',
  partially_consumed: 'Partially Consumed',
  consumed: 'Consumed',
  exhausted: 'Exhausted',
  expired: 'Expired',
  recalled: 'Recalled',
};

export const LOT_STATUS_TONES: Record<LotStatus, string> = {
  created: 'neutral',
  quarantined: 'orange',
  released: 'green',
  blocked: 'red',
  partially_consumed: 'blue',
  consumed: 'neutral',
  exhausted: 'neutral',
  expired: 'orange',
  recalled: 'red',
};

/**
 * The explicit state machine. Every legal transition is listed; anything absent
 * is refused with a reason.
 *
 * Three decisions worth defending:
 *
 * 1. `consumed` and `exhausted` can still go to `recalled`. A recall routinely
 *    lands on material that has already been used — that is precisely the case
 *    traceability exists for. Refusing it would make the system unable to
 *    represent the most important event it will ever record.
 * 2. `recalled` is terminal. There is no un-recall; a recall decision reversed
 *    is a new record, not an edited one.
 * 3. `expired` may go to `blocked` or `recalled`, never back to `released`.
 *    Re-releasing expired material is a decision this software will not make
 *    representable by a status change.
 */
export const LOT_STATUS_TRANSITIONS: Record<LotStatus, readonly LotStatus[]> = {
  created: ['quarantined', 'released', 'blocked', 'expired', 'recalled'],
  quarantined: ['released', 'blocked', 'expired', 'recalled'],
  released: [
    'quarantined',
    'blocked',
    'partially_consumed',
    'consumed',
    'exhausted',
    'expired',
    'recalled',
  ],
  blocked: ['quarantined', 'released', 'expired', 'recalled'],
  partially_consumed: ['quarantined', 'blocked', 'consumed', 'exhausted', 'expired', 'recalled'],
  consumed: ['recalled'],
  exhausted: ['recalled'],
  expired: ['blocked', 'recalled'],
  recalled: [],
};

/** States from which material may be drawn (consumed or split). */
export const CONSUMABLE_LOT_STATUSES: readonly LotStatus[] = ['released', 'partially_consumed'];

/** States that can never change again. */
export const TERMINAL_LOT_STATUSES: readonly LotStatus[] = ['recalled'];

export const LOT_STATUS_TAXONOMY: IndustryTaxonomy = {
  key: 'md.lotStatus',
  label: 'Lot Status',
  description:
    'The lifecycle state of a batch. Closed list — the state machine switches on these values, so a tenant cannot add to it.',
  extensible: false,
  values: LOT_STATUSES.map((s) => ({ value: s, label: LOT_STATUS_LABELS[s], tone: LOT_STATUS_TONES[s] })),
};

export interface TransitionCheck {
  ok: boolean;
  /** Why the transition was refused, in a sentence a user can act on. */
  reason?: string;
}

export function canTransitionLot(from: LotStatus, to: LotStatus): TransitionCheck {
  if (from === to) return { ok: true };
  if (!LOT_STATUSES.includes(to)) return { ok: false, reason: `"${to}" is not a lot status.` };
  if (TERMINAL_LOT_STATUSES.includes(from)) {
    return {
      ok: false,
      reason: `A ${LOT_STATUS_LABELS[from].toLowerCase()} lot is final — record a new decision rather than changing this one.`,
    };
  }
  if (!LOT_STATUS_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: `A lot cannot go from ${LOT_STATUS_LABELS[from]} to ${LOT_STATUS_LABELS[to]}.`,
    };
  }
  return { ok: true };
}

/* ── the lot model ─────────────────────────────────────────────────────────── */

export interface MedicalDeviceLot {
  id: string;
  tenantId: string;
  lotNumber: string;
  /** Record id of the owning product. */
  productId: string;
  /** Denormalized product code, kept so a lot reads correctly on its own. */
  productCode: string;
  /** Record id of the manufacturing order that produced this lot, if any. */
  manufacturingOrderId: string;
  status: LotStatus;
  manufactureDate: string;
  /**
   * Expiry, when the article has one. A great many devices — instruments, most
   * metal implants — have no expiry at all, so this is empty far more often
   * than it is set, and empty NEVER means "expired" or "unknown risk".
   */
  expiryDate: string;
  /** The original quantity. Immutable after creation. */
  quantity: number;
  /** Cumulative quantity issued downstream. Never decreases. */
  consumedQuantity: number;
  /** Cumulative quantity moved into child lots by splitting. Never decreases. */
  splitQuantity: number;
  unit: string;
  warehouseId: string;
  /** Supplier record id, for purchased raw material lots. */
  supplierId: string;
  /** The lot this material originally came from, following the whole chain. */
  sourceLotId: string;
  /** The immediate lot this was split from. */
  parentLotId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Quantity left in the lot. The ONLY definition — nothing stores this. */
export function lotRemaining(lot: Pick<MedicalDeviceLot, 'quantity' | 'consumedQuantity' | 'splitQuantity'>): number {
  return round6(lot.quantity - lot.consumedQuantity - lot.splitQuantity);
}

/**
 * Quantities are rounded to six decimals at every boundary. Lot quantities are
 * frequently fractional (kilograms of alloy, metres of wire) and binary floats
 * make 100 − 60 − 40 land at 5.7e-15 rather than 0, which would leave a lot
 * eternally "partially consumed" with a residue no one can see or issue.
 */
export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(str(value));
  return Number.isFinite(n) ? n : 0;
}

export function deviceLotFromRecord(record: EnterpriseEntity): MedicalDeviceLot {
  const f = record.fields;
  const status = str(f.status) as LotStatus;
  return {
    id: record.id,
    tenantId: str(record.metadata?.tenantId),
    lotNumber: str(f.lotNumber),
    productId: str(f.productId),
    productCode: str(f.productCode),
    manufacturingOrderId: str(f.manufacturingOrderId),
    status: LOT_STATUSES.includes(status) ? status : 'created',
    manufactureDate: str(f.manufactureDate),
    expiryDate: str(f.expiryDate),
    quantity: num(f.quantity),
    consumedQuantity: num(f.consumedQuantity),
    splitQuantity: num(f.splitQuantity),
    unit: str(f.unit) || 'unit',
    warehouseId: str(f.warehouseId),
    supplierId: str(f.supplierId),
    sourceLotId: str(f.sourceLotId),
    parentLotId: str(f.parentLotId),
    notes: str(f.notes),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* ── expiry ────────────────────────────────────────────────────────────────── */

/**
 * Is the lot past its expiry at `nowIso`? A lot with no expiry date is NEVER
 * expired — this returns false rather than treating missing data as a hazard.
 * Expiry is computed at read; it is never a stored flag that can go stale.
 */
export function isLotExpired(lot: Pick<MedicalDeviceLot, 'expiryDate'>, nowIso: string): boolean {
  if (!lot.expiryDate) return false;
  const expiry = Date.parse(lot.expiryDate);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) return false;
  return expiry < now;
}

/* ── quantity operations ───────────────────────────────────────────────────── */

export interface QuantityCheck {
  ok: boolean;
  reason?: string;
}

/**
 * May `amount` be drawn from this lot? One gate for both consumption and
 * splitting, because they compete for exactly the same material and checking
 * them separately is how a lot ends up over-drawn by one of each.
 */
export function canDraw(lot: MedicalDeviceLot, amount: number): QuantityCheck {
  if (!Number.isFinite(amount)) return { ok: false, reason: 'Quantity must be a number.' };
  if (amount <= 0) return { ok: false, reason: 'Quantity must be greater than zero.' };
  if (!CONSUMABLE_LOT_STATUSES.includes(lot.status)) {
    return {
      ok: false,
      reason: `Material cannot be drawn from a ${LOT_STATUS_LABELS[lot.status].toLowerCase()} lot — release it first.`,
    };
  }
  const remaining = lotRemaining(lot);
  if (round6(amount) > remaining) {
    return {
      ok: false,
      reason: `Only ${remaining} ${lot.unit} remain in ${lot.lotNumber}; ${amount} was requested.`,
    };
  }
  return { ok: true };
}

/** The status a lot lands in after `drawn` more units are consumed. */
export function statusAfterConsumption(lot: MedicalDeviceLot, drawn: number): LotStatus {
  const remainingAfter = round6(lotRemaining(lot) - drawn);
  if (remainingAfter > 0) return 'partially_consumed';
  // Nothing left. Which terminal state depends on WHY: if any of the original
  // quantity went to child lots, the lot was divided as well as used, and
  // "consumed" would overstate what happened to the material.
  return lot.splitQuantity > 0 ? 'exhausted' : 'consumed';
}

/** The status a lot lands in after `drawn` more units are split out. */
export function statusAfterSplit(lot: MedicalDeviceLot, drawn: number): LotStatus {
  const remainingAfter = round6(lotRemaining(lot) - drawn);
  return remainingAfter > 0 ? 'partially_consumed' : 'exhausted';
}

/* ── splitting ─────────────────────────────────────────────────────────────── */

export interface LotSplitPart {
  /** Lot number for the new child. Must be unique within the tenant. */
  lotNumber: string;
  quantity: number;
}

export interface LotSplitPlan {
  ok: boolean;
  reason?: string;
  /** Total drawn from the parent — always exactly the sum of the parts. */
  total: number;
  /** The parent's remaining quantity once the split is applied. */
  parentRemainingAfter: number;
  parentStatusAfter: LotStatus;
  parts: readonly LotSplitPart[];
}

/**
 * Plan a split without performing it.
 *
 * Quantity conservation is checked here as an equality, not an inequality: the
 * parts must sum to a quantity the parent can supply, and the parent's counters
 * absorb exactly that sum, so `original = remaining + consumed + Σ children`
 * holds by construction after the plan is applied.
 *
 * A split does NOT have to exhaust the parent — splitting 100 into 60 + 40 and
 * splitting 100 into 60 alone are both legal; the second leaves 40 in the
 * parent. The charter's example is the first, which this satisfies.
 */
export function planLotSplit(lot: MedicalDeviceLot, parts: readonly LotSplitPart[]): LotSplitPlan {
  const empty = {
    total: 0,
    parentRemainingAfter: lotRemaining(lot),
    parentStatusAfter: lot.status,
    parts: [],
  };
  if (parts.length === 0) {
    return { ok: false, reason: 'A split needs at least one part.', ...empty };
  }
  if (parts.length === 1 && round6(parts[0]!.quantity) === lotRemaining(lot)) {
    return {
      ok: false,
      reason: 'That split would move the entire remaining quantity into a single new lot — renumbering a lot is not a split, and it would break the 1:1 link between this lot number and the material it identifies.',
      ...empty,
    };
  }
  for (const part of parts) {
    if (!part.lotNumber.trim()) {
      return { ok: false, reason: 'Every part of a split needs a lot number.', ...empty };
    }
    if (!Number.isFinite(part.quantity) || part.quantity <= 0) {
      return { ok: false, reason: `Part "${part.lotNumber}" must have a quantity greater than zero.`, ...empty };
    }
  }
  const numbers = parts.map((p) => p.lotNumber.trim().toLowerCase());
  if (new Set(numbers).size !== numbers.length) {
    return { ok: false, reason: 'Two parts of the split were given the same lot number.', ...empty };
  }
  if (numbers.includes(lot.lotNumber.trim().toLowerCase())) {
    return { ok: false, reason: 'A child lot cannot reuse the parent lot number.', ...empty };
  }
  const total = round6(parts.reduce((sum, p) => sum + p.quantity, 0));
  const draw = canDraw(lot, total);
  if (!draw.ok) return { ok: false, reason: draw.reason ?? 'The split exceeds the lot.', ...empty };
  return {
    ok: true,
    total,
    parentRemainingAfter: round6(lotRemaining(lot) - total),
    parentStatusAfter: statusAfterSplit(lot, total),
    parts: parts.map((p) => ({ lotNumber: p.lotNumber.trim(), quantity: round6(p.quantity) })),
  };
}

/* ── merge: deliberately unsupported ───────────────────────────────────────── */

/**
 * Why lot merge is NOT implemented.
 *
 * Merging lots A and B into C asks the system to answer "which inputs produced
 * this unit?" with "one of two sets, we no longer know which". For a device
 * that goes into a person, that is the one answer traceability must never give:
 * a defect traced to A's raw material would force the recall of everything in
 * C, including material that was never at risk, and — worse — a defect confined
 * to B would be indistinguishable from one in A.
 *
 * The operations a merge is usually reached for are all representable without
 * losing that link:
 *   • Consuming several lots into one output → a manufacturing order with
 *     multiple input lots and one output lot. Already supported; the output
 *     lot's backward trace lists every input.
 *   • Storing several lots together → they share a warehouse. Storage location
 *     is not identity.
 *   • Shipping several lots on one shipment → one shipment, many lot links.
 *     Already supported.
 *
 * This constant is exported so the UI and the service quote the same reason,
 * and so a test can assert the refusal rather than the absence.
 */
export const LOT_MERGE_UNSUPPORTED_REASON =
  'Merging lots is not supported. A merged lot cannot say which inputs produced which unit, so a defect in one input would force the recall of material that was never at risk. To combine material, record a manufacturing order that consumes each lot and produces one output lot — the output lot then traces back to every input.';

/* ── grouping for the Lot Center ───────────────────────────────────────────── */

export type LotCenterView =
  | 'all'
  | 'quarantined'
  | 'released'
  | 'blocked'
  | 'expired'
  | 'recalled';

export const LOT_CENTER_VIEWS: readonly LotCenterView[] = [
  'all',
  'quarantined',
  'released',
  'blocked',
  'expired',
  'recalled',
];

export const LOT_CENTER_VIEW_LABELS: Record<LotCenterView, string> = {
  all: 'All Lots',
  quarantined: 'Quarantined',
  released: 'Released',
  blocked: 'Blocked',
  expired: 'Expired',
  recalled: 'Recalled',
};

/**
 * Does a lot belong in a Lot Center view?
 *
 * `expired` is deliberately not just `status === 'expired'`. A lot whose expiry
 * date has passed belongs in the Expired view the moment it passes, whether or
 * not anyone has run the transition — a view that only showed lots someone had
 * already marked would be a list of work already done, not work outstanding.
 */
export function lotInView(lot: MedicalDeviceLot, view: LotCenterView, nowIso: string): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'quarantined':
      return lot.status === 'quarantined';
    case 'released':
      return lot.status === 'released' || lot.status === 'partially_consumed';
    case 'blocked':
      return lot.status === 'blocked';
    case 'expired':
      return lot.status === 'expired' || (isLotExpired(lot, nowIso) && lot.status !== 'recalled');
    case 'recalled':
      return lot.status === 'recalled';
    default:
      return false;
  }
}

export interface LotCenterCounts {
  all: number;
  quarantined: number;
  released: number;
  blocked: number;
  expired: number;
  recalled: number;
}

export function countLotViews(lots: readonly MedicalDeviceLot[], nowIso: string): LotCenterCounts {
  const counts: LotCenterCounts = { all: 0, quarantined: 0, released: 0, blocked: 0, expired: 0, recalled: 0 };
  for (const lot of lots) {
    for (const view of LOT_CENTER_VIEWS) {
      if (lotInView(lot, view, nowIso)) counts[view] += 1;
    }
  }
  return counts;
}

/** Free-text search over the fields a lot is actually looked up by. */
export function matchesLotSearch(lot: MedicalDeviceLot, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [lot.lotNumber, lot.productCode, lot.warehouseId, lot.manufacturingOrderId, lot.supplierId].some(
    (field) => field.toLowerCase().includes(q),
  );
}
