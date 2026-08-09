/**
 * The Opportunity model and the first deterministic discovery engine.
 *
 * An "opportunity" here is a claim about the business, and a claim is only
 * worth showing if a person can check it. Four rules follow from that, and
 * every design decision in this file is one of them:
 *
 *  1. **Findings are derived, never stored.** A persisted finding is a finding
 *     that can go stale, and a stale finding presented as current is
 *     fabrication by omission — the reader has no way to know the world moved.
 *     Only the user's DECISION about a finding persists (see
 *     `OpportunityDecision`), keyed by a stable id so it re-attaches to the
 *     same finding on the next pass.
 *
 *  2. **Impact is backward-looking arithmetic, never a projected saving.**
 *     "You have already spent X more than your own best observed price" is a
 *     fact about orders that exist. "You will save X" requires assuming future
 *     volume, future prices and a successful negotiation — three things nobody
 *     knows. The first is computed here; the second is never produced.
 *
 *  3. **Confidence is a named tier with stated criteria, not a float.** 0.87
 *     looks like a measurement and is almost always a vibe. `strong` with the
 *     four checks that produced it listed underneath can be argued with.
 *
 *  4. **The obvious innocent explanation is checked, not ignored.** A lower
 *     unit price on a bigger order is a volume discount, not a leak. An engine
 *     that cannot tell those apart manufactures outrage from normal
 *     purchasing, so the volume case is DETECTED and it lowers confidence.
 *
 * Electron-free and store-free on purpose: the engine takes plain observations
 * and returns plain results, so it is exercised in tests exactly as it runs in
 * production.
 */
import type { AttributeStatus, HoldRecord } from './understanding';

/* ────────────────────────────── vocabulary ────────────────────────────── */

/**
 * The catalogue of analyses NeuroPause can perform. One member today: adding a
 * second is adding a producer, not reworking the model.
 */
export type OpportunityCategory = 'procurement_price_variance';

export const OPPORTUNITY_CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  procurement_price_variance: 'Purchase price variance',
};

/**
 * The lifecycle. `measured` is Program 5's terminus and is deliberately part of
 * the vocabulary now — declaring it late would mean migrating persisted
 * decisions later, and a status enum is the cheapest thing in the system to
 * get right early.
 */
export type OpportunityStatus =
  | 'new'
  | 'investigating'
  | 'recommended'
  | 'accepted'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'measured';

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  new: 'New',
  investigating: 'Looking into it',
  recommended: 'Recommended',
  accepted: 'Accepted',
  rejected: 'Not pursuing',
  in_progress: 'In progress',
  completed: 'Done',
  measured: 'Measured',
};

/**
 * Which transitions are legal.
 *
 * `completed → measured` exists as of Program 5, which added the measurement
 * behind it. The edge is not enough on its own: the subsystem refuses the
 * transition unless a real outcome has actually been measured, so nobody can
 * mark work "measured" that was never measured.
 */
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  new: ['investigating', 'accepted', 'rejected'],
  investigating: ['accepted', 'rejected', 'new'],
  recommended: ['accepted', 'rejected', 'investigating'],
  accepted: ['in_progress', 'rejected'],
  rejected: ['new'],
  // `in_progress → completed` is reached by executing the plan, not by hand.
  in_progress: ['completed', 'accepted'],
  completed: ['measured'],
  measured: [],
};

export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return OPPORTUNITY_TRANSITIONS[from].includes(to);
}

/** How much weight the evidence carries. Three tiers, each with stated criteria. */
export type ConfidenceTier = 'strong' | 'moderate' | 'weak';

export const CONFIDENCE_LABELS: Record<ConfidenceTier, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  weak: 'Weak evidence',
};

/** Ranking weight per tier. Documented here because it is the whole formula. */
export const CONFIDENCE_WEIGHT: Record<ConfidenceTier, number> = {
  strong: 1,
  moderate: 0.6,
  weak: 0.3,
};

/* ──────────────────────────────── model ───────────────────────────────── */

/** A pointer at a real record, openable in the module that owns it. */
export interface OpportunityRecordRef {
  moduleId: string;
  recordId: string;
  /** What to show — the record's own reference, e.g. 'PO-0003'. */
  label: string;
}

