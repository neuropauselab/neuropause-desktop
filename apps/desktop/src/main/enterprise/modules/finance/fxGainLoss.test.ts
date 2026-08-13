import { describe, expect, it } from 'vitest';
import {
  FX_GAINLOSS_ACCOUNT,
  computeRealizedFxGainLoss,
  computeUnrealizedFxGainLoss,
  realizedReceivableFxLines,
} from '@neuropause/shared';

describe('FX gain/loss engine (pure, IAS 21)', () => {
  it('realized: a receivable settled at a higher rate is a GAIN, at a lower rate a LOSS', () => {
    // 100 EUR AR booked @ 90; settled @ 92 → 9200 received vs 9000 booked = +200 gain.
    const gain = computeRealizedFxGainLoss({ amount: 100, bookedRate: 90, settledRate: 92, monetaryClass: 'asset' });
    expect(gain.functionalBooked).toBe(9000);
    expect(gain.functionalCurrent).toBe(9200);
    expect(gain.gainLoss).toBe(200);
    expect(gain.isGain).toBe(true);
    // Settled @ 88 → 8800 vs 9000 = −200 loss.
    const loss = computeRealizedFxGainLoss({ amount: 100, bookedRate: 90, settledRate: 88, monetaryClass: 'asset' });
    expect(loss.gainLoss).toBe(-200);
    expect(loss.isGain).toBe(false);
    // No rate movement → no difference.
    expect(computeRealizedFxGainLoss({ amount: 100, bookedRate: 90, settledRate: 90, monetaryClass: 'asset' }).gainLoss).toBe(0);
  });

  it('a PAYABLE flips the sign — a higher settlement rate means we owe more, a LOSS', () => {
    // 100 EUR AP booked @ 90; settled @ 92 → pay 9200 vs 9000 owed = 200 LOSS (sign flipped).
    const payable = computeRealizedFxGainLoss({ amount: 100, bookedRate: 90, settledRate: 92, monetaryClass: 'liability' });
    expect(payable.gainLoss).toBe(-200);
    expect(payable.isGain).toBe(false);
    // A lower rate on a payable is a gain (we owe less).
    expect(computeRealizedFxGainLoss({ amount: 100, bookedRate: 90, settledRate: 88, monetaryClass: 'liability' }).gainLoss).toBe(200);
  });

  it('realized on a PARTIAL settlement only recognizes the portion actually settled', () => {
    // Pay 40 of a 100 EUR receivable, booked @ 90, settled @ 95 → (40×95) − (40×90) = +200.
    const partial = computeRealizedFxGainLoss({ amount: 40, bookedRate: 90, settledRate: 95, monetaryClass: 'asset' });
    expect(partial.gainLoss).toBe(200);
  });

  it('unrealized: an open balance remeasured at period-end uses the same signed math', () => {
    const unrealized = computeUnrealizedFxGainLoss({ amount: 1000, bookedRate: 90, revalRate: 91.5, monetaryClass: 'asset' });
    expect(unrealized.functionalBooked).toBe(90000);
    expect(unrealized.functionalCurrent).toBe(91500);
    expect(unrealized.gainLoss).toBe(1500);
  });

  it('builds balanced realized lines: gain → Cr FX, loss → Dr FX, zero → the unchanged two lines', () => {
    const fx = FX_GAINLOSS_ACCOUNT.code;
    // Gain: Dr Cash 9200 / Cr AR 9000 / Cr FX 200.
    const gain = realizedReceivableFxLines({ functionalSettled: 9200, functionalBooked: 9000, cashCode: '1000', receivableCode: '1100', fxCode: fx });
    expect(gain).toEqual([
      { account: '1000', debit: 9200, credit: 0 },
      { account: '1100', debit: 0, credit: 9000 },
      { account: fx, debit: 0, credit: 200 },
    ]);
    expect(gain.reduce((s, l) => s + l.debit, 0)).toBe(gain.reduce((s, l) => s + l.credit, 0)); // balanced
    // Loss: Dr Cash 8800 / Cr AR 9000 / Dr FX 200.
    const loss = realizedReceivableFxLines({ functionalSettled: 8800, functionalBooked: 9000, cashCode: '1000', receivableCode: '1100', fxCode: fx });
    expect(loss[2]).toEqual({ account: fx, debit: 200, credit: 0 });
    expect(loss.reduce((s, l) => s + l.debit, 0)).toBe(loss.reduce((s, l) => s + l.credit, 0)); // balanced
    // Zero difference → the unchanged two-line entry (no FX line), single-currency identical.
    const flat = realizedReceivableFxLines({ functionalSettled: 9000, functionalBooked: 9000, cashCode: '1000', receivableCode: '1100', fxCode: fx });
    expect(flat).toHaveLength(2);
  });
});
