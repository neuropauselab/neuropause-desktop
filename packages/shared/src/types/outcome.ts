/**
 * Outcome measurement — did the action actually change anything?
 *
 * The rule this whole file is built to enforce: **execution is not success.**
 * NeuroPause created a request for quotation. That is a fact. Whether the
 * business now pays less is a completely separate question, answerable only by
 * comparing real purchase orders, and frequently not answerable at all. A
 * product that quietly treats "we did the thing" as "the thing worked" is
 * describing its own activity and calling it business value.
 *
 * Four consequences run through everything below:
 *
 *  1. **Measured is not verified.** A number can be computed from data that is
 *     incomplete, mis-associated, or not yet transacted. Six named checks stand
 *     between a computed figure and a verified one, and the UI must be able to
 *     show a measurement that has not passed them.
 *
 *  2. **Observed is not caused.** The price after the action may be lower
 *     because of the action, because of the season, or because someone
 *     unrelated renegotiated. NeuroPause has no causal methodology, so it says
 *     "observed after", never "achieved" or "delivered".
 *
 *  3. **Negative outcomes are first-class.** If the price went UP, that is the
 *     answer, and it is reported with exactly the same prominence. A
 *     measurement system that can only report improvement is a marketing
 *     device.
 *
 *  4. **Unavailable is a real result.** No award yet, no baseline, two
 *     currencies — each produces a specific, named refusal explaining what is
 *     missing and what would fix it, never a zero or a blank.
 *
 * Like the discovery engine, this is pure and store-free: outcomes are DERIVED
 * on every read from live records, so a measurement cannot go stale while
 * still looking current. What persists is the revision log — the record that
 * at some past moment we observed a different number, and why.
 */
import type { PurchaseOrderObservation } from './opportunity';

/* ────────────────────────────── vocabulary ────────────────────────────── */

/**
 * The lifecycle of a measurement.
 *
 * `measuring` from the specification is deliberately absent: measurement here
 * is synchronous arithmetic over records already in memory, so no state exists
 * in which it is "in progress". Declaring a status nothing can ever reach
 * means every reader has to wonder what produces it, and every renderer has to
 * handle a case that cannot occur.
 */
export type OutcomeStatus =
  | 'unavailable'
  | 'pending'
  | 'measured'
  | 'verified'
  | 'failed_to_verify';

export const OUTCOME_STATUS_LABELS: Record<OutcomeStatus, string> = {
  unavailable: 'Measurement unavailable',
  pending: 'Measurement pending',
  measured: 'Measured, not yet verified',
  verified: 'Measured and verified',
  failed_to_verify: 'Could not verify',
};

/**
 * Which way it went.
 *
 * Named for the DIRECTION of the number, not for whether anyone should be
 * pleased. "Favourable" is a statement about arithmetic; "success" would be a
 * statement about causation nobody here is entitled to make.
 */
export type OutcomeDirection = 'favourable' | 'unfavourable' | 'unchanged' | 'unknown';

export const OUTCOME_DIRECTION_LABELS: Record<OutcomeDirection, string> = {
  // Arithmetic, not attainment. "Moved in the intended direction" smuggles a
  // claim about goals into a label that should only describe two numbers.
  favourable: 'Lower than the baseline',
  unfavourable: 'Higher than the baseline',
  unchanged: 'Level with the baseline',
  unknown: 'Direction unknown',
};

export type OutcomeConfidenceTier = 'strong' | 'moderate' | 'weak';

export const OUTCOME_CONFIDENCE_LABELS: Record<OutcomeConfidenceTier, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
};

/** The six things that must hold before a measurement may be called verified. */
export type VerificationCheckId =
  | 'source_exists'
  | 'source_accessible'
  | 'calculation_succeeded'
  | 'period_valid'
  | 'records_associated'
  | 'no_quality_blocker';

export interface VerificationCheck {
  id: VerificationCheckId;
  label: string;
  passed: boolean;
  /** Why it passed or failed, in terms of the actual records. */
  detail: string;
}

/* ──────────────────────────────── model ───────────────────────────────── */

export interface OutcomeRecordRef {
  moduleId: string;
  recordId: string;
  label: string;
}

/**
 * One side of the comparison.
 *
 * `value` is nullable and that is the point — "we could not establish a
 * baseline" has to be representable, because it is the common case.
 */