/** One checkable fact. `records` is what makes it checkable. */
export interface OpportunityEvidence {
  label: string;
  detail: string;
  records: readonly OpportunityRecordRef[];
}

/**
 * Money, with the arithmetic that produced it attached.
 *
 * `kind` exists so this figure can never be quietly reinterpreted. There is
 * exactly one member, and it says the money is already gone — not that any of
 * it is recoverable.
 */
export interface OpportunityImpact {
  amount: number;
  currency: string;
  kind: 'already_spent_above_best_observed_price';
  /** The formula, in words a person can re-derive by hand. */
  basis: string;
  /** Said plainly wherever the number appears. */
  caveat: string;
}

export interface OpportunityConfidence {
  tier: ConfidenceTier;
  basis: string;
  checks: readonly { label: string; passed: boolean; detail: string }[];
}

export interface OpportunityRankingFactor {
  label: string;
  value: string;
  /** How this factor enters the score, in words. */
  effect: string;
}

export interface OpportunityRanking {
  score: number;
  factors: readonly OpportunityRankingFactor[];
  basis: string;
}

/** Who performs a step. NeuroPause claims only what it can actually do. */
export type PlanActor = 'neuropause' | 'you';

export interface OpportunityPlanStep {
  order: number;
  title: string;
  detail: string;
  performedBy: PlanActor;
}

export interface OpportunityPlan {
  objective: string;
  steps: readonly OpportunityPlanStep[];
  affectedRecords: readonly OpportunityRecordRef[];
  expectedEffect: string;
  requiredPermissions: readonly string[];
  /** Null means no approval policy governs this action today — stated, not implied. */
  approvalRequired: string | null;
  risk: string;
  /** How anyone can confirm the action actually happened. */
  verification: string;
  /** What NeuroPause can execute here, if anything. */
  executable: OpportunityExecutable | null;
}

/**
 * The one action this vertical can perform. Narrow by design: a plan that can
 * run anything is a plan nobody can audit.
 */
export interface OpportunityExecutable {
  kind: 'create_rfq';
  label: string;
  targetModuleId: string;
  /** Everything the action needs, resolved at discovery time. */
  product: string;
  quantity: number;
  warehouse: string | null;
  /**
   * The finding's currency, carried onto the RFQ so the purchase order an
   * award produces can be compared against the orders that produced the
   * finding. Without it the order defaults to USD and the analysis that asked
   * for it can no longer see it.
   */
  currency: string;
}

export interface Opportunity {
  id: string;
  category: OpportunityCategory;
  /** The question that was asked of the data. */
  objective: string;
  title: string;
  /** ANSWER — what was found, in one line. */
  finding: string;
  /** REASON — why it matters. */
  why: string;
  evidence: readonly OpportunityEvidence[];
  sourceRecords: readonly OpportunityRecordRef[];
  impact: OpportunityImpact | null;
  /** Present exactly when `impact` is null: why no figure can be given. */
  impactUnavailable: string | null;
  confidence: OpportunityConfidence;
  /** UNKNOWN — what NeuroPause cannot establish. Never empty. */
  unknown: readonly string[];
  recommendation: string;
  plan: OpportunityPlan;
  ranking: OpportunityRanking;
  risk: string;
  status: OpportunityStatus;
  /** Reuses the platform provenance vocabulary rather than inventing one. */
  provenance: AttributeStatus;
  /** When this pass ran. Findings are recomputed, so this is always now-ish. */
  derivedAt: string;
  /* Governance links — populated from the persisted decision. */
  decisionId: string | null;
  holdId: string | null;
  executionRef: OpportunityRecordRef | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  statusNote: string | null;
  /** The impact figure when the user last decided, for honest re-reading. */
  impactAtDecision: number | null;
}

/**
 * What the pass examined and what it had to set aside.
 *
 * This is the most important object in the file when nothing is found, which
 * on a fresh install is always. "No opportunities" alone is indistinguishable
 * from "the analysis is broken"; the exclusions and the window turn it into
 * something a person can act on.
 */
