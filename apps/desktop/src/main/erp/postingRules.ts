/**
 * Phase 6 — Inventory / Procurement / Manufacturing → General Ledger.
 *
 * Closes the ceiling named in the Phase 6 recon: "the accounting integration
 * stops at Finance and HR — inventory, production and procurement never reach
 * the books, so the GL cannot produce a correct balance sheet or gross margin
 * for a company that holds stock."
 *
 * This module DERIVES balanced journal lines from operational events. It does
 * not post them: posting stays with the existing journal-entry module, which
 * owns the balance guard, the period-close guard, posted-entry immutability and
 * reversal. Deriving here and posting there means there is still exactly one
 * accounting engine.
 *
 * Every derivation returns balanced debit/credit lines or an explicit refusal.
 * A rule that cannot compute a defensible amount produces NO entry and says why
 * — a plausible-looking wrong number in the ledger is far worse than a gap.
 */
import type { GlJournalLine } from '@neuropause/shared';
import { round2 } from './documentLines';

/**
 * Chart extension for stock and production accounting.
 *
 * The FINANCE chart (frozen `packages/shared`) is authoritative and canonical:
 * 1000 cash, 1100 receivable, 1200 GST input, **2000 accounts payable**,
 * **2100 TAX PAYABLE**, 4000 revenue, **5000 operating expenses**, 5100/5200
 * depreciation/loss, 7810/7811 FX. These stock accounts extend it and MUST NOT
 * collide with it.
 *
 * ERP Session 10 alignment (operator-ruled): a prior comment here wrongly read
 * 2100 as "payable" — 2100 is Tax Payable and AP is 2000 — which is why this
 * engine had shipped AP=2100 (colliding with Tax Payable) and COGS=5000
 * (colliding with Operating Expenses). Corrected: AP → 2000 (matches finance),
 * COGS → its own 5050 (clear of Operating Expenses 5000), and a dedicated
 * Purchase Price Variance 5920 in the variance block. Constants, not literals,
 * so an operator can still remap to an existing chart without touching the rules.
 */
export const STOCK_ACCOUNTS = {
  /** Asset — stock on hand. */
  inventory: '1300',
  /** Asset — work in progress. */
  wip: '1350',
  /** Asset — finished goods. */
  finishedGoods: '1360',
  /** Liability — goods received, not yet invoiced. */
  grni: '2150',
  /** Liability — accounts payable. Matches the finance chart (2000); 2100 is Tax Payable. */
  accountsPayable: '2000',
  /** Expense — cost of goods sold. Own code, clear of Operating Expenses (5000). */
  cogs: '5050',
  /** Expense — inventory adjustments / write-offs. */
  inventoryAdjustment: '5010',
  /** Expense — material usage variance. */
  materialVariance: '5900',
  /** Expense — production variance. */
  productionVariance: '5910',
  /** Expense — purchase price variance (actual bill price vs standard-cost receipt). */
  purchasePriceVariance: '5920',
} as const;

export type StockAccountKey = keyof typeof STOCK_ACCOUNTS;

export interface PostingDerivation {
  ok: boolean;
  /** Balanced journal lines, or empty when `ok` is false. */
  lines: GlJournalLine[];
  /** Deterministic reference so a re-fired event cannot double-post. */
  reference: string;
  memo: string;
  /** Present when the rule refused. */
  refusedReason: string | null;
}

function refuse(reference: string, reason: string): PostingDerivation {
  return { ok: false, lines: [], reference, memo: '', refusedReason: reason };
}

function balanced(lines: readonly GlJournalLine[]): boolean {
  const debit = round2(lines.reduce((n, l) => n + l.debit, 0));
  const credit = round2(lines.reduce((n, l) => n + l.credit, 0));
  return debit === credit && debit > 0;
}

function finish(reference: string, memo: string, lines: GlJournalLine[]): PostingDerivation {
  if (!balanced(lines)) {
    return refuse(reference, `Derived entry does not balance — refusing to produce it (${reference}).`);
  }
  return { ok: true, lines, reference, memo, refusedReason: null };
}

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

export interface GoodsReceiptPosting {
  receiptId: string;
  /** Quantity × purchase price, per received line. */
  lines: readonly { productId: string | null; quantity: number; unitPrice: number }[];
}