export interface OutcomeSide {
  value: number | null;
  unit: string;
  /** How this figure was arrived at, in words a person can re-derive. */
  method: string;
  /** The records it was computed from. */
  records: readonly OutcomeRecordRef[];
  /** The span the records fall in, by their own dates. */
  period: OutcomePeriod | null;
}

export interface OutcomePeriod {
  fromIso: string;
  toIso: string;
  days: number;
  /** What the dates actually mean — never assumed to be business dates. */
  basis: string;
}

/**
 * The money consequence, when and only when it can be computed honestly.
 *
 * Requires all four of quantity, price, currency and period to be valid, and
 * even then describes only what was OBSERVED on a specific order — never an
 * annualised projection, and never the word "saving".
 */
export interface OutcomeFinancialEffect {
  amount: number;
  currency: string;
  basis: string;
  caveat: string;
}

export interface OutcomeConfidence {
  tier: OutcomeConfidenceTier;
  basis: string;
}

/** A measurement observed at a point in time, kept so history is not lost. */
export interface OutcomeRevision {
  /**
   * P12 — the tenant this record belongs to.
   *
   * Optional in the TYPE so a file written before P12 still parses. Absent means
   * UNRESOLVED: visible to no tenant, counted, never auto-assigned.
   */
  tenantId?: string | null;
  /** The workspace inside that tenant. Absent means tenant-level. */
  workspaceId?: string | null;
  id: string;
  /** Deterministic identity: opportunity + metric. */
  outcomeKey: string;
  at: string;
  actor: string | null;
  /**
   * The execution this observation measured. On the revision rather than in
   * the key, so replacing an RFQ shows up as a change in the history instead
   * of orphaning everything recorded before it.
   */
  executionRecordId: string | null;
  status: OutcomeStatus;
  baseline: number | null;
  measurement: number | null;
  change: number | null;
  currency: string;
  /** Why a new revision exists rather than an edit to the previous one. */
  reason: string;
}

export interface Outcome {
  /** Deterministic — the same decision, execution, metric and period. */
  id: string;
  opportunityId: string;
  /** The Decision Record for the action, when there is one. */
  decisionId: string | null;
  execution: OutcomeRecordRef | null;
  status: OutcomeStatus;
  /** What the plan said it was trying to do — never conflated with the result. */
  expectedEffect: string;
  metric: string;
  baseline: OutcomeSide;
  measurement: OutcomeSide;
  /** measurement − baseline, in the metric's unit. Null when either side is. */
  change: number | null;
  changePercent: number | null;
  direction: OutcomeDirection;
  currency: string;
  financialEffect: OutcomeFinancialEffect | null;
  /** Present exactly when `financialEffect` is null. */
  financialEffectUnavailable: string | null;
  /** The historical figure the opportunity carried when the user decided. */
  impactAtDecision: number | null;
  verification: readonly VerificationCheck[];
  confidence: OutcomeConfidence;
  /** Never empty — there is always something a measurement cannot establish. */
  unknown: readonly string[];
  /**
   * The sentence that refuses the causal claim. Always present on a measured
   * outcome, because the tempting reading of any change is "we did that".
   */
  causalNote: string;
  /** Present when nothing could be measured — `unavailable`, `pending`, or a
   * `failed_to_verify` caused by a structural defect rather than a bad number. */
  blocked: OutcomeBlocked | null;
  /** When this pass ran. Derived every read, so always current. */
  measuredAt: string;
  /** Prior observations of this same outcome, newest first. */
  revisions: readonly OutcomeRevision[];
}

export interface OutcomeBlocked {
  headline: string;
  available: readonly string[];
  missing: readonly string[];
  wouldEnable: readonly string[];
}

/* ─────────────────────────────── engine ───────────────────────────────── */

/** The execution NeuroPause performed, as the measurement needs to see it. */
export interface ExecutionObservation {
  moduleId: string;
  recordId: string;
  label: string;
  /** When the RFQ was created — the boundary between "before" and "after". */
  createdAt: string;
  /** open | awarded | cancelled */
  status: string;
  /** The purchase order the award produced, if it has been awarded. */
  awardedOrderId: string | null;
  awardedSupplier: string | null;
  awardedAt: string | null;
  product: string;
  currency: string | null;
  /**
   * The finding this execution was raised from, if it names one.
   *
   * The only non-circular way to check that an execution belongs to the
   * opportunity being measured. Comparing products is tautological — the
   * awarded order copies its product from the RFQ — so without this, the
   * check called "the records belong to this finding" can never fail.
   */
  sourceOpportunity: string | null;
}

