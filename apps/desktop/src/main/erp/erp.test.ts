/**
 * Phase 6 — ERP foundation locks: line items, totals, three-way match,
 * stock/production posting, approvals and segregation of duties.
 *
 * These protect the books. The behaviours asserted here are the ones whose
 * absence the Phase 6 recon identified as structural ceilings: documents with no
 * lines, a ledger that never sees stock, and approvals a creator could grant
 * themselves.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DocumentLineStore,
  computeDocumentTotals,
  computeLineTotals,
  round2,
  validateLine,
  type DocumentLine,
  type LineDocumentType,
} from './documentLines';
import { threeWayMatch, DEFAULT_TOLERANCE } from './threeWayMatch';
import {
  deriveCogsPosting,
  deriveGoodsReceiptPosting,
  deriveInventoryAdjustmentPosting,
  deriveMaterialIssuePosting,
  deriveProductionCompletionPosting,
  deriveSupplierBillPosting,
  STOCK_ACCOUNTS,
  stockAccountsInUse,
} from './postingRules';
import {
  DEFAULT_SPEND_POLICY,
  applicableSteps,
  applyDecision,
  canApprove,
  evaluateApproval,
  type ApprovalPolicy,
  type ApprovalRequest,
} from './approvalEngine';

const T0 = '2026-08-08T12:00:00.000Z';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-erp-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function line(over: Partial<DocumentLine> = {}): DocumentLine {
  return {
    id: 'l1',
    documentId: 'DOC-1',
    documentType: 'salesOrder',
    lineNo: 1,
    productId: 'SKU-1',
    description: 'Widget',
    quantity: 1,
    unit: 'ea',
    unitPrice: 100,
    discountPercent: null,
    discountAmount: null,
    taxRatePercent: null,
    currency: 'INR',
    accountId: null,
    warehouseId: null,
    projectId: null,
    costCenterId: null,
    batchId: null,
    createdAt: T0,
    updatedAt: T0,
    createdBy: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('money arithmetic is deterministic', () => {
  it('rounds half up without float drift', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('computes a line: quantity, discount, tax, total', () => {
    const t = computeLineTotals({ quantity: 3, unitPrice: 99.99, discountPercent: 10, discountAmount: null, taxRatePercent: 18 });
    expect(t.gross).toBe(299.97);
    expect(t.discount).toBe(30);
    expect(t.taxable).toBe(269.97);
    expect(t.tax).toBe(48.59);
    expect(t.total).toBe(318.56);
  });

  it('lets an absolute discount win over a percentage', () => {
    const t = computeLineTotals({ quantity: 1, unitPrice: 100, discountPercent: 50, discountAmount: 10, taxRatePercent: null });
    expect(t.discount).toBe(10);
    expect(t.total).toBe(90);
  });

  it('never lets a discount exceed the line', () => {
    const t = computeLineTotals({ quantity: 1, unitPrice: 50, discountPercent: null, discountAmount: 999, taxRatePercent: null });
    expect(t.discount).toBe(50);
    expect(t.total).toBe(0);
  });

  it('handles a zero-rate tax and a zero price', () => {
    expect(computeLineTotals({ quantity: 5, unitPrice: 0, discountPercent: null, discountAmount: null, taxRatePercent: 18 }).total).toBe(0);
    expect(computeLineTotals({ quantity: 2, unitPrice: 10, discountPercent: null, discountAmount: null, taxRatePercent: 0 }).tax).toBe(0);
  });

  it('supports a credit (negative) line on an invoice', () => {
    const t = computeLineTotals({ quantity: -2, unitPrice: 25, discountPercent: null, discountAmount: null, taxRatePercent: 10 });
    expect(t.gross).toBe(-50);
    expect(t.total).toBe(-55);
  });

  it('sums ROUNDED line totals so the document agrees with its printed lines', () => {
    // Each line rounds to 0.34; three lines must total 1.02, not 1.005×3 → 1.01.
    const lines = [1, 2, 3].map((n) => line({ id: `l${n}`, lineNo: n, quantity: 1, unitPrice: 0.335 }));
    const totals = computeDocumentTotals(lines);
    expect(totals.lineCount).toBe(3);
    expect(totals.total).toBe(round2(0.34 * 3));
  });

  it('flags a document whose lines disagree on currency', () => {
    const totals = computeDocumentTotals([line({ currency: 'INR' }), line({ id: 'l2', currency: 'USD' })]);
    expect(totals.currencyMismatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('line validation is domain-specific', () => {
  it('requires a price on a sales order but not on a goods receipt', () => {
    expect(validateLine('salesOrder', { quantity: 1, productId: 'SKU-1' }).ok).toBe(false);
    expect(validateLine('goodsReceipt', { quantity: 1, productId: 'SKU-1' }).ok).toBe(true);
  });

  it('requires a product where goods actually move', () => {
    expect(validateLine('delivery', { quantity: 1, description: 'something' }).ok).toBe(false);
    expect(validateLine('invoice', { quantity: 1, unitPrice: 10, description: 'Consulting' }).ok).toBe(true);
  });

  it('rejects a negative quantity on an order but allows it on a receipt', () => {
    expect(validateLine('salesOrder', { quantity: -1, unitPrice: 5, productId: 'SKU-1' }).ok).toBe(false);
    expect(validateLine('goodsReceipt', { quantity: -1, productId: 'SKU-1' }).ok).toBe(true);
  });

  it('rejects out-of-range discount and tax', () => {
    expect(validateLine('invoice', { quantity: 1, unitPrice: 10, discountPercent: 150 }).ok).toBe(false);
    expect(validateLine('invoice', { quantity: 1, unitPrice: 10, taxRatePercent: -1 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('DocumentLineStore', () => {
  const type: LineDocumentType = 'purchaseOrder';

  it('persists lines across instances and totals them', async () => {
    const file = join(dir, 'lines.json');
    const a = new DocumentLineStore(file);
    await a.load();
    const res = await a.setLines(
      type,
      'PO-1',
      [
        { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
        { productId: 'SKU-2', description: 'Gadget', quantity: 4, unitPrice: 100, taxRatePercent: 18 },
      ],
      { actor: 'buyer@np.example', now: T0 },
    );
    expect(res.ok).toBe(true);
    expect(res.lines.map((l) => l.lineNo)).toEqual([1, 2]);

    const b = new DocumentLineStore(file);
    await b.load();
    expect(b.forDocument(type, 'PO-1')).toHaveLength(2);
    expect(b.totals(type, 'PO-1').total).toBe(round2(250 + 400 + 72));
  });

  it('writes NOTHING when any line is invalid — all or nothing', async () => {
    const store = new DocumentLineStore(join(dir, 'l.json'));
    await store.load();
    const res = await store.setLines(
      type,
      'PO-2',
      [
        { productId: 'SKU-1', description: 'ok', quantity: 1, unitPrice: 5 },
        { description: 'no product, no price', quantity: 1 },
      ],
      { actor: null, now: T0 },
    );
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.lineNo).toBe(2);
    expect(store.forDocument(type, 'PO-2')).toHaveLength(0);
  });

  it('replaces lines wholesale and renumbers them', async () => {
    const store = new DocumentLineStore(join(dir, 'l.json'));
    await store.load();
    await store.setLines(type, 'PO-3', [
      { productId: 'A', description: 'a', quantity: 1, unitPrice: 1 },
      { productId: 'B', description: 'b', quantity: 1, unitPrice: 1 },
    ], { actor: null, now: T0 });
    await store.setLines(type, 'PO-3', [{ productId: 'C', description: 'c', quantity: 2, unitPrice: 3 }], { actor: null, now: T0 });
    const lines = store.forDocument(type, 'PO-3');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineNo).toBe(1);
    expect(lines[0]?.productId).toBe('C');
  });

  it('cascades on parent delete — the integrity JSON cannot enforce', async () => {
    const store = new DocumentLineStore(join(dir, 'l.json'));
    await store.load();
    await store.setLines(type, 'PO-4', [{ productId: 'A', description: 'a', quantity: 1, unitPrice: 1 }], { actor: null, now: T0 });
    expect(await store.deleteForDocument(type, 'PO-4')).toBe(1);
    expect(store.forDocument(type, 'PO-4')).toHaveLength(0);
  });

  it('detects orphaned lines explicitly', async () => {
    const store = new DocumentLineStore(join(dir, 'l.json'));
    await store.load();
    await store.setLines(type, 'PO-5', [{ productId: 'A', description: 'a', quantity: 1, unitPrice: 1 }], { actor: null, now: T0 });
    const orphans = store.orphans(() => false);
    expect(orphans).toHaveLength(1);
    expect(store.orphans(() => true)).toHaveLength(0);
  });

  it('keeps documents isolated from one another', async () => {
    const store = new DocumentLineStore(join(dir, 'l.json'));
    await store.load();
    await store.setLines(type, 'PO-A', [{ productId: 'A', description: 'a', quantity: 1, unitPrice: 1 }], { actor: null, now: T0 });
    await store.setLines('salesOrder', 'PO-A', [{ productId: 'B', description: 'b', quantity: 1, unitPrice: 2 }], { actor: null, now: T0 });
    expect(store.forDocument(type, 'PO-A')[0]?.productId).toBe('A');
    expect(store.forDocument('salesOrder', 'PO-A')[0]?.productId).toBe('B');
  });
});

// ---------------------------------------------------------------------------

describe('three-way match', () => {
  const po = [line({ documentType: 'purchaseOrder', productId: 'SKU-1', quantity: 100, unitPrice: 10 })];
  const base = {
    supplierId: 'SUP-1',
    orderSupplierId: 'SUP-1',
    currency: 'INR',
    orderCurrency: 'INR',
    tolerance: DEFAULT_TOLERANCE,
  };

  it('MATCHES when order, receipt and bill agree', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(r.state).toBe('MATCHED');
    expect(r.postable).toBe(true);
  });

  it('is PARTIAL when less is billed than received', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 60, unitPrice: 10 })],
    });
    expect(r.state).toBe('PARTIAL');
    expect(r.postable).toBe(false);
    expect(r.receivedNotInvoiced).toBe(400); // 40 × 10 still accrued
  });

  it('MISMATCHES when billed quantity exceeds what was received', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 50, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(r.state).toBe('MISMATCH');
    expect(r.postable).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/exceeds received/);
  });

  it('MISMATCHES on an overcharge beyond price tolerance', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 12 })],
    });
    expect(r.state).toBe('MISMATCH');
    expect(r.reasons.join(' ')).toMatch(/unit price/i);
  });

  it('tolerates a price difference inside tolerance', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10.05 })],
    });
    expect(r.state).toBe('MATCHED');
  });

  it('MISMATCHES an item that was never ordered', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-9', quantity: 5, unitPrice: 1 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-9', quantity: 5, unitPrice: 1 })],
    });
    expect(r.state).toBe('MISMATCH');
    expect(r.reasons.join(' ')).toMatch(/does not appear on the purchase order/);
  });

  it('MISMATCHES a bill raised before anything was received', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(r.state).toBe('MISMATCH');
    expect(r.reasons.join(' ')).toMatch(/before any goods were received/);
  });

  it('BLOCKS on a supplier or currency mismatch regardless of the lines', () => {
    const wrongSupplier = threeWayMatch({
      ...base,
      supplierId: 'SUP-2',
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(wrongSupplier.state).toBe('BLOCKED');
    expect(wrongSupplier.postable).toBe(false);

    const wrongCurrency = threeWayMatch({
      ...base,
      currency: 'USD',
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(wrongCurrency.state).toBe('BLOCKED');
  });

  it('sends an excessive over-receipt to MANUAL_REVIEW', () => {
    const r = threeWayMatch({
      ...base,
      orderLines: po,
      receiptLines: [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 130, unitPrice: 10 })],
      billLines: [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })],
    });
    expect(r.state).toBe('MANUAL_REVIEW');
    expect(r.postable).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('stock and production postings reach the ledger', () => {
  const debit = (d: { lines: { account: string; debit: number }[] }, account: string): number =>
    d.lines.filter((l) => l.account === account).reduce((n, l) => n + l.debit, 0);
  const credit = (d: { lines: { account: string; credit: number }[] }, account: string): number =>
    d.lines.filter((l) => l.account === account).reduce((n, l) => n + l.credit, 0);

  it('accrues GRNI on goods receipt: Dr Inventory, Cr GRNI', () => {
    const d = deriveGoodsReceiptPosting({ receiptId: 'GR-1', lines: [{ productId: 'SKU-1', quantity: 10, unitPrice: 25 }] });
    expect(d.ok).toBe(true);
    expect(debit(d, STOCK_ACCOUNTS.inventory)).toBe(250);
    expect(credit(d, STOCK_ACCOUNTS.grni)).toBe(250);
    expect(d.reference).toBe('GRN-GR-1');
  });

  it('refuses to accrue an unvalued receipt', () => {
    const d = deriveGoodsReceiptPosting({ receiptId: 'GR-2', lines: [{ productId: 'SKU-1', quantity: 10, unitPrice: 0 }] });
    expect(d.ok).toBe(false);
    expect(d.lines).toHaveLength(0);
    expect(d.refusedReason).toMatch(/cannot be valued|nothing to accrue/i);
  });

  it('clears GRNI on a MATCHED bill and raises the payable', () => {
    const d = deriveSupplierBillPosting({ billId: 'B-1', matchedValue: 250, billedValue: 250, matchState: 'MATCHED' });
    expect(d.ok).toBe(true);
    expect(debit(d, STOCK_ACCOUNTS.grni)).toBe(250);
    expect(credit(d, STOCK_ACCOUNTS.accountsPayable)).toBe(250);
  });

  it('REFUSES to post a bill that is not MATCHED', () => {
    for (const state of ['MISMATCH', 'PARTIAL', 'BLOCKED', 'MANUAL_REVIEW']) {
      const d = deriveSupplierBillPosting({ billId: 'B-2', matchedValue: 100, billedValue: 200, matchState: state });
      expect(d.ok, state).toBe(false);
      expect(d.lines, state).toHaveLength(0);
    }
  });

  it('separates billing beyond matched receipts instead of inflating stock', () => {
    const d = deriveSupplierBillPosting({ billId: 'B-3', matchedValue: 200, billedValue: 250, matchState: 'MATCHED' });
    expect(d.ok).toBe(true);
    expect(debit(d, STOCK_ACCOUNTS.grni)).toBe(200);
    expect(debit(d, STOCK_ACCOUNTS.inventoryAdjustment)).toBe(50);
    expect(credit(d, STOCK_ACCOUNTS.accountsPayable)).toBe(250);
  });

  it('posts COGS on dispatch: Dr COGS, Cr Inventory', () => {
    const d = deriveCogsPosting({
      dispatchId: 'D-1',
      method: 'weighted_average',
      lines: [{ productId: 'SKU-1', quantity: 10, unitCost: 18 }],
    });
    expect(d.ok).toBe(true);
    expect(debit(d, STOCK_ACCOUNTS.cogs)).toBe(180);
    expect(credit(d, STOCK_ACCOUNTS.inventory)).toBe(180);
  });

  it('REFUSES a partial cost of sale when any line has no cost', () => {
    const d = deriveCogsPosting({
      dispatchId: 'D-2',
      method: 'weighted_average',
      lines: [
        { productId: 'SKU-1', quantity: 10, unitCost: 18 },
        { productId: 'SKU-2', quantity: 5, unitCost: null },
      ],
    });
    expect(d.ok).toBe(false);
    expect(d.refusedReason).toMatch(/no resolvable unit cost/);
  });

  it('posts an inventory write-down and a write-up in opposite directions', () => {
    const down = deriveInventoryAdjustmentPosting({ adjustmentId: 'A-1', valueDelta: -120, reason: 'Shrinkage' });
    expect(debit(down, STOCK_ACCOUNTS.inventoryAdjustment)).toBe(120);
    expect(credit(down, STOCK_ACCOUNTS.inventory)).toBe(120);

    const up = deriveInventoryAdjustmentPosting({ adjustmentId: 'A-2', valueDelta: 60, reason: 'Count correction' });
    expect(debit(up, STOCK_ACCOUNTS.inventory)).toBe(60);
    expect(credit(up, STOCK_ACCOUNTS.inventoryAdjustment)).toBe(60);
  });

  it('moves material into WIP and settles it into finished goods with variance', () => {
    const issue = deriveMaterialIssuePosting({
      productionOrderId: 'PO-9',
      lines: [{ productId: 'RAW-1', quantity: 100, unitCost: 5 }],
    });
    expect(debit(issue, STOCK_ACCOUNTS.wip)).toBe(500);
    expect(credit(issue, STOCK_ACCOUNTS.inventory)).toBe(500);

    // Cost overrun: 500 accumulated against a 450 standard → 50 unfavourable.
    const done = deriveProductionCompletionPosting({ productionOrderId: 'PO-9', wipAccumulated: 500, standardCostOfOutput: 450 });
    expect(done.ok).toBe(true);
    expect(debit(done, STOCK_ACCOUNTS.finishedGoods)).toBe(450);
    expect(debit(done, STOCK_ACCOUNTS.productionVariance)).toBe(50);
    expect(credit(done, STOCK_ACCOUNTS.wip)).toBe(500);
  });

  it('records a favourable variance as a credit', () => {
    const done = deriveProductionCompletionPosting({ productionOrderId: 'PO-10', wipAccumulated: 400, standardCostOfOutput: 450 });
    expect(credit(done, STOCK_ACCOUNTS.productionVariance)).toBe(50);
  });

  it('every derived entry balances', () => {
    const derivations = [
      deriveGoodsReceiptPosting({ receiptId: 'r', lines: [{ productId: 'p', quantity: 3, unitPrice: 33.33 }] }),
      deriveSupplierBillPosting({ billId: 'b', matchedValue: 99.99, billedValue: 99.99, matchState: 'MATCHED' }),
      deriveCogsPosting({ dispatchId: 'd', method: 'standard', lines: [{ productId: 'p', quantity: 7, unitCost: 1.11 }] }),
      deriveMaterialIssuePosting({ productionOrderId: 'm', lines: [{ productId: 'p', quantity: 9, unitCost: 2.22 }] }),
      deriveProductionCompletionPosting({ productionOrderId: 'm', wipAccumulated: 19.98, standardCostOfOutput: 20 }),
    ];
    for (const d of derivations) {
      expect(d.ok).toBe(true);
      const dr = round2(d.lines.reduce((n, l) => n + l.debit, 0));
      const cr = round2(d.lines.reduce((n, l) => n + l.credit, 0));
      expect(dr).toBe(cr);
    }
  });

  it('declares every account it can touch so an operator can remap the chart', () => {
    const accounts = stockAccountsInUse();
    expect(accounts.length).toBeGreaterThan(5);
    expect(accounts.every((a) => /^[0-9]{4}$/.test(a.account))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('procure-to-pay end to end', () => {
  it('receipt accrues GRNI, a matched bill clears exactly what was received', () => {
    const orderLines = [line({ documentType: 'purchaseOrder', productId: 'SKU-1', quantity: 100, unitPrice: 10 })];
    const receiptLines = [line({ documentType: 'goodsReceipt', productId: 'SKU-1', quantity: 100, unitPrice: 10 })];
    const billLines = [line({ documentType: 'bill', productId: 'SKU-1', quantity: 100, unitPrice: 10 })];

    const receipt = deriveGoodsReceiptPosting({
      receiptId: 'GR-1',
      lines: receiptLines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
    });
    const grniAccrued = receipt.lines.filter((l) => l.account === STOCK_ACCOUNTS.grni).reduce((n, l) => n + l.credit, 0);

    const match = threeWayMatch({
      supplierId: 'SUP-1',
      orderSupplierId: 'SUP-1',
      currency: 'INR',
      orderCurrency: 'INR',
      orderLines,
      receiptLines,
      billLines,
    });
    expect(match.state).toBe('MATCHED');

    const bill = deriveSupplierBillPosting({
      billId: 'B-1',
      matchedValue: match.totals.billed,
      billedValue: match.totals.billed,
      matchState: match.state,
    });
    const grniCleared = bill.lines.filter((l) => l.account === STOCK_ACCOUNTS.grni).reduce((n, l) => n + l.debit, 0);

    // The control that matters: GRNI nets to zero once the goods are invoiced.
    expect(grniAccrued).toBe(1000);
    expect(grniCleared).toBe(1000);
    expect(round2(grniAccrued - grniCleared)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('approval engine and segregation of duties', () => {
  const request = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
    documentType: 'purchaseOrder',
    documentId: 'PO-1',
    amount: 50_000,
    createdBy: 'buyer@np.example',
    department: 'ops',
    approvals: [],
    ...over,
  });

  it('selects steps by amount threshold', () => {
    expect(applicableSteps(DEFAULT_SPEND_POLICY, 5_000).map((s) => s.id)).toEqual(['manager']);
    expect(applicableSteps(DEFAULT_SPEND_POLICY, 50_000).map((s) => s.id)).toEqual(['manager', 'finance']);
    expect(applicableSteps(DEFAULT_SPEND_POLICY, 500_000).map((s) => s.id)).toEqual(['manager', 'finance', 'executive']);
  });

  it('stays pending until every required step is satisfied', () => {
    let req = request();
    let status = evaluateApproval(DEFAULT_SPEND_POLICY, req);
    expect(status.state).toBe('pending');
    expect(status.nextStep?.id).toBe('manager');

    const step1 = status.nextStep!;
    const r1 = applyDecision(DEFAULT_SPEND_POLICY, req, step1, { userId: 'mgr@np.example', roles: ['manager'] }, 'approved', T0);
    expect(r1.ok).toBe(true);
    req = r1.request;
    status = r1.status;
    expect(status.state).toBe('pending');
    expect(status.nextStep?.id).toBe('finance');

    const r2 = applyDecision(DEFAULT_SPEND_POLICY, req, status.nextStep!, { userId: 'cfo@np.example', roles: ['finance'] }, 'approved', T0);
    expect(r2.status.state).toBe('approved');
  });

  it('REFUSES the creator approving their own document', () => {
    const req = request();
    const step = applicableSteps(DEFAULT_SPEND_POLICY, req.amount)[0]!;
    const verdict = canApprove(DEFAULT_SPEND_POLICY, req, step, { userId: 'buyer@np.example', roles: ['manager'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations[0]?.rule).toBe('creator_cannot_approve');

    const applied = applyDecision(DEFAULT_SPEND_POLICY, req, step, { userId: 'buyer@np.example', roles: ['manager'] }, 'approved', T0);
    expect(applied.ok).toBe(false);
    expect(applied.request.approvals).toHaveLength(0); // nothing recorded
  });

  it('REFUSES one person approving two steps', () => {
    const req = request({ approvals: [{ stepId: 'manager', userId: 'mgr@np.example', decision: 'approved', at: T0 }] });
    const finance = applicableSteps(DEFAULT_SPEND_POLICY, req.amount).find((s) => s.id === 'finance')!;
    const verdict = canApprove(DEFAULT_SPEND_POLICY, req, finance, { userId: 'mgr@np.example', roles: ['manager', 'finance'] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations[0]?.rule).toBe('approver_cannot_repeat_step');
  });

  it('refuses an approver who lacks the required role', () => {
    const req = request();
    const step = applicableSteps(DEFAULT_SPEND_POLICY, req.amount)[0]!;
    const applied = applyDecision(DEFAULT_SPEND_POLICY, req, step, { userId: 'clerk@np.example', roles: ['viewer'] }, 'approved', T0);
    expect(applied.ok).toBe(false);
    expect(applied.error).toMatch(/does not hold a role/);
  });

  it('records a rejection as terminal', () => {
    const req = request({ approvals: [{ stepId: 'manager', userId: 'mgr@np.example', decision: 'rejected', at: T0 }] });
    const status = evaluateApproval(DEFAULT_SPEND_POLICY, req);
    expect(status.state).toBe('rejected');
    expect(status.nextStep).toBeNull();
  });

  it('supports a department-scoped step', () => {
    const policy: ApprovalPolicy = {
      id: 'dept',
      documentType: 'expense',
      steps: [{ id: 'dept-head', label: 'Department head', roles: ['manager'], sameDepartment: true }],
      sod: [],
    };
    const req = request({ department: 'finance' });
    const step = policy.steps[0]!;
    expect(canApprove(policy, req, step, { userId: 'a', roles: ['manager'], department: 'ops' }).allowed).toBe(false);
    expect(canApprove(policy, req, step, { userId: 'a', roles: ['manager'], department: 'finance' }).allowed).toBe(true);
  });

  it('can refuse rather than auto-approve when no step covers the amount', () => {
    const policy: ApprovalPolicy = {
      id: 'strict',
      documentType: 'journal',
      steps: [{ id: 'big', label: 'Large only', roles: ['finance'], minAmount: 1_000_000 }],
      sod: [],
      refuseWhenNoStepMatches: true,
    };
    expect(evaluateApproval(policy, request({ amount: 5 })).state).toBe('blocked');
  });
});
