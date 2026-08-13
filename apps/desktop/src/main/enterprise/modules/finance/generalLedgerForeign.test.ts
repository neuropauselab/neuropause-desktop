import { describe, expect, it } from 'vitest';
import { glAccountForeignTotals, glAccountLedgerTotals, parseGlJournalLines } from '@neuropause/shared';
import type { GlJournalEntry, GlJournalLine } from '@neuropause/shared';

const T0 = '2026-08-06T00:00:00.000Z';

const entry = (lines: GlJournalLine[], posted = true): GlJournalEntry => ({
  id: 'je',
  entryNumber: 'JE',
  memo: '',
  entryDate: '2026-08-15',
  lines,
  totalDebits: 0,
  totalCredits: 0,
  posted,
  postedAt: posted ? T0 : '',
  sourceModule: '',
  sourceRef: '',
  createdAt: T0,
  updatedAt: T0,
});

describe('GL line transaction-currency view (W6-C1 foundation)', () => {
  it('preserves transaction-currency fields on a foreign line', () => {
    const p = parseGlJournalLines(
      JSON.stringify([
        { account: '1001', debit: 120, credit: 0, txnCurrency: 'EUR', txnAmount: 100, exchangeRate: 1.2, rateDate: '2026-08-15', rateSource: 'register' },
      ]),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error('unreachable');
    expect(p.lines[0]).toEqual({
      account: '1001',
      debit: 120,
      credit: 0,
      txnCurrency: 'EUR',
      txnAmount: 100,
      exchangeRate: 1.2,
      rateDate: '2026-08-15',
      rateSource: 'register',
    });
  });

  it('parses a single-currency line byte-identically (no transaction fields added)', () => {
    const p = parseGlJournalLines(JSON.stringify([{ account: '1000', debit: 100, credit: 0 }]));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.lines[0]).toEqual({ account: '1000', debit: 100, credit: 0 });
  });

  it('ignores a transaction amount with no transaction currency (stays single-currency)', () => {
    const p = parseGlJournalLines(JSON.stringify([{ account: '1000', debit: 100, credit: 0, txnAmount: 100 }]));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.lines[0]).toEqual({ account: '1000', debit: 100, credit: 0 });
  });

  it("derives an account's own-currency balance from posted transaction amounts, leaving functional totals intact", () => {
    const entries = [
      entry([{ account: '1001', debit: 120, credit: 0, txnCurrency: 'EUR', txnAmount: 100 }, { account: '4000', debit: 0, credit: 120 }]),
      entry([{ account: '1001', debit: 60, credit: 0, txnCurrency: 'EUR', txnAmount: 50 }, { account: '4000', debit: 0, credit: 60 }]),
      entry([{ account: '1001', debit: 0, credit: 36, txnCurrency: 'EUR', txnAmount: 30 }, { account: '5000', debit: 36, credit: 0 }]),
    ];
    const f = glAccountForeignTotals('1001', entries);
    expect(f.currency).toBe('EUR');
    expect(f.txnDebit).toBe(150); // 100 + 50
    expect(f.txnCredit).toBe(30);
    expect(f.balance).toBe(120); // 150 − 30, in EUR
    expect(f.lineCount).toBe(3);
    // The functional totals are untouched by the transaction-currency view.
    expect(glAccountLedgerTotals('1001', entries)).toEqual({ debitTotal: 180, creditTotal: 36 });
  });

  it('returns a zero own-currency balance for a single-currency account', () => {
    const entries = [entry([{ account: '1000', debit: 100, credit: 0 }, { account: '4000', debit: 0, credit: 100 }])];
    const f = glAccountForeignTotals('1000', entries);
    expect(f.lineCount).toBe(0);
    expect(f.balance).toBe(0);
    expect(f.currency).toBe('');
  });

  it('ignores unposted entries when deriving the own-currency balance', () => {
    const entries = [entry([{ account: '1001', debit: 120, credit: 0, txnCurrency: 'EUR', txnAmount: 100 }, { account: '4000', debit: 0, credit: 120 }], false)];
    expect(glAccountForeignTotals('1001', entries).lineCount).toBe(0);
  });
});
