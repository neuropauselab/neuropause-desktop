/**
 * Procurement ↔ Finance → Budget Controls — the pure commitment-control
 * engine (Final Wave FW-5).
 *
 * A Finance budget can now GOVERN purchasing: a purchase order that names a
 * budget (`budgetRef`) is evaluated at APPROVAL time against the budget's
 * amount minus what is already COMMITTED to it — the totals of every live PO
 * on the same budget that has passed approval (approved / sent / received).
 * The budget's own `commitmentPolicy` decides what an overrun means:
 *
 *   off   — the budget is informational; approval never consults it.
 *   warn  — approval proceeds but the overrun is stamped on the PO and said
 *           out loud (the default: visibility without a hard stop).
 *   block — approval REFUSES with the exact numbers; raise the budget or
 *           shrink the order.
 *
 * Honesty rules: a PO with no budgetRef is uncontrolled and says nothing; a
 * budgetRef that resolves to no live budget REFUSES approval under warn and
 * block alike (a dangling control is a broken control, never silently open);
 * draft and cancelled POs never count as commitment.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */

/** What an overrun means for approval — declared per budget. */
export const COMMITMENT_POLICIES = ['off', 'warn', 'block'] as const;
export type CommitmentPolicy = (typeof COMMITMENT_POLICIES)[number];

/** PO statuses that count as committed spend against a budget. */
export const COMMITTED_PO_STATUSES = ['approved', 'sent', 'received'] as const;

/** The generic-record shape the engine reads (budgets and purchase orders). */
interface RecordLike {
  id: string;
  status: string;
  fields: Record<string, unknown>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One approval-time budget decision, with every number it used. */
export interface BudgetControlDecision {
  /** Whether approval may proceed. */
  allowed: boolean;
  /** off | warn | block — the governing policy ('off' when uncontrolled). */
  policy: CommitmentPolicy;
  /** True when the PO named a budget at all. */
  controlled: boolean;
  /** True when the named budget resolved to a live record. */
  budgetFound: boolean;
  budgetName: string;
  budgetAmount: number;
  /** Committed spend already on this budget (approved/sent/received POs). */
  committedAmount: number;
  /** This PO's total. */
  orderAmount: number;
  /** committed + order. */
  projectedAmount: number;
  /** Positive when projected exceeds the budget. */
  overBy: number;
  /** The sentence the module stamps/says — always states the numbers. */
  note: string;
}

/**
 * Evaluate one PO's approval against its named budget. `purchaseOrders` is
 * the module's full record list — the PO being approved is EXCLUDED from
 * commitment by id (its own total arrives via `orderTotal`).
 */
export function evaluateBudgetControl(input: {
  orderId: string;
  orderTotal: number;
  budgetRef: string;
  budgets: ReadonlyArray<RecordLike>;
  purchaseOrders: ReadonlyArray<RecordLike>;
}): BudgetControlDecision {
  const orderAmount = round2(num(input.orderTotal));
  const ref = str(input.budgetRef).trim();
  const base: BudgetControlDecision = {
    allowed: true,
    policy: 'off',
    controlled: ref !== '',
    budgetFound: false,
    budgetName: '',
    budgetAmount: 0,
    committedAmount: 0,
    orderAmount,
    projectedAmount: orderAmount,
    overBy: 0,
    note: '',
  };
  if (!ref) {
    base.note = 'No budget named — this order is not budget-controlled.';
    return base;
  }
  const budget = input.budgets.find((r) => r.id === ref && r.status !== 'deleted');
  if (!budget) {
    return {
      ...base,
      allowed: false,
      budgetFound: false,
      note: `Budget "${ref}" was not found — a dangling budget control never approves silently. Fix the reference or clear it.`,
    };
  }
  const policyRaw = str(budget.fields.commitmentPolicy).trim() as CommitmentPolicy;
  const policy: CommitmentPolicy = (COMMITMENT_POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : 'warn';
  const budgetAmount = round2(num(budget.fields.budgetAmount));
  const budgetName = str(budget.fields.budgetName) || ref;
  const committedAmount = round2(
    input.purchaseOrders
      .filter(
        (r) =>
          r.id !== input.orderId &&
          r.status !== 'deleted' &&
          str(r.fields.budgetRef).trim() === ref &&
          (COMMITTED_PO_STATUSES as readonly string[]).includes(str(r.fields.status)),
      )
      .reduce((s, r) => s + num(r.fields.total), 0),
  );
  const projectedAmount = round2(committedAmount + orderAmount);
  const overBy = round2(Math.max(projectedAmount - budgetAmount, 0));
  if (policy === 'off') {
    return {
      ...base,
      policy,
      budgetFound: true,
      budgetName,
      budgetAmount,
      committedAmount,
      projectedAmount,
      overBy,
      note: `Budget "${budgetName}" is informational (policy off) — approval does not consult it.`,
    };
  }
  if (overBy <= 0) {
    return {
      ...base,
      policy,
      budgetFound: true,
      budgetName,
      budgetAmount,
      committedAmount,
      projectedAmount,
      overBy: 0,
      note: `Within budget "${budgetName}": committed ${committedAmount} + this order ${orderAmount} = ${projectedAmount} of ${budgetAmount}.`,
    };
  }
  const overNote = `Over budget "${budgetName}" by ${overBy}: committed ${committedAmount} + this order ${orderAmount} = ${projectedAmount} against ${budgetAmount}.`;
  if (policy === 'block') {
    return {
      ...base,
      allowed: false,
      policy,
      budgetFound: true,
      budgetName,
      budgetAmount,
      committedAmount,
      projectedAmount,
      overBy,
      note: `${overNote} Policy is BLOCK — raise the budget or reduce the order.`,
    };
  }
  return {
    ...base,
    policy,
    budgetFound: true,
    budgetName,
    budgetAmount,
    committedAmount,
    projectedAmount,
    overBy,
    note: `${overNote} Policy is WARN — approved with the overrun on the record.`,
  };
}
