/**
 * The discovery engine, exercised as arithmetic.
 *
 * What is actually being defended here is not "does it find things" — that is
 * the easy half. It is the four ways a plausible-looking engine lies:
 *
 *  - reporting a volume discount as a pricing leak;
 *  - comparing two currencies as if they were one;
 *  - counting draft or cancelled orders as money that moved;
 *  - going quiet when it finds nothing, so a broken analysis and an honest
 *    "no findings" look identical.
 *
 * Each has a test below, and each of those tests is the reason the
 * corresponding branch exists.
 */
import { describe, expect, it } from 'vitest';
import type { PurchaseOrderObservation } from '@neuropause/shared';
import {
  discoverPriceVarianceOpportunities,
  insufficiencyMessage,
  priceVarianceOpportunityId,
} from '@neuropause/shared';

const NOW = '2026-08-09T12:00:00.000Z';
const RECENT = '2026-07-01T00:00:00.000Z';

function po(over: Partial<PurchaseOrderObservation> & { recordId: string }): PurchaseOrderObservation {
  return {
    reference: `PO-${over.recordId}`,
    supplier: 'Acme',
    product: 'SKU-100',
    quantity: 10,
    unitCost: 100,
    currency: 'INR',
    status: 'approved',
    orderedAt: RECENT,
    warehouse: 'WH-01',
    ...over,
  };
}

/** Three orders, two suppliers, no volume explanation: excess = 550. */
const CLEAN_VARIANCE = [
  po({ recordId: '1', supplier: 'Acme', quantity: 10, unitCost: 100 }),
  po({ recordId: '2', supplier: 'Borealis', quantity: 20, unitCost: 120 }),
  po({ recordId: '3', supplier: 'Acme', quantity: 5, unitCost: 130 }),
];

const run = (
  orders: PurchaseOrderObservation[],
  opts: { lookbackDays?: number; readCeiling?: number } = {},
) => discoverPriceVarianceOpportunities(orders, { now: NOW, ...opts });

