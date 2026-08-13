import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  STOCK_MOVEMENTS_MODULE_ID,
  deriveInventoryValuation,
  deriveStockLedger,
  lotCodePayload,
  lotRuntimeState,
  reservationFromRecord,
  movementFromRecord,
  type EnterpriseEntity,
  type InventoryLot,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createLotModule } from './lotModule';
import { createReservationModule } from './reservationModule';
import { createInventoryValuationModule } from './inventoryValuationModule';

const T0 = '2026-08-06T00:00:00.000Z';

describe('W3.3–W3.5 pure engines', () => {
  it('lot code payloads are canonical and runtime state is time-derived', () => {
    const payload = lotCodePayload({ lotNumber: 'LOT-1', product: 'SKU-1', warehouse: 'WH-01', quantity: 50, expiryDate: '2026-09-01' });
    expect(payload).toBe('{"lot":"LOT-1","sku":"SKU-1","wh":"WH-01","qty":50,"exp":"2026-09-01"}');
    const lot = { id: 'l', lotNumber: 'LOT-1', product: 'SKU-1', warehouse: 'WH-01', quantity: 50, expiryDate: '2026-09-01', receiptRef: '', codePayload: payload, consumedAt: null, createdAt: T0, updatedAt: T0 } as InventoryLot;
    const now = Date.parse('2026-08-06T00:00:00.000Z');
    expect(lotRuntimeState(lot, now)).toBe('active');
    expect(lotRuntimeState({ ...lot, expiryDate: '2026-08-01' }, now)).toBe('expired');
    expect(lotRuntimeState({ ...lot, consumedAt: T0, expiryDate: '2026-08-01' }, now)).toBe('consumed');
  });

  it('valuation prices ledger cells at standard cost and counts unvalued cells', () => {
    const mv = (o: Record<string, unknown>): ReturnType<typeof movementFromRecord> =>
      movementFromRecord({
        id: String(o.id ?? 'm'), title: '', fields: { movementNumber: 'MV', type: 'receive', product: 'SKU-1', warehouse: 'WH-01', quantity: 10, status: 'posted', ...o },
        createdAt: T0, updatedAt: T0,
      } as unknown as EnterpriseEntity);
    const products = [
      { sku: 'SKU-1', standardCost: 12.5 },
      { sku: 'SKU-2', standardCost: 0 },
    ] as Parameters<typeof deriveInventoryValuation>[1];
    const v = deriveInventoryValuation(
      [mv({ id: 'a' }), mv({ id: 'b', product: 'SKU-2', quantity: 4 }), mv({ id: 'c', type: 'issue', quantity: 3 })],
      products,
    );
    expect(v.cellCount).toBe(2);
    const sku1 = v.rows.find((r) => r.product === 'SKU-1')!;
    expect(sku1.onHand).toBe(7);
    expect(sku1.value).toBe(87.5);
    const sku2 = v.rows.find((r) => r.product === 'SKU-2')!;
    expect(sku2.unvalued).toBe(true);
    expect(sku2.value).toBe(0);
    expect(v.unvaluedCount).toBe(1);
    expect(v.totalValue).toBe(87.5);
  });
});

