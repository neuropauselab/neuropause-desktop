import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateDeliveryPerformance,
  calculateGoodsReceiptAccuracy,
  calculateInventoryReplenishment,
  calculateProcurementSavings,
  calculatePurchaseCycleTime,
  calculatePurchaseTotal,
  calculateSupplierHealth,
  calculateSupplierPerformance,
  calculateVendorRisk,
  deriveProcurementInsights,
  procurementInsightsToKpis,
  productFromRecord,
  type EnterprisePermission,
  type EnterpriseEntity,
  type GoodsReceipt,
  type PlatformEventInput,
  type Product,
  type PurchaseOrder,
  type Supplier,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createSupplierModule } from './supplierModule';
import { createPurchaseRequestModule } from './purchaseRequestModule';
import { createPurchaseOrderModule } from './purchaseOrderModule';
import { createGoodsReceiptModule } from './goodsReceiptModule';

const T0 = '2026-07-08T00:00:00.000Z';

function supplier(p: Partial<Supplier> = {}): Supplier {
  return { id: 's1', name: 'Acme Supplies', gst: '', pan: '', contactPerson: '', email: '', phone: '', bankDetails: '', paymentTerms: 'net30', leadTime: 10, vendorRating: 4, status: 'active', ...p };
}
function po(p: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return { id: 'o1', poNumber: 'PO-1', supplier: 'Acme', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, subtotal: 1000, discount: 100, tax: 80, total: 0, budget: 1000, currency: 'USD', expectedDelivery: '', status: 'draft', approvedBy: '', sourceRequest: '', createdAt: T0, updatedAt: T0, ...p };
}
function product(p: Partial<Product> = {}): Product {
  return { id: 'p1', sku: 'SKU-1', barcode: '', name: 'Widget', category: '', unit: 'unit', purchaseCost: 4, standardCost: 5, sellingPrice: 10, reorderLevel: 10, safetyStock: 5, maximumStock: 50, currentStock: 0, reservedStock: 0, availableStock: 0, status: 'active', ...p };
}

/* ── deterministic business logic ── */

describe('deterministic procurement functions', () => {
  it('purchase total, accuracy, cycle time', () => {
    expect(calculatePurchaseTotal({ subtotal: 1000, discount: 100, tax: 80 })).toBe(980);
    expect(calculateGoodsReceiptAccuracy(100, 90)).toBe(90);
    expect(calculateGoodsReceiptAccuracy(0, 5)).toBe(100);
    expect(calculatePurchaseCycleTime('2026-07-01', '2026-07-11')).toBe(10);
  });
  it('delivery + supplier performance', () => {
    const rows = [
      { expectedDate: '2026-07-10', receiptDate: '2026-07-08', quantityOrdered: 10, quantityReceived: 10 },
      { expectedDate: '2026-07-05', receiptDate: '2026-07-09', quantityOrdered: 10, quantityReceived: 8 },
    ];
    expect(calculateDeliveryPerformance(rows)).toBe(50); // one on time, one late
    expect(calculateSupplierPerformance(rows)).toBeGreaterThan(0);
  });
  it('vendor risk + supplier health', () => {
    expect(calculateVendorRisk(supplier({ vendorRating: 2, leadTime: 40 }), [])).toBe(56); // (5-2)*12 + 20
    expect(calculateSupplierHealth(supplier({ vendorRating: 2 })).level).toBe('high');
    expect(calculateSupplierHealth(supplier({ vendorRating: 5, leadTime: 5 })).level).toBe('low');
  });
  it('replenishment reuses inventory reorder; savings', () => {
    const need = calculateInventoryReplenishment([product({ availableStock: 3, reorderLevel: 10, safetyStock: 5, maximumStock: 50 })]);
    expect(need).toHaveLength(1);
    expect(need[0].requirement).toBe(47);
    expect(calculateProcurementSavings([{ budget: 1000, total: 900, status: 'sent' }, { budget: 0, total: 500, status: 'draft' }])).toBe(100);
  });
});

describe('deriveProcurementInsights + KPIs', () => {
  it('rolls suppliers + POs + receipts into KPIs', () => {
    const suppliers = [supplier({ leadTime: 10 }), supplier({ id: 's2', leadTime: 20 })];
    const orders = [po({ status: 'sent', subtotal: 1000, discount: 0, tax: 0 }), po({ id: 'o2', status: 'draft', subtotal: 500, discount: 0, tax: 0 })];
    const receipts: GoodsReceipt[] = [{ id: 'g1', grNumber: 'GR-1', purchaseOrder: 'o1', supplier: 'Acme', product: 'SKU-1', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10, expectedDate: '2026-07-10', receiptDate: '2026-07-12', status: 'received', condition: '', receiptMovement: 'm1', createdAt: T0, updatedAt: T0 }];
    const insights = deriveProcurementInsights(suppliers, orders, receipts);
    expect(insights).toMatchObject({
      openPurchaseOrders: 2, // sent + draft
      procurementSpend: 1000, // only the non-draft PO
      averageLeadTime: 15,
      lateDeliveries: 1, // received after expected
    });
    expect(procurementInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'proc-open-po',
      'proc-pending-receipts',
      'proc-spend',
      'proc-supplier-perf',
      'proc-lead-time',
      'proc-late',
      'proc-vendor-risk',
    ]);
  });
});

