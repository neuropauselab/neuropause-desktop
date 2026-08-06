import { describe, expect, it } from 'vitest';
import { deriveFxExposure } from '@neuropause/shared';
import type { ExchangeRate, FinanceInvoice, VendorBill } from '@neuropause/shared';

const T0 = '2026-08-06T00:00:00.000Z';

const mkInvoice = (over: Partial<FinanceInvoice>): FinanceInvoice => ({
  id: 'inv',
  number: 'INV',
  customer: 'Acme',
  amount: 0,
  taxRate: 0,
  amountPaid: 0,
  currency: 'USD',
  exchangeRate: 1,
  status: 'issued',
  paymentTerms: 'net30',
  issueDate: null,
  dueDate: null,
  sourceOrder: '',
  notes: null,
  ...over,
});
const mkBill = (over: Partial<VendorBill>): VendorBill => ({
  id: 'b',
  billNumber: 'BILL',
  vendor: 'Supplies Co',
  vendorGstin: '',
  amount: 0,
  taxRate: 0,
  taxAmount: 0,
  total: 0,
  currency: 'USD',
  exchangeRate: 1,
  status: 'approved',
  billDate: '2026-01-01',
  dueDate: '',
  paidDate: '',
  paymentReference: '',
  sourcePurchaseOrder: '',
  amountPaid: 0,
  outstanding: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});
const mkRate = (fromCurrency: string, toCurrency: string, rate: number, effectiveFrom: string): ExchangeRate => ({
  id: `${fromCurrency}-${toCurrency}-${effectiveFrom}`,
  fromCurrency,
  toCurrency,
  rate,
  effectiveFrom,
  source: 'test',
  lockedAt: null,
  createdAt: T0,
  updatedAt: T0,
});

describe('FX exposure engine (pure, W6-C2)', () => {
  it('marks an open foreign receivable to the latest rate (asset exposure)', () => {
    const res = deriveFxExposure({
      invoices: [mkInvoice({ number: 'INV-1', currency: 'EUR', amount: 1000, exchangeRate: 1.1 })],
      rates: [mkRate('EUR', 'USD', 1.25, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.currencyCount).toBe(1);
    expect(res.byCurrency[0]).toMatchObject({
      currency: 'EUR',
      receivableForeign: 1000,
      payableForeign: 0,
      cashForeign: 0,
      netForeign: 1000,
      functionalBooked: 1100,
      latestRate: 1.25,
      rateResolved: true,
      functionalCurrent: 1250,
      unrealizedDelta: 150,
    });
    expect(res.totalFunctionalCurrent).toBe(1250);
    expect(res.totalUnrealizedDelta).toBe(150);
    expect(res.skippedNoRate).toBe(0);
  });

  it('nets receivables + foreign cash − payables within a currency and marks the net position', () => {
    const res = deriveFxExposure({
      invoices: [mkInvoice({ number: 'INV-1', currency: 'EUR', amount: 1000, exchangeRate: 1.1 })], // AR booked 1100
      bills: [mkBill({ billNumber: 'BILL-1', currency: 'EUR', outstanding: 400, exchangeRate: 1.2, status: 'approved' })], // AP booked 480
      cash: [{ currency: 'EUR', foreignBalance: 200, functionalBalance: 240 }], // cash booked 240
      rates: [mkRate('EUR', 'USD', 1.25, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    const eur = res.byCurrency[0];
    expect(eur.receivableForeign).toBe(1000);
    expect(eur.payableForeign).toBe(400);
    expect(eur.cashForeign).toBe(200);
    expect(eur.netForeign).toBe(800); // 1000 + 200 − 400
    expect(eur.functionalBooked).toBe(860); // 1100 − 480 + 240
    expect(eur.functionalCurrent).toBe(1000); // 800 × 1.25
    expect(eur.unrealizedDelta).toBe(140); // 1000 − 860
  });

  it('shows a foreign position but withholds the mark-to-market when no as-of rate resolves', () => {
    const res = deriveFxExposure({
      invoices: [mkInvoice({ number: 'INV-1', currency: 'AED', amount: 1000, exchangeRate: 0.27 })],
      rates: [], // no AED rate
      asOfDate: '2026-08-31',
    });
    const aed = res.byCurrency[0];
    expect(aed.receivableForeign).toBe(1000);
    expect(aed.functionalBooked).toBe(270);
    expect(aed.rateResolved).toBe(false);
    expect(aed.latestRate).toBe(0);
    expect(aed.functionalCurrent).toBe(270); // un-marked (never faked 1:1)
    expect(aed.unrealizedDelta).toBe(0);
    expect(res.skippedNoRate).toBe(1);
  });

  it('aggregates multiple currencies, sorted, with correct totals', () => {
    const res = deriveFxExposure({
      invoices: [
        mkInvoice({ number: 'INV-EUR', currency: 'EUR', amount: 1000, exchangeRate: 1.1 }), // booked 1100 → 1250 @1.25
        mkInvoice({ number: 'INV-GBP', currency: 'GBP', amount: 500, exchangeRate: 1.3 }), // booked 650 → 625 @1.25
      ],
      rates: [mkRate('EUR', 'USD', 1.25, '2026-08-01'), mkRate('GBP', 'USD', 1.25, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.byCurrency.map((r) => r.currency)).toEqual(['EUR', 'GBP']); // sorted
    expect(res.totalFunctionalBooked).toBe(1750); // 1100 + 650
    expect(res.totalFunctionalCurrent).toBe(1875); // 1250 + 625
    expect(res.totalUnrealizedDelta).toBe(125); // +150 − 25
    expect(res.currencyCount).toBe(2);
  });

  it('excludes functional-currency, draft, and fully-paid positions', () => {
    const res = deriveFxExposure({
      invoices: [
        mkInvoice({ number: 'USD-1', currency: 'USD', amount: 1000, exchangeRate: 1 }), // functional
        mkInvoice({ number: 'DRAFT', currency: 'EUR', amount: 1000, exchangeRate: 1.1, status: 'draft' }),
        mkInvoice({ number: 'PAID', currency: 'EUR', amount: 1000, exchangeRate: 1.1, amountPaid: 1000 }), // nothing open
      ],
      rates: [mkRate('EUR', 'USD', 1.25, '2026-08-01')],
      asOfDate: '2026-08-31',
    });
    expect(res.byCurrency).toEqual([]);
    expect(res.currencyCount).toBe(0);
    expect(res.totalFunctionalCurrent).toBe(0);
  });

  it('returns an empty result for no positions', () => {
    const res = deriveFxExposure({ rates: [], asOfDate: '2026-08-31' });
    expect(res.byCurrency).toEqual([]);
    expect(res.totalFunctionalCurrent).toBe(0);
    expect(res.totalUnrealizedDelta).toBe(0);
    expect(res.functionalCurrency).toBe('USD');
  });
});
