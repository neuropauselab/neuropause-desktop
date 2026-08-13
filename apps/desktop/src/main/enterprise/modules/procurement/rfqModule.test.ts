import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PURCHASE_ORDERS_MODULE_ID,
  compareRfqQuotes,
  parseRfqQuotes,
  rfqFromRecord,
  type EnterpriseEntity,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createSupplierModule } from './supplierModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createRfqModule } from './rfqModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('RFQ quote parsing + comparison (pure)', () => {
  it('parses JSON quote lines with line-numbered errors and duplicate refusal', () => {
    const good = parseRfqQuotes(
      '{"supplier":"Acme Supplies","unitCost":12.5,"leadTimeDays":7}\n{"supplier":"Beta Parts","unitCost":11.9}',
    );
    expect(good.errors).toEqual([]);
    expect(good.quotes).toHaveLength(2);
    expect(good.quotes[1].leadTimeDays).toBeNull();
    expect(parseRfqQuotes('not json').errors[0]).toContain('Line 1');
    expect(parseRfqQuotes('{"supplier":"A","unitCost":0}').errors[0]).toContain('greater than zero');
    expect(parseRfqQuotes('{"supplier":"A","unitCost":5,"leadTimeDays":1.5}').errors[0]).toContain('whole number');
    const dup = parseRfqQuotes('{"supplier":"A","unitCost":5}\n{"supplier":"A","unitCost":4}');
    expect(dup.errors[0]).toContain('duplicate quote from "A"');
  });

  it('compares deterministically — best value by cost (ties → lead time → name), fastest by lead time', () => {
    const { quotes } = parseRfqQuotes(
      [
        '{"supplier":"Slow Cheap","unitCost":10,"leadTimeDays":30}',
        '{"supplier":"Fast Cheap","unitCost":10,"leadTimeDays":5}',
        '{"supplier":"Fastest Pricey","unitCost":15,"leadTimeDays":2}',
        '{"supplier":"No Lead","unitCost":9.5}',
      ].join('\n'),
    );
    const cmp = compareRfqQuotes(quotes);
    expect(cmp.bestValue?.supplier).toBe('No Lead'); // lowest cost wins outright
    expect(cmp.bestLeadTime?.supplier).toBe('Fastest Pricey');
    const tie = compareRfqQuotes(quotes.filter((q) => q.unitCost === 10));
    expect(tie.bestValue?.supplier).toBe('Fast Cheap'); // cost tie → shorter lead time
    expect(compareRfqQuotes([])).toEqual({ bestValue: null, bestLeadTime: null });
  });
});

describe('RFQs over real stores — supplier guards, award → draft PO, immutability', () => {
  let dir: string;
  let suppliers: EnterpriseModule;
  let orders: EnterpriseModule;
  let rfqs: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-rfq-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    suppliers = createSupplierModule(join(dir, 'suppliers.json'));
    orders = createPurchaseOrderModule(join(dir, 'orders.json'));
    rfqs = createRfqModule(join(dir, 'rfqs.json'), suppliers.store);
    await Promise.all([suppliers.store.load(), orders.store.load(), rfqs.store.load()]);
    for (const name of ['Acme Supplies', 'Beta Parts']) {
      suppliers.store.create({ title: name, fields: { name }, actor: 't@np', now: T0 });
    }
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === PURCHASE_ORDERS_MODULE_ID ? orders : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([suppliers.store.flush(), orders.store.flush(), rfqs.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const newRfq = (quotesJson: string): EnterpriseEntity => {
    const v = rfqs.hooks.validate({
      fields: { rfqNumber: 'RFQ-1', product: 'SKU-0001', quantity: 40, warehouse: 'WH-01', neededBy: '2026-09-01', quotesJson },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return rfqs.store.create({ title: 'RFQ-1', fields: v.values, actor: 't@np', now: T0 });
  };

  it('stamps the comparison read-only and refuses phantom vendors', () => {
    const rec = newRfq('{"supplier":"Acme Supplies","unitCost":12.5,"leadTimeDays":7}\n{"supplier":"Beta Parts","unitCost":11.9,"leadTimeDays":14}');
    expect(rec.fields.quoteCount).toBe(2);
    expect(rec.fields.bestValueSupplier).toBe('Beta Parts');
    expect(rec.fields.bestValueUnitCost).toBe(11.9);
    expect(rec.fields.bestLeadTimeSupplier).toBe('Acme Supplies');
    const ghost = rfqs.hooks.validate({
      fields: { rfqNumber: 'RFQ-2', product: 'SKU-0001', quantity: 1, quotesJson: '{"supplier":"Ghost Co","unitCost":1}' },
    });
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(JSON.stringify(ghost.errors)).toContain('Ghost Co');
  });

  it('awards best value into a draft PO with exact totals, then freezes the RFQ', async () => {
    const rec = newRfq('{"supplier":"Acme Supplies","unitCost":12.5,"leadTimeDays":7}\n{"supplier":"Beta Parts","unitCost":11.9,"leadTimeDays":14}');
    const res = await rfqs.hooks.runAction!('award', rec, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const rfq = rfqFromRecord(rfqs.store.get(rec.id)!);
    expect(rfq.status).toBe('awarded');
    expect(rfq.awardedSupplier).toBe('Beta Parts');
    const po = orders.store.get(rfq.awardedOrder)!;
    expect(po.fields.poNumber).toBe('PO-RFQ-1');
    expect(po.fields.supplier).toBe('Beta Parts');
    expect(po.fields.quantity).toBe(40);
    expect(po.fields.unitCost).toBe(11.9);
    expect(po.fields.subtotal).toBe(476); // 40 × 11.9 exactly
    expect(po.fields.sourceRequest).toBeNull(); // validator nulls empty inputs
    // Frozen: edits and further actions are refused.
    const edit = rfqs.hooks.validate({ fields: { ...rfqs.store.get(rec.id)!.fields, quantity: 99 } });
    expect(edit.ok).toBe(false);
    expect((await rfqs.hooks.runAction!('award', rfqs.store.get(rec.id)!, ctx)).ok).toBe(false);
    expect((await rfqs.hooks.runAction!('cancel', rfqs.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('refuses awarding an empty RFQ and cancels cleanly', async () => {
    const rec = newRfq('');
    expect(rec.fields.quoteCount).toBe(0);
    const empty = await rfqs.hooks.runAction!('award', rec, ctx);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(String(empty.error)).toContain('No quotes');
    const cancel = await rfqs.hooks.runAction!('cancel', rec, ctx);
    expect(cancel.ok).toBe(true);
    expect(rfqFromRecord(rfqs.store.get(rec.id)!).status).toBe('cancelled');
  });
});