export interface DataReview {
  windowDays: number;
  /** Every order read, including ones outside the window. */
  ordersExamined: number;
  /** Of those, how many fall inside the window. */
  ordersInWindow: number;
  /** Of those, how many carried everything the comparison needs. */
  ordersUsable: number;
  /** True when the bounded read hit its ceiling — there is more than was seen. */
  truncated: boolean;
  productsExamined: number;
  productsCompared: number;
  /**
   * `unit` matters: some reasons set aside an ORDER, others a whole PRODUCT.
   * Rendering "1×" against both without saying which is unreadable.
   */
  exclusions: readonly { reason: string; count: number; unit: 'order' | 'product' }[];
  wouldImprove: readonly string[];
}

export interface OpportunityCenterView {
  opportunities: readonly Opportunity[];
  dismissed: readonly Opportunity[];
  review: DataReview;
  /** Null when at least one opportunity was found. */
  insufficient: string | null;
  derivedAt: string;
}

/**
 * The outcome of running a plan.
 *
 * `ok: false` with a hold is the normal governed path, not an error — the
 * action was understood and withheld.
 *
 * `created` is populated ONLY when NeuroPause wrote the record itself and then
 * read it back by id — never merely because a write was attempted, and never
 * for a pre-existing record it happened to find. Those two exclusions are the
 * whole value of the field: the UI renders "X created" from it.
 */
export interface OpportunityExecuteResult {
  ok: boolean;
  message: string;
  hold: HoldRecord | null;
  created: OpportunityRecordRef | null;
  opportunity: Opportunity | null;
}

/** The only part of an opportunity that persists: what the user decided. */
export interface OpportunityDecision {
  id: string;
  status: OpportunityStatus;
  at: string;
  actor: string | null;
  note: string;
  impactAtDecision: number | null;
  decisionRecordId: string | null;
  holdId: string | null;
  executionRef: OpportunityRecordRef | null;
}

/* ─────────────────────────────── engine ───────────────────────────────── */

/**
 * A purchase order reduced to the fields the analysis needs.
 *
 * Deliberately not `EnterpriseEntity`: the engine should be impossible to
 * couple to the record store, and a caller that has to state which field means
 * "unit cost" cannot accidentally analyse the wrong column.
 */
export interface PurchaseOrderObservation {
  recordId: string;
  reference: string;
  supplier: string;
  product: string;
  quantity: number;
  unitCost: number;
  currency: string;
  status: string;
  /**
   * ISO. When the order was RECORDED, which is the only date a purchase order
   * reliably has — the module carries `expectedDelivery` (a delivery date, not
   * an order date), so using that to place an order in time would be wrong.
   * The distinction is surfaced to the reader rather than smoothed over.
   */
  orderedAt: string;
  warehouse: string | null;
}

export interface DiscoveryOptions {
  now: string;
  /** How far back to look. Stated in the UI; never silently applied. */
  lookbackDays?: number;
  /**
   * The caller's read ceiling, when it had one. Supplied so the review can say
   * "there is more than I saw" — a bounded read that reports its result as the
   * whole picture is the quietest way to be wrong.
   */
  readCeiling?: number;
}

export interface DiscoveryResult {
  opportunities: Opportunity[];
  review: DataReview;
}

export const DEFAULT_LOOKBACK_DAYS = 365;

/**
 * Statuses that represent money actually committed.
 *
 * A draft order is a thought, not a spend, and including one would make the
 * phrase "already spent" false. Excluded drafts are counted and reported
 * rather than silently dropped.
 */
const COMMITTED_STATUSES = new Set(['approved', 'sent', 'received']);

const MODULE_ID = 'procurement-orders';
const RFQ_MODULE_ID = 'procurement-rfqs';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Two FNV-1a passes with different offset bases, concatenated — 64 bits.
 *
 * Not cryptographic, but the width matters. At 32 bits the birthday
 * probability of ANY collision is ~0.3% across 5,000 products and ~4.5% across
 * 20,000, and a collision here is not a cosmetic clash: a persisted decision
 * would attach to the wrong product, so a dismissal could hide a finding about
 * something else, or an `executionRef` could claim an RFQ raised for a
 * different item. 64 bits makes that vanishingly unlikely for the price of six
 * more characters.
 */