describe('W3.3–W3.5 modules over real stores', () => {
  let dir: string;
  let products: EnterpriseModule;
  let movements: EnterpriseModule;
  let lots: EnterpriseModule;
  let reservations: EnterpriseModule;
  let valuations: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;

  const seedMovement = (fields: Record<string, unknown>): void => {
    const v = movements.hooks.validate({
      fields: { movementNumber: `MV-SEED-${randomUUID().slice(0, 6)}`, type: 'receive', product: 'SKU-1', warehouse: 'WH-01', quantity: 100, status: 'posted', ...fields },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (v.ok) movements.store.create({ title: 'seed', fields: v.values, actor: 't@np', now: T0 });
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-inv-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    products = createProductModule(join(dir, 'products.json'));
    movements = createStockMovementModule(join(dir, 'movements.json'));
    lots = createLotModule(join(dir, 'lots.json'), products.store);
    reservations = createReservationModule(join(dir, 'reservations.json'), movements.store, products.store);
    valuations = createInventoryValuationModule(join(dir, 'valuations.json'), movements.store, products.store);
    await Promise.all([
      products.store.load(), movements.store.load(), lots.store.load(),
      reservations.store.load(), valuations.store.load(),
    ]);
    products.store.create({ title: 'Widget', fields: { sku: 'SKU-1', name: 'Widget', standardCost: 12.5 }, actor: 't@np', now: T0 });
    seedMovement({});
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === STOCK_MOVEMENTS_MODULE_ID ? movements : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([
      products.store.flush(), movements.store.flush(), lots.store.flush(),
      reservations.store.flush(), valuations.store.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lots stamp canonical payloads, refuse unknown SKUs, and freeze on consume', async () => {
    const v = lots.hooks.validate({ fields: { lotNumber: 'LOT-1', product: 'SKU-1', warehouse: 'WH-01', quantity: 50, expiryDate: '2026-09-01' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(String(v.values.codePayload)).toContain('"lot":"LOT-1"');
    const rec = lots.store.create({ title: 'LOT-1', fields: v.values, actor: 't@np', now: T0 });
    expect(lots.hooks.validate({ fields: { lotNumber: 'LOT-2', product: 'SKU-404', warehouse: 'WH-01', quantity: 1 } }).ok).toBe(false);
    const consume = await lots.hooks.runAction!('consume', rec, ctx);
    expect(consume.ok).toBe(true);
    const edit = lots.hooks.validate({ fields: { ...lots.store.get(rec.id)!.fields, quantity: 1 } });
    expect(edit.ok).toBe(false);
    expect((await lots.hooks.runAction!('consume', lots.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('reservations guard availability, post real ledger holds, and release them', async () => {
    const v = reservations.hooks.validate({ fields: { reservationNumber: 'RSV-1', product: 'SKU-1', warehouse: 'WH-01', quantity: 60 } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    const rec = reservations.store.create({ title: 'RSV-1', fields: v.values, actor: 't@np', now: T0 });
    await reservations.hooks.onChange!({ action: 'created', record: rec }, ctx);
    const held = reservationFromRecord(reservations.store.get(rec.id)!);
    expect(held.reservedMovement).toBeTruthy(); // a REAL movement was posted
    let ledger = deriveStockLedger(movements.store.list().map(movementFromRecord));
    let cell = ledger.find((c) => c.product === 'SKU-1' && c.warehouse === 'WH-01')!;
    expect(cell.reserved).toBe(60);
    expect(cell.available).toBe(40);
    // A second reservation is limited by the first — with the amount stated.
    const over = reservations.hooks.validate({ fields: { reservationNumber: 'RSV-2', product: 'SKU-1', warehouse: 'WH-01', quantity: 50 } });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(JSON.stringify(over.errors)).toContain('Only 40');
    // Release posts the matching reservation_release and restores availability.
    const release = await reservations.hooks.runAction!('release', reservations.store.get(rec.id)!, ctx);
    expect(release.ok, release.ok ? '' : release.error).toBe(true);
    ledger = deriveStockLedger(movements.store.list().map(movementFromRecord));
    cell = ledger.find((c) => c.product === 'SKU-1' && c.warehouse === 'WH-01')!;
    expect(cell.reserved).toBe(0);
    expect(cell.available).toBe(100);
    // Closed reservations are immutable.
    expect(reservations.hooks.validate({ fields: { ...reservations.store.get(rec.id)!.fields, quantity: 1 } }).ok).toBe(false);
    expect((await reservations.hooks.runAction!('fulfil', reservations.store.get(rec.id)!, ctx)).ok).toBe(false);
  });

  it('valuation registers price the ledger and freeze after generation', () => {
    const v = valuations.hooks.validate({ fields: { asOfDate: '2026-08-06' } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    expect(v.values.reportNumber).toBe('IV-2026-08-06-1');
    expect(v.values.method).toBe('standard-cost');
    expect(v.values.cellCount).toBe(1);
    expect(v.values.totalValue).toBe(1250); // 100 × 12.5
    const rec = valuations.store.create({ title: String(v.values.reportNumber), fields: v.values, actor: 't@np', now: T0 });
    const edit = valuations.hooks.validate({ fields: { ...valuations.store.get(rec.id)!.fields, asOfDate: '2026-09-01' } });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(JSON.stringify(edit.errors)).toContain('immutable');
  });
});
