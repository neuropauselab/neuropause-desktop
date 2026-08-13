import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deriveCostValuation, type StockMovement } from '@neuropause/shared';
import type { EnterpriseModule } from '../../framework';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createInventoryValuationModule } from './inventoryValuationModule';

const T0 = '2026-08-06T00:00:00.000Z';

/** Build a posted movement with an explicit sequence (drives chronological order). */
const mov = (n: number, type: string, quantity: number, unitCost: number, over: Partial<StockMovement> = {}): StockMovement =>
  ({
    id: `m${n}`,
    movementNumber: `MV-${String(n).padStart(3, '0')}`,
    type,
    product: 'SKU-1',
    warehouse: 'WH-01',
    fromWarehouse: '',
    quantity,
    unitCost,
    referenceModule: '',
    referenceRecord: '',
    reason: '',
    status: 'posted',
    createdAt: `2026-08-06T00:${String(n).padStart(2, '0')}:00.000Z`,
    updatedAt: T0,
    ...over,
  }) as StockMovement;

describe('Actual-cost valuation engine (pure)', () => {
  it('FIFO consumes the oldest layers first, leaving the newest cost on hand', () => {
    const cv = deriveCostValuation([mov(1, 'receive', 10, 100), mov(2, 'receive', 10, 120), mov(3, 'issue', 15, 0)], 'fifo');
    expect(cv.rows).toHaveLength(1);
    expect(cv.rows[0]).toEqual({ product: 'SKU-1', onHand: 5, unitCost: 120, value: 600, uncosted: false });
    expect(cv.totalValue).toBe(600);
  });

  it('weighted-average blends all receipts; the same stock is worth less than FIFO here', () => {
    const movements = [mov(1, 'receive', 10, 100), mov(2, 'receive', 10, 120), mov(3, 'issue', 15, 0)];
    const wac = deriveCostValuation(movements, 'weighted-average');
    expect(wac.rows[0].unitCost).toBe(110); // (10·100 + 10·120) / 20
    expect(wac.totalValue).toBe(550); // 5 on hand × 110
  });

  it('moving-average recomputes the average on each receipt, so issue timing changes the value', () => {
    // Receive 10@100, issue 5 (avg stays 100), receive 10@120 → avg (5·100 + 10·120)/15.
    const movements = [mov(1, 'receive', 10, 100), mov(2, 'issue', 5, 0), mov(3, 'receive', 10, 120)];
    expect(deriveCostValuation(movements, 'moving-average').totalValue).toBe(1700); // 15 × 113.333
    // Weighted-average over the same movements ignores issue timing → less.
    expect(deriveCostValuation(movements, 'weighted-average').totalValue).toBe(1650); // 15 × 110
  });

  it('counts uncosted remaining stock and omits products with no on-hand', () => {
    const uncosted = deriveCostValuation([mov(1, 'receive', 10, 0)], 'fifo');
    expect(uncosted.rows[0]).toMatchObject({ onHand: 10, value: 0, uncosted: true });
    expect(uncosted.uncostedCount).toBe(1);
    const drained = deriveCostValuation([mov(1, 'receive', 10, 100), mov(2, 'issue', 10, 0)], 'fifo');
    expect(drained.rows).toHaveLength(0);
    expect(drained.cellCount).toBe(0);
  });
});

describe('Valuation module — method selector over real stores', () => {
  let dir: string;
  let products: EnterpriseModule;
  let movements: EnterpriseModule;
  let valuations: EnterpriseModule;

  const seed = (fields: Record<string, unknown>): void => {
    const v = movements.hooks.validate({
      fields: { movementNumber: `MV-${randomUUID().slice(0, 6)}`, type: 'receive', product: 'SKU-2', warehouse: 'WH-01', quantity: 10, unitCost: 100, status: 'posted', ...fields },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) movements.store.create({ title: 'seed', fields: v.values, actor: 't@np', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-costing-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    products = createProductModule(join(dir, 'products.json'));
    movements = createStockMovementModule(join(dir, 'movements.json'));
    valuations = createInventoryValuationModule(join(dir, 'valuations.json'), movements.store, products.store);
    await Promise.all([products.store.load(), movements.store.load(), valuations.store.load()]);
    products.store.create({ title: 'Gadget', fields: { sku: 'SKU-2', name: 'Gadget', standardCost: 50 }, actor: 't@np', now: T0 });
  });

  afterEach(async () => {
    await Promise.all([products.store.flush(), movements.store.flush(), valuations.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('defaults to standard cost, and generates a FIFO register when the method is chosen', () => {
    // Default method — unchanged W3.5 behavior.
    const std = valuations.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(std.ok).toBe(true);
    if (std.ok) expect(std.values.method).toBe('standard-cost');
    // Costed receipts, then an issue → FIFO leaves the newest layer. Sequential
    // movement numbers make the chronological order deterministic (all share T0).
    seed({ movementNumber: 'MV-001', quantity: 10, unitCost: 100 });
    seed({ movementNumber: 'MV-002', quantity: 10, unitCost: 120 });
    seed({ movementNumber: 'MV-003', type: 'issue', quantity: 15, unitCost: 0 });
    const fifo = valuations.hooks.validate({ fields: { asOfDate: '2026-08-07', method: 'fifo' } });
    expect(fifo.ok, JSON.stringify('errors' in fifo ? fifo.errors : {})).toBe(true);
    if (!fifo.ok) throw new Error('unreachable');
    expect(fifo.values.method).toBe('fifo');
    const rows = JSON.parse(String(fifo.values.rows)) as Array<{ product: string; value: number }>;
    const gadget = rows.find((r) => r.product === 'SKU-2')!;
    expect(gadget.value).toBe(600); // 5 remaining × 120
    // Immutable once generated.
    const rec = valuations.store.create({ title: String(fifo.values.reportNumber), fields: fifo.values, actor: 't@np', now: T0 });
    expect(valuations.hooks.validate({ fields: { ...valuations.store.get(rec.id)!.fields, method: 'weighted-average' } }).ok).toBe(false);
  });
});