function stableKey(input: string): string {
  const pass = (offset: number): number => {
    let hash = offset;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };
  return `${pass(0x811c9dc5).toString(36)}${pass(0x01000193).toString(36)}`;
}

/** The id a finding keeps across recomputes, so a decision re-attaches to it. */
export function priceVarianceOpportunityId(product: string, currency: string): string {
  return `opp_ppv_${stableKey(`${product.trim().toUpperCase()}|${currency.trim().toUpperCase()}`)}`;
}

function money(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A percentage that never rounds a real quantity down to nothing.
 *
 * "…accounts for 12.00 INR, which is 0% of the 40,000.00 INR spent" reads as a
 * contradiction and invites the reader to distrust the figure beside it.
 */
function percent(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return '0%';
  const rounded = Math.round((part / whole) * 100);
  return rounded === 0 ? '<1%' : `${rounded}%`;
}

type ExclusionUnit = 'order' | 'product';

interface Tally {
  add(reason: string, unit: ExclusionUnit): void;
  list(): { reason: string; count: number; unit: ExclusionUnit }[];
}

function tally(): Tally {
  const counts = new Map<string, { count: number; unit: ExclusionUnit }>();
  return {
    add(reason, unit) {
      const current = counts.get(reason);
      if (current) current.count += 1;
      else counts.set(reason, { count: 1, unit });
    },
    list() {
      return [...counts.entries()]
        .map(([reason, { count, unit }]) => ({ reason, count, unit }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    },
  };
}

/**
 * Find products bought at more than one price from more than one supplier.
 *
 * The whole analysis is one comparison done carefully: for each product, the
 * lowest unit price YOU actually paid becomes the reference, and every order
 * above it contributes `(price − best) × quantity` to a difference that has
 * already left the bank. No forecast, no benchmark, no market data — the
 * business is compared only against itself, which is the one comparison that
 * needs no external evidence to be true.
 */
export function discoverPriceVarianceOpportunities(
  orders: readonly PurchaseOrderObservation[],
  options: DiscoveryOptions,
): DiscoveryResult {
  const windowDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const cutoff = Date.parse(options.now) - windowDays * 86_400_000;
  const excluded = tally();

  const usable: PurchaseOrderObservation[] = [];
  let inWindow = 0;
  for (const order of orders) {
    const at = Date.parse(order.orderedAt);
    if (!Number.isFinite(at)) {
      excluded.add('No usable order date', 'order');
      continue;
    }
    if (at < cutoff) {
      excluded.add(`Older than the ${windowDays}-day window`, 'order');
      continue;
    }
    inWindow += 1;
    if (!COMMITTED_STATUSES.has(order.status.trim().toLowerCase())) {
      excluded.add('Not a committed order (draft or cancelled) — no money has moved', 'order');
      continue;
    }
    if (!order.product.trim()) {
      excluded.add('No product on the order — nothing to compare against', 'order');
      continue;
    }
    if (!order.supplier.trim()) {
      excluded.add('No supplier on the order', 'order');
      continue;
    }
    if (!(order.quantity > 0)) {
      excluded.add('Quantity is zero or missing', 'order');
      continue;
    }
    if (!(order.unitCost > 0) || !Number.isFinite(order.unitCost)) {
      excluded.add('Unit cost is zero, missing or not a number', 'order');
      continue;
    }
    const currency = order.currency.trim().toUpperCase();
    if (!currency) {
      // Defaulting a blank to INR and then telling the reader "all in INR"
      // would be asserting a fact about an empty field.
      excluded.add('No currency on the order, so its price cannot be compared', 'order');
      continue;
    }
    // Prices are ROUNDED ONCE, here, and every later comparison and display
    // uses the rounded value. Comparing raw floats while showing two decimals
    // produces cards that argue with themselves — "a spread of 0.00 INR"
    // underneath a non-zero total.
    usable.push({ ...order, unitCost: round2(order.unitCost), currency });
  }

  const groups = new Map<string, PurchaseOrderObservation[]>();
  for (const order of usable) {
    const key = order.product.trim().toUpperCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(order);
    else groups.set(key, [order]);
  }

  const opportunities: Opportunity[] = [];
  let compared = 0;

  for (const [, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const currencies = new Set(rows.map((r) => r.currency));
    if (currencies.size > 1) {
      // Two prices in two currencies are not comparable without an exchange
      // rate AT EACH ORDER DATE. The rates module holds rates, but applying
      // today's rate to last year's order would invent the difference this
      // engine is supposed to measure.
      excluded.add(
        'Product bought in more than one currency — prices are not comparable',
        'product',
      );
      continue;
    }
    const suppliers = new Set(rows.map((r) => r.supplier.trim().toLowerCase()));
    if (suppliers.size < 2) {
      excluded.add('Only one supplier for this product — nothing to compare against', 'product');
      continue;
    }
    compared += 1;

    // Non-null: `currencies.size` is exactly 1 here, and every row carries a
    // non-empty currency (blank ones were excluded at intake).
    const currency = rows[0]!.currency;
    const cheapest = Math.min(...rows.map((r) => r.unitCost));
    const dearer = rows.filter((r) => r.unitCost > cheapest);
    if (dearer.length === 0) continue; // Same price everywhere. Nothing to say.

    // ONE rounding policy: each order's contribution is rounded, and the total
    // is the sum of exactly the figures shown as evidence. Rounding the sum
    // separately makes the headline disagree with the lines beneath it, and
    // `impact.basis` invites the reader to add them up by hand.
    const deltas = dearer.map((row) => ({
      row,
      delta: round2((row.unitCost - cheapest) * row.quantity),
    }));
    const excess = deltas.reduce((sum, d) => sum + d.delta, 0);
    if (!(excess > 0)) continue;

    // Ties on price go to the LARGEST order, which is the reading least
    // flattering to the finding: it maximises the chance that the volume check
    // below fires and knocks the confidence down.
    const best = rows
      .filter((r) => r.unitCost === cheapest)
      .sort((a, b) => b.quantity - a.quantity)[0] as PurchaseOrderObservation;

    const largestDearer = Math.max(...dearer.map((r) => r.quantity));
    const volumeMayExplain = best.quantity > largestDearer;

    const opportunity = composePriceVariance({
      product: best.product.trim(),
      currency,
      rows,
      best,
      deltas,
      excess: round2(excess),
      volumeMayExplain,
      suppliers: suppliers.size,
      windowDays,
      now: options.now,
    });
    opportunities.push(opportunity);
  }

  opportunities.sort((a, b) => b.ranking.score - a.ranking.score || a.title.localeCompare(b.title));

  const truncated = options.readCeiling !== undefined && orders.length >= options.readCeiling;
  return {
    opportunities,
    review: {
      windowDays,
      ordersExamined: orders.length,
      ordersInWindow: inWindow,
      ordersUsable: usable.length,
      truncated,
      productsExamined: groups.size,
      productsCompared: compared,
      exclusions: excluded.list(),
      wouldImprove: improvementAdvice({
        examined: orders.length,
        inWindow,
        usable: usable.length,
        products: groups.size,
        compared,
        truncated,
        ceiling: options.readCeiling ?? 0,
      }),
    },
  };
}

/**
 * What extra data would let NeuroPause say more.
 *
 * Tailored to what was actually missing. Generic advice ("add more data") is
 * worse than none, because it is true of every situation and actionable in
 * none.
 */
function improvementAdvice(input: {
  examined: number;
  inWindow: number;
  usable: number;
  products: number;
  compared: number;
  truncated: boolean;
  ceiling: number;
}): string[] {
  const advice: string[] = [];
  if (input.truncated) {
    // A bounded read that presents its slice as the whole picture is the
    // quietest way for this surface to be wrong, so it is said first.
    advice.push(
      `Only the ${input.ceiling.toLocaleString('en-US')} most recently updated purchase orders were read, and there are at least that many. Anything older was not part of this analysis.`,
    );
  }
  if (input.examined === 0) {
    advice.push(
      'No purchase orders exist yet. Record purchases in Business → Procurement → Purchase Orders, or import them in Data, and this analysis runs on them automatically.',
    );
    return advice;
  }
  if (input.inWindow === 0) {
    advice.push(
      'Every order read falls outside the window. Widen it, or record more recent purchases.',
    );
  } else if (input.usable === 0) {
    advice.push(
      'No order inside the window was both committed (approved, sent or received) and carried a product, supplier, quantity and unit cost. Those are the whole comparison.',
    );
  }
  if (input.products > 0 && input.compared === 0) {
    advice.push(
      'Every product was bought from a single supplier. Comparing prices needs at least two suppliers for the same product.',
    );
  }
  advice.push(
    'Consistent product codes matter more than anything else here: the same item entered as two different SKUs is compared as two different products, and a real price gap disappears.',
  );
  return advice;
}

interface ComposeInput {
  product: string;
  currency: string;
  rows: readonly PurchaseOrderObservation[];
  best: PurchaseOrderObservation;
  /** Each dearer order with the ROUNDED amount it contributes. */
  deltas: readonly { row: PurchaseOrderObservation; delta: number }[];
  excess: number;
  volumeMayExplain: boolean;
  suppliers: number;
  windowDays: number;
  now: string;
}

function composePriceVariance(input: ComposeInput): Opportunity {
  const { product, currency, rows, best, deltas, excess, volumeMayExplain } = input;
  const dearer = deltas.map((d) => d.row);
  const id = priceVarianceOpportunityId(product, currency);
  const ref = (o: PurchaseOrderObservation): OpportunityRecordRef => ({
    moduleId: MODULE_ID,
    recordId: o.recordId,
    label: o.reference || o.recordId,
  });
  const highest = [...dearer].sort((a, b) => b.unitCost - a.unitCost)[0] as PurchaseOrderObservation;
  const spread = round2(highest.unitCost - best.unitCost);
  const spreadPct = percent(spread, best.unitCost);
  const totalSpend = round2(rows.reduce((s, r) => s + r.unitCost * r.quantity, 0));
  const sharePct = percent(excess, totalSpend);

  const confidence = gradeConfidence({
    orderCount: rows.length,
    supplierCount: input.suppliers,
    volumeMayExplain,
    bestQty: best.quantity,
    largestDearerQty: Math.max(...dearer.map((r) => r.quantity)),
  });

  const evidence: OpportunityEvidence[] = [
    {
      label: 'Lowest price you actually paid',
      detail: `${money(best.unitCost, currency)} per unit to ${best.supplier} on ${best.reference} (${plural(best.quantity, 'unit', 'units')}).`,
      records: [ref(best)],
    },
    {
      label: `Paid more on ${plural(dearer.length, 'order', 'orders')}`,
      // The same rounded figures the impact total is the sum of, so a reader
      // adding these up by hand lands exactly on the headline.
      detail: deltas
        .map(
          ({ row: o, delta }) =>
            `${o.reference}: ${money(o.unitCost, currency)} per unit to ${o.supplier} × ${plural(o.quantity, 'unit', 'units')} = ${money(delta, currency)} above the lowest price`,
        )
        .join('; '),
      records: dearer.map(ref),
    },
    {
      label: 'What was compared',
      detail: `${plural(rows.length, 'committed order', 'committed orders')} for ${product} from ${plural(input.suppliers, 'supplier', 'suppliers')}, all in ${currency}, within the last ${input.windowDays} days.`,
      records: rows.map(ref),
    },
  ];

  const unknown: string[] = [
    volumeMayExplain
      ? `Volume probably explains part of this. The cheapest order (${plural(best.quantity, 'unit', 'units')}) was larger than every dearer one, which is what a normal volume discount looks like.`
      : 'Volume discounts are not modelled. Order sizes are shown so you can judge whether quantity explains any of the gap.',
    'Specification is not compared. A cheaper unit may be a different grade, pack size or lead time — NeuroPause reads the product code, not the product.',
    'Prices are taken from the purchase orders as entered. They have not been reconciled against supplier bills, so a later credit note or renegotiation is not reflected.',
    'Nothing here says the lower price is still available, or that either supplier would honour it again.',
    'The window is measured from when each order was RECORDED in NeuroPause. Purchase orders carry an expected delivery date but no order date, so imported history is dated by its import, not by when it was placed.',
  ];

  const impact: OpportunityImpact = {
    amount: excess,
    currency,
    kind: 'already_spent_above_best_observed_price',
    basis: `Sum over ${plural(dearer.length, 'order', 'orders')} of (unit price − ${money(best.unitCost, currency)}) × quantity.`,
    caveat:
      'This is money already spent, not a saving available today. It is what the same purchases would have cost at the lowest price you paid, and it is a measure of the gap — not a forecast.',
  };

  const supplierNames = [...new Set(rows.map((r) => r.supplier.trim()))].sort();
  const quantity = Math.max(1, Math.round(dearer.reduce((s, r) => s + r.quantity, 0) / dearer.length));
  const plan: OpportunityPlan = {
    objective: `Get current, comparable quotes for ${product} so the next order is priced against more than one supplier.`,
    steps: [
      {
        order: 1,
        title: 'Confirm the orders describe the same thing',
        detail: `Open ${best.reference} and ${highest.reference} and check the specification matches. If they do not, this finding does not apply and you should dismiss it.`,
        performedBy: 'you',
      },
      {
        order: 2,
        title: 'Raise a request for quotation',
        detail: `NeuroPause creates an open RFQ for ${product} in Procurement, seeded with the quantity you typically order (${plural(quantity, 'unit', 'units')}). It is created as a draft record; nothing is sent to any supplier.`,
        performedBy: 'neuropause',
      },
      {
        order: 3,
        title: `Invite ${supplierNames.length === 1 ? 'the supplier' : 'the suppliers'} to quote`,
        // The DISTINCT suppliers on this product. Naming `best.supplier` and
        // `highest.supplier` reads "add quotes from Acme and Acme" whenever one
        // supplier sold at both the lowest and the highest price — which is the
        // common case when a price drifts over time.
        detail: `Add quotes from ${formatList(supplierNames)} — and any other source you want to test — to the RFQ. The RFQ already computes best value and best lead time once quotes are in.`,
        performedBy: 'you',
      },
      {
        order: 4,
        title: 'Award and order',
        detail: 'Awarding the RFQ creates a purchase order against the chosen supplier through the existing procurement flow, with its own approval.',
        performedBy: 'you',
      },
    ],
    affectedRecords: rows.map(ref),
    expectedEffect:
      'You will hold current, comparable quotes for this product. Whether that changes the price depends on the suppliers, and NeuroPause will not predict it.',
    requiredPermissions: ['procurement:manage'],
    approvalRequired: null,
    risk: 'Low. Creating an RFQ adds a draft record and changes no existing order, no stock and no ledger. It sends nothing to a supplier.',
    verification:
      'After writing, NeuroPause reads the RFQ back out of the procurement module by id and shows you the reference. If it cannot be read back, the action is held rather than reported as done. This confirms the record exists in the running app; it is not a check that the write reached disk.',
    executable: {
      kind: 'create_rfq',
      label: 'Create an RFQ for this product',
      targetModuleId: RFQ_MODULE_ID,
      product,
      quantity,
      warehouse: best.warehouse,
      currency,
    },
  };

  return {
    id,
    category: 'procurement_price_variance',
    objective: 'Is the business paying different prices for the same product?',
    title: `${product} is bought at ${plural(new Set(rows.map((r) => r.unitCost)).size, 'different price', 'different prices')}`,
    finding: `You paid between ${money(best.unitCost, currency)} and ${money(highest.unitCost, currency)} per unit for ${product} — a spread of ${money(spread, currency)} (${spreadPct}) across ${plural(input.suppliers, 'supplier', 'suppliers')}.`,
    why: `Across ${plural(rows.length, 'committed order', 'committed orders')} that spread accounts for ${money(excess, currency)}, which is ${sharePct} of the ${money(totalSpend, currency)} spent on this product in the window.`,
    evidence,
    sourceRecords: rows.map(ref),
    impact,
    impactUnavailable: null,
    confidence,
    unknown,
    recommendation: `Get both suppliers to quote the same specification before the next order for ${product}.`,
    plan,
    ranking: {
      score: round2(excess * CONFIDENCE_WEIGHT[confidence.tier]),
      factors: [
        {
          label: 'Money above your best price',
          value: money(excess, currency),
          effect: 'The base of the score.',
        },
        {
          label: 'Share of spend on this product',
          value: sharePct,
          effect: 'Shown for context; it does not change the score.',
        },
        {
          label: 'Orders affected',
          value: plural(dearer.length, 'order', 'orders'),
          effect: 'Shown for context; it does not change the score.',
        },
        {
          label: 'Confidence',
          value: CONFIDENCE_LABELS[confidence.tier],
          effect: `Multiplies the score by ${CONFIDENCE_WEIGHT[confidence.tier]}.`,
        },
      ],
      basis:
        'Ranked by the money spent above your own best price, multiplied by how much the comparison can be trusted. Nothing else enters the score.',
    },
    risk: plan.risk,
    status: 'new',
    provenance: 'system_derived',
    derivedAt: input.now,
    decisionId: null,
    holdId: null,
    executionRef: null,
    statusChangedAt: null,
    statusChangedBy: null,
    statusNote: null,
    impactAtDecision: null,
  };
}

/**
 * Grade the comparison against four named checks.
 *
 * The volume check is the one that matters: it is the difference between
 * "you are paying two prices for one thing" and "you got a discount for
 * ordering more", and an engine that skips it will confidently report the
 * second as the first.
 */
function gradeConfidence(input: {
  orderCount: number;
  supplierCount: number;
  volumeMayExplain: boolean;
  bestQty: number;
  largestDearerQty: number;
}): OpportunityConfidence {
  const enoughOrders = input.orderCount >= 3;
  const enoughSuppliers = input.supplierCount >= 2;
  const notVolume = !input.volumeMayExplain;

  const checks = [
    {
      label: 'Enough orders to see a pattern',
      passed: enoughOrders,
      detail: enoughOrders
        ? `${input.orderCount} committed orders compared.`
        : `Only ${input.orderCount} committed orders — this is a single comparison, not a pattern.`,
    },
    {
      label: 'More than one supplier',
      passed: enoughSuppliers,
      detail: `${input.supplierCount} suppliers supplied this product.`,
    },
    {
      label: 'Not explained by order size',
      passed: notVolume,
      detail: notVolume
        ? `The cheapest order (${input.bestQty} units) was not larger than the dearest (${input.largestDearerQty} units), so a volume discount does not account for the gap.`
        : `The cheapest order (${input.bestQty} units) was larger than every dearer one (largest ${input.largestDearerQty} units), so some of the gap is probably a volume discount.`,
    },
    {
      label: 'One currency',
      passed: true,
      detail: 'All compared orders are in the same currency, so no exchange rate enters the arithmetic.',
    },
  ];

  let tier: ConfidenceTier;
  if (enoughOrders && enoughSuppliers && notVolume) tier = 'strong';
  else if (notVolume || enoughOrders) tier = 'moderate';
  else tier = 'weak';

  const failed = checks.filter((c) => !c.passed);
  return {
    tier,
    basis:
      failed.length === 0
        ? 'All four checks passed.'
        : `${plural(failed.length, 'check', 'checks')} did not pass: ${failed.map((c) => c.label.toLowerCase()).join('; ')}.`,
    checks,
  };
}

/**
 * The sentence shown when the pass found nothing.
 *
 * Three different situations, three different sentences. Collapsing them into
 * one message would hide the only useful information: which of them it is.
 */
export function insufficiencyMessage(review: DataReview): string {
  if (review.ordersExamined === 0) {
    return 'Insufficient evidence to identify a reliable opportunity — there are no purchase orders to analyse yet.';
  }
  if (review.ordersInWindow === 0) {
    return `Insufficient evidence to identify a reliable opportunity — every purchase order is older than the ${review.windowDays}-day window.`;
  }
  if (review.ordersUsable === 0) {
    // The dominant exclusion, not a guess. Reporting "none carried the fields"
    // when in fact every order was a draft names the wrong problem, and the
    // reader goes and checks the wrong thing.
    const top = review.exclusions.find((e) => e.unit === 'order');
    return `Insufficient evidence to identify a reliable opportunity — no purchase order in the window could be used${top ? `: ${top.reason.toLowerCase()}` : ''}.`;
  }
  if (review.productsCompared === 0) {
    return 'No reliable opportunities identified from the available evidence — no product was bought from more than one supplier, so there are no prices to compare.';
  }
  return 'No reliable opportunities identified from the available evidence — every product compared was bought at a consistent price.';
}
