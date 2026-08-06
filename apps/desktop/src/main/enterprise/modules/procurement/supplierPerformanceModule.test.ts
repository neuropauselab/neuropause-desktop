import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deriveSupplierPerformance, type GoodsReceipt } from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createSupplierModule } from './supplierModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';
import { createSupplierPerformanceModule } from './supplierPerformanceModule';

const T0 = '2026-08-06T00:00:00.000Z';

const receipt = (over: Partial<GoodsReceipt>): GoodsReceipt =>
  ({
    id: 'g1', grNumber: 'GR-1', purchaseOrder: '', supplier: 'Acme Supplies', product: 'SKU-1',
    warehouse: 'WH-01', quantityOrdered: 100, quantityReceived: 100, expectedDate: '2026-08-01',
    receiptDate: '2026-08-01', status: 'received', condition: '', receiptMovement: '',
    createdAt: T0, updatedAt: T0, ...over,
  }) as GoodsReceipt;

describe('supplier performance engine (pure) — evidence-based, explainable', () => {
  it('scores on-time rate + symmetric quantity accuracy with printed formula', () => {
    const reg = deriveSupplierPerformance([
      receipt({}), // on time, exact
      receipt({ id: 'g2', grNumber: 'GR-2', receiptDate: '2026-08-06' }), // 5 days late
      receipt({ id: 'g3', grNumber: 'GR-3', supplier: 'Beta Parts', quantityOrdered: 100, quantityReceived: 110 }), // over-delivery penalized
      receipt({ id: 'g4', grNumber: 'GR-4', supplier: '', quantityOrdered: 0 }), // unattributed bucket
    ]);
    expect(reg.supplierCount).toBe(3);
    const acme = reg.rows.find((r) => r.supplier === 'Acme Supplies')!;
    expect(acme.onTimeRatePct).toBe(50);
    expect(acme.avgDaysLate).toBe(5);
    expect(acme.quantityAccuracyPct).toBe(100);
    expect(acme.score).toBe(70); // 0.6×50 + 0.4×100
    expect(acme.band).toBe('watch');
    expect(acme.reasons.join(' ')).toContain('score = round(0.6 × 50 + 0.4 × 100)');
    const beta = reg.rows.find((r) => r.supplier === 'Beta Parts')!;
    expect(beta.quantityAccuracyPct).toBe(110);
    expect(beta.score).toBe(96); // 0.6×100 + 0.4×90 — over-delivery costs
    expect(reg.rows.find((r) => r.supplier === '(unattributed)')).toBeTruthy();
    expect(reg.rows[0].supplier).toBe('Acme Supplies'); // worst first
    expect(reg.overallOnTimePct).toBe(75); // 3 of 4 dated receipts on time
  });

  it('reports unmeasured dimensions instead of fabricating them', () => {
    const reg = deriveSupplierPerformance([
      receipt({ expectedDate: '', receiptDate: '', quantityOrdered: 0, quantityReceived: 5 }),
    ]);
    const row = reg.rows[0];
    expect(row.onTimeRatePct).toBeNull();
    expect(row.quantityAccuracyPct).toBeNull();
    expect(row.score).toBe(100); // unmeasured counts as 100 — and SAYS so
    expect(row.reasons.join(' ')).toContain('unmeasured');
    expect(reg.overallOnTimePct).toBeNull();
    expect(deriveSupplierPerformance([]).supplierCount).toBe(0);
  });
});

describe('Scorecard registers over real stores — generation, unmeasured note, immutability', () => {
  let dir: string;
  let suppliers: EnterpriseModule;
  let receipts: EnterpriseModule;
  let registers: EnterpriseModule;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-sp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    suppliers = createSupplierModule(join(dir, 'suppliers.json'));
    receipts = createGoodsReceiptModule(join(dir, 'receipts.json'));
    registers = createSupplierPerformanceModule(join(dir, 'registers.json'), receipts.store, suppliers.store);
    await Promise.all([suppliers.store.load(), receipts.store.load(), registers.store.load()]);
    for (const name of ['Acme Supplies', 'Fresh Vendor']) {
      suppliers.store.create({ title: name, fields: { name }, actor: 't@np', now: T0 });
    }
    receipts.store.create({
      title: 'GR-1',
      fields: {
        grNumber: 'GR-1', supplier: 'Acme Supplies', product: 'SKU-1', warehouse: 'WH-01',
        quantityOrdered: 100, quantityReceived: 90, expectedDate: '2026-08-01', receiptDate: '2026-08-03', status: 'received',
      },
      actor: 't@np', now: T0,
    });
  });

  afterEach(async () => {
    await Promise.all([suppliers.store.flush(), receipts.store.flush(), registers.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('generates an immutable register and names the unmeasured supplier count', () => {
    const v = registers.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.reportNumber).toBe('SP-2026-08-06-1');
    expect(v.values.supplierCount).toBe(1);
    expect(v.values.overallOnTimePct).toBe(0); // the one dated receipt was late
    expect(String(v.values.note)).toContain('1 registered supplier(s) have no receipts yet');
    const rows = JSON.parse(String(v.values.rows));
    expect(rows[0]).toMatchObject({ supplier: 'Acme Supplies', quantityAccuracyPct: 90, avgDaysLate: 2 });
    const rec = registers.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    const edit = registers.hooks.validate({ fields: { ...registers.store.get(rec.id)!.fields, asOfDate: '2026-09-01' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
  });
});
