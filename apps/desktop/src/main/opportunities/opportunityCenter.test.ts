/**
 * The Opportunity Center end to end, over the real seams.
 *
 * Nothing here is mocked that could be real: purchase orders live in an actual
 * `EnterpriseRecordStore` on disk, the RFQ is written to another one, holds and
 * Decision Records go through Program 3's actual stores and shared raiser, and
 * every call goes through the handler's own Zod schema by channel name. What
 * that buys is the ability to test the property this subsystem exists for —
 *
 *   an action justified by evidence must re-derive that evidence at the
 *   instant of acting, and refuse if it no longer holds
 *
 * — which is impossible to check against a stubbed pipeline, because the stub
 * is exactly the thing that would keep returning the stale finding.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  IpcChannelName,
  Opportunity,
  OpportunityCenterView,
  OpportunityExecuteResult,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { DecisionRecordStore } from '../decisions/decisionService';
import { HoldStore } from '../decisions/holdStore';
import { createHoldRaiser } from '../decisions/raiseHold';
import { OpportunityDecisionStore } from './opportunityDecisionStore';
import {
  findOpenRfq,
  purchaseOrdersAsObservations,
  rfqAsExecution,
  rfqFieldsFor,
} from './procurementSource';
import { OutcomeRevisionStore } from '../outcomes/outcomeRevisionStore';
import { initOpportunities } from '.';

const T0 = '2026-08-09T12:00:00.000Z';
const ACTOR = 'priya@example.com';

interface OrderSeed {
  ref: string;
  supplier: string;
  product?: string;
  quantity: number;
  unitCost: number;
  status?: string;
  currency?: string;
}

/** Three orders, two suppliers, no volume explanation → 550 above best. */
const SEED: OrderSeed[] = [
  { ref: 'PO-0001', supplier: 'Acme', quantity: 10, unitCost: 100 },
  { ref: 'PO-0002', supplier: 'Borealis', quantity: 20, unitCost: 120 },
  { ref: 'PO-0003', supplier: 'Acme', quantity: 5, unitCost: 130 },
];