export interface MeasurementInput {
  opportunityId: string;
  decisionId: string | null;
  /** The product and currency the opportunity was raised about. */
  product: string;
  currency: string;
  expectedEffect: string;
  impactAtDecision: number | null;
  /** The RFQ, resolved from the opportunity's execution reference. */
  execution: ExecutionObservation | null;
  /** Every purchase order for this product, committed or not. */
  orders: readonly PurchaseOrderObservation[];
  revisions: readonly OutcomeRevision[];
  now: string;
}

const METRIC = 'Average unit purchase price';
const UNIT = 'per unit';
const MODULE_ID = 'procurement-orders';

/** Statuses that mean money is committed. Mirrors the discovery engine. */
const COMMITTED = new Set(['approved', 'sent', 'received']);

/**
 * Round to cents, symmetrically.
 *
 * `Math.round` rounds halves toward +∞, so a half-cent rise would round away
 * from zero while a half-cent fall rounded to nothing — a systematic bias
 * against favourable results in a file whose stated rule is that both
 * directions get identical treatment. Rounding the magnitude and restoring the
 * sign removes it.
 */
function round2(value: number): number {
  const rounded = (value < 0 ? -1 : 1) * (Math.round(Math.abs(value) * 100) / 100);
  // Normalise negative zero. A sub-cent fall would otherwise render as
  // "-0.00 INR" and compare unequal to zero, so a difference too small to
  // exist would still be reported as a direction.
  return rounded === 0 ? 0 : rounded;
}

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

/**
 * The identity a measurement keeps across recomputes.
 *
 * Opportunity + metric, and deliberately NOT the execution or the period. An
 * earlier version keyed on those too, which satisfied idempotency and quietly
 * broke the audit trail: cancelling an RFQ and raising another minted a new
 * key, so every prior observation became unreachable. Unreachable and deleted
 * look the same to the person looking for them, and this store's whole claim
 * is that nothing is destroyed. The execution is recorded ON each revision
 * instead, so a change of execution is visible in the history rather than
 * hiding it.
 */
export function outcomeIdFor(input: { opportunityId: string; metric: string }): string {
  return `out_${stableKey(`${input.opportunityId}|${input.metric}`)}`;
}

/**
 * Signed, deliberately. Clamping a backwards period to zero would render
 * "2026-08-09 to 2026-07-01 (0 days)" — a span that runs the wrong way and
 * claims to be empty, hiding the very inversion worth noticing.
 */
function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

const DATE_BASIS =
  'Dates are when each order was RECORDED in NeuroPause. Purchase orders carry an expected delivery date but no order date, so this is the only date the records actually have.';

function emptySide(method: string): OutcomeSide {
  return { value: null, unit: UNIT, method, records: [], period: null };
}

function ref(order: PurchaseOrderObservation): OutcomeRecordRef {
  return { moduleId: MODULE_ID, recordId: order.recordId, label: order.reference || order.recordId };
}

