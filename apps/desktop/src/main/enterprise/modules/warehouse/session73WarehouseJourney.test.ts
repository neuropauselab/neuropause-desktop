/**
 * ERP S73 Gate 4 — WAREHOUSE WHOLE-USER JOURNEY through the real warehouse + inventory
 * modules, with the Inventory Ledger as the single source of truth (stock is never edited).
 *
 *   Seed on-hand → Transfer (approve→dispatch→receive, net-zero relocation) →
 *   Pick → Pack → Ship (issues stock, releases the reservation) → tenant isolation.
 *
 * The per-capability ledger integrations (paired transfer movements, cycle-count variance,
 * stock-adjustment sign, RBAC warehouse:read/manage + defense-in-depth inventory:manage) are
 * already proven in warehouse.test.ts; this pin proves the SAME modules end-to-end as one
 * user journey and adds the cross-tenant isolation assertion.
 *
 * CYCLE-COUNT `reconcile` + STOCK-ADJUSTMENT `post` MECHANISMS are governed and proven, but the
 * ECONOMIC-VARIANCE MATERIALITY APPROVAL (the threshold above which a variance/write-off needs
 * sign-off, the decider role, executor≠approver SoD, and the write-off GL treatment) is UNDEFINED
 * (D10) and is DELIBERATELY NOT driven here — see DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md.
 * Nothing about variance-approval authority is invented in this gate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  productFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { resolveTenantScope } from '../../../tenancy/backgroundPrincipal';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createZoneModule } from './zoneModule';
import { createBinModule } from './binModule';
import { createTransferOrderModule } from './transferOrderModule';
import { createPickListModule } from './pickListModule';
import { createPackingModule } from './packingModule';
import { createShippingModule } from './shippingModule';
import { createCycleCountModule } from './cycleCountModule';
import { createStockAdjustmentModule } from './stockAdjustmentModule';

const T0 = '2026-09-03T00:00:00.000Z';
const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s73wh-${t}-${randomUUID()}.json`); paths.push(p); return p; };
let scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
let authorized: EnterprisePermission[] = [];
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let products: ReturnType<typeof createProductModule>;

function moduleCtx() {
  return {
    authorize: (p: EnterprisePermission) => authorized.push(p),
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined,
    actor: () => 'warehouse.op@np.dev', now: () => T0,
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; authorized = [];
  registry = new EnterpriseModuleRegistry();
  products = createProductModule(tmp('prod'));
  for (const m of [
    products,
    createStockMovementModule(tmp('mv')),
    createZoneModule(tmp('zone')),
    createBinModule(tmp('bin')),
    createTransferOrderModule(tmp('trn')),
    createPickListModule(tmp('pick')),
    createPackingModule(tmp('pack')),
    createShippingModule(tmp('ship')),
    createCycleCountModule(tmp('cc')),
    createStockAdjustmentModule(tmp('adj')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const create = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const act = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const getRec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id) as EnterpriseEntity;
const listOf = (moduleId: string) => H(IpcChannel.EnterpriseModuleList)({ moduleId }) as Promise<EnterpriseEntity[]>;
const onHand = (productId: string) => productFromRecord(products.store.get(productId) as EnterpriseEntity).currentStock;

describe('S73 · Warehouse whole-user journey (Inventory Ledger is the source of truth)', () => {
  it('seed → transfer (approve→dispatch→receive, net-zero) → pick→pack→ship (issues stock)', async () => {
    const prod = await create('inventory-products', { sku: 'SKU-1', name: 'Widget', standardCost: 5 });
    const productId = prod.record!.id;
    const seed = await create('warehouse-adjustments', { adjustmentNumber: 'ADJ-SEED', product: 'SKU-1', warehouse: 'WH-1', quantity: 100, reason: 'found' });
    expect((await act('warehouse-adjustments', seed.record!.id, 'post')).ok).toBe(true);
    expect(onHand(productId)).toBe(100);

    // Transfer WH-1 → WH-2, quantity 30: net-zero on the product total
    const tr = await create('warehouse-transfers', { transferNumber: 'TRN-1', product: 'SKU-1', quantity: 30, fromWarehouse: 'WH-1', toWarehouse: 'WH-2' });
    const trId = tr.record!.id;
    authorized = [];
    expect((await act('warehouse-transfers', trId, 'approve')).ok).toBe(true);
    expect(authorized).toContain('warehouse:manage'); // action authority
    expect(authorized).toContain('inventory:manage');  // the reservation movement's authority
    expect((await act('warehouse-transfers', trId, 'dispatch')).ok).toBe(true);
    expect((await act('warehouse-transfers', trId, 'receive')).ok).toBe(true);
    expect(String(getRec('warehouse-transfers', trId).fields.status)).toBe('completed');
    expect(onHand(productId)).toBe(100); // relocation is net-zero on the total

    // Pick → Pack → Ship: issues 5 out of WH-1
    const p = await create('warehouse-picks', { pickNumber: 'PICK-1', salesOrder: 'SO-1', product: 'SKU-1', warehouse: 'WH-1', quantity: 5 });
    const pickId = p.record!.id;
    expect((await act('warehouse-picks', pickId, 'reserve')).ok).toBe(true);
    expect((await act('warehouse-picks', pickId, 'pick')).ok).toBe(true);
    expect((await act('warehouse-picks', pickId, 'createPacking')).ok).toBe(true);
    const packRec = (await listOf('warehouse-packing')).find((r) => r.title === 'PACK-PICK-1')!;
    expect((await act('warehouse-packing', packRec.id, 'pack')).ok).toBe(true);
    expect((await act('warehouse-packing', packRec.id, 'createShipment')).ok).toBe(true);
    const shipRec = (await listOf('warehouse-shipping')).find((r) => r.title === 'SHIP-PACK-PICK-1')!;
    expect((await act('warehouse-shipping', shipRec.id, 'ship')).ok).toBe(true);
    expect(onHand(productId)).toBe(95); // 100 − 5 issued
  });

  it('TENANT isolation: a transfer created in tenant-B is invisible in tenant-A', async () => {
    await create('warehouse-transfers', { transferNumber: 'TRN-A', product: 'SKU-1', quantity: 1, fromWarehouse: 'WH-1', toWarehouse: 'WH-2' });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await create('warehouse-transfers', { transferNumber: 'TRN-B', product: 'SKU-1', quantity: 1, fromWarehouse: 'WH-1', toWarehouse: 'WH-2' });
    // tenant-B sees only TRN-B
    const visibleInB = (await listOf('warehouse-transfers')).map((r) => String(r.fields.transferNumber));
    expect(visibleInB).toContain('TRN-B');
    expect(visibleInB).not.toContain('TRN-A');
    // back in tenant-A: only TRN-A is visible, TRN-B is invisible (scopeOrDeny)
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const visibleInA = (await listOf('warehouse-transfers')).map((r) => String(r.fields.transferNumber));
    expect(visibleInA).toContain('TRN-A');
    expect(visibleInA).not.toContain('TRN-B');
  });
});
