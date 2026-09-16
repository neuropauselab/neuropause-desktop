/**
 * ERP S73 Gate 5 — MANUFACTURING WHOLE-USER JOURNEY through the real manufacturing +
 * inventory modules, with the Inventory Ledger as the single source of truth.
 *
 *   Seed components → BOM → Production Order (plan → allocate → start → complete) →
 *   BOM-driven component consumption + finished-goods output → Quality inspection →
 *   Costing → tenant isolation.
 *
 * The per-capability proofs (BOM component scaling/waste, allocate-reserves/start-consumes/
 * complete-yields movements, MES execution state machine, cost variance) already live in
 * manufacturing.test.ts / mesExecution.test.ts / productionCostingAndVariance.test.ts; this
 * pin proves the SAME modules end-to-end as one journey and adds cross-tenant isolation.
 *
 * QUALITY `postDisposition` → inventory quarantine/reject mapping and PRODUCTION COST-VARIANCE
 * SETTLEMENT authority carry Session-4 / Session-5 decision notes; the parts of those that
 * require an UNDEFINED approval authority (variance-write-off sign-off, scrap materiality) are
 * NOT driven here and NOT invented — see DECISION-MEMO-S60-APPROVAL-CONTROL-PLANE.md.
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
import { createBomModule } from './bomModule';
import { createProductionOrderModule } from './productionOrderModule';
import { createWorkCenterModule } from './workCenterModule';
import { createMachineModule } from './machineModule';
import { createScheduleModule } from './scheduleModule';
import { createExecutionModule } from './executionModule';
import { createQualityModule } from './qualityModule';
import { createCostingModule } from './costingModule';

const T0 = '2026-09-03T00:00:00.000Z';
const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s73mf-${t}-${randomUUID()}.json`); paths.push(p); return p; };
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
    actor: () => 'production.op@np.dev', now: () => T0,
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; authorized = [];
  registry = new EnterpriseModuleRegistry();
  products = createProductModule(tmp('prod'));
  for (const m of [
    products,
    createStockMovementModule(tmp('mv')),
    createBomModule(tmp('bom')),
    createProductionOrderModule(tmp('mo')),
    createWorkCenterModule(tmp('wc')),
    createMachineModule(tmp('mc')),
    createScheduleModule(tmp('sch')),
    createExecutionModule(tmp('ex')),
    createQualityModule(tmp('qc')),
    createCostingModule(tmp('pc')),
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
const stockOf = (productId: string) => productFromRecord(products.store.get(productId) as EnterpriseEntity);
async function seedStock(sku: string, name: string, qty: number): Promise<string> {
  const p = await create('inventory-products', { sku, name, standardCost: 2 });
  await create('inventory-movements', { movementNumber: `SEED-${sku}`, type: 'receive', product: sku, warehouse: 'WH-1', quantity: qty, status: 'posted' });
  return p.record!.id;
}

describe('S73 · Manufacturing whole-user journey (Inventory Ledger is the source of truth)', () => {
  it('BOM → production order (plan→allocate→start→complete) → quality → costing', async () => {
    const comp1 = await seedStock('COMP-1', 'Bolt', 100);
    const comp2 = await seedStock('COMP-2', 'Frame', 100);
    const fg = await seedStock('FG-1', 'Finished Good', 0);

    await create('manufacturing-bom', {
      bomNumber: 'BOM-1', product: 'FG-1', yield: 100, status: 'active',
      components: JSON.stringify([{ sku: 'COMP-1', quantity: 2 }, { sku: 'COMP-2', quantity: 5 }]),
    });
    const mo = await create('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
    const moId = mo.record!.id;

    authorized = [];
    expect((await act('manufacturing-orders', moId, 'plan')).ok).toBe(true);
    expect((await act('manufacturing-orders', moId, 'allocate')).ok).toBe(true);
    expect(authorized).toContain('manufacturing:manage'); // action authority
    expect(authorized).toContain('inventory:manage');     // the reservation movement's authority
    // components reserved (2×10, 5×10), on-hand unchanged
    expect(stockOf(comp1)).toMatchObject({ currentStock: 100, reservedStock: 20 });
    expect(stockOf(comp2)).toMatchObject({ currentStock: 100, reservedStock: 50 });

    expect((await act('manufacturing-orders', moId, 'start')).ok).toBe(true);
    // components consumed and reservations released
    expect(stockOf(comp1)).toMatchObject({ currentStock: 80, reservedStock: 0 });
    expect(stockOf(comp2)).toMatchObject({ currentStock: 50, reservedStock: 0 });

    expect((await act('manufacturing-orders', moId, 'complete')).ok).toBe(true);
    expect(String(getRec('manufacturing-orders', moId).fields.status)).toBe('completed');
    // finished goods produced (10 output)
    expect(stockOf(fg).currentStock).toBe(10);

    // Quality inspection recorded for the run
    const qc = await create('manufacturing-quality', { inspectionNumber: 'QC-1', stage: 'final', inspectedQuantity: 10, passedQuantity: 9, failedQuantity: 1, reworkQuantity: 0, result: 'pass' });
    expect(qc.ok).toBe(true);

    // Costing recorded for the run
    const pc = await create('manufacturing-costing', { costNumber: 'PC-1', materialCost: 100, laborCost: 50, machineCost: 30, overheadCost: 20, standardCost: 180 });
    expect(pc.ok).toBe(true);
  });

  it('TENANT isolation: a production order created in tenant-B is invisible in tenant-A', async () => {
    await create('manufacturing-orders', { orderNumber: 'MO-A', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await create('manufacturing-orders', { orderNumber: 'MO-B', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 1 });
    const inB = (await listOf('manufacturing-orders')).map((r) => String(r.fields.orderNumber));
    expect(inB).toContain('MO-B');
    expect(inB).not.toContain('MO-A');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const inA = (await listOf('manufacturing-orders')).map((r) => String(r.fields.orderNumber));
    expect(inA).toContain('MO-A');
    expect(inA).not.toContain('MO-B');
  });
});