/**
 * Goods receipt: stock arrives and a liability accrues before the invoice does.
 *
 *   Dr Inventory   Cr GRNI
 *
 * This is the accrual that was entirely missing — previously a receipt updated
 * stock and touched the ledger not at all, so the balance sheet understated both
 * assets and liabilities between receipt and invoice.
 */
export function deriveGoodsReceiptPosting(input: GoodsReceiptPosting): PostingDerivation {
  const reference = `GRN-${input.receiptId}`;
  const value = round2(input.lines.reduce((n, l) => n + l.quantity * l.unitPrice, 0));
  if (value <= 0) {
    return refuse(reference, 'Receipt has no valued lines — nothing to accrue. (A receipt with no price cannot be valued.)');
  }
  return finish(reference, `Goods received, not invoiced (${input.receiptId})`, [
    { account: STOCK_ACCOUNTS.inventory, debit: value, credit: 0, memo: 'Stock received' },
    { account: STOCK_ACCOUNTS.grni, debit: 0, credit: value, memo: 'Accrued supplier liability' },
  ]);
}

export interface SupplierBillPosting {
  billId: string;
  /** The portion of the bill covered by matched receipts. */
  matchedValue: number;
  /** Total billed, including anything not covered by a receipt. */
  billedValue: number;
  /** Three-way match state — a mismatch must not reach here. */
  matchState: string;
}

/**
 * Supplier bill: clears GRNI for what was received, recognizes payable for the
 * whole bill.
 *
 *   Dr GRNI (matched)   Cr Accounts Payable (billed)
 *
 * GRNI is cleared ONLY to the extent goods were actually received and matched —
 * that is the entire point of the account. A bill that is not MATCHED is refused.
 */
export function deriveSupplierBillPosting(input: SupplierBillPosting): PostingDerivation {
  const reference = `BILL-${input.billId}`;
  if (input.matchState !== 'MATCHED') {
    return refuse(
      reference,
      `Three-way match state is ${input.matchState}; only a MATCHED bill may post. Resolve the mismatch first.`,
    );
  }
  const billed = round2(input.billedValue);
  const matched = round2(input.matchedValue);
  if (billed <= 0) return refuse(reference, 'Bill has no value.');
  if (matched > billed) return refuse(reference, 'Matched value exceeds the billed value — refusing to clear more GRNI than was billed.');

  const lines: GlJournalLine[] = [
    { account: STOCK_ACCOUNTS.grni, debit: matched, credit: 0, memo: 'Clear goods-received-not-invoiced' },
  ];
  // Anything billed beyond matched receipts is a direct cost, not stock — it is
  // separated rather than quietly inflating inventory.
  const unmatched = round2(billed - matched);
  if (unmatched > 0) {
    lines.push({ account: STOCK_ACCOUNTS.inventoryAdjustment, debit: unmatched, credit: 0, memo: 'Billed beyond matched receipts' });
  }
  lines.push({ account: STOCK_ACCOUNTS.accountsPayable, debit: 0, credit: billed, memo: 'Supplier payable' });
  return finish(reference, `Supplier bill ${input.billId}`, lines);
}

export interface GoodsBillPosting {
  billId: string;
  /** GRNI actually accrued for the matched receipts (standard-cost basis, functional). */
  receivedValue: number;
  /** Billed subtotal, ex-tax, in functional currency. */
  billedExTax: number;
  /** Billed tax, functional currency (0 when none). */
  taxAmount: number;
  /** The input-tax account for the tax leg (finance chart, e.g. GST Input Credit 1200). */
  taxAccount: string;
}

/**
 * ERP Session 11 — a MATCHED goods vendor bill relieves GRNI and recognizes the
 * standard-vs-actual purchase price variance, on the live finance path:
 *
 *   Dr GRNI 2150                 (relieve the accrued receipt liability, at standard)
 *   Dr Input Tax                 (recoverable tax, if any)
 *   Dr/Cr Purchase Price Variance 5920   (billed − received; Dr when unfavourable)
 *   Cr Accounts Payable 2000     (total owed the supplier)
 *
 * GRNI is relieved at exactly the accrued (standard-cost) value, so a full
 * receipt→bill cycle nets GRNI to zero. The price difference is PPV — the costing
 * BASIS never changes (standard cost stays standard cost). PPV direction follows
 * the existing production-variance convention: paying MORE than standard is an
 * unfavourable Dr; less is a favourable Cr. A bill with no accrued receipt value
 * refuses (goods must have been received before their GRNI can be relieved).
 */
