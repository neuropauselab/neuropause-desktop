/**
 * The Opportunity Center on screen, driven by real clicks.
 *
 * Wired the same way the app wires it: the real `OpportunitiesView` against the
 * real `initOpportunities` handlers, over real record stores on disk. The
 * assertions are deliberately about WORDING as much as behaviour, because on
 * this screen the wording is the feature — a number labelled "savings" instead
 * of "already spent" is not a copy nit, it is the product making a claim it
 * cannot support.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { route, clearRoutes, unroutedChannels } from './setup';

import { EnterpriseRecordStore } from '@main/enterprise/framework/enterpriseRecordStore';
import { DecisionRecordStore } from '@main/decisions/decisionService';
import { HoldStore } from '@main/decisions/holdStore';
import { createHoldRaiser } from '@main/decisions/raiseHold';
import { OpportunityDecisionStore } from '@main/opportunities/opportunityDecisionStore';
import { initOpportunities } from '@main/opportunities/index';
import {
  findOpenRfq,
  purchaseOrdersAsObservations,
  rfqAsExecution,
  rfqFieldsFor,
} from '@main/opportunities/procurementSource';
import { OutcomeRevisionStore } from '@main/outcomes/outcomeRevisionStore';
import { OpportunitiesView } from '@renderer/opportunities/OpportunitiesView';

const DIR = join(tmpdir(), 'np-ui-opportunities');
const T0 = '2026-08-09T12:00:00.000Z';

let dir: string;
let orders: EnterpriseRecordStore;
let rfqs: EnterpriseRecordStore;
let holds: HoldStore;
let records: DecisionRecordStore;
let decisions: OpportunityDecisionStore;
let revisions: OutcomeRevisionStore;
let mayManage = true;

/**
 * Baseline orders are dated BEFORE the action. An order recorded at the same
 * instant the RFQ was raised is not evidence of what was being paid
 * beforehand, and the engine is right to exclude it.
 */
const T_BEFORE = '2026-07-01T00:00:00.000Z';

function seed(ref: string, supplier: string, quantity: number, unitCost: number): void {
  orders.create({
    title: ref,
    fields: {
      poNumber: ref,
      supplier,
      product: 'SKU-100',
      quantity,
      unitCost,
      currency: 'INR',
      status: 'approved',
      warehouse: 'WH-01',
    },
    actor: 'priya@example.com',
    now: T_BEFORE,
  });
}

async function wire(): Promise<void> {
  dir = join(DIR, randomUUID());
  await fs.mkdir(dir, { recursive: true });
  mayManage = true;

  orders = new EnterpriseRecordStore(join(dir, 'po.json'), 'procurement-orders', 'order');
  rfqs = new EnterpriseRecordStore(join(dir, 'rfq.json'), 'procurement-rfqs', 'rfq');
  holds = new HoldStore(join(dir, 'holds.json'));
  records = new DecisionRecordStore(join(dir, 'decisions.json'));
  decisions = new OpportunityDecisionStore(join(dir, 'opp.json'));
  revisions = new OutcomeRevisionStore(join(dir, 'rev.json'));
  await Promise.all([
    orders.load(),
    rfqs.load(),
    holds.load(),
    records.load(),
    decisions.load(),
    revisions.load(),
  ]);

  const { handlers } = initOpportunities({
    orders: () => purchaseOrdersAsObservations(orders),
    decisions,
    raiseHold: createHoldRaiser({
      holds,
      decisions: records,
      actor: () => 'priya@example.com',
      audit: () => undefined,
    }),
    decisionRecords: records,
    canExecute: () => mayManage,
    heldPermissions: () => ['procurement:read'],
    actorLabel: () => 'Priya',
    actor: () => 'priya@example.com',
    rfqModuleAvailable: () => true,
    openRfqFor: (product) => findOpenRfq(rfqs, product),
    createRfq: async (input) => {
      const { title, fields } = rfqFieldsFor(rfqs, input);
      const created = rfqs.create({ title, fields, actor: 'priya@example.com', now: T0 });
      await rfqs.flush();
      return { recordId: created.id, label: title };
    },
    readRfq: (recordId) => {
      const record = rfqs.get(recordId);
      return record
        ? { recordId: record.id, label: String(record.fields.rfqNumber ?? record.title) }
        : null;
    },
    executionFor: (recordId) => rfqAsExecution(rfqs, recordId),
    outcomeRevisions: revisions,
    audit: () => undefined,
    // Fixed, so these tests do not start failing on a date.
    now: () => T0,
    readCeiling: 5_000,
  });
  for (const h of handlers) {
    route(h.channel as string, (p) => h.handler(h.schema.parse(p)));
  }
}