describe('price variance discovery', () => {
  describe('the arithmetic', () => {
    it('sums (price − best) × quantity over every dearer order', () => {
      const { opportunities } = run(CLEAN_VARIANCE);
      expect(opportunities).toHaveLength(1);
      // (120−100)×20 = 400, (130−100)×5 = 150.
      expect(opportunities[0]!.impact?.amount).toBe(550);
      expect(opportunities[0]!.impact?.currency).toBe('INR');
    });

    it('says the money is already spent, and never calls it a saving', () => {
      const o = run(CLEAN_VARIANCE).opportunities[0]!;
      expect(o.impact!.kind).toBe('already_spent_above_best_observed_price');
      expect(o.impact!.caveat).toContain('already spent');
      expect(o.impact!.caveat).toContain('not a saving');
      // EVERY string the finding can put on a screen, not a chosen few — the
      // earlier version of this test checked five fields and would have missed
      // "a potential saving of 550" in a plan step or an evidence line.
      const prose = [
        o.title,
        o.objective,
        o.finding,
        o.why,
        o.recommendation,
        o.risk,
        o.impact!.basis,
        o.impact!.caveat,
        o.confidence.basis,
        ...o.unknown,
        ...o.evidence.flatMap((e) => [e.label, e.detail]),
        o.plan.objective,
        o.plan.expectedEffect,
        o.plan.risk,
        o.plan.verification,
        ...o.plan.steps.flatMap((s) => [s.title, s.detail]),
        o.ranking.basis,
        ...o.ranking.factors.flatMap((f) => [f.label, f.value, f.effect]),
        ...o.confidence.checks.flatMap((c) => [c.label, c.detail]),
      ].join(' ');
      // Only AFFIRMATIVE saving claims are forbidden. The two places the word
      // appears are denials ("not a saving available today"), and those are the
      // point — so they are asserted for, not against.
      expect(prose.toLowerCase()).not.toMatch(
        /\b(will|would|can|could|may|might|potential|estimated|projected|expected)\s+sav|\bsavings?\s+of\b|\byou'?ll\s+sav/,
      );
      expect(prose).toContain('not a saving available today');
    });

    it('names the distinct suppliers, not the same one twice', () => {
      // When one supplier sold at both the lowest AND the highest price — a
      // price that drifted over time — naming best and highest reads "add
      // quotes from Acme and Acme".
      const step = run(CLEAN_VARIANCE).opportunities[0]!.plan.steps.find((s) => s.order === 3)!;
      expect(step.detail).toContain('Acme and Borealis');
      expect(step.detail).not.toContain('Acme and Acme');
    });

    it('makes the evidence add up to the headline, to the cent', () => {
      // Three-decimal unit costs are ordinary in procurement, and rounding the
      // SUM while showing rounded TERMS makes the card disagree with itself —
      // under a `basis` that explicitly invites adding them up by hand.
      const { opportunities } = run([
        po({ recordId: '1', supplier: 'Acme', quantity: 1, unitCost: 12 }),
        po({ recordId: '2', supplier: 'Borealis', quantity: 3, unitCost: 12.345 }),
        po({ recordId: '3', supplier: 'Borealis', quantity: 3, unitCost: 12.345 }),
      ]);
      const found = opportunities[0]!;
      const shown = found.evidence
        .flatMap((e) => [...e.detail.matchAll(/= ([\d,]+\.\d\d) INR above/g)])
        .map((m) => Number(m[1]!.replace(/,/g, '')));
      expect(shown.length).toBe(2);
      expect(Number(shown.reduce((a, b) => a + b, 0).toFixed(2))).toBe(found.impact!.amount);
    });

    it('never prints a spread of 0.00 beside a non-zero total', () => {
      // Prices are rounded ONCE at intake, so what is compared is what is
      // displayed. Otherwise 100.000 vs 100.004 yields "a spread of 0.00 INR
      // (0%)" under a headline of 4.00 INR.
      const { opportunities } = run([
        po({ recordId: '1', supplier: 'Acme', quantity: 10, unitCost: 100 }),
        po({ recordId: '2', supplier: 'Borealis', quantity: 1000, unitCost: 100.004 }),
      ]);
      expect(opportunities).toEqual([]);
    });

    it('says "<1%" rather than "0%" of a real amount', () => {
      const { opportunities } = run([
        po({ recordId: '1', supplier: 'Acme', quantity: 1000, unitCost: 100 }),
        po({ recordId: '2', supplier: 'Borealis', quantity: 1, unitCost: 112 }),
      ]);
      expect(opportunities[0]!.why).toContain('<1%');
      expect(opportunities[0]!.why).not.toMatch(/\b0% of\b/);
    });

    it('finds nothing when every order is at the same price', () => {
      const { opportunities, review } = run([
        po({ recordId: '1', supplier: 'Acme', unitCost: 100 }),
        po({ recordId: '2', supplier: 'Borealis', unitCost: 100 }),
      ]);
      expect(opportunities).toEqual([]);
      // Compared, and genuinely consistent — a different fact from "could not compare".
      expect(review.productsCompared).toBe(1);
      expect(insufficiencyMessage(review)).toContain('consistent price');
    });
  });

  describe('the volume discount — the finding this engine must not fabricate', () => {
    it('flags it when the cheapest order was the biggest, and drops confidence', () => {
      const { opportunities } = run([
        po({ recordId: '1', supplier: 'Acme', quantity: 100, unitCost: 50 }),
        po({ recordId: '2', supplier: 'Borealis', quantity: 10, unitCost: 60 }),
      ]);
      const found = opportunities[0]!;
      expect(found.confidence.tier).toBe('weak');
      const volumeCheck = found.confidence.checks.find((c) => c.label.includes('order size'))!;
      expect(volumeCheck.passed).toBe(false);
      expect(found.unknown.join(' ')).toContain('Volume probably explains part of this');
    });

    it('does NOT flag it when the cheapest order was not the biggest', () => {
      const found = run(CLEAN_VARIANCE).opportunities[0]!;
      expect(found.confidence.checks.find((c) => c.label.includes('order size'))!.passed).toBe(true);
      expect(found.confidence.tier).toBe('strong');
    });

    it('breaks a price tie toward the LARGEST order — the least flattering reading', () => {
      // Two orders share the lowest price. Picking the larger one is what makes
      // the volume check fire; picking the smaller would quietly inflate
      // confidence on exactly the case that deserves suspicion.
      const { opportunities } = run([
        po({ recordId: '1', supplier: 'Acme', quantity: 5, unitCost: 50 }),
        po({ recordId: '2', supplier: 'Acme', quantity: 90, unitCost: 50 }),
        po({ recordId: '3', supplier: 'Borealis', quantity: 10, unitCost: 70 }),
      ]);
      const found = opportunities[0]!;
      expect(found.confidence.checks.find((c) => c.label.includes('order size'))!.passed).toBe(false);
      expect(found.confidence.tier).toBe('moderate'); // 3 orders rescues it from weak
    });
  });

  describe('what it refuses to compare', () => {
    it('refuses two currencies rather than applying a rate to old orders', () => {
      const { opportunities, review } = run([
        po({ recordId: '1', supplier: 'Acme', unitCost: 100, currency: 'INR' }),
        po({ recordId: '2', supplier: 'Borealis', unitCost: 120, currency: 'USD' }),
      ]);
      expect(opportunities).toEqual([]);
      expect(review.exclusions.map((e) => e.reason).join(' ')).toContain('more than one currency');
    });

    it('refuses a single supplier — there is nothing to compare against', () => {
      const { opportunities, review } = run([
        po({ recordId: '1', supplier: 'Acme', unitCost: 100 }),
        po({ recordId: '2', supplier: 'Acme', unitCost: 200 }),
      ]);
      expect(opportunities).toEqual([]);
      expect(review.exclusions.map((e) => e.reason).join(' ')).toContain('Only one supplier');
    });

    it('excludes drafts and cancellations, because no money moved', () => {
      const { opportunities, review } = run([
        po({ recordId: '1', supplier: 'Acme', unitCost: 100, status: 'draft' }),
        po({ recordId: '2', supplier: 'Borealis', unitCost: 500, status: 'cancelled' }),
      ]);
      expect(opportunities).toEqual([]);
      expect(review.ordersUsable).toBe(0);
      const excluded = review.exclusions.find((e) => e.reason.includes('committed'))!;
      expect(excluded.count).toBe(2);
    });

    it('excludes orders missing any field the comparison needs', () => {
      const { review } = run([
        po({ recordId: '1', product: '' }),
        po({ recordId: '2', supplier: '' }),
        po({ recordId: '3', quantity: 0 }),
        po({ recordId: '4', unitCost: 0 }),
        po({ recordId: '5', unitCost: Number.POSITIVE_INFINITY }),
        // A blank currency must NOT be defaulted to INR and then described to
        // the reader as "all in INR" — that asserts a fact about an empty field.
        po({ recordId: '6', currency: '' }),
      ]);
      expect(review.ordersUsable).toBe(0);
      const reasons = review.exclusions.map((e) => e.reason).join(' | ');
      expect(reasons).toContain('No product');
      expect(reasons).toContain('No supplier');
      expect(reasons).toContain('Quantity is zero');
      expect(reasons).toContain('Unit cost is zero, missing or not a number');
      expect(reasons).toContain('No currency');
    });

    it('labels whether a reason set aside an order or a whole product', () => {
      const { review } = run([
        po({ recordId: '1', status: 'draft' }),
        po({ recordId: '2', unitCost: 100 }),
        po({ recordId: '3', unitCost: 200 }),
      ]);
      const byReason = new Map(review.exclusions.map((e) => [e.reason, e.unit]));
      expect([...byReason.values()]).toContain('order');
      expect(byReason.get('Only one supplier for this product — nothing to compare against')).toBe(
        'product',
      );
    });

    it('applies the lookback window and counts it separately from usability', () => {
      const old = po({ recordId: '9', supplier: 'Borealis', unitCost: 999, orderedAt: '2020-01-01T00:00:00.000Z' });
      const { opportunities, review } = run([...CLEAN_VARIANCE, old], { lookbackDays: 90 });
      expect(review.windowDays).toBe(90);
      expect(review.ordersExamined).toBe(4);
      // The distinction the UI depends on: an out-of-window order is not an
      // order that "did not carry the fields".
      expect(review.ordersInWindow).toBe(3);
      expect(review.ordersUsable).toBe(3);
      expect(review.exclusions.map((e) => e.reason).join(' ')).toContain('Older than the 90-day window');
      expect(opportunities[0]!.impact?.amount).toBe(550);
    });

    it('declares a truncated read instead of presenting a slice as everything', () => {
      const { review } = run(CLEAN_VARIANCE, { readCeiling: 3 });
      expect(review.truncated).toBe(true);
      expect(review.wouldImprove[0]).toContain('most recently updated purchase orders');
      expect(run(CLEAN_VARIANCE, { readCeiling: 5000 }).review.truncated).toBe(false);
    });
  });

  describe('the empty state — the one most users see first', () => {
    it('names the ACTUAL reason nothing was usable, not a plausible one', () => {
      expect(insufficiencyMessage(run([]).review)).toContain('no purchase orders to analyse');

      // Every order is a draft. It carried all four fields, so claiming
      // otherwise sends the reader to check the wrong thing.
      const drafts = insufficiencyMessage(run([po({ recordId: '1', status: 'draft' })]).review);
      expect(drafts).toContain('not a committed order');
      expect(drafts).not.toContain('carried the product');

      expect(
        insufficiencyMessage(
          run([po({ recordId: '1', orderedAt: '2019-01-01T00:00:00.000Z' })]).review,
        ),
      ).toContain('older than the 365-day window');

      expect(
        insufficiencyMessage(
          run([po({ recordId: '1' }), po({ recordId: '2', unitCost: 200 })]).review,
        ),
      ).toContain('no product was bought from more than one supplier');
    });

    it('gives advice specific to what was missing, not generic advice', () => {
      const empty = run([]).review.wouldImprove.join(' ');
      expect(empty).toContain('No purchase orders exist yet');

      const oneSupplier = run([
        po({ recordId: '1', unitCost: 100 }),
        po({ recordId: '2', unitCost: 200 }),
      ]).review.wouldImprove.join(' ');
      expect(oneSupplier).toContain('single supplier');
      expect(oneSupplier).not.toContain('No purchase orders exist yet');

      const allOld = run([po({ recordId: '1', orderedAt: '2019-01-01T00:00:00.000Z' })]).review
        .wouldImprove.join(' ');
      expect(allOld).toContain('outside the window');
    });

    it('always names the product-code trap, because it silently hides real gaps', () => {
      expect(run(CLEAN_VARIANCE).review.wouldImprove.join(' ')).toContain('Consistent product codes');
    });
  });

  describe('what a finding is obliged to carry', () => {
    it('points every piece of evidence at real record ids', () => {
      const found = run(CLEAN_VARIANCE).opportunities[0]!;
      const cited = new Set(found.evidence.flatMap((e) => e.records.map((r) => r.recordId)));
      expect([...cited].sort()).toEqual(['1', '2', '3']);
      for (const record of found.sourceRecords) {
        expect(record.moduleId).toBe('procurement-orders');
        expect(record.label).toMatch(/^PO-/);
      }
    });

    it('never ships an empty "what we cannot establish"', () => {
      for (const found of run(CLEAN_VARIANCE).opportunities) {
        expect(found.unknown.length).toBeGreaterThan(2);
      }
    });

    it('is marked system-derived, reusing the platform provenance vocabulary', () => {
      expect(run(CLEAN_VARIANCE).opportunities[0]!.provenance).toBe('system_derived');
    });

    it('carries a plan whose executable step is the only thing NeuroPause claims to do', () => {
      const plan = run(CLEAN_VARIANCE).opportunities[0]!.plan;
      expect(plan.executable?.kind).toBe('create_rfq');
      expect(plan.requiredPermissions).toEqual(['procurement:manage']);
      // Exactly one step is ours. Claiming more would be claiming to negotiate.
      expect(plan.steps.filter((s) => s.performedBy === 'neuropause')).toHaveLength(1);
      expect(plan.verification).toContain('reads the RFQ back');
    });
  });

  describe('ranking', () => {
    it('orders by money above best price, discounted by confidence', () => {
      const orders = [
        ...CLEAN_VARIANCE, // 550, strong → 550
        po({ recordId: '4', product: 'SKU-200', supplier: 'Acme', quantity: 100, unitCost: 50 }),
        po({ recordId: '5', product: 'SKU-200', supplier: 'Borealis', quantity: 10, unitCost: 60 }),
      ];
      const { opportunities } = run(orders);
      expect(opportunities.map((o) => o.ranking.score)).toEqual([550, 30]); // 100 × 0.3
      expect(opportunities[0]!.title).toContain('SKU-100');
    });

    it('states its own formula and marks the context-only factors as such', () => {
      const ranking = run(CLEAN_VARIANCE).opportunities[0]!.ranking;
      expect(ranking.basis).toContain('multiplied by how much the comparison can be trusted');
      const contextOnly = ranking.factors.filter((f) => f.effect.includes('does not change'));
      expect(contextOnly.length).toBe(2);
    });
  });

  describe('identity', () => {
    it('gives a finding the same id across recomputes, so decisions re-attach', () => {
      const first = run(CLEAN_VARIANCE).opportunities[0]!.id;
      const laterWithMoreData = run([
        ...CLEAN_VARIANCE,
        po({ recordId: '6', supplier: 'Borealis', unitCost: 140 }),
      ]).opportunities[0]!;
      expect(laterWithMoreData.id).toBe(first);
      // Same identity, different arithmetic — which is the whole point of
      // recomputing rather than storing.
      expect(laterWithMoreData.impact?.amount).not.toBe(550);
    });

    it('normalizes case and whitespace, so "sku-100 " is not a second product', () => {
      expect(priceVarianceOpportunityId(' sku-100 ', 'inr')).toBe(
        priceVarianceOpportunityId('SKU-100', 'INR'),
      );
    });
  });
});
