/**
 * Transaction-graph spine — Session 1b: correlation across the procurement and
 * warehouse document chains, driven through the REAL module action handlers.
 *
 * Proves the Session 1 helper propagates correctly across independent,
 * hand-written conversions (not just the sales chain): a purchase-request →
 * purchase-order → goods-receipt chain, and a pick-list → packing → shipment
 * chain, each converge on ONE correlationId with correct causation edges and
 * reconstruct root-first via `traceTransactionGraph`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  GOODS_RECEIPTS_MODULE_ID,
  IpcChannel,
  PACKING_MODULE_ID,
  PICK_LISTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  SHIPPING_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from './moduleRegistry';
import { globalRef, readCorrelation, traceTransactionGraph } from './transactionGraph';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createProductModule } from '../modules/inventory/productModule';
import { createStockMovementModule } from '../modules/inventory/stockMovementModule';
import { createSupplierModule } from '../modules/procurement/supplierModule';
import { createPurchaseRequestModule } from '../modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../modules/procurement/goodsReceiptModule';
import { createPickListModule } from '../modules/warehouse/pickListModule';
import { createPackingModule } from '../modules/warehouse/packingModule';
import { createShippingModule } from '../modules/warehouse/shippingModule';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

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

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    createSupplierModule(tmp('sup')),
    createPurchaseRequestModule(tmp('pr')),
    createPurchaseOrderModule(tmp('po')),
    createGoodsReceiptModule(tmp('gr')),
    createPickListModule(tmp('pick')),
    createPackingModule(tmp('pack')),
    createShippingModule(tmp('ship')),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean }>;
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields });
const only = (moduleId: string): EnterpriseEntity => registry.get(moduleId)!.store.list()[0];

describe('Session 1b — procurement chain (PR → PO → GR) shares one correlationId', () => {
  it('the PO and GR inherit the purchase request as the transaction root', async () => {
    const pr = await createIn(PURCHASE_REQUESTS_MODULE_ID, { requestNumber: 'PR-1', product: 'SKU-1', quantity: 25, budget: 500 });
    const prId = pr.record!.id;
    expect((await act(PURCHASE_REQUESTS_MODULE_ID, prId, 'approve')).ok).toBe(true);
    expect((await act(PURCHASE_REQUESTS_MODULE_ID, prId, 'createPurchaseOrder')).ok).toBe(true);

    const po = only(PURCHASE_ORDERS_MODULE_ID);
    const CID = globalRef(PURCHASE_REQUESTS_MODULE_ID, prId);
    expect(readCorrelation(only(PURCHASE_REQUESTS_MODULE_ID)).correlationId).toBe(CID); // PR is root
    expect(readCorrelation(po)).toMatchObject({ correlationId: CID, causationId: prId, causedByModule: PURCHASE_REQUESTS_MODULE_ID });

    await update(PURCHASE_ORDERS_MODULE_ID, po.id, { warehouse: 'WH-1' });
    await act(PURCHASE_ORDERS_MODULE_ID, po.id, 'approve');
    await act(PURCHASE_ORDERS_MODULE_ID, po.id, 'send');
    expect((await act(PURCHASE_ORDERS_MODULE_ID, po.id, 'receiveGoods')).ok).toBe(true);

    const gr = only(GOODS_RECEIPTS_MODULE_ID);
    expect(readCorrelation(gr)).toMatchObject({ correlationId: CID, causationId: po.id, causedByModule: PURCHASE_ORDERS_MODULE_ID });

    const graph = await traceTransactionGraph(registry.list(), CID);
    const refs = graph.map((n) => `${n.moduleId}:${n.recordId}`);
    expect(refs).toContain(globalRef(PURCHASE_REQUESTS_MODULE_ID, prId));
    expect(refs).toContain(globalRef(PURCHASE_ORDERS_MODULE_ID, po.id));
    expect(refs).toContain(globalRef(GOODS_RECEIPTS_MODULE_ID, gr.id));
    expect(graph[0].isRoot).toBe(true);
    expect(graph[0].moduleId).toBe(PURCHASE_REQUESTS_MODULE_ID);
  });
});

describe('Session 1b — warehouse chain (pick → packing → shipment) shares one correlationId', () => {
  it('packing and shipment inherit the pick list as the transaction root', async () => {
    const pick = await createIn(PICK_LISTS_MODULE_ID, {
      pickNumber: 'PICK-1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5, status: 'picked',
    });
    const pickId = pick.record!.id;
    expect((await act(PICK_LISTS_MODULE_ID, pickId, 'createPacking')).ok).toBe(true);

    const packing = only(PACKING_MODULE_ID);
    const CID = globalRef(PICK_LISTS_MODULE_ID, pickId);
    expect(readCorrelation(only(PICK_LISTS_MODULE_ID)).correlationId).toBe(CID); // pick is root
    expect(readCorrelation(packing)).toMatchObject({ correlationId: CID, causationId: pickId, causedByModule: PICK_LISTS_MODULE_ID });

    await act(PACKING_MODULE_ID, packing.id, 'pack'); // packing must be 'packed' before shipment
    expect((await act(PACKING_MODULE_ID, packing.id, 'createShipment')).ok).toBe(true);
    const shipment = only(SHIPPING_MODULE_ID);
    expect(readCorrelation(shipment)).toMatchObject({ correlationId: CID, causationId: packing.id, causedByModule: PACKING_MODULE_ID });

    const graph = await traceTransactionGraph(registry.list(), CID);
    expect(graph.map((n) => n.moduleId)).toEqual([PICK_LISTS_MODULE_ID, PACKING_MODULE_ID, SHIPPING_MODULE_ID]);
    expect(graph[0].isRoot).toBe(true);
    expect(graph[2].parentRef).toBe(globalRef(PACKING_MODULE_ID, packing.id));
  });
});