beforeEach(wire);
afterEach(async () => {
  cleanup();
  clearRoutes();
  await Promise.all([
    orders.flush(),
    rfqs.flush(),
    holds.flush(),
    records.flush(),
    decisions.flush(),
    revisions.flush(),
  ]);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

/** Three orders, two suppliers, 550 above the best price. */
function seedVariance(): void {
  seed('PO-0001', 'Acme', 10, 100);
  seed('PO-0002', 'Borealis', 20, 120);
  seed('PO-0003', 'Acme', 5, 130);
}

describe('Opportunity Center on screen', () => {
  describe('with no data — the state most installs open in', () => {
    it('explains why there is nothing rather than showing a bare empty list', async () => {
      render(<OpportunitiesView />);
      await screen.findByText(/no purchase orders to analyse yet/i);
      expect(screen.getByText(/will not invent a finding/i)).toBeTruthy();
      // The data review is what makes the empty state an answer.
      expect(screen.getByText(/What was examined/i)).toBeTruthy();
      expect(screen.getByText(/Business → Procurement/i)).toBeTruthy();
      expect(unroutedChannels()).toEqual([]);
    });

    it('counts what it set aside, so "nothing found" is checkable', async () => {
      seed('PO-0001', 'Acme', 10, 100);
      seed('PO-0002', 'Acme', 10, 200);
      render(<OpportunitiesView />);
      await screen.findByText(/no product was bought from more than one supplier/i);
      expect(screen.getByText(/Only one supplier for this product/i)).toBeTruthy();
      // Counted per PRODUCT GROUP, not per order — one product was set aside,
      // and both its orders were otherwise usable.
      expect(screen.getByText(/1 distinct product; 0 had more than one supplier/i)).toBeTruthy();
      expect(screen.getByText(/2 in total; 2 fall inside the last 365 days/i)).toBeTruthy();
      // Counted per PRODUCT, and it says so — the list mixes units.
      expect(screen.getByText('1 product')).toBeTruthy();
    });
  });

  describe('with a real finding', () => {
    beforeEach(seedVariance);

    it('shows the finding, the figure, and what the figure is NOT', async () => {
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at 3 different prices/i);
      expect(screen.getByText('550.00 INR')).toBeTruthy();
      // The label beside the number. Never "savings".
      expect(screen.getByText(/already spent above/i)).toBeTruthy();
      expect(screen.queryByText(/potential saving/i)).toBeNull();
      expect(screen.getByText(/Strong evidence/i)).toBeTruthy();
    });

    it('reveals evidence, unknowns and the confidence checks on demand', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);

      // Collapsed by default — the card is a summary, not a wall.
      expect(screen.queryByText(/What NeuroPause cannot establish/i)).toBeNull();
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));

      expect(await screen.findByText(/What this is based on/i)).toBeTruthy();
      expect(screen.getByText(/What NeuroPause cannot establish/i)).toBeTruthy();
      // Real record references, openable by the reader. It appears twice by
      // design — once under the orders that cost more, once under everything
      // that was compared.
      expect(screen.getAllByText('PO-0002').length).toBeGreaterThan(1);
      // The volume caveat is present even when it did not fire.
      expect(screen.getByText(/Volume discounts are not modelled/i)).toBeTruthy();
      // The arithmetic is shown, not just its result.
      expect(screen.getByText(/Sum over 2 orders of \(unit price/i)).toBeTruthy();
    });

    it('explains the ranking instead of showing an unexplained score', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));
      expect(await screen.findByText(/Why it is ranked here/i)).toBeTruthy();
      expect(screen.getByText(/multiplied by how much the comparison can be trusted/i)).toBeTruthy();
      expect(screen.getByText(/Multiplies the score by 1/i)).toBeTruthy();
    });

    it('accepts a finding and then offers the one action NeuroPause can take', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);

      expect(screen.queryByRole('button', { name: /create an rfq/i })).toBeNull();
      await user.click(screen.getByRole('button', { name: /this is worth pursuing/i }));

      const run = await screen.findByRole('button', { name: /create an rfq for this product/i });
      expect(run).toBeTruthy();
      expect(screen.getByText('Accepted')).toBeTruthy();
    });

    it('runs the plan, and reports the record it verified', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /this is worth pursuing/i }));
      await user.click(await screen.findByRole('button', { name: /create an rfq/i }));

      await screen.findByText(/Created RFQ-0001 for SKU-100/i);
      // The record really exists, and the screen reflects the honest status:
      // NeuroPause did step 2 of 4, so "In progress", not "Done".
      expect(rfqs.count()).toBe(1);
      await waitFor(() => expect(screen.getByText('In progress')).toBeTruthy());
    });

    it('renders a refusal as a hold with its resolution, not as an error', async () => {
      const user = userEvent.setup();
      mayManage = false;
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /this is worth pursuing/i }));
      await user.click(await screen.findByRole('button', { name: /create an rfq/i }));

      expect(await screen.findByText(/On hold · Missing permission/i)).toBeTruthy();
      expect(screen.getByText(/does not hold "procurement:manage"/i)).toBeTruthy();
      expect(screen.getByText(/What would resolve this/i)).toBeTruthy();
      expect(screen.getByText(/until someone resolves it/i)).toBeTruthy();
      expect(rfqs.count()).toBe(0);
    });

    it('dismisses a finding, and says what it was worth when the gap grows', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /not pursuing/i }));

      await screen.findByRole('heading', { name: /not pursuing/i });
      // The gap widens after the dismissal.
      seed('PO-0004', 'Borealis', 100, 200);
      await user.click(screen.getByRole('button', { name: /refresh/i }));

      expect(
        await screen.findByText(/It was 550.00 INR when you set it aside; it is 10,550.00 INR now/i),
      ).toBeTruthy();
    });

    it('brings a dismissed finding back', async () => {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /not pursuing/i }));
      await user.click(await screen.findByRole('button', { name: /bring it back/i }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /this is worth pursuing/i })).toBeTruthy(),
      );
    });

    it('never asks for a channel nobody serves', async () => {
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      expect(unroutedChannels()).toEqual([]);
    });
  });

  /* ── Program 5: the outcome on screen ─────────────────────────────────── */

  describe('the outcome section', () => {
    beforeEach(seedVariance);

    /** Open a card's detail, where the outcome is rendered. */
    async function openDetail(): Promise<void> {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));
      await screen.findByText('Outcome');
    }

    /** Run the plan so an RFQ exists. */
    async function execute(): Promise<string> {
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /this is worth pursuing/i }));
      await user.click(await screen.findByRole('button', { name: /create an rfq/i }));
      await screen.findByText(/Created RFQ-0001/i);
      cleanup();
      return rfqs.list()[0]!.id;
    }

    /** Award the RFQ by hand, the way the module's action would. */
    function awardTo(rfqId: string, unitCost: number, poStatus = 'draft'): void {
      const po = orders.create({
        title: 'PO-RFQ-0001',
        fields: {
          poNumber: 'PO-RFQ-0001',
          supplier: 'Borealis',
          product: 'SKU-100',
          quantity: 13,
          unitCost,
          currency: 'INR',
          status: poStatus,
          warehouse: 'WH-01',
        },
        actor: 'priya@example.com',
        now: '2026-08-10T00:00:00.000Z',
      });
      rfqs.update(rfqId, {
        fields: {
          ...rfqs.get(rfqId)!.fields,
          status: 'awarded',
          awardedSupplier: 'Borealis',
          awardedOrder: po.id,
          awardedAt: '2026-08-10T00:00:00.000Z',
        },
        actor: 'priya@example.com',
        now: '2026-08-10T00:00:00.000Z',
      });
    }

    it('shows the three columns even when there is nothing to measure', async () => {
      await openDetail();
      // Keeping the frame visible is what stops "no measurement" reading as
      // "no expectation either".
      expect(screen.getByText('Expected')).toBeTruthy();
      expect(screen.getByText('Measured')).toBeTruthy();
      expect(screen.getByText('Verified')).toBeTruthy();
      expect(screen.getByText(/Measurement unavailable/i)).toBeTruthy();
      expect(screen.getByText(/has not created a request for quotation/i)).toBeTruthy();
    });

    it('says PENDING after the action, and that execution is not a result', async () => {
      await execute();
      await openDetail();
      expect(screen.getByText(/Measurement pending/i)).toBeTruthy();
      expect(screen.getByText(/downstream business transaction/i)).toBeTruthy();
      expect(screen.getByText(/What would enable the measurement/i)).toBeTruthy();
    });

    it('shows a favourable change with the causal refusal beside it', async () => {
      const rfqId = await execute();
      awardTo(rfqId, 95);
      await openDetail();

      // Baseline is the weighted average of the three seeded orders: 115.71.
      expect(screen.getByText('-20.71 INR')).toBeTruthy();
      expect(screen.getByText(/Lower than the baseline/i)).toBeTruthy();
      // Not a footnote — the number's natural misreading is "we did that".
      expect(screen.getByText(/OBSERVED after the action, not what the action achieved/i)).toBeTruthy();
    });

    it('shows a WORSE result just as prominently, and never as a failure of the app', async () => {
      const rfqId = await execute();
      awardTo(rfqId, 150);
      await openDetail();
      expect(screen.getByText('+34.29 INR')).toBeTruthy();
      expect(screen.getByText(/Higher than the baseline/i)).toBeTruthy();
      // Same place, same treatment as the favourable case.
      expect(screen.getByText(/Financial effect/i)).toBeTruthy();
    });

    it('stops at MEASURED on a draft order and says why', async () => {
      const rfqId = await execute();
      awardTo(rfqId, 95, 'draft');
      await openDetail();
      expect(screen.getByText(/Measured, not yet verified/i)).toBeTruthy();
      expect(screen.getByText(/5 of 6 checks passed/i)).toBeTruthy();
      expect(screen.getByText(/agreed but not transacted/i)).toBeTruthy();
    });

    it('reaches VERIFIED on a committed order', async () => {
      const rfqId = await execute();
      awardTo(rfqId, 95, 'approved');
      await openDetail();
      expect(screen.getByText(/Measured and verified/i)).toBeTruthy();
      expect(screen.getByText(/6 of 6 checks passed/i)).toBeTruthy();
    });

    it('refuses to compare two currencies rather than converting', async () => {
      const rfqId = await execute();
      const po = orders.create({
        title: 'PO-RFQ-0001',
        fields: {
          poNumber: 'PO-RFQ-0001',
          supplier: 'Borealis',
          product: 'SKU-100',
          quantity: 13,
          unitCost: 95,
          currency: 'USD',
          // A draft, as an award produces. Deliberate: a COMMITTED order in a
          // second currency makes the discovery engine drop the product
          // entirely (it refuses mixed-currency comparison), so the finding —
          // and with it the outcome — would disappear before this state could
          // ever be seen. The draft is the reachable path, and it is what the
          // award actually creates.
          status: 'draft',
        },
        actor: 'priya@example.com',
        now: '2026-08-10T00:00:00.000Z',
      });
      rfqs.update(rfqId, {
        fields: { ...rfqs.get(rfqId)!.fields, status: 'awarded', awardedOrder: po.id },
        actor: 'priya@example.com',
        now: '2026-08-10T00:00:00.000Z',
      });
      await openDetail();
      expect(screen.getByText(/cannot be compared/i)).toBeTruthy();
      expect(screen.getByText(/would invent the very difference being measured/i)).toBeTruthy();
    });

    it('Refresh re-measures from the records — it is never a no-op', async () => {
      const user = userEvent.setup();
      const rfqId = await execute();
      awardTo(rfqId, 95);

      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));
      expect(await screen.findByText('-20.71 INR')).toBeTruthy();

      // Someone corrects the awarded order's price behind the screen.
      const po = orders.list().find((r) => r.fields.poNumber === 'PO-RFQ-0001')!;
      orders.update(po.id, {
        fields: { ...po.fields, unitCost: 130 },
        actor: 'priya@example.com',
        now: '2026-08-10T00:00:00.000Z',
      });
      await user.click(screen.getByRole('button', { name: /refresh measurement/i }));

      expect(await screen.findByText('+14.29 INR')).toBeTruthy();
      expect(screen.queryByText('-20.71 INR')).toBeNull();
    });

    it('re-measures when the finding beneath it moves, without being remounted', async () => {
      // The panel stays mounted across a reload. Without a change signal it
      // keeps asserting "no action has been run" while the RFQ sits in the
      // store — a stale measurement wearing a fresh timestamp. Every other
      // test here calls cleanup() first, so only this one can catch it.
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));
      expect(await screen.findByText(/has not created a request for quotation/i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /this is worth pursuing/i }));
      await user.click(await screen.findByRole('button', { name: /create an rfq/i }));

      expect(await screen.findByText(/Measurement pending/i)).toBeTruthy();
      expect(screen.queryByText(/has not created a request for quotation/i)).toBeNull();
    });

    it('keeps Refresh reachable when the measurement fails to load', async () => {
      // An early return on error removed the only retry affordance, leaving a
      // transient fault as a dead end until the card was collapsed.
      const user = userEvent.setup();
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      route('outcome:get', () => {
        throw new Error('boom');
      });
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));

      expect(await screen.findByText(/This is a fault, not a result/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /refresh measurement/i })).toBeTruthy();
    });

    it('refuses to record a measurement that does not exist, and says so', async () => {
      const user = userEvent.setup();
      await execute(); // RFQ raised, never awarded → pending
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /i have finished this/i }));
      await user.click(await screen.findByRole('button', { name: /record the measurement/i }));

      expect(await screen.findByText(/no measurement to record yet/i)).toBeTruthy();
      expect(revisions.count()).toBe(0);
      // And the status did not move.
      expect(screen.getByText('Done')).toBeTruthy();
    });

    it('records the measurement into the audit trail once', async () => {
      const user = userEvent.setup();
      const rfqId = await execute();
      awardTo(rfqId, 95, 'approved');
      render(<OpportunitiesView />);
      await screen.findByText(/SKU-100 is bought at/i);
      await user.click(screen.getByRole('button', { name: /i have finished this/i }));
      await user.click(await screen.findByRole('button', { name: /record the measurement/i }));

      await waitFor(() => expect(revisions.count()).toBe(1));
      expect(revisions.list()[0]!.measurement).toBe(95);
      await user.click(screen.getByRole('button', { name: /show the evidence/i }));
      expect(await screen.findByText(/Recorded measurements \(1\)/i)).toBeTruthy();
    });

    it('lists the source records the measurement came from', async () => {
      const rfqId = await execute();
      awardTo(rfqId, 95);
      await openDetail();
      expect(screen.getByText(/Source records/i)).toBeTruthy();
      expect(screen.getAllByText('PO-0001').length).toBeGreaterThan(0);
      expect(screen.getByText('PO-RFQ-0001')).toBeTruthy();
      expect(screen.getByText(/RFQ-0001 \(the action\)/i)).toBeTruthy();
    });

    it('surfaces a load failure instead of a permanent skeleton', async () => {
      clearRoutes();
      route('opportunity:list', () => ({
        opportunities: [],
        dismissed: [],
        review: {
          windowDays: 365,
          ordersExamined: 0,
          ordersInWindow: 0,
          ordersUsable: 0,
          truncated: false,
          productsExamined: 0,
          productsCompared: 0,
          exclusions: [],
          wouldImprove: [],
        },
        insufficient: 'Nothing could be analysed in this run.',
        derivedAt: '2026-08-09T12:00:00.000Z',
      }));
      render(<OpportunitiesView />);
      // The screen must SETTLE rather than spin. The outcome section lives
      // inside a card, so with no cards the thing being proven is that the
      // loading state ends and a real message appears.
      expect(await screen.findByText(/Nothing could be analysed in this run/i)).toBeTruthy();
      expect(screen.queryByLabelText(/Looking through your records/i)).toBeNull();
    });
  });

  describe('when the list cannot be loaded', () => {
    it('names a permission refusal as a permission refusal', async () => {
      clearRoutes();
      route('opportunity:list', () => {
        throw new Error('Not authorized: missing permission "procurement:read".');
      });
      render(<OpportunitiesView />);
      expect(await screen.findByText(/do not hold procurement:read/i)).toBeTruthy();
      expect(screen.getByText(/Nothing is being hidden/i)).toBeTruthy();
    });

    it('does NOT blame permissions for a fault', async () => {
      // The screen used to assert "you do not hold procurement:read" for ANY
      // rejection, turning a crash into a confident false claim about the
      // user's account.
      clearRoutes();
      route('opportunity:list', () => {
        throw new Error('ENOENT: no such file or directory');
      });
      render(<OpportunitiesView />);
      expect(await screen.findByText(/This is a fault, not a permission problem/i)).toBeTruthy();
      expect(screen.queryByText(/do not hold procurement:read/i)).toBeNull();
    });
  });
});
