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
  rfqFieldsFor,
} from '@main/opportunities/procurementSource';
import { OpportunitiesView } from '@renderer/opportunities/OpportunitiesView';

const DIR = join(tmpdir(), 'np-ui-opportunities');
const T0 = '2026-08-09T12:00:00.000Z';

let dir: string;
let orders: EnterpriseRecordStore;
let rfqs: EnterpriseRecordStore;
let holds: HoldStore;
let records: DecisionRecordStore;
let decisions: OpportunityDecisionStore;
let mayManage = true;

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
    now: T0,
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
  await Promise.all([orders.load(), rfqs.load(), holds.load(), records.load(), decisions.load()]);

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