export function deriveGoodsBillPosting(input: GoodsBillPosting): PostingDerivation {
  const reference = `GBILL-${input.billId}`;
  const received = round2(input.receivedValue);
  const billed = round2(input.billedExTax);
  const tax = round2(input.taxAmount);
  if (received <= 0) {
    return refuse(reference, 'No accrued goods-received value to relieve — a goods bill cannot post before its receipt.');
  }
  if (billed <= 0) return refuse(reference, 'Bill has no value.');

  const lines: GlJournalLine[] = [
    { account: STOCK_ACCOUNTS.grni, debit: received, credit: 0, memo: 'Clear goods-received-not-invoiced' },
  ];
  if (tax > 0) {
    lines.push({ account: input.taxAccount, debit: tax, credit: 0, memo: 'Recoverable input tax' });
  }
  // Purchase price variance = billed (actual) − received (standard). Unfavourable
  // (paid more than standard) is a debit; favourable is a credit. The standard-cost
  // basis is unchanged — this line only records the difference.
  const variance = round2(billed - received);
  if (variance > 0) {
    lines.push({ account: STOCK_ACCOUNTS.purchasePriceVariance, debit: variance, credit: 0, memo: 'Unfavourable purchase price variance' });
  } else if (variance < 0) {
    lines.push({ account: STOCK_ACCOUNTS.purchasePriceVariance, debit: 0, credit: Math.abs(variance), memo: 'Favourable purchase price variance' });
  }
  lines.push({ account: STOCK_ACCOUNTS.accountsPayable, debit: 0, credit: round2(billed + tax), memo: 'Supplier payable' });
  return finish(reference, `Goods bill ${input.billId} (GRNI relief${variance !== 0 ? ' + PPV' : ''})`, lines);
}

// ---------------------------------------------------------------------------
// Inventory / COGS
// ---------------------------------------------------------------------------

/**
 * Valuation methods this build actually implements. Anything else must not be
 * claimed: costing you cannot compute is costing you do not have.
 */
export type ValuationMethod = 'weighted_average' | 'standard';

export interface CogsPosting {
  dispatchId: string;
  lines: readonly { productId: string | null; quantity: number; unitCost: number | null }[];
  method: ValuationMethod;
}

/**
 * Dispatch / delivery: stock leaves and becomes cost of sale.
 *
 *   Dr COGS   Cr Inventory
 *
 * Without this, revenue reached the ledger via the invoice while cost never did,
 * so gross margin was unobtainable from the books.
 *
 * A line with no resolvable unit cost REFUSES the whole entry rather than
 * posting a partial cost — a half-costed dispatch silently overstates margin.
 */
export function deriveCogsPosting(input: CogsPosting): PostingDerivation {
  const reference = `COGS-${input.dispatchId}`;
  const uncosted = input.lines.filter((l) => l.unitCost === null || !Number.isFinite(l.unitCost));
  if (uncosted.length > 0) {
    return refuse(
      reference,
      `${uncosted.length} line(s) have no resolvable unit cost under ${input.method} valuation — refusing to post a partial cost of sale.`,
    );
  }
  const value = round2(input.lines.reduce((n, l) => n + l.quantity * (l.unitCost ?? 0), 0));
  if (value <= 0) return refuse(reference, 'Dispatch has no costed quantity.');

  return finish(reference, `Cost of goods sold (${input.dispatchId}, ${input.method})`, [
    { account: STOCK_ACCOUNTS.cogs, debit: value, credit: 0, memo: 'Cost of goods sold' },
    { account: STOCK_ACCOUNTS.inventory, debit: 0, credit: value, memo: 'Stock issued' },
  ]);
}

export interface InventoryAdjustmentPosting {
  adjustmentId: string;
  /** Positive = stock found / written up; negative = shrinkage / write-off. */
  valueDelta: number;
  reason: string;
}

