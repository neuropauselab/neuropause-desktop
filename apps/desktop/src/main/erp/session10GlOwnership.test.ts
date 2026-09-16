/**
 * ERP Session 10 — GL posting-ownership + AP/COGS/GRNI account integrity.
 *
 * Reproduces the Session 9 / Session 10-memo defects at the derivation level and
 * pins the operator-ruled fixes:
 *   • AP = 2000 (was 2100, colliding with finance Tax Payable 2100).
 *   • COGS = 5050 (was 5000, colliding with finance Operating Expenses 5000) —
 *     so a goods purchase no longer double-hits one merged 5000 account.
 *   • Purchase Price Variance = 5920 (new, standard-cost variance target).
 *   • COGS costing method is labelled 'standard' (truthful) — the live bridge no
 *     longer claims 'weighted_average' for a standard-cost mechanism.
 *
 * The account codes are pinned LITERALLY (a symbolic pin passes at any value and
 * is exactly how the two charts drifted apart unnoticed). The no-collision
 * invariant is derived CONSUMER→PRODUCER: it reads the frozen finance chart and
 * asserts the stock chart does not squat its codes.
 */
import { describe, it, expect } from 'vitest';
import {
  GL_CONTROL_ACCOUNTS,
  GL_PAYABLE_CONTROL_ACCOUNTS,
  type StockMovement,
} from '@neuropause/shared';
import {
  STOCK_ACCOUNTS,
  deriveCogsPosting,
  deriveGoodsReceiptPosting,
  deriveSupplierBillPosting,
} from './postingRules';
import { STOCK_ACCOUNT_DEFS } from './stockAccounts';
import { deriveMovementGlPostings } from '../enterprise/modules/inventory/inventoryGlBridge';

/** The frozen finance chart codes this stock chart must not collide with. */
const FINANCE_AP = GL_PAYABLE_CONTROL_ACCOUNTS.accountsPayable.code; // 2000
const FINANCE_OPEX = GL_PAYABLE_CONTROL_ACCOUNTS.operatingExpense.code; // 5000
const FINANCE_TAX_PAYABLE = GL_CONTROL_ACCOUNTS.taxPayable.code; // 2100

describe('Session 10 — canonical account mapping (literal pins)', () => {
  it('AP is 2000, matching the frozen finance chart (not 2100 = Tax Payable)', () => {
    expect(STOCK_ACCOUNTS.accountsPayable).toBe('2000');
    expect(STOCK_ACCOUNTS.accountsPayable).toBe(FINANCE_AP);
    expect(STOCK_ACCOUNTS.accountsPayable).not.toBe(FINANCE_TAX_PAYABLE);
  });

  it('COGS is 5050 — its own code, clear of Operating Expenses 5000', () => {
    expect(STOCK_ACCOUNTS.cogs).toBe('5050');
    expect(STOCK_ACCOUNTS.cogs).not.toBe(FINANCE_OPEX);
  });

  it('Purchase Price Variance is 5920 and is a defined expense account', () => {
    expect(STOCK_ACCOUNTS.purchasePriceVariance).toBe('5920');
    const ppv = STOCK_ACCOUNT_DEFS.find((d) => d.code === '5920');
    expect(ppv).toBeDefined();
    expect(ppv?.accountClass).toBe('expense');
    expect(ppv?.name).toBe('Purchase Price Variance');
  });
});

