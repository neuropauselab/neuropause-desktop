import { describe, expect, it } from 'vitest';
import {
  FX_UNREALIZED_ACCOUNT,
  cashRevaluationLines,
  deriveCashRevaluation,
  glJournalTotals,
  isBalancedGlJournal,
  reverseFxLines,
} from '@neuropause/shared';
import type { ExchangeRate, GlJournalLine } from '@neuropause/shared';

const T0 = '2026-08-06T00:00:00.000Z';
const FX = FX_UNREALIZED_ACCOUNT.code; // 7811

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
const shape = (lines: readonly GlJournalLine[]): Array<{ account: string; debit: number; credit: number }> =>
  lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit }));
const balanced = (lines: readonly GlJournalLine[]): boolean => isBalancedGlJournal(glJournalTotals(lines));

describe('Foreign cash revaluation engine (pure, W6-C1)', () => {
  const rates = [mkRate('EUR', 'USD', 1.25, '2026-08-01'), mkRate('GBP', 'USD', 1.25, '2026-08-01')];

  it('revalues a foreign cash account UP at the period-end rate (asset gain)', () => {
    const res = deriveCashRevaluation({
      accounts: [{ account: '1001', currency: 'EUR', foreignBalance: 100, functionalBalance: 120 }],
      rates,
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(1);
    expect(res.items[0]).toMatchObject({
      account: '1001',
      currency: 'EUR',
      revalRate: 1.25,
      functionalBooked: 120,
      functionalCurrent: 125,
      delta: 5,
    });
    expect(res.cashDelta).toBe(5);
    expect(res.unrealizedGainLoss).toBe(5);
    expect(res.skippedNoRate).toBe(0);
  });

  it('revalues DOWN when the period-end rate is below the booked carrying (asset loss)', () => {
    const res = deriveCashRevaluation({
      accounts: [{ account: '1001', currency: 'EUR', foreignBalance: 100, functionalBalance: 130 }],
      rates,
      asOfDate: '2026-08-31',
    });
    expect(res.items[0].delta).toBe(-5); // 125 − 130
    expect(res.cashDelta).toBe(-5);
    expect(res.unrealizedGainLoss).toBe(-5);
  });

  it('skips a functional-currency account (no exposure) and a zero-balance account', () => {
    const res = deriveCashRevaluation({
      accounts: [
        { account: '1000', currency: 'USD', foreignBalance: 500, functionalBalance: 500 },
        { account: '1002', currency: 'EUR', foreignBalance: 0, functionalBalance: 0 },
      ],
      rates,
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(0);
    expect(res.skippedNoRate).toBe(0);
    expect(res.cashDelta).toBe(0);
  });

  it('skips (and counts) a foreign account with no period-end rate — never faked 1:1', () => {
    const res = deriveCashRevaluation({
      accounts: [{ account: '1003', currency: 'AED', foreignBalance: 1000, functionalBalance: 270 }],
      rates,
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(0);
    expect(res.skippedNoRate).toBe(1);
    expect(res.cashDelta).toBe(0);
  });

  it('aggregates the cash adjustment across multiple foreign accounts', () => {
    const res = deriveCashRevaluation({
      accounts: [
        { account: '1001', currency: 'EUR', foreignBalance: 100, functionalBalance: 120 }, // +5
        { account: '1002', currency: 'GBP', foreignBalance: 100, functionalBalance: 130 }, // −5
      ],
      rates,
      asOfDate: '2026-08-31',
    });
    expect(res.revaluedCount).toBe(2);
    expect(res.cashDelta).toBe(0); // +5 − 5
  });
});

describe('cashRevaluationLines (W6-C1)', () => {
  it('debits a gaining cash account and balances to 7811', () => {
    const lines = cashRevaluationLines({ adjustments: [{ accountCode: '1001', delta: 5 }], fxCode: FX });
    expect(shape(lines)).toEqual([
      { account: '1001', debit: 5, credit: 0 },
      { account: FX, debit: 0, credit: 5 },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('credits a losing cash account and balances to 7811', () => {
    const lines = cashRevaluationLines({ adjustments: [{ accountCode: '1002', delta: -5 }], fxCode: FX });
    expect(shape(lines)).toEqual([
      { account: '1002', debit: 0, credit: 5 },
      { account: FX, debit: 5, credit: 0 },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('nets multiple accounts into one balanced entry (no FX line when they offset)', () => {
    const lines = cashRevaluationLines({
      adjustments: [
        { accountCode: '1001', delta: 5 },
        { accountCode: '1002', delta: -5 },
      ],
      fxCode: FX,
    });
    expect(shape(lines)).toEqual([
      { account: '1001', debit: 5, credit: 0 },
      { account: '1002', debit: 0, credit: 5 },
    ]);
    expect(balanced(lines)).toBe(true); // the two cash legs already balance — no 7811 line
  });

  it('emits no lines for an all-zero or empty adjustment set', () => {
    expect(cashRevaluationLines({ adjustments: [{ accountCode: '1001', delta: 0 }], fxCode: FX })).toEqual([]);
    expect(cashRevaluationLines({ adjustments: [], fxCode: FX })).toEqual([]);
  });

  it('reverses cleanly via reverseFxLines', () => {
    const lines = cashRevaluationLines({ adjustments: [{ accountCode: '1001', delta: 5 }], fxCode: FX });
    const rev = reverseFxLines(lines);
    expect(shape(rev)).toEqual([
      { account: '1001', debit: 0, credit: 5 },
      { account: FX, debit: 5, credit: 0 },
    ]);
    expect(balanced(rev)).toBe(true);
  });
});