/* ── modules + the critical Goods Receipt → inventory integration ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let products: ReturnType<typeof createProductModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}
function tmp(tag: string): string {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  products = createProductModule(tmp('prod'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(createStockMovementModule(tmp('mv')));
  registry.register(createSupplierModule(tmp('sup')));
  registry.register(createPurchaseRequestModule(tmp('pr')));
  registry.register(createPurchaseOrderModule(tmp('po')));
  registry.register(createGoodsReceiptModule(tmp('gr')));
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}
async function createIn(moduleId: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> };
}
function act(moduleId: string, id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
}

describe('RBAC + PO total', () => {
  it('writes authorize procurement:manage; PO stamps deterministic total', async () => {
    const res = await createIn('procurement-orders', { poNumber: 'PO-1', subtotal: 1000, discount: 100, tax: 80 });
    expect(res.ok).toBe(true);
    expect(res.record?.fields.total).toBe(980);
    expect(rec.authorized).toContain('procurement:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'procurement-suppliers' });
    expect(rec.authorized).toEqual(['procurement:read']);
  });
});

describe('Goods Receipt → real inventory receive movement (single source of truth)', () => {
  it('posting a receipt writes a receive movement and drives product stock', async () => {
    const prod = await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const productId = prod.record?.id as string;

    const gr = await createIn('procurement-receipts', {
      grNumber: 'GR-1',
      product: 'SKU-1',
      warehouse: 'WH-1',
      quantityOrdered: 50,
      quantityReceived: 50,
      status: 'pending',
    });
    const grId = gr.record?.id as string;

    const posted = await act('procurement-receipts', grId, 'post');
    expect(posted.ok).toBe(true);

    // product stock derived from the real movement
    expect(productFromRecord(products.store.get(productId) as EnterpriseEntity)).toMatchObject({ currentStock: 50, availableStock: 50 });
    // GR marked received + linked to the movement
    const grRec = (await handler(IpcChannel.EnterpriseModuleGet)({ moduleId: 'procurement-receipts', id: grId })) as EnterpriseEntity;
    expect(grRec.fields.status).toBe('received');
    expect(String(grRec.fields.receiptMovement)).toMatch(/^rec_/);
    // timeline: movement created + product reconciled
    expect(rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:inventory-movements')).toBe(true);
    expect(rec.publish.some((e) => e.type === 'enterprise.record.updated' && e.source === 'enterprise:inventory-products')).toBe(true);
  });

  it('posting is idempotent (a receipt posts once)', async () => {
    await createIn('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-1', product: 'SKU-1', warehouse: 'WH-1', quantityReceived: 20, status: 'pending' });
    const grId = gr.record?.id as string;
    expect((await act('procurement-receipts', grId, 'post')).ok).toBe(true);
    const again = await act('procurement-receipts', grId, 'post');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been posted/i);
  });
});

describe('procurement flow (PR → PO → GR)', () => {
  it('approves a request, converts to a PO, then to a goods receipt', async () => {
    const pr = await createIn('procurement-requests', { requestNumber: 'PR-1', product: 'SKU-1', quantity: 25, budget: 500 });
    const prId = pr.record?.id as string;

    // approve
    expect((await act('procurement-requests', prId, 'approve')).ok).toBe(true);
    // PR → PO
    const toPo = await act('procurement-requests', prId, 'createPurchaseOrder');
    expect(toPo.ok).toBe(true);
    const orderRec = handlerListFind(await listOf('procurement-orders'), 'PO-PR-1');
    expect(orderRec?.fields).toMatchObject({ sourceRequest: prId, quantity: 25 });

    // the buyer completes the PO (warehouse), approves + sends, then receives goods
    const poId = orderRec?.id as string;
    await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: 'procurement-orders', id: poId, fields: { warehouse: 'WH-1' } });
    await act('procurement-orders', poId, 'approve');
    await act('procurement-orders', poId, 'send');
    const toGr = await act('procurement-orders', poId, 'receiveGoods');
    expect(toGr.ok).toBe(true);
    const grRec = handlerListFind(await listOf('procurement-receipts'), 'GR-PO-PR-1');
    expect(grRec?.fields).toMatchObject({ purchaseOrder: poId, quantityOrdered: 25 });
  });
});

async function listOf(moduleId: string): Promise<EnterpriseEntity[]> {
  return (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];
}
function handlerListFind(list: EnterpriseEntity[], title: string): EnterpriseEntity | undefined {
  return list.find((r) => r.title === title);
}

describe('AI summary', () => {
  it('supplier / PO / GR expose aiSummary=true; requests do not', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{ id: string; aiSummary: boolean }>;
    expect(summaries.find((s) => s.id === 'procurement-suppliers')?.aiSummary).toBe(true);
    expect(summaries.find((s) => s.id === 'procurement-orders')?.aiSummary).toBe(true);
    expect(summaries.find((s) => s.id === 'procurement-receipts')?.aiSummary).toBe(true);
    expect(summaries.find((s) => s.id === 'procurement-requests')?.aiSummary).toBe(false);
  });
});
