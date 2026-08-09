/**
 * The whole loop, closed, over real modules.
 *
 *   purchase orders → finding → decision → action → RFQ → award → purchase
 *   order → baseline → measurement → verification → outcome
 *
 * Nothing in that chain is stubbed. The RFQ is created by the opportunity
 * subsystem's own execute handler, quotes are added through the RFQ module's
 * real validator, the award runs the module's real `runAction` (which writes a
 * real purchase order), and the outcome is measured from whatever the stores
 * actually contain afterwards.
 *
 * That matters because the property under test is not "does the arithmetic
 * work" — it is "does the number the user sees come from the thing that
 * actually happened". A stubbed award would let the measurement pass while
 * measuring a fiction, which is the exact failure this program exists to
 * prevent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  PURCHASE_ORDERS_MODULE_ID,
  measurePriceOutcome,
  rfqFromRecord,
  type EnterpriseEntity,
  type IpcChannelName,
  type Opportunity,
  type OpportunityCenterView,
  type Outcome,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework';
import { createSupplierModule } from '../enterprise/modules/procurement/supplierModule';
import { createPurchaseOrderModule } from '../enterprise/modules/procurement/purchaseOrderModule';
import { createRfqModule } from '../enterprise/modules/procurement/rfqModule';
import { DecisionRecordStore } from '../decisions/decisionService';
import { HoldStore } from '../decisions/holdStore';
import { createHoldRaiser } from '../decisions/raiseHold';
import { OpportunityDecisionStore } from '../opportunities/opportunityDecisionStore';
import {
  findOpenRfq,
  purchaseOrdersAsObservations,
  rfqAsExecution,
  rfqFieldsFor,
} from '../opportunities/procurementSource';
import { initOpportunities } from '../opportunities';
import { OutcomeRevisionStore } from './outcomeRevisionStore';

const T0 = '2026-08-09T12:00:00.000Z';
/**
 * Baseline orders are dated BEFORE the action, because that is what makes them
 * a baseline. An order recorded at the same instant the RFQ was raised is not
 * evidence of what the business was paying beforehand, and the engine is right
 * to exclude it.
 */
const T_BEFORE = '2026-07-01T00:00:00.000Z';
const ACTOR = 'priya@example.com';

/** Weighted average of 100×10 + 120×20 + 130×5 = 4,050 over 35 units = 115.71. */
const BASELINE = [
  { ref: 'PO-0001', supplier: 'Acme Supplies', quantity: 10, unitCost: 100 },
  { ref: 'PO-0002', supplier: 'Beta Parts', quantity: 20, unitCost: 120 },
  { ref: 'PO-0003', supplier: 'Acme Supplies', quantity: 5, unitCost: 130 },
];

