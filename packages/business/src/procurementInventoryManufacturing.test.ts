import { describe, it, expect, beforeAll } from 'vitest';
import { ManualClock } from '@neuropause/cloud-core';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { createBusinessPlatform, type BusinessPlatform } from './platform';

describe('Modules 9,10,11 — Procurement, Inventory, Manufacturing', () => {
  let runtime: EnterpriseRuntime;
  let biz: BusinessPlatform;

  beforeAll(() => {
    const clock = new ManualClock(1000);
    runtime = createEnterpriseRuntime({ clock });
    biz = createBusinessPlatform(runtime, { clock });
  });

  it('runs the procurement PO lifecycle and spend analysis', async () => {
    const s = await biz.procurement().createSupplier({ name: 'Widgets Inc' });
    const po = await biz.procurement().createPurchaseOrder({ supplierId: s.id, lines: [{ sku: 'W1', qty: 10, unitPrice: 5 }] });
    expect(po.total).toBe(50);
    await biz.procurement().approvePurchaseOrder(po.id);
    await biz.procurement().receiveGoods(po.id, 10);
    expect(biz.procurement().purchaseOrders()[0]!.state).toBe('received');
    expect(biz.procurement().vendorScore(s.id)).toBe(100);
    expect(biz.procurement().spendAnalysis().total).toBe(50);
  });

  it('computes on-hand and weighted-average valuation from real movements', async () => {
    const wh = await biz.inventory().createWarehouse('Main');
    await biz.inventory().recordMovement({ sku: 'A', warehouseId: wh.id, qty: 10, kind: 'receipt', unitCost: 2 });
    await biz.inventory().recordMovement({ sku: 'A', warehouseId: wh.id, qty: 10, kind: 'receipt', unitCost: 4 });
    await biz.inventory().recordMovement({ sku: 'A', warehouseId: wh.id, qty: 5, kind: 'issue' });
    expect(biz.inventory().onHand('A', wh.id)).toBe(15);
    const val = biz.inventory().valuation('A');
    expect(val.unitCost).toBe(3); // (10@2 + 10@4) / 20
    expect(val.value).toBe(45); // 15 * 3
    expect(biz.inventory().reserve('A', wh.id, 20).reserved).toBe(false); // only 15 available
  });

  it('plans production and explodes a BOM but NEVER executes the factory', async () => {
    const plant = await biz.manufacturing().createPlant('Plant 1');
    await biz.manufacturing().defineBOM({ productSku: 'BIKE', components: [{ sku: 'WHEEL', qty: 2 }, { sku: 'FRAME', qty: 1 }] });
    const wc = await biz.manufacturing().createWorkCenter({ name: 'Assembly', capacityPerDay: 10 });
    const order = await biz.manufacturing().createProductionOrder({ productSku: 'BIKE', qty: 5, plantId: plant.id });
    expect(order.state).toBe('planned');
    expect(order.note).toMatch(/REGULATED-EXTERNAL/);
    const reqs = biz.manufacturing().explodeBOM('BIKE', 5);
    expect(reqs.find((r) => r.sku === 'WHEEL')!.requiredQty).toBe(10);
    await biz.manufacturing().schedule(order.id, wc.id);
    expect(biz.manufacturing().productionOrders()[0]!.state).toBe('released'); // descriptor only — never a real dispatch
  });
});