function money(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function blockedOutcome(
  input: MeasurementInput,
  status: 'unavailable' | 'pending',
  blocked: OutcomeBlocked,
  execution: OutcomeRecordRef | null,
): Outcome {
  return {
    id: outcomeIdFor({ opportunityId: input.opportunityId, metric: METRIC }),
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    execution,
    status,
    expectedEffect: input.expectedEffect,
    metric: METRIC,
    baseline: emptySide('Not established.'),
    measurement: emptySide('Not established.'),
    change: null,
    changePercent: null,
    direction: 'unknown',
    currency: input.currency,
    financialEffect: null,
    financialEffectUnavailable:
      'There is no measured change, so there is nothing to convert into money.',
    impactAtDecision: input.impactAtDecision,
    verification: [],
    confidence: { tier: 'weak', basis: 'Nothing has been measured yet.' },
    unknown: [...blocked.missing],
    causalNote:
      'Nothing has been measured, so no claim — causal or otherwise — is being made about the result.',
    blocked,
    measuredAt: input.now,
    revisions: input.revisions,
  };
}

/**
 * Measure what happened after the action.
 *
 * The comparison is deliberately narrow. The baseline is what the business was
 * paying for this product BEFORE the RFQ existed; the measurement is the ONE
 * purchase order that awarding this RFQ produced. Widening the measurement to
 * "any order placed since" would credit the action with purchasing it had
 * nothing to do with — the measurement equivalent of the causal overclaim this
 * file exists to prevent.
 */
export function measurePriceOutcome(input: MeasurementInput): Outcome {
  const { execution } = input;
  const wanted = input.product.trim().toUpperCase();
  const currency = input.currency.trim().toUpperCase();

  /* ── Is there an execution at all? ─────────────────────────────────── */
  if (!execution) {
    return blockedOutcome(
      input,
      'unavailable',
      {
        headline: 'No action has been run for this opportunity, so there is nothing to measure.',
        available: ['The finding itself, and whatever the purchase orders currently say.'],
        missing: ['An execution. NeuroPause has not created a request for quotation for it.'],
        wouldEnable: ['Accept the opportunity and run its plan.'],
      },
      null,
    );
  }

  const executionRef: OutcomeRecordRef = {
    moduleId: execution.moduleId,
    recordId: execution.recordId,
    label: execution.label,
  };

  /* ── Identity. The outcome must belong to THIS execution. ──────────── */
  if (execution.product.trim().toUpperCase() !== wanted) {
    return blockedOutcome(
      input,
      'unavailable',
      {
        headline:
          'The recorded execution is for a different product, so measuring it here would attribute the wrong work to this finding.',
        available: [`Execution ${execution.label} covers "${execution.product}".`],
        missing: [`An execution covering "${input.product}".`],
        wouldEnable: [
          'Run this opportunity’s plan so its own request for quotation is created and linked.',
        ],
      },
      executionRef,
    );
  }

  /* ── Baseline: what was being paid before the action. ──────────────── */
  const actionAt = Date.parse(execution.createdAt);
  const baselineOrders = input.orders.filter((o) => {
    if (o.product.trim().toUpperCase() !== wanted) return false;
    if (o.currency.trim().toUpperCase() !== currency) return false;
    if (!COMMITTED.has(o.status.trim().toLowerCase())) return false;
    const at = Date.parse(o.orderedAt);
    return Number.isFinite(at) && at < actionAt && o.quantity > 0 && o.unitCost > 0;
  });

  const baselineQty = baselineOrders.reduce((s, o) => s + o.quantity, 0);
  /**
   * Unrounded, and kept that way through every calculation below.
   *
   * A weighted average is almost never exact — this fixture's is
   * 115.714285…— and rounding it to cents before subtracting, then
   * multiplying by quantity, amplifies the discarded fraction by the order
   * size. On a 10,000-unit order that invents tens of currency units on a
   * screen whose entire premise is not inventing figures. Rounding happens
   * once, at the display boundary.
   */
  const rawBaseline =
    baselineQty > 0
      ? baselineOrders.reduce((s, o) => s + o.unitCost * o.quantity, 0) / baselineQty
      : null;
  const baselineValue = rawBaseline === null ? null : round2(rawBaseline);

  const baselineDates = baselineOrders.map((o) => o.orderedAt).sort();
  const baseline: OutcomeSide = {
    value: baselineValue,
    unit: UNIT,
    method:
      baselineValue === null
        ? `No committed order for ${input.product} in ${currency} exists before the action, so there is nothing to compare against.`
        : `Quantity-weighted average of ${baselineOrders.length} committed order${baselineOrders.length === 1 ? '' : 's'} placed before the action: total spend ÷ total units. Only committed orders count, so this is what was actually paid — the measured side may be an order that is only agreed.`,
    records: baselineOrders.map(ref),
    period:
      baselineDates.length > 0
        ? {
            fromIso: baselineDates[0] as string,
            toIso: execution.createdAt,
            days: daysBetween(baselineDates[0] as string, execution.createdAt),
            basis: DATE_BASIS,
          }
        : null,
  };

  /* ── Has the execution produced a transaction yet? ─────────────────── */
  if (execution.status.trim().toLowerCase() === 'cancelled') {
    return blockedOutcome(
      input,
      'unavailable',
      {
        headline: `${execution.label} was cancelled, so the action produced no purchase to measure.`,
        available: [
          baselineValue === null
            ? 'No usable baseline either.'
            : `A baseline of ${money(baselineValue, currency)} per unit from ${baselineOrders.length} earlier order(s).`,
        ],
        missing: ['A purchase order resulting from the action. The RFQ was cancelled before award.'],
        wouldEnable: ['Raise a new request for quotation and award it.'],
      },
      executionRef,
    );
  }

  // An `awardedOrder` on an RFQ that is not awarded is a half-written record,
  // not a result. `readOnly` is a form hint — `store.update` bypasses the
  // module's validator entirely — so the status has to be checked, not assumed
  // from the presence of the id.
  if (!execution.awardedOrderId || execution.status.trim().toLowerCase() !== 'awarded') {
    return blockedOutcome(
      input,
      'pending',
      {
        headline:
          'The action ran, but no purchase has resulted from it yet — so there is nothing to measure against the baseline.',
        available: [
          `${execution.label} is open in Procurement.`,
          baselineValue === null
            ? 'No committed order before the action, so no baseline either.'
            : `A baseline of ${money(baselineValue, currency)} per unit from ${baselineOrders.length} earlier order${baselineOrders.length === 1 ? '' : 's'}.`,
        ],
        missing: [
          'A downstream business transaction. Awarding the RFQ creates the purchase order this measurement compares against.',
        ],
        wouldEnable: [
          `Add supplier quotes to ${execution.label} and award it. The award drafts a purchase order, and the price on that order is the measurement.`,
        ],
      },
      executionRef,
    );
  }

  const awarded = input.orders.find((o) => o.recordId === execution.awardedOrderId) ?? null;
  if (!awarded) {
    // The RFQ says it awarded an order and the order is not there. That is a
    // broken association, not an absence — and reporting it as "pending" would
    // hide a real integrity problem behind a normal-looking state.
    const outcome = blockedOutcome(
      input,
      'unavailable',
      {
        headline: `${execution.label} records an award, but the purchase order it points at cannot be found.`,
        available: [`${execution.label} names purchase order ${execution.awardedOrderId}.`],
        missing: [`Purchase order ${execution.awardedOrderId} is not in the procurement store.`],
        wouldEnable: [
          'Restore or re-create the awarded purchase order, or cancel and re-run the sourcing.',
        ],
      },
      executionRef,
    );
    return { ...outcome, status: 'failed_to_verify' };
  }

  /* ── Measurement: the price on the order the award produced. ───────── */
  const awardedCurrency = awarded.currency.trim().toUpperCase();
  const measurementValue = awarded.unitCost > 0 ? round2(awarded.unitCost) : null;
  const measurement: OutcomeSide = {
    value: measurementValue,
    unit: UNIT,
    method: `Unit price on ${awarded.reference}, the purchase order created by awarding ${execution.label}${execution.awardedSupplier ? ` to ${execution.awardedSupplier}` : ''}.`,
    records: [ref(awarded)],
    period: {
      fromIso: execution.createdAt,
      toIso: awarded.orderedAt,
      days: daysBetween(execution.createdAt, awarded.orderedAt),
      basis: DATE_BASIS,
    },
  };

  /* ── Can the two sides be compared at all? ─────────────────────────── */
  const currencyMismatch = awardedCurrency !== currency;
  const comparable =
    baseline.value !== null && measurement.value !== null && !currencyMismatch;

  if (!comparable) {
    /**
     * UNAVAILABLE, not FAILED_TO_VERIFY.
     *
     * The distinction is the difference between "we cannot measure this" and
     * "something is wrong". Having no earlier purchase to compare against, or
     * two currencies that cannot be compared without inventing a rate, are
     * both ordinary situations with a clear cause and a clear remedy.
     * Reporting them as a verification failure would send someone hunting for
     * a defect that does not exist — and would bury the genuine integrity
     * case (an award pointing at an order that is not there) among them.
     */
    const blocked: OutcomeBlocked = currencyMismatch
      ? {
          headline: `The baseline is in ${currency} and the awarded order is in ${awardedCurrency}, so the two cannot be compared.`,
          available: [
            `${baselineOrders.length} earlier committed order${baselineOrders.length === 1 ? '' : 's'} in ${currency}.`,
            `${awarded.reference} at ${money(awarded.unitCost, awardedCurrency)} per unit.`,
          ],
          missing: [
            `A shared currency. Converting between ${currency} and ${awardedCurrency} would require a rate for the date of every order, and applying today's rate to older ones would invent the very difference being measured.`,
          ],
          wouldEnable: [
            `Record the awarded order in ${currency}, or compare against orders in ${awardedCurrency}.`,
          ],
        }
      : baseline.value === null
        ? {
            headline: `There is no earlier purchase of ${input.product} to compare against, so the new price cannot be called better or worse.`,
            available: [`${awarded.reference} at ${money(awarded.unitCost, awardedCurrency)} per unit.`],
            missing: [
              `A baseline. No committed order for ${input.product} in ${currency} exists before ${execution.label} was raised.`,
            ],
            wouldEnable: [
              'Record the earlier purchases of this product, or wait until there is a second order to compare against.',
            ],
          }
        : {
            headline: `${awarded.reference} carries no usable unit price, so there is nothing to measure.`,
            available: [
              `A baseline of ${money(baseline.value as number, currency)} per unit from ${baselineOrders.length} earlier order${baselineOrders.length === 1 ? '' : 's'}.`,
            ],
            missing: [`A unit price on ${awarded.reference}.`],
            wouldEnable: ['Set the unit cost on the awarded purchase order.'],
          };

    const unavailable = blockedOutcome(input, 'unavailable', blocked, executionRef);
    // Keep whichever side DID resolve — showing the baseline you do have is
    // more use than a pair of blanks.
    return {
      ...unavailable,
      baseline,
      measurement,
      financialEffectUnavailable: blocked.missing[0] as string,
    };
  }

  /* ── Structural defects block the number, they do not annotate it. ──
   *
   * An order that predates the action cannot be a result of it, and an order
   * for a different product is not this finding's outcome. Emitting a change,
   * a percentage and a money figure alongside a failed check invites the
   * reader to take the headline and skip the caveat — which is the whole
   * failure mode. These refuse instead.
   */
  const periodValid = Date.parse(awarded.orderedAt) >= actionAt;
  const productMatches = awarded.product.trim().toUpperCase() === wanted;
  // Older executions predate the provenance field, so a MISSING link is
  // tolerated; a link naming a DIFFERENT finding is not.
  const linkMatches =
    execution.sourceOpportunity === null || execution.sourceOpportunity === input.opportunityId;

  if (!periodValid || !productMatches || !linkMatches) {
    const defect = !periodValid
      ? {
          headline: `${awarded.reference} is dated before ${execution.label} was raised, so it cannot be a result of the action.`,
          missing: [
            `A purchase dated at or after ${execution.createdAt.slice(0, 10)}. ${awarded.reference} is dated ${awarded.orderedAt.slice(0, 10)}.`,
          ],
        }
      : !productMatches
        ? {
            headline: `${awarded.reference} is for "${awarded.product}", not "${input.product}", so it is not this finding's outcome.`,
            missing: ['An awarded order for the product this opportunity was raised about.'],
          }
        : {
            headline: `${execution.label} was raised from a different opportunity, so measuring it here would credit this finding with someone else's work.`,
            missing: [
              `An execution naming this finding. ${execution.label} names ${execution.sourceOpportunity}.`,
            ],
          };
    const blocked = blockedOutcome(
      input,
      'unavailable',
      {
        headline: defect.headline,
        available: [`${execution.label} and ${awarded.reference} both exist and could be read.`],
        missing: defect.missing,
        wouldEnable: ['Run this opportunity’s own plan, so its execution and its result are its own.'],
      },
      executionRef,
    );
    return { ...blocked, status: 'failed_to_verify', baseline, measurement };
  }

  // From the RAW baseline, never the displayed one. Rounding to cents before
  // subtracting can flip the direction on three-decimal unit prices, and the
  // direction is the headline claim.
  const rawChange = (awarded.unitCost as number) - (rawBaseline as number);
  const change = round2(rawChange);
  const changePercent =
    (rawBaseline as number) > 0 ? Math.round((rawChange / (rawBaseline as number)) * 1000) / 10 : null;

  // Lower is better for a purchase price. Named for the direction of the
  // number, not for whether anyone should be pleased about it. Judged at the
  // rounded value because money has a smallest unit: a sub-cent difference is
  // not a difference.
  const direction: OutcomeDirection =
    change < 0 ? 'favourable' : change > 0 ? 'unfavourable' : 'unchanged';

  const verification = verify({
    baselineOrders: baselineOrders.length,
    awardedFound: true,
    comparable,
    currencyMismatch,
    baselineCurrency: currency,
    awardedCurrency,
    periodValid,
    productMatches,
    linkMatches,
    committed: COMMITTED.has(awarded.status.trim().toLowerCase()),
    awardedStatus: awarded.status,
    awardedLabel: awarded.reference,
  });

  // Reached only when both sides resolved and no structural defect blocked, so
  // the only question left is whether the quality checks passed.
  const failed = verification.filter((c) => !c.passed);
  const status: OutcomeStatus = failed.length === 0 ? 'verified' : 'measured';

  /* ── Money, from the raw figures, with the precision stated. ────────
   *
   * The basis quotes the baseline to four places rather than two, because it
   * invites the reader to redo the multiplication and the two-place figure
   * would not reproduce this total.
   */
  const financialEffect: OutcomeFinancialEffect | null =
    awarded.quantity > 0
      ? {
          amount: round2(rawChange * awarded.quantity),
          currency,
          basis: `(${money(awarded.unitCost, currency)} − ${(rawBaseline as number).toFixed(4)} ${currency}) × ${awarded.quantity} units on ${awarded.reference}. The baseline is quoted to four places here because it is an average; rounding it to cents first would misstate this total.`,
          caveat:
            'Observed on this one order only. It is not an annual figure, not a saving, and not attributed to the action.',
        }
      : null;

  const unknown: string[] = [
    'Whether the action caused this. NeuroPause compared two prices; it did not run a controlled comparison, and prices move for reasons no record here captures.',
    'What else changed at the same time — specification, order size, payment terms, market rates. Any of those could account for the difference on its own.',
    `The measurement is a single purchase order. One order is a data point, not a trend${baselineOrders.length < 3 ? `, and the baseline rests on only ${baselineOrders.length} order${baselineOrders.length === 1 ? '' : 's'}` : ''}.`,
    DATE_BASIS,
  ];
  if (!COMMITTED.has(awarded.status.trim().toLowerCase())) {
    unknown.unshift(
      `${awarded.reference} is still "${awarded.status}". The price is agreed, not transacted — no money has moved at this price yet.`,
    );
  }

  return {
    id: outcomeIdFor({ opportunityId: input.opportunityId, metric: METRIC }),
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    execution: executionRef,
    status,
    expectedEffect: input.expectedEffect,
    metric: METRIC,
    baseline,
    measurement,
    change,
    changePercent,
    direction,
    currency,
    financialEffect,
    financialEffectUnavailable: financialEffect
      ? null
      : currencyMismatch
        ? `The baseline is in ${currency} and the awarded order is in ${awardedCurrency}. Converting between them would invent the difference being measured, so no financial figure is given.`
        : 'The change could not be established, so there is nothing to convert into money.',
    impactAtDecision: input.impactAtDecision,
    verification,
    confidence: gradeOutcomeConfidence(verification, baselineOrders.length, comparable),
    unknown,
    causalNote:
      change === null
        ? 'No change could be established, so nothing is claimed.'
        : `This is what was OBSERVED after the action, not what the action achieved. NeuroPause has no way to establish cause from these records, and does not claim it.`,
    blocked: null,
    measuredAt: input.now,
    revisions: input.revisions,
  };
}

/**
 * The six checks that stand between a computed number and a verified one.
 *
 * Each names the record it looked at, so a failure is actionable rather than
 * a shrug. `no_quality_blocker` is the one that catches the case people most
 * want to wave through: a price agreed on a draft order that nobody has
 * approved is not a price the business has paid.
 */
function verify(input: {
  baselineOrders: number;
  awardedFound: boolean;
  comparable: boolean;
  currencyMismatch: boolean;
  baselineCurrency: string;
  awardedCurrency: string;
  periodValid: boolean;
  productMatches: boolean;
  linkMatches: boolean;
  committed: boolean;
  awardedStatus: string;
  awardedLabel: string;
}): VerificationCheck[] {
  return [
    {
      id: 'source_exists',
      label: 'Source data exists on both sides',
      passed: input.baselineOrders > 0 && input.awardedFound,
      detail:
        input.baselineOrders > 0
          ? `${input.baselineOrders} committed order${input.baselineOrders === 1 ? '' : 's'} before the action, and the awarded order after it.`
          : 'No committed order exists before the action, so there is no baseline to compare against.',
    },
    {
      id: 'source_accessible',
      label: 'Every referenced record could be read',
      passed: input.awardedFound,
      detail: input.awardedFound
        ? `${input.awardedLabel} was read from the procurement store.`
        : 'The awarded purchase order could not be read.',
    },
    {
      id: 'calculation_succeeded',
      label: 'The arithmetic produced a finite number',
      passed: input.comparable,
      detail: input.comparable
        ? 'Both sides resolved to a positive unit price and the difference is finite.'
        : 'One side of the comparison is missing, so no difference could be computed.',
    },
    {
      id: 'period_valid',
      label: 'The measurement follows the action',
      passed: input.periodValid,
      detail: input.periodValid
        ? 'The awarded order is dated at or after the request for quotation.'
        : 'The awarded order predates the action, so it cannot be a result of it.',
    },
    {
      id: 'records_associated',
      label: 'The records belong to this finding',
      passed: input.productMatches && input.linkMatches,
      // Product alone would be circular: the awarded order copies its product
      // from the RFQ, so that comparison can never fail. The link is the check
      // that carries the weight.
      detail: !input.productMatches
        ? 'The awarded order is for a different product than the opportunity.'
        : input.linkMatches
          ? 'The execution names this finding, and the awarded order matches its product.'
          : 'The execution was raised from a different opportunity.',
    },
    {
      id: 'no_quality_blocker',
      label: 'No known data-quality blocker',
      passed: !input.currencyMismatch && input.committed,
      detail: input.currencyMismatch
        ? `The baseline is in ${input.baselineCurrency} and the awarded order is in ${input.awardedCurrency}. Two currencies cannot be compared without inventing a rate.`
        : input.committed
          ? 'Single currency throughout, and the awarded order is a committed purchase.'
          : `${input.awardedLabel} is still "${input.awardedStatus}" — the price is agreed but not transacted, so the measurement describes an intention rather than a purchase.`,
    },
  ];
}

/**
 * Confidence from the checks and the depth of the baseline. No judgement, no
 * model — just how much the comparison rests on.
 */
function gradeOutcomeConfidence(
  checks: readonly VerificationCheck[],
  baselineOrders: number,
  comparable: boolean,
): OutcomeConfidence {
  if (!comparable) {
    return { tier: 'weak', basis: 'The two sides could not be compared, so nothing is established.' };
  }
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0 && baselineOrders >= 3) {
    return {
      tier: 'strong',
      basis: `All six verification checks passed, and the baseline rests on ${baselineOrders} committed orders.`,
    };
  }
  if (failed.length === 0) {
    return {
      tier: 'moderate',
      basis: `All six verification checks passed, but the baseline rests on only ${baselineOrders} committed order${baselineOrders === 1 ? '' : 's'} — enough to compute, thin enough to be moved by one unusual purchase.`,
    };
  }
  return {
    tier: 'weak',
    basis: `${failed.length} verification check${failed.length === 1 ? '' : 's'} did not pass: ${failed.map((c) => c.label.toLowerCase()).join('; ')}.`,
  };
}