/** Stock adjustment / write-off: the counted truth reaches the ledger. */
export function deriveInventoryAdjustmentPosting(input: InventoryAdjustmentPosting): PostingDerivation {
  const reference = `ADJ-${input.adjustmentId}`;
  const delta = round2(input.valueDelta);
  if (delta === 0) return refuse(reference, 'Adjustment has no financial effect.');
  const magnitude = Math.abs(delta);
  const lines: GlJournalLine[] =
    delta > 0
      ? [
          { account: STOCK_ACCOUNTS.inventory, debit: magnitude, credit: 0, memo: input.reason },
          { account: STOCK_ACCOUNTS.inventoryAdjustment, debit: 0, credit: magnitude, memo: 'Stock written up' },
        ]
      : [
          { account: STOCK_ACCOUNTS.inventoryAdjustment, debit: magnitude, credit: 0, memo: input.reason },
          { account: STOCK_ACCOUNTS.inventory, debit: 0, credit: magnitude, memo: 'Stock written down' },
        ];
  return finish(reference, `Inventory adjustment ${input.adjustmentId}`, lines);
}

// ---------------------------------------------------------------------------
// Manufacturing — WIP and variance
// ---------------------------------------------------------------------------

export interface MaterialIssuePosting {
  productionOrderId: string;
  lines: readonly { productId: string | null; quantity: number; unitCost: number | null }[];
}

/** Material issue to production: stock becomes work in progress. Dr WIP Cr Inventory. */
export function deriveMaterialIssuePosting(input: MaterialIssuePosting): PostingDerivation {
  const reference = `WIP-ISSUE-${input.productionOrderId}`;
  const uncosted = input.lines.filter((l) => l.unitCost === null || !Number.isFinite(l.unitCost));
  if (uncosted.length > 0) {
    return refuse(reference, `${uncosted.length} material line(s) have no unit cost — refusing to value work in progress partially.`);
  }
  const value = round2(input.lines.reduce((n, l) => n + l.quantity * (l.unitCost ?? 0), 0));
  if (value <= 0) return refuse(reference, 'No valued material was issued.');
  return finish(reference, `Material issued to production ${input.productionOrderId}`, [
    { account: STOCK_ACCOUNTS.wip, debit: value, credit: 0, memo: 'Material to WIP' },
    { account: STOCK_ACCOUNTS.inventory, debit: 0, credit: value, memo: 'Raw material issued' },
  ]);
}

export interface ProductionCompletionPosting {
  productionOrderId: string;
  /** Cost actually accumulated in WIP for this order. */
  wipAccumulated: number;
  /** Standard cost of the output produced. */
  standardCostOfOutput: number;
}

/**
 * Production completion: WIP becomes finished goods, and the difference between
 * accumulated cost and standard cost is recognized as variance rather than
 * being buried in inventory value.
 *
 *   Dr Finished Goods (standard)
 *   Dr/Cr Production Variance (difference)
 *   Cr WIP (accumulated)
 */
export function deriveProductionCompletionPosting(input: ProductionCompletionPosting): PostingDerivation {
  const reference = `WIP-COMPLETE-${input.productionOrderId}`;
  const wip = round2(input.wipAccumulated);
  const standard = round2(input.standardCostOfOutput);
  if (wip <= 0 && standard <= 0) return refuse(reference, 'Completion has no cost to settle.');

  const variance = round2(wip - standard);
  const lines: GlJournalLine[] = [
    { account: STOCK_ACCOUNTS.finishedGoods, debit: standard, credit: 0, memo: 'Finished goods at standard' },
  ];
  if (variance > 0) {
    // Cost overrun — an expense, not an asset.
    lines.push({ account: STOCK_ACCOUNTS.productionVariance, debit: variance, credit: 0, memo: 'Unfavourable production variance' });
  } else if (variance < 0) {
    lines.push({ account: STOCK_ACCOUNTS.productionVariance, debit: 0, credit: Math.abs(variance), memo: 'Favourable production variance' });
  }
  lines.push({ account: STOCK_ACCOUNTS.wip, debit: 0, credit: wip, memo: 'WIP settled' });
  return finish(reference, `Production completed ${input.productionOrderId}`, lines);
}

/**
 * Every account this module can touch, so an operator can pre-create or remap
 * them against an existing chart before enabling stock accounting.
 */
export function stockAccountsInUse(): { key: StockAccountKey; account: string }[] {
  return (Object.keys(STOCK_ACCOUNTS) as StockAccountKey[]).map((key) => ({ key, account: STOCK_ACCOUNTS[key] }));
}
