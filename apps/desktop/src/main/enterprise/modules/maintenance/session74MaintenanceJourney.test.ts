/**
 * ERP S74 — MAINTENANCE WHOLE-USER JOURNEY through the real maintenance + inventory +
 * machine modules, with the Inventory Ledger as the single source of truth for parts.
 *
 * CORRECTIVE path:
 *   Asset + Machine → Corrective fault → raiseWorkOrder (fault → in_progress, WO created) →
 *   assign a technician → assign (machine → maintenance) → start → complete → verify
 *   (machine → running + immutable Maintenance History created, cost captured) →
 *   Spare-part consume (real Inventory Ledger stock issue).
 *
 * PREVENTIVE path:
 *   Plan → Preventive task → raiseWorkOrder → WO lifecycle → verified + history.
 *
 * The per-capability proofs (WO lifecycle → machine status + history, spare-part → real
 * inventory consumption, PM/CM raiseWorkOrder idempotency, RBAC) already live in
 * maintenance.test.ts; this pin proves the SAME modules end-to-end as one user journey and
 * adds illegal-mutation negatives + cross-tenant isolation.
 *
 * ACCOUNTING BOUNDARY (STOPPED, memo'd): a spare-part consumption posts a real Inventory
 * Ledger movement (stock drops) but NO GL journal — maintenance cost → GL (repairs/maintenance
 * expense vs capex, WO labor/parts cost posting) is UNDEFINED and is NOT driven here and NOT
 * invented. See DECISION-MEMO-S74-MAINTENANCE-COST-ACCOUNTING.md.
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
import { createMachineModule } from '../manufacturing/machineModule';
import { createAssetCategoryModule } from './assetCategoryModule';
import { createAssetModule } from './assetModule';
import { createMaintenancePlanModule } from './maintenancePlanModule';
import { createPreventiveMaintenanceModule } from './preventiveMaintenanceModule';
import { createCorrectiveMaintenanceModule } from './correctiveMaintenanceModule';
import { createWorkOrderModule } from './workOrderModule';
import { createTechnicianModule } from './technicianModule';
import { createMaintenanceHistoryModule } from './maintenanceHistoryModule';
import { createSparePartModule } from './sparePartModule';
import { createDowntimeEventModule } from './downtimeEventModule';

const T0 = '2026-09-03T00:00:00.000Z';
const paths: string[] = [];
const tmp = (t: string) => { const p = join(tmpdir(), `np-s74-${t}-${randomUUID()}.json`); paths.push(p); return p; };
let scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
let authorized: EnterprisePermission[] = [];
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let products: ReturnType<typeof createProductModule>;
let machines: ReturnType<typeof createMachineModule>;

function moduleCtx() {
  return {
    authorize: (p: EnterprisePermission) => authorized.push(p),
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined,
    actor: () => 'maint.op@np.dev', now: () => T0,
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; authorized = [];
  registry = new EnterpriseModuleRegistry();
  products = createProductModule(tmp('prod'));
  machines = createMachineModule(tmp('mc'));
  for (const m of [
    products,
    createStockMovementModule(tmp('mv')),
    machines,
    createAssetCategoryModule(tmp('cat')),
    createAssetModule(tmp('ast')),
    createMaintenancePlanModule(tmp('plan')),
    createPreventiveMaintenanceModule(tmp('pm')),
    createCorrectiveMaintenanceModule(tmp('cm')),
    createWorkOrderModule(tmp('wo')),
    createTechnicianModule(tmp('tech')),
    createMaintenanceHistoryModule(tmp('hist')),
    createSparePartModule(tmp('sp')),
    createDowntimeEventModule(tmp('dt')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const create = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: unknown }>;
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const act = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const getRec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id) as EnterpriseEntity;
const listOf = (moduleId: string) => H(IpcChannel.EnterpriseModuleList)({ moduleId }) as Promise<EnterpriseEntity[]>;
const machineRec = (id: string) => registry.get('manufacturing-machines')!.store.get(id) as EnterpriseEntity;
const stock = (productId: string) => productFromRecord(products.store.get(productId) as EnterpriseEntity).currentStock;

describe('S74 · Maintenance whole-user journey (corrective)', () => {
  it('fault → raiseWorkOrder → assign→start→complete→verify → machine restored + history + spare-part stock issue', async () => {
    // Master data
    await create('maintenance-asset-categories', { name: 'CNC Machines' });
    const asset = await create('maintenance-assets', { assetTag: 'AST-1', name: 'CNC-1 Asset', category: 'CNC Machines' });
    expect(asset.ok).toBe(true);
    const mc = await create('manufacturing-machines', { name: 'CNC-1', code: 'MC-1', runtime: 100, downtime: 0, status: 'running' });
    const mcId = mc.record!.id;

    // Corrective fault → raise a governed work order (fault → in_progress)
    const cm = await create('maintenance-corrective', { cmNumber: 'CM-1', asset: 'AST-1', machine: 'CNC-1', faultDescription: 'Bearing seized' });
    const cmId = cm.record!.id;
    expect((await act('maintenance-corrective', cmId, 'raiseWorkOrder')).ok).toBe(true);
    expect(String(getRec('maintenance-corrective', cmId).fields.status)).toBe('in_progress');
    const wo = (await listOf('maintenance-work-orders'))[0];
    expect(wo.fields).toMatchObject({ workOrderNumber: 'WO-CM-1', type: 'corrective' });
    // second raise is idempotent (no duplicate WO)
    expect((await act('maintenance-corrective', cmId, 'raiseWorkOrder')).ok).toBe(false);
    expect(await listOf('maintenance-work-orders')).toHaveLength(1);

    // Planner assigns a technician + cost estimate, then runs the lifecycle
    await update('maintenance-work-orders', wo.id, { technician: 'Sam', laborCost: 200, partsCost: 100, downtimeHours: 4 });
    authorized = [];
    expect((await act('maintenance-work-orders', wo.id, 'assign')).ok).toBe(true);
    expect(authorized).toContain('maintenance:manage');
    expect(String(machineRec(mcId).fields.status)).toBe('maintenance'); // machine taken out of service
    expect((await act('maintenance-work-orders', wo.id, 'start')).ok).toBe(true);

    // ILLEGAL: cannot verify before completing
    const earlyVerify = await act('maintenance-work-orders', wo.id, 'verify');
    expect(earlyVerify.ok).toBe(false);
    expect(String(earlyVerify.message)).toMatch(/complete the work order before verifying/i);

    expect((await act('maintenance-work-orders', wo.id, 'complete')).ok).toBe(true);
    // ILLEGAL: duplicate completion refused
    expect((await act('maintenance-work-orders', wo.id, 'complete')).ok).toBe(false);
    expect((await act('maintenance-work-orders', wo.id, 'verify')).ok).toBe(true);

    // machine restored + immutable history created with captured cost
    expect(String(machineRec(mcId).fields.status)).toBe('running');
    const history = await listOf('maintenance-history');
    expect(history).toHaveLength(1);
    expect(history[0].fields).toMatchObject({ workOrder: wo.id, totalCost: 300, downtimeHours: 4 });
    expect(String(getRec('maintenance-work-orders', wo.id).fields.status)).toBe('verified');

    // Spare-part consumption → REAL Inventory Ledger stock issue
    await create('inventory-products', { sku: 'BEARING', name: 'Bearing', standardCost: 5 });
    const prodId = (products.store.list().find((r) => r.fields.sku === 'BEARING') as EnterpriseEntity).id;
    await create('inventory-movements', { movementNumber: 'SEED-1', type: 'receive', product: 'BEARING', warehouse: 'WH-1', quantity: 50, status: 'posted' });
    expect(stock(prodId)).toBe(50);
    const sp = await create('maintenance-spare-parts', { partNumber: 'SP-1', workOrder: 'WO-CM-1', product: 'BEARING', warehouse: 'WH-1', quantity: 5, unitCost: 5 });
    authorized = [];
    expect((await act('maintenance-spare-parts', sp.record!.id, 'consume')).ok).toBe(true);
    expect(authorized).toContain('inventory:manage'); // ledger seam re-authorizes (defense in depth)
    expect(stock(prodId)).toBe(45);
    // ILLEGAL: duplicate consumption refused (no double stock issue)
    const again = await act('maintenance-spare-parts', sp.record!.id, 'consume');
    expect(again.ok).toBe(false);
    expect(String(again.message)).toMatch(/already been consumed/i);
    expect(stock(prodId)).toBe(45);
  });

  it('assigning a work order without a technician is refused', async () => {
    const wo = await create('maintenance-work-orders', { workOrderNumber: 'WO-X', type: 'corrective', machine: 'CNC-1' });
    const res = await act('maintenance-work-orders', wo.record!.id, 'assign');
    expect(res.ok).toBe(false);
    expect(String(res.message)).toMatch(/technician/i);
  });
});

describe('S74 · Maintenance whole-user journey (preventive)', () => {
  it('plan → preventive task → raiseWorkOrder → lifecycle → verified + history', async () => {
    await create('manufacturing-machines', { name: 'CNC-2', code: 'MC-2', runtime: 100, downtime: 0, status: 'running' });
    await create('maintenance-plans', { planNumber: 'MP-1', name: 'Quarterly service', machine: 'CNC-2' });
    const pm = await create('maintenance-preventive', { pmNumber: 'PM-1', plan: 'MP-1', machine: 'CNC-2', scheduledDate: '2026-09-01', status: 'scheduled' });
    expect((await act('maintenance-preventive', pm.record!.id, 'raiseWorkOrder')).ok).toBe(true);
    const wo = (await listOf('maintenance-work-orders')).find((r) => String(r.fields.type) === 'preventive')!;
    expect(wo).toBeDefined();
    await update('maintenance-work-orders', wo.id, { technician: 'Lee', laborCost: 50, partsCost: 0 });
    for (const a of ['assign', 'start', 'complete', 'verify']) expect((await act('maintenance-work-orders', wo.id, a)).ok).toBe(true);
    expect(String(getRec('maintenance-work-orders', wo.id).fields.status)).toBe('verified');
    expect((await listOf('maintenance-history')).some((h) => h.fields.workOrder === wo.id)).toBe(true);
  });
});

describe('S74 · Maintenance tenant isolation', () => {
  it('a work order created in tenant-B is invisible in tenant-A', async () => {
    await create('maintenance-work-orders', { workOrderNumber: 'WO-A', type: 'corrective', machine: 'CNC-1' });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await create('maintenance-work-orders', { workOrderNumber: 'WO-B', type: 'corrective', machine: 'CNC-1' });
    const inB = (await listOf('maintenance-work-orders')).map((r) => String(r.fields.workOrderNumber));
    expect(inB).toContain('WO-B');
    expect(inB).not.toContain('WO-A');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const inA = (await listOf('maintenance-work-orders')).map((r) => String(r.fields.workOrderNumber));
    expect(inA).toContain('WO-A');
    expect(inA).not.toContain('WO-B');
  });
});