/**
 * Whether a newly measured outcome differs materially from the last recorded
 * revision — the idempotency test.
 *
 * Re-measuring unchanged data must append nothing. A revision log that grows
 * on every page view is not an audit trail, it is noise that buries the two
 * entries that mattered.
 */
export function revisionNeeded(
  outcome: Outcome,
  previous: OutcomeRevision | undefined,
): { needed: boolean; reason: string } {
  if (!previous) {
    return { needed: true, reason: 'First recorded measurement of this outcome.' };
  }
  if (previous.status !== outcome.status) {
    return {
      needed: true,
      reason: `Status moved from ${OUTCOME_STATUS_LABELS[previous.status].toLowerCase()} to ${OUTCOME_STATUS_LABELS[outcome.status].toLowerCase()}.`,
    };
  }
  if (previous.baseline !== outcome.baseline.value) {
    return {
      needed: true,
      reason: `The baseline changed from ${previous.baseline ?? 'none'} to ${outcome.baseline.value ?? 'none'} — earlier purchase orders were added, corrected or removed.`,
    };
  }
  if (previous.measurement !== outcome.measurement.value) {
    return {
      needed: true,
      reason: `The measured price changed from ${previous.measurement ?? 'none'} to ${outcome.measurement.value ?? 'none'}.`,
    };
  }
  if (previous.executionRecordId !== (outcome.execution?.recordId ?? null)) {
    return {
      needed: true,
      reason:
        'The same figures, but measured against a different execution — the earlier action was replaced.',
    };
  }
  return { needed: false, reason: '' };
}