describe('Session 10 — the two charts no longer collide (consumer→producer)', () => {
  it('shares exactly one code with the finance chart — Accounts Payable 2000 (intentional)', () => {
    const financeCodes = new Set(
      [...Object.values(GL_CONTROL_ACCOUNTS), ...Object.values(GL_PAYABLE_CONTROL_ACCOUNTS)].map((a) => a.code),
    );
    const stockCodes = Object.values(STOCK_ACCOUNTS);
    const shared = stockCodes.filter((c) => financeCodes.has(c));
    // AP is deliberately the SAME account in both charts; nothing else may overlap.
    expect(shared).toEqual(['2000']);
  });

  it('no stock account squats Tax Payable (2100) or Operating Expenses (5000)', () => {
    const stockCodes = new Set(Object.values(STOCK_ACCOUNTS));
    expect(stockCodes.has(FINANCE_TAX_PAYABLE)).toBe(false); // 2100 stays Tax Payable only
    // 5000 stays Operating Expenses only; COGS moved to 5050.
    expect(Object.values(STOCK_ACCOUNTS).filter((c) => c === FINANCE_OPEX)).toEqual([]);
  });

  it('every stock account code is unique', () => {
    const codes = Object.values(STOCK_ACCOUNTS);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('Session 10 — derivations post to the canonical accounts', () => {
  it('goods receipt: Dr Inventory 1300 / Cr GRNI 2150', () => {
    const d = deriveGoodsReceiptPosting({ receiptId: 'R1', lines: [{ productId: 'SKU1', quantity: 10, unitPrice: 5 }] });
    expect(d.ok).toBe(true);
    expect(d.lines.find((l) => l.debit > 0)?.account).toBe('1300');
    expect(d.lines.find((l) => l.credit > 0)?.account).toBe('2150');
  });

  it('supplier bill (MATCHED): credits Accounts Payable 2000, never 2100', () => {
    const d = deriveSupplierBillPosting({ billId: 'B1', matchedValue: 100, billedValue: 100, matchState: 'MATCHED' });
    expect(d.ok).toBe(true);
    const ap = d.lines.find((l) => l.credit > 0);
    expect(ap?.account).toBe('2000');
    expect(ap?.account).not.toBe('2100');
    // GRNI is relieved on the debit side.
    expect(d.lines.find((l) => l.debit > 0 && l.account === '2150')).toBeTruthy();
  });

  it('COGS derivation: Dr COGS 5050 / Cr Inventory 1300, memo truthfully says standard', () => {
    const d = deriveCogsPosting({ dispatchId: 'D1', lines: [{ productId: 'SKU1', quantity: 2, unitCost: 10 }], method: 'standard' });
    expect(d.ok).toBe(true);
    expect(d.lines.find((l) => l.debit > 0)?.account).toBe('5050');
    expect(d.lines.find((l) => l.credit > 0)?.account).toBe('1300');
    expect(d.memo).toContain('standard');
    expect(d.memo).not.toContain('weighted_average');
  });
});

describe('Session 10 — the LIVE inventory→GL bridge labels COGS truthfully', () => {
  const issue = { type: 'issue', product: 'SKU1', quantity: 2, unitCost: 10 } as unknown as StockMovement;

  it('an issue movement books COGS to 5050 with a standard-cost memo (not weighted_average)', () => {
    const entries = deriveMovementGlPostings(issue, 'M1');
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.memo).toContain('standard');
    expect(entry.memo).not.toContain('weighted_average');
    expect(entry.lines.find((l) => l.debit > 0)?.account).toBe('5050');
    expect(entry.lines.find((l) => l.credit > 0)?.account).toBe('1300');
  });
});

describe('Session 10 — reproduction: the double-5000 / AP-Tax collisions are resolved', () => {
  it('a goods purchase no longer merges bill expense and dispatch COGS into one 5000 account', () => {
    // Bill approval books to finance Operating Expenses (5000); dispatch books COGS.
    // Before Session 10 both were 5000 — the same goods hit ONE account twice.
    const billExpenseAccount = FINANCE_OPEX; // 5000
    const cogs = deriveCogsPosting({ dispatchId: 'D1', lines: [{ productId: 'SKU1', quantity: 1, unitCost: 100 }], method: 'standard' });
    const cogsAccount = cogs.lines.find((l) => l.debit > 0)?.account;
    expect(cogsAccount).toBe('5050');
    // The two expense hits are now DISTINCT and auditable (collision resolved).
    expect(cogsAccount).not.toBe(billExpenseAccount);
  });

  it('AP (2000) and Tax Payable (2100) are distinct accounts', () => {
    const bill = deriveSupplierBillPosting({ billId: 'B1', matchedValue: 50, billedValue: 50, matchState: 'MATCHED' });
    const apAccount = bill.lines.find((l) => l.credit > 0)?.account;
    expect(apAccount).toBe('2000');
    expect(apAccount).not.toBe(FINANCE_TAX_PAYABLE);
  });
});