describe('outcome measurement, end to end', () => {
  let dir: string;
  let suppliers: EnterpriseModule;
  let orders: EnterpriseModule;
  let rfqs: EnterpriseModule;
  let holds: HoldStore;
  let records: DecisionRecordStore;
  let decisions: OpportunityDecisionStore;
  let revisions: OutcomeRevisionStore;
  let ctx: EnterpriseModuleActionContext;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;

  const seedOrder = (o: { ref: string; supplier: string; quantity: number; unitCost: number; currency?: string; status?: string }): void => {
    orders.store.create({
      title: o.ref,
      fields: {
        poNumber: o.ref,
        supplier: o.supplier,
        product: 'SKU-100',
        quantity: o.quantity,
        unitCost: o.unitCost,
        currency: o.currency ?? 'INR',
        status: o.status ?? 'approved',
        warehouse: 'WH-01',
      },
      actor: ACTOR,
      now: T_BEFORE,
    });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-outcome-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });

    suppliers = createSupplierModule(join(dir, 'suppliers.json'));
    orders = createPurchaseOrderModule(join(dir, 'orders.json'));
    rfqs = createRfqModule(join(dir, 'rfqs.json'), suppliers.store);
    holds = new HoldStore(join(dir, 'holds.json'));
    records = new DecisionRecordStore(join(dir, 'decisions.json'));
    decisions = new OpportunityDecisionStore(join(dir, 'opp.json'));
    revisions = new OutcomeRevisionStore(join(dir, 'rev.json'));
    await Promise.all([
      suppliers.store.load(),
      orders.store.load(),
      rfqs.store.load(),
      holds.load(),
      records.load(),
      decisions.load(),
      revisions.load(),
    ]);
    for (const name of ['Acme Supplies', 'Beta Parts', 'Gamma Metals']) {
      suppliers.store.create({ title: name, fields: { name }, actor: ACTOR, now: T0 });
    }
    for (const o of BASELINE) seedOrder(o);

    ctx = {
      actor: () => ACTOR,
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === PURCHASE_ORDERS_MODULE_ID ? orders : null),
      emit: () => undefined,
    };

    const subsystem = initOpportunities({
      orders: () => purchaseOrdersAsObservations(orders.store),
      readCeiling: 5_000,
      decisions,
      raiseHold: createHoldRaiser({
        holds,
        decisions: records,
        actor: () => ACTOR,
        audit: () => undefined,
      }),
      decisionRecords: records,
      canExecute: () => true,
      heldPermissions: () => ['procurement:manage'],
      actorLabel: () => 'Priya',
      actor: () => ACTOR,
      rfqModuleAvailable: () => true,
      openRfqFor: (product) => findOpenRfq(rfqs.store, product),
      createRfq: async (input) => {
        const { title, fields } = rfqFieldsFor(rfqs.store, input);
        const created = rfqs.store.create({ title, fields, actor: ACTOR, now: T0 });
        await rfqs.store.flush();
        return { recordId: created.id, label: title };
      },
      readRfq: (recordId) => {
        const r = rfqs.store.get(recordId);
        return r ? { recordId: r.id, label: String(r.fields.rfqNumber ?? r.title) } : null;
      },
      executionFor: (recordId) => rfqAsExecution(rfqs.store, recordId),
      outcomeRevisions: revisions,
      audit: () => undefined,
      now: () => T0,
    });
    const byChannel = new Map(subsystem.handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    await Promise.all([
      suppliers.store.flush(),
      orders.store.flush(),
      rfqs.store.flush(),
      holds.flush(),
      records.flush(),
      decisions.flush(),
      revisions.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const list = (): Promise<OpportunityCenterView> =>
    call(IpcChannel.OpportunityList, {}) as Promise<OpportunityCenterView>;
  const setStatus = (id: string, status: string): Promise<Opportunity | null> =>
    call(IpcChannel.OpportunitySetStatus, { id, status }) as Promise<Opportunity | null>;
  const outcomeOf = (opportunityId: string): Promise<Outcome | null> =>
    call(IpcChannel.OutcomeGet, { opportunityId }) as Promise<Outcome | null>;

  /** Finding → accepted → executed. Returns the opportunity and its RFQ. */
  async function throughExecution(): Promise<{ opportunity: Opportunity; rfq: EnterpriseEntity }> {
    const found = (await list()).opportunities[0]!;
    await setStatus(found.id, 'accepted');
    const result = (await call(IpcChannel.OpportunityExecute, { id: found.id })) as {
      ok: boolean;
      created: { recordId: string } | null;
    };
    expect(result.ok).toBe(true);
    return { opportunity: found, rfq: rfqs.store.get(result.created!.recordId)! };
  }

  /** Add quotes and run the module's REAL award action. */
  async function award(rfq: EnterpriseEntity, quotesJson: string): Promise<EnterpriseEntity> {
    const validated = rfqs.hooks.validate({ fields: { ...rfq.fields, quotesJson } });
    expect(validated.ok, JSON.stringify('errors' in validated ? validated.errors : {})).toBe(true);
    if (!validated.ok) throw new Error('unreachable');
    const withQuotes = rfqs.store.update(rfq.id, { fields: validated.values, actor: ACTOR, now: T0 })!;
    const res = await rfqs.hooks.runAction!('award', withQuotes, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    return rfqs.store.get(rfq.id)!;
  }

  /* ── the loop ──────────────────────────────────────────────────────────── */

  describe('before anything has happened', () => {
    it('is UNAVAILABLE with no action, and says what would enable it', async () => {
      const found = (await list()).opportunities[0]!;
      const outcome = (await outcomeOf(found.id))!;
      expect(outcome.status).toBe('unavailable');
      expect(outcome.blocked?.missing.join(' ')).toContain('has not created a request for quotation');
      expect(outcome.blocked?.wouldEnable.join(' ')).toContain('run its plan');
      // Nothing measured means nothing claimed.
      expect(outcome.change).toBeNull();
      expect(outcome.financialEffect).toBeNull();
    });

    it('is PENDING once the action ran but no purchase resulted', async () => {
      const { opportunity } = await throughExecution();
      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.status).toBe('pending');
      // The distinction the whole program turns on: the action succeeded, and
      // that is not an outcome.
      expect(outcome.blocked?.missing.join(' ')).toContain('downstream business transaction');
      expect(outcome.blocked?.available.join(' ')).toContain('baseline of 115.71 INR');
      expect(outcome.change).toBeNull();
    });

    it('refuses to be marked "measured" while the outcome is pending', async () => {
      const { opportunity } = await throughExecution();
      await setStatus(opportunity.id, 'completed');
      const refused = await setStatus(opportunity.id, 'measured');
      // The status is a claim a reader will believe. It cannot be set by hand
      // when no measurement exists.
      expect(refused?.status).toBe('completed');
      expect(revisions.count()).toBe(0);
    });
  });

  describe('after a real award', () => {
    it('measures the awarded price against the pre-action baseline', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95,"leadTimeDays":7}');

      const outcome = (await outcomeOf(opportunity.id))!;
      // Weighted average before the action: (1000 + 2400 + 650) / 35 = 115.714…
      expect(outcome.baseline.value).toBe(115.71);
      expect(outcome.measurement.value).toBe(95);
      expect(outcome.change).toBe(-20.71);
      expect(outcome.direction).toBe('favourable');
      expect(outcome.measurement.records[0]!.label).toBe('PO-RFQ-0001');
    });

    it('carries the currency through the award, so the two sides are comparable', async () => {
      const { opportunity, rfq } = await throughExecution();
      const awarded = await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const po = orders.store.get(rfqFromRecord(awarded).awardedOrder)!;
      // Before this was carried, the award produced a USD order regardless of
      // what the business buys in — which made the awarded order incomparable
      // with the very orders that produced the finding.
      expect(po.fields.currency).toBe('INR');
      expect((await outcomeOf(opportunity.id))!.status).not.toBe('failed_to_verify');
    });

    it('reports a WORSE price as unfavourable, not as a success', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Gamma Metals","unitCost":150}');

      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.direction).toBe('unfavourable');
      expect(outcome.change).toBe(34.29);
      expect(outcome.financialEffect!.amount).toBeGreaterThan(0);
      // Nothing anywhere calls this a win. Only AFFIRMATIVE claims are
      // forbidden — "not what the action achieved" is the denial, and it is
      // asserted for rather than against.
      const prose = [
        outcome.causalNote,
        outcome.financialEffect!.caveat,
        outcome.expectedEffect,
        ...outcome.unknown,
      ].join(' ');
      expect(prose.toLowerCase()).not.toMatch(
        /\b(was|were|is|has been)\s+(a\s+)?(success|achieved|delivered)|\bsuccessfully\b/,
      );
      expect(outcome.causalNote).toContain('not what the action achieved');
    });

    it('reports an identical price as unchanged', async () => {
      // Award at exactly the weighted-average baseline.
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":115.71}');
      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.change).toBe(0);
      expect(outcome.direction).toBe('unchanged');
    });

    it('never claims the action caused the change', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.causalNote).toContain('OBSERVED after the action');
      expect(outcome.causalNote).toContain('does not claim it');
      expect(outcome.unknown.join(' ')).toContain('Whether the action caused this');
    });
  });

  describe('measured is not verified', () => {
    it('stops at MEASURED while the awarded order is still a draft', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');

      const outcome = (await outcomeOf(opportunity.id))!;
      // The award drafts a purchase order. A price agreed on a draft nobody has
      // approved is not a price the business has paid.
      expect(outcome.status).toBe('measured');
      const blocker = outcome.verification.find((c) => c.id === 'no_quality_blocker')!;
      expect(blocker.passed).toBe(false);
      expect(blocker.detail).toContain('agreed but not transacted');
      expect(outcome.unknown[0]).toContain('no money has moved at this price yet');
    });

    it('reaches VERIFIED once the awarded order is committed', async () => {
      const { opportunity, rfq } = await throughExecution();
      const awarded = await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const poId = rfqFromRecord(awarded).awardedOrder;
      orders.store.update(poId, { fields: { status: 'approved' }, actor: ACTOR, now: T0 });

      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.status).toBe('verified');
      expect(outcome.verification.every((c) => c.passed)).toBe(true);
      expect(outcome.verification).toHaveLength(6);
      expect(outcome.confidence.tier).toBe('strong');
      expect(outcome.confidence.basis).toContain('All six verification checks passed');
    });

    it('computes the financial effect only from the order it measured', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const effect = (await outcomeOf(opportunity.id))!.financialEffect!;
      // (95 − 115.714285…) × 13 units on that one order. Computed from the
      // UNROUNDED baseline: rounding the per-unit change to cents first and
      // then multiplying gives −269.23, which is 6 paise of invented
      // difference on 13 units and grows linearly with order size.
      expect(effect.amount).toBe(-269.29);
      expect(effect.basis).toContain('115.7143');
      expect(effect.currency).toBe('INR');
      expect(effect.caveat).toContain('not a saving');
      expect(effect.caveat).toContain('this one order only');
    });
  });

  describe('recording, idempotency and revisions', () => {
    const measured = async (): Promise<Opportunity> => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      await setStatus(opportunity.id, 'completed');
      return opportunity;
    };

    it('records one revision when the measurement is first accepted', async () => {
      const opportunity = await measured();
      const now = await setStatus(opportunity.id, 'measured');
      expect(now?.status).toBe('measured');
      expect(revisions.count()).toBe(1);
      expect(revisions.list()[0]!.reason).toContain('First recorded measurement');
      expect(revisions.list()[0]!.measurement).toBe(95);
    });

    it('records NOTHING further when nothing changed', async () => {
      const opportunity = await measured();
      await setStatus(opportunity.id, 'measured');
      await setStatus(opportunity.id, 'measured');
      await setStatus(opportunity.id, 'measured');
      // A revision per click is not an audit trail.
      expect(revisions.count()).toBe(1);
    });

    it('records a NEW revision when the source data moves, keeping the old one', async () => {
      const opportunity = await measured();
      await setStatus(opportunity.id, 'measured');
      // A historical order is corrected, so the baseline moves.
      seedOrder({ ref: 'PO-0004', supplier: 'Acme Supplies', quantity: 100, unitCost: 200 });
      await setStatus(opportunity.id, 'measured');

      expect(revisions.count()).toBe(2);
      const all = revisions.forOutcome(revisions.list()[0]!.outcomeKey);
      expect(all).toHaveLength(2);
      // The earlier observation survives intact — nothing was overwritten.
      expect(all[1]!.baseline).toBe(115.71);
      expect(all[0]!.baseline).not.toBe(115.71);
      expect(all[0]!.reason).toContain('baseline changed from 115.71');
    });

    it('survives a restart with the revision history intact', async () => {
      const opportunity = await measured();
      await setStatus(opportunity.id, 'measured');
      await revisions.flush();

      const reopened = new OutcomeRevisionStore(join(dir, 'rev.json'));
      await reopened.load();
      expect(reopened.count()).toBe(1);
      expect(reopened.list()[0]!.measurement).toBe(95);
    });
  });

  describe('recalculating from live data', () => {
    it('reflects a corrected purchase order immediately — no cache to go stale', async () => {
      const { opportunity, rfq } = await throughExecution();
      const awarded = await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      expect((await outcomeOf(opportunity.id))!.measurement.value).toBe(95);

      // Someone corrects the awarded order's price.
      orders.store.update(rfqFromRecord(awarded).awardedOrder, {
        fields: { unitCost: 105 },
        actor: ACTOR,
        now: T0,
      });
      expect((await outcomeOf(opportunity.id))!.measurement.value).toBe(105);
    });

    it('FAILS TO VERIFY when the awarded order has vanished', async () => {
      const { opportunity, rfq } = await throughExecution();
      const awarded = await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      orders.store.softDelete(rfqFromRecord(awarded).awardedOrder);

      const outcome = (await outcomeOf(opportunity.id))!;
      // A broken association is an integrity problem, not a normal absence —
      // reporting it as "pending" would hide it behind an ordinary state.
      expect(outcome.status).toBe('failed_to_verify');
      expect(outcome.blocked?.missing.join(' ')).toContain('not in the procurement store');
    });
  });

  describe('refusals that must not print a number', () => {
    it('refuses an RFQ that names an awarded order but is not awarded', async () => {
      const { opportunity, rfq } = await throughExecution();
      const po = orders.store.create({
        title: 'PO-X',
        fields: { poNumber: 'PO-X', product: 'SKU-100', quantity: 1, unitCost: 5, currency: 'INR', status: 'approved' },
        actor: ACTOR,
        now: T0,
      });
      // `readOnly` is a form hint; `store.update` bypasses the validator, so a
      // half-written record like this is reachable.
      rfqs.store.update(rfq.id, { fields: { ...rfq.fields, awardedOrder: po.id }, actor: ACTOR, now: T0 });

      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.status).toBe('pending');
      expect(outcome.change).toBeNull();
    });

    it('refuses an awarded order dated BEFORE the action', async () => {
      const { opportunity, rfq } = await throughExecution();
      const po = orders.store.create({
        title: 'PO-OLD',
        fields: { poNumber: 'PO-OLD', product: 'SKU-100', quantity: 10, unitCost: 5, currency: 'INR', status: 'approved' },
        actor: ACTOR,
        now: T_BEFORE,
      });
      rfqs.store.update(rfq.id, {
        fields: { ...rfq.fields, status: 'awarded', awardedOrder: po.id },
        actor: ACTOR,
        now: T0,
      });

      const outcome = (await outcomeOf(opportunity.id))!;
      // A 5.00 price against a 115.71 baseline is a spectacular-looking
      // result. It must not appear at all: the order predates the action, so
      // it cannot be a result of it, and printing the number under a failed
      // check invites the reader to take the headline and skip the caveat.
      expect(outcome.status).toBe('failed_to_verify');
      expect(outcome.change).toBeNull();
      expect(outcome.financialEffect).toBeNull();
      expect(outcome.blocked?.headline).toContain('cannot be a result of the action');
    });

    it('refuses an execution raised from a DIFFERENT opportunity', async () => {
      const { opportunity, rfq } = await throughExecution();
      rfqs.store.update(rfq.id, {
        fields: { ...rfq.fields, sourceOpportunity: 'opp_someone_else' },
        actor: ACTOR,
        now: T0,
      });
      await award(rfqs.store.get(rfq.id)!, '{"supplier":"Beta Parts","unitCost":95}');

      const outcome = (await outcomeOf(opportunity.id))!;
      // Product alone would have passed — the awarded order copies its product
      // from the RFQ, so that comparison is circular.
      expect(outcome.status).toBe('failed_to_verify');
      expect(outcome.change).toBeNull();
      expect(outcome.blocked?.headline).toContain('different opportunity');
    });

    it('refuses when there is no earlier purchase to compare against', () => {
      /**
       * Driven directly at the engine, not through the app.
       *
       * In the normal flow this state cannot arise: the finding and the
       * baseline are derived from the same committed orders, so a finding that
       * exists guarantees orders that predate the RFQ raised from it. The
       * branch is defensive — it protects against imported history dated after
       * the action, which is exactly how imports are dated. Contriving a
       * store-level path to it would test the contrivance; calling the pure
       * function states the intent.
       */
      const outcome = measurePriceOutcome({
        opportunityId: 'opp_x',
        decisionId: null,
        product: 'SKU-100',
        currency: 'INR',
        expectedEffect: 'Get comparable quotes.',
        impactAtDecision: null,
        execution: {
          moduleId: 'procurement-rfqs',
          recordId: 'rfq_1',
          label: 'RFQ-0001',
          createdAt: T_BEFORE,
          status: 'awarded',
          awardedOrderId: 'po_new',
          awardedSupplier: 'Beta Parts',
          awardedAt: T0,
          product: 'SKU-100',
          currency: 'INR',
          sourceOpportunity: 'opp_x',
        },
        orders: [
          {
            recordId: 'po_new',
            reference: 'PO-NEW',
            supplier: 'Beta Parts',
            product: 'SKU-100',
            quantity: 10,
            unitCost: 95,
            currency: 'INR',
            status: 'approved',
            orderedAt: T0,
            warehouse: null,
          },
        ],
        revisions: [],
        now: T0,
      });
      expect(outcome.status).toBe('unavailable');
      expect(outcome.blocked?.headline).toContain('no earlier purchase');
      expect(outcome.change).toBeNull();
      // The side that resolved is still shown.
      expect(outcome.measurement.value).toBe(95);
    });

    it('refuses to compare two currencies rather than converting', async () => {
      const { opportunity, rfq } = await throughExecution();
      rfqs.store.update(rfq.id, { fields: { ...rfq.fields, currency: 'USD' }, actor: ACTOR, now: T0 });
      await award(rfqs.store.get(rfq.id)!, '{"supplier":"Beta Parts","unitCost":95}');

      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.status).toBe('unavailable');
      expect(outcome.blocked?.missing.join(' ')).toContain('would require a rate');
      expect(outcome.financialEffect).toBeNull();
      // The side that DID resolve is still shown — a baseline you have is more
      // use than two blanks.
      expect(outcome.baseline.value).toBe(115.71);
    });

    it('refuses a cancelled RFQ', async () => {
      const { opportunity, rfq } = await throughExecution();
      rfqs.store.update(rfq.id, { fields: { ...rfq.fields, status: 'cancelled' }, actor: ACTOR, now: T0 });
      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.status).toBe('unavailable');
      expect(outcome.blocked?.headline).toContain('was cancelled');
    });

    it('will not record a measurement it could not verify', async () => {
      const { opportunity, rfq } = await throughExecution();
      rfqs.store.update(rfq.id, { fields: { ...rfq.fields, currency: 'USD' }, actor: ACTOR, now: T0 });
      await award(rfqs.store.get(rfq.id)!, '{"supplier":"Beta Parts","unitCost":95}');
      await setStatus(opportunity.id, 'completed');

      const refused = await setStatus(opportunity.id, 'measured');
      expect(refused?.status).toBe('completed');
      // Three nulls filed under "measured" is exactly the fabrication the
      // status is supposed to rule out.
      expect(revisions.count()).toBe(0);
    });
  });

  describe('arithmetic that must not drift', () => {
    it('does not let rounding flip the direction on sub-cent differences', async () => {
      for (const record of orders.store.list()) orders.store.softDelete(record.id);
      seedOrder({ ref: 'PO-A', supplier: 'Acme Supplies', quantity: 1, unitCost: 12.344 });
      seedOrder({ ref: 'PO-B', supplier: 'Beta Parts', quantity: 1, unitCost: 12.346 });
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":12.345}');

      const outcome = (await outcomeOf(opportunity.id))!;
      // Baseline is exactly 12.345; the award matches it. Rounding each side to
      // cents first would give 12.34 vs 12.35 and report a rise.
      expect(outcome.change).toBe(0);
      expect(outcome.direction).toBe('unchanged');
      expect(Object.is(outcome.change, -0)).toBe(false);
    });
  });

  describe('identity', () => {
    it('measures against the execution recorded for THIS finding', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const outcome = (await outcomeOf(opportunity.id))!;
      expect(outcome.execution!.recordId).toBe(rfq.id);
      expect(outcome.opportunityId).toBe(opportunity.id);
      // And the RFQ carries the link back, structurally rather than in prose.
      expect(rfqs.store.get(rfq.id)!.fields.sourceOpportunity).toBe(opportunity.id);
    });

    it('gives the same outcome the same id across recomputes', async () => {
      const { opportunity, rfq } = await throughExecution();
      await award(rfq, '{"supplier":"Beta Parts","unitCost":95}');
      const first = (await outcomeOf(opportunity.id))!;
      const second = (await outcomeOf(opportunity.id))!;
      expect(second.id).toBe(first.id);
    });
  });
});