describe('Opportunity Center, wired', () => {
  let dir: string;
  let orders: EnterpriseRecordStore;
  let rfqs: EnterpriseRecordStore;
  let holds: HoldStore;
  let records: DecisionRecordStore;
  let decisions: OpportunityDecisionStore;
  let revisions: OutcomeRevisionStore;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;

  /** Flipped per test to drive the governed refusals. */
  let mayManage: boolean;
  let rfqModuleUp: boolean;
  /** Simulates a write that reports success and does not land. */
  let breakVerification: boolean;

  const seedOrder = (seed: OrderSeed): string =>
    orders.create({
      title: seed.ref,
      fields: {
        poNumber: seed.ref,
        supplier: seed.supplier,
        product: seed.product ?? 'SKU-100',
        quantity: seed.quantity,
        unitCost: seed.unitCost,
        currency: seed.currency ?? 'INR',
        status: seed.status ?? 'approved',
        warehouse: 'WH-01',
      },
      actor: ACTOR,
      now: T0,
    }).id;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-opp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    mayManage = true;
    rfqModuleUp = true;
    breakVerification = false;

    orders = new EnterpriseRecordStore(join(dir, 'po.json'), 'procurement-orders', 'order');
    rfqs = new EnterpriseRecordStore(join(dir, 'rfq.json'), 'procurement-rfqs', 'rfq');
    holds = new HoldStore(join(dir, 'holds.json'));
    records = new DecisionRecordStore(join(dir, 'decisions.json'));
    decisions = new OpportunityDecisionStore(join(dir, 'opportunity-decisions.json'));
    revisions = new OutcomeRevisionStore(join(dir, 'outcome-revisions.json'));
    await Promise.all([
      orders.load(),
      rfqs.load(),
      holds.load(),
      records.load(),
      decisions.load(),
      revisions.load(),
    ]);
    for (const seed of SEED) seedOrder(seed);

    const subsystem = initOpportunities({
      orders: () => purchaseOrdersAsObservations(orders),
      decisions,
      raiseHold: createHoldRaiser({
        holds,
        decisions: records,
        actor: () => ACTOR,
        audit: () => undefined,
      }),
      decisionRecords: records,
      canExecute: () => mayManage,
      heldPermissions: () => ['procurement:read'],
      actorLabel: () => 'Priya',
      actor: () => ACTOR,
      rfqModuleAvailable: () => rfqModuleUp,
      openRfqFor: (product) => findOpenRfq(rfqs, product),
      createRfq: async (input) => {
        const { title, fields } = rfqFieldsFor(rfqs, input);
        const created = rfqs.create({ title, fields, actor: ACTOR, now: T0 });
        await rfqs.flush();
        return { recordId: created.id, label: title };
      },
      readRfq: (recordId) => {
        if (breakVerification) return null;
        const record = rfqs.get(recordId);
        return record
          ? { recordId: record.id, label: String(record.fields.rfqNumber ?? record.title) }
          : null;
      },
      executionFor: (recordId) => rfqAsExecution(rfqs, recordId),
      outcomeRevisions: revisions,
      audit: () => undefined,
      // A FIXED clock. With the real one, every test here passes only while
      // today is within 365 days of the seeded `createdAt` — the suite would
      // turn red on a date, for no code change.
      now: () => T0,
      readCeiling: 5_000,
    });

    const byChannel = new Map(subsystem.handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    // Every store here writes atomically (tmp + rename) behind a coalescing
    // queue. Draining ALL of them before removing the directory is what stops
    // a stray rename racing the rm — an unhandled ENOENT that fails the run
    // while every test still reports green.
    await Promise.all([orders.flush(), rfqs.flush(), holds.flush(), records.flush(), decisions.flush(), revisions.flush()]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const list = (): Promise<OpportunityCenterView> =>
    call(IpcChannel.OpportunityList, {}) as Promise<OpportunityCenterView>;
  const setStatus = (id: string, status: string, note?: string): Promise<Opportunity | null> =>
    call(IpcChannel.OpportunitySetStatus, { id, status, ...(note ? { note } : {}) }) as Promise<
      Opportunity | null
    >;
  const execute = (id: string): Promise<OpportunityExecuteResult> =>
    call(IpcChannel.OpportunityExecute, { id }) as Promise<OpportunityExecuteResult>;

  /* ── data → finding → evidence → opportunity ───────────────────────────── */

  describe('discovery over real records', () => {
    it('reads the live purchase-order store and finds the variance', async () => {
      const view = await list();
      expect(view.opportunities).toHaveLength(1);
      expect(view.insufficient).toBeNull();
      expect(view.opportunities[0]!.impact?.amount).toBe(550);
    });

    it('cites purchase orders that can actually be opened', async () => {
      const found = (await list()).opportunities[0]!;
      for (const ref of found.sourceRecords) {
        expect(orders.get(ref.recordId)).not.toBeNull();
      }
    });

    it('reads unitCost, not total — the field the analysis actually means', async () => {
      // A record whose `total` is enormous but whose unit price matches the
      // best one must not register. Reading the wrong column is the failure
      // `procurementSource` exists to make visible.
      seedOrder({ ref: 'PO-0009', supplier: 'Borealis', quantity: 1000, unitCost: 100 });
      expect((await list()).opportunities[0]!.impact?.amount).toBe(550);
    });

    it('says why there is nothing when the store is empty', async () => {
      for (const record of orders.list()) orders.softDelete(record.id);
      const view = await list();
      expect(view.opportunities).toEqual([]);
      expect(view.insufficient).toContain('no purchase orders to analyse');
      expect(view.review.wouldImprove.join(' ')).toContain('Business → Procurement');
    });
  });

  /* ── decisions persist; findings do not ────────────────────────────────── */

  describe('what persists', () => {
    it('remembers a dismissal across a restart, re-attached by finding identity', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'rejected', 'Different specification.');
      await decisions.flush();

      const reopened = new OpportunityDecisionStore(join(dir, 'opportunity-decisions.json'));
      await reopened.load();
      const remembered = reopened.get(found.id);
      expect(remembered?.status).toBe('rejected');
      expect(remembered?.note).toBe('Different specification.');
      // The figure at the time is kept so a grown gap can be pointed out later.
      expect(remembered?.impactAtDecision).toBe(550);
    });

    it('moves a dismissed finding out of the list without pretending it is gone', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'rejected');
      const view = await list();
      expect(view.opportunities).toEqual([]);
      expect(view.dismissed).toHaveLength(1);
      // Critically NOT the insufficient-evidence sentence: the analysis found
      // something, the user set it aside. Saying "no evidence" would be false.
      expect(view.insufficient).toBeNull();
    });

    it('recomputes the figure rather than replaying the stored one', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'rejected');
      seedOrder({ ref: 'PO-0010', supplier: 'Borealis', quantity: 100, unitCost: 200 });
      const view = await list();
      expect(view.dismissed[0]!.impactAtDecision).toBe(550); // what you decided on
      expect(view.dismissed[0]!.impact?.amount).toBe(10_550); // what is true now
    });

    it('refuses an illegal transition instead of corrupting the lifecycle', async () => {
      const found = (await list()).opportunities[0]!;
      const unchanged = await setStatus(found.id, 'measured');
      // `measured` is Program 5's, reachable from nothing here.
      expect(unchanged?.status).toBe('new');
      expect(decisions.get(found.id)).toBeNull();
    });

    it('enforces the lifecycle on the EXECUTE path too, not only setStatus', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'accepted');
      await execute(found.id); // → in_progress
      await setStatus(found.id, 'completed');

      // `completed` is terminal. Re-running must not drag it backwards; the
      // transition table has to bind wherever status moves, and execute was
      // the path that moved it by assignment rather than by policy.
      await execute(found.id);
      expect(decisions.get(found.id)?.status).toBe('completed');
    });

    it('keeps the figure from WHEN you decided, even if the status is re-sent', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'rejected');
      seedOrder({ ref: 'PO-0010', supplier: 'Borealis', quantity: 100, unitCost: 200 });
      await setStatus(found.id, 'rejected', 'Still not pursuing.');

      // Overwriting this would destroy the only thing that lets the product
      // say "you set this aside at 550; it is 10,550 now".
      expect(decisions.get(found.id)?.impactAtDecision).toBe(550);
    });
  });

  /* ── governed execution ────────────────────────────────────────────────── */

  describe('executing the plan', () => {
    const accepted = async (): Promise<Opportunity> => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'accepted');
      return found;
    };

    it('creates a real RFQ, reads it back, and records the decision', async () => {
      const found = await accepted();
      const result = await execute(found.id);

      expect(result.ok).toBe(true);
      expect(result.hold).toBeNull();
      expect(result.created?.label).toBe('RFQ-0001');

      // The record genuinely exists in the RFQ store, with the right product.
      const created = rfqs.get(result.created!.recordId)!;
      expect(created.fields.product).toBe('SKU-100');
      expect(created.fields.status).toBe('open');
      expect(String(created.fields.notes)).toContain('Raised from an Opportunity');

      const record = records.list().find((r) => r.outcome === 'proceeded')!;
      expect(record.executed).toContain('read it back to confirm it exists');
      expect(record.assessment.risk).toBe('supported');
    });

    it('stops at in_progress, because three of the four steps are still yours', async () => {
      const found = await accepted();
      const result = await execute(found.id);
      // `completed` would claim an outcome nobody has: no quotes, no award.
      expect(result.opportunity?.status).toBe('in_progress');
      expect((await list()).opportunities[0]!.status).toBe('in_progress');
    });

    it('HOLDS when the evidence no longer holds at the moment of acting', async () => {
      const found = await accepted();
      // The world moves between render and click: the dear orders are voided.
      for (const record of orders.list()) {
        if (record.title !== 'PO-0001') orders.softDelete(record.id);
      }

      const result = await execute(found.id);
      expect(result.ok).toBe(false);
      expect(result.created).toBeNull();
      expect(result.hold?.reason).toBe('insufficient_evidence');
      expect(result.hold?.unknown.join(' ')).toContain('no longer produces this finding');
      // Nothing was written on the strength of a finding that had expired.
      expect(rfqs.count()).toBe(0);
    });

    it('HOLDS on a missing permission rather than throwing it away in a toast', async () => {
      const found = await accepted();
      mayManage = false;

      const result = await execute(found.id);
      expect(result.ok).toBe(false);
      expect(result.hold?.reason).toBe('insufficient_permission');
      expect(result.hold?.known.join(' ')).toContain('procurement:manage');
      expect(rfqs.count()).toBe(0);
    });

    it('checks permission FIRST, so an unprivileged caller cannot flood governance', async () => {
      // The attack this ordering prevents: raising a hold writes a HoldRecord,
      // a Decision Record and an audit entry, keyed by a caller-supplied id.
      // With the permission check second, an account holding only
      // `procurement:read` could post arbitrary ids and — because the hold
      // store evicts oldest-first at its cap — push every real hold out of the
      // governance queue.
      mayManage = false;
      for (let i = 0; i < 25; i += 1) await execute(`opp_made_up_${i}`);

      // One hold for the actor, not twenty-five for twenty-five invented ids.
      expect(holds.openCount()).toBe(1);
      expect(holds.openHolds()[0]!.reason).toBe('insufficient_permission');
      expect(records.count()).toBe(1);
      // And it must not confirm which invented ids were real findings.
      expect(holds.openHolds()[0]!.subject).not.toContain('opp_made_up');
    });

    it('refuses to act on a finding that was never accepted', async () => {
      // The UI only offers the button on an accepted finding, but the UI is
      // not the boundary.
      const found = (await list()).opportunities[0]!;
      const result = await execute(found.id);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Accept this opportunity');
      expect(rfqs.count()).toBe(0);
    });

    it('refuses to act on a finding the user dismissed', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'rejected', 'Different specification.');

      const result = await execute(found.id);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('You set this opportunity aside');
      // Acting here would create a real RFQ AND silently un-dismiss a decision
      // the user made — the system overruling an answer it asked for.
      expect(rfqs.count()).toBe(0);
      expect(decisions.get(found.id)?.status).toBe('rejected');
    });

    it('links the hold back to the finding it was raised for', async () => {
      const found = await accepted();
      rfqModuleUp = false;
      const result = await execute(found.id);

      // Without this the hold sits in the queue with no way back, and the card
      // shows no trace that anything was attempted.
      expect(decisions.get(found.id)?.holdId).toBe(result.hold!.id);
      expect((await list()).opportunities[0]!.holdId).toBe(result.hold!.id);
    });

    it('HOLDS when the module it would write into is not there', async () => {
      const found = await accepted();
      rfqModuleUp = false;

      const result = await execute(found.id);
      expect(result.hold?.reason).toBe('unresolved_dependency');
      expect(result.hold?.resolution).toContain('Restart NeuroPause');
    });

    it('HOLDS — and does not claim success — when the write cannot be read back', async () => {
      const found = await accepted();
      breakVerification = true;

      const result = await execute(found.id);
      expect(result.ok).toBe(false);
      expect(result.hold?.reason).toBe('verification_unavailable');
      // The single most important assertion in the file: `created` stays null
      // even though a create was issued, because the UI renders "X created"
      // from it and an unverifiable claim must not reach the user as a fact.
      expect(result.created).toBeNull();
      expect(result.message).toContain('could not read the RFQ back');
      const record = records.list().find((r) => r.holdId === result.hold?.id)!;
      expect(record.executed).toContain('whether it persisted could not be confirmed');
    });

    it('does not create a second RFQ, and claims nothing for the one it found', async () => {
      const found = await accepted();
      await execute(found.id);
      const again = await execute(found.id);

      expect(again.ok).toBe(false);
      expect(rfqs.count()).toBe(1);
      // Nothing needs resolving — the work is already underway — so no hold.
      expect(again.hold).toBeNull();
      // But `created` stays NULL. The match is on product alone, so the open
      // RFQ may have been raised years ago for an unrelated reason; returning
      // it here would have NeuroPause claiming an execution it did not perform,
      // and the UI renders "X created" from this field.
      expect(again.created).toBeNull();
      expect(again.message).toContain('did not create a second one');
    });

    it('does not adopt a pre-existing RFQ as this opportunity’s work', async () => {
      // An RFQ raised by someone else, for their own reasons, before the
      // opportunity was ever accepted.
      rfqs.create({
        title: 'RFQ-0042',
        fields: { rfqNumber: 'RFQ-0042', product: 'SKU-100', quantity: 1, status: 'open' },
        now: T0,
      });
      const found = await accepted();
      const result = await execute(found.id);

      expect(result.created).toBeNull();
      expect(result.opportunity?.executionRef).toBeNull();
      // And the status must not advance: NeuroPause did nothing.
      expect(result.opportunity?.status).toBe('accepted');
      expect(decisions.get(found.id)?.executionRef ?? null).toBeNull();
    });

    it('matches an open RFQ whatever the casing of its status', async () => {
      rfqs.create({
        title: 'RFQ-0042',
        fields: { rfqNumber: 'RFQ-0042', product: 'SKU-100', quantity: 1, status: 'Open' },
        now: T0,
      });
      const found = await accepted();
      // A missed match would create a duplicate RFQ for a product already
      // being sourced.
      expect((await execute(found.id)).message).toContain('RFQ-0042 is already open');
      expect(rfqs.count()).toBe(1);
    });

    it('numbers RFQs from the highest existing reference, never from a count', async () => {
      rfqs.create({
        title: 'RFQ-0007',
        fields: { rfqNumber: 'RFQ-0007', product: 'SKU-999', quantity: 1, status: 'awarded' },
        now: T0,
      });
      const found = await accepted();
      const result = await execute(found.id);
      expect(result.created?.label).toBe('RFQ-0008');
    });
  });

  /* ── the hold/record pairing Program 3 depends on ──────────────────────── */

  describe('governance integration', () => {
    it('pairs every hold with a Decision Record on the same subject', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'accepted');
      mayManage = false;
      const result = await execute(found.id);

      const hold = result.hold!;
      const paired = records.list().find((r) => r.holdId === hold.id)!;
      expect(paired.subject).toBe(hold.subject);
      expect(paired.outcome).toBe('cancelled');
      expect(paired.executed).toContain('Nothing');
    });

    it('does not pile up holds when a refused action is retried', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'accepted');
      mayManage = false;
      await execute(found.id);
      await execute(found.id);
      await execute(found.id);

      expect(holds.openCount()).toBe(1);
      expect(records.list().filter((r) => r.holdId !== null)).toHaveLength(1);
    });

    it('survives a restart with the hold and its record intact', async () => {
      const found = (await list()).opportunities[0]!;
      await setStatus(found.id, 'accepted');
      mayManage = false;
      const result = await execute(found.id);
      await Promise.all([holds.flush(), records.flush()]);

      const holds2 = new HoldStore(join(dir, 'holds.json'));
      const records2 = new DecisionRecordStore(join(dir, 'decisions.json'));
      await Promise.all([holds2.load(), records2.load()]);
      expect(holds2.openCount()).toBe(1);
      expect(records2.list().some((r) => r.holdId === result.hold!.id)).toBe(true);
    });
  });
});
