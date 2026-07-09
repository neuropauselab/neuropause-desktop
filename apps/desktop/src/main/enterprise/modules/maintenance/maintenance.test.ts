import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateAssetHealth,
  calculateDowntime,
  calculateMTBF,
  calculateMTTR,
  calculateMachineAvailability,
  calculateMaintenanceBacklog,
  calculateMaintenanceCompliance,
  calculateMaintenanceCost,
  calculateMaintenanceRisk,
  calculateServiceEfficiency,
  calculateMachineUtilization,
  deriveMaintenanceInsights,
  machineFromRecord,
  maintenanceInsightsToKpis,
  productFromRecord,
  type Asset,
  type DowntimeEvent,
  type EnterprisePermission,
  type EnterpriseEntity,
  type Machine,
  type PlatformEventInput,
  type PreventiveMaintenance,
  type Technician,
  type WorkOrder,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
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

const T0 = '2026-07-08T00:00:00.000Z';

function machine(p: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'CNC-1', code: 'MC-1', workCenter: 'WC-1', runtime: 90, downtime: 30, maintenanceDue: '', status: 'running', ...p };
}
function asset(p: Partial<Asset> = {}): Asset {
  return { id: 'a1', assetTag: 'AST-1', name: 'Mill', category: 'Equipment', location: 'Floor', machine: 'CNC-1', criticality: 'high', purchaseCost: 10000, purchaseDate: '', breakdownCount: 0, status: 'operational', ...p };
}
function workOrder(p: Partial<WorkOrder> = {}): WorkOrder {
  return { id: 'w1', workOrderNumber: 'WO-1', type: 'corrective', machine: 'CNC-1', asset: 'AST-1', technician: 'Sam', priority: 'high', description: '', scheduledDate: '2026-07-08', completedDate: '2026-07-08', downtimeHours: 4, laborCost: 200, partsCost: 100, result: 'pass', status: 'verified', historyRecord: '', createdAt: T0, updatedAt: T0, ...p };
}
function preventive(p: Partial<PreventiveMaintenance> = {}): PreventiveMaintenance {
  return { id: 'p1', pmNumber: 'PM-1', plan: 'MP-1', asset: 'AST-1', machine: 'CNC-1', scheduledDate: '', completedDate: '', status: 'completed', workOrder: '', ...p };
}
function downtime(p: Partial<DowntimeEvent> = {}): DowntimeEvent {
  return { id: 'd1', eventNumber: 'DT-1', machine: 'CNC-1', type: 'unplanned', cause: 'Bearing', startTime: '', endTime: '', durationHours: 20, workOrder: '', status: 'logged', ...p };
}
function technician(p: Partial<Technician> = {}): Technician {
  return { id: 't1', name: 'Sam', code: 'TECH-1', skill: 'Mechanical', shift: 'day', assignedOrders: 1, status: 'busy', ...p };
}

/* ── deterministic business logic ── */

describe('deterministic maintenance functions', () => {
  it('downtime, MTBF, MTTR, compliance, cost, service efficiency, backlog', () => {
    expect(calculateDowntime([{ durationHours: 2 }, { durationHours: 3 }])).toBe(5);
    expect(calculateMTBF(1000, 4)).toBe(250);
    expect(calculateMTTR(20, 4)).toBe(5);
    expect(calculateMaintenanceCompliance(8, 10)).toBe(80);
    expect(calculateMaintenanceCost([{ laborCost: 200, partsCost: 100 }])).toBe(300);
    expect(calculateServiceEfficiency(8, 10)).toBe(80);
    expect(calculateMaintenanceBacklog([{ status: 'scheduled' }, { status: 'completed' }, { status: 'assigned' }])).toBe(2);
    expect(calculateMachineAvailability(90, 10)).toBe(90); // reused from Manufacturing
  });
  it('asset health + maintenance risk', () => {
    expect(calculateAssetHealth({ status: 'operational', breakdownCount: 0, criticality: 'low' }).level).toBe('low');
    expect(calculateAssetHealth({ status: 'maintenance', breakdownCount: 0, criticality: 'low' }).level).toBe('high');
    expect(calculateAssetHealth({ status: 'operational', breakdownCount: 5, criticality: 'low' }).level).toBe('high');
    expect(calculateMaintenanceRisk({ criticality: 'critical', breakdownCount: 0, status: 'operational' }, 0)).toBe(45);
    expect(calculateMaintenanceRisk({ criticality: 'critical', breakdownCount: 0, status: 'operational' }, 100)).toBe(65);
  });
});

describe('deriveMaintenanceInsights + KPIs', () => {
  it('rolls maintenance records into the ten KPIs', () => {
    const insights = deriveMaintenanceInsights({
      machines: [machine({ runtime: 90, downtime: 30 })],
      assets: [asset()],
      workOrders: [workOrder()],
      preventives: [preventive()],
      downtimeEvents: [downtime()],
      technicians: [technician()],
    });
    expect(insights).toMatchObject({
      machineAvailability: 75, // 90 / (90+30)
      maintenanceCompliance: 100, // 1 completed of 1 scheduled
      breakdownRate: 100, // 1 unplanned of 1
      maintenanceCost: 300,
      downtimeHours: 20,
      technicianUtilization: 100, // 1 busy of 1
    });
    expect(maintenanceInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'mnt-availability',
      'mnt-compliance',
      'mnt-preventive',
      'mnt-breakdown',
      'mnt-cost',
      'mnt-downtime',
      'mnt-asset-health',
      'mnt-tech-util',
      'mnt-service',
      'mnt-health',
    ]);
  });
});

/* ── modules + the critical maintenance → machine → Manufacturing-KPI integration ── */

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
let machines: ReturnType<typeof createMachineModule>;

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
  machines = createMachineModule(tmp('mc'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(createStockMovementModule(tmp('mv')));
  registry.register(machines);
  registry.register(createAssetCategoryModule(tmp('cat')));
  registry.register(createAssetModule(tmp('ast')));
  registry.register(createMaintenancePlanModule(tmp('plan')));
  registry.register(createPreventiveMaintenanceModule(tmp('pm')));
  registry.register(createCorrectiveMaintenanceModule(tmp('cm')));
  registry.register(createWorkOrderModule(tmp('wo')));
  registry.register(createTechnicianModule(tmp('tech')));
  registry.register(createMaintenanceHistoryModule(tmp('hist')));
  registry.register(createSparePartModule(tmp('sp')));
  registry.register(createDowntimeEventModule(tmp('dt')));
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
function getRec(moduleId: string, id: string) {
  return handler(IpcChannel.EnterpriseModuleGet)({ moduleId, id }) as Promise<EnterpriseEntity>;
}
async function listOf(moduleId: string): Promise<EnterpriseEntity[]> {
  return (await handler(IpcChannel.EnterpriseModuleList)({ moduleId })) as EnterpriseEntity[];
}
function machineRec(id: string): Machine {
  return machineFromRecord(machines.store.get(id) as EnterpriseEntity);
}

describe('Downtime Event → authoritative machine → Manufacturing KPI (real downtime)', () => {
  it('logging downtime writes the machine and lowers the Manufacturing availability metric', async () => {
    const mc = await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-1', runtime: 90, downtime: 10, status: 'running' });
    const mcId = mc.record?.id as string;
    // Manufacturing availability BEFORE any maintenance downtime.
    expect(calculateMachineUtilization(90, 90 + 10)).toBe(90);

    const dt = await createIn('maintenance-downtime', { eventNumber: 'DT-1', machine: 'CNC-1', type: 'unplanned', cause: 'Bearing', durationHours: 20 });
    const dtId = dt.record?.id as string;

    rec.authorized.length = 0;
    expect((await act('maintenance-downtime', dtId, 'log')).ok).toBe(true);
    // defense in depth: writing the authoritative machine needs manufacturing:manage
    expect(rec.authorized).toContain('maintenance:manage');
    expect(rec.authorized).toContain('manufacturing:manage');

    // the AUTHORITATIVE machine record now carries the real downtime + breakdown status
    const m = machineRec(mcId);
    expect(m.downtime).toBe(30); // 10 + 20
    expect(m.status).toBe('breakdown');
    // Manufacturing's own KPI derives from the updated machine: 90 → 75
    expect(calculateMachineUtilization(m.runtime, m.runtime + m.downtime)).toBe(75);

    // logging again is idempotent (downtime not double-counted)
    const again = await act('maintenance-downtime', dtId, 'log');
    expect(again.ok).toBe(false);
    expect(machineRec(mcId).downtime).toBe(30);
  });
});

describe('Work Order lifecycle → machine status + Maintenance History', () => {
  it('assign puts the machine into maintenance; verify restores it and records history', async () => {
    const mc = await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-1', runtime: 100, downtime: 0, status: 'running' });
    const mcId = mc.record?.id as string;

    const wo = await createIn('maintenance-work-orders', { workOrderNumber: 'WO-1', type: 'corrective', machine: 'CNC-1', technician: 'Sam', laborCost: 200, partsCost: 100, downtimeHours: 4, scheduledDate: '2026-07-08' });
    const woId = wo.record?.id as string;

    expect((await act('maintenance-work-orders', woId, 'assign')).ok).toBe(true);
    expect(machineRec(mcId).status).toBe('maintenance');
    expect((await act('maintenance-work-orders', woId, 'start')).ok).toBe(true);
    expect((await act('maintenance-work-orders', woId, 'complete')).ok).toBe(true);
    expect((await act('maintenance-work-orders', woId, 'verify')).ok).toBe(true);

    // machine restored to service
    expect(machineRec(mcId).status).toBe('running');
    // a REAL maintenance history record was created from the verified work order
    const history = await listOf('maintenance-history');
    expect(history).toHaveLength(1);
    expect(history[0].fields).toMatchObject({ workOrder: woId, totalCost: 300, downtimeHours: 4 });
    const woRec = await getRec('maintenance-work-orders', woId);
    expect(woRec.fields.status).toBe('verified');
    expect(String(woRec.fields.historyRecord)).toMatch(/^rec_/);
  });

  it('assigning without a technician is rejected', async () => {
    const wo = await createIn('maintenance-work-orders', { workOrderNumber: 'WO-2', type: 'corrective', machine: 'CNC-1' });
    const res = await act('maintenance-work-orders', wo.record?.id as string, 'assign');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/technician/i);
  });
});

describe('Spare Part → real inventory consumption (Inventory Ledger)', () => {
  it('consuming a spare part posts a production_consumption movement and drops stock', async () => {
    const prod = await createIn('inventory-products', { sku: 'BEARING', name: 'Bearing', standardCost: 5 });
    const prodId = prod.record?.id as string;
    await createIn('inventory-movements', { movementNumber: 'SEED-1', type: 'receive', product: 'BEARING', warehouse: 'WH-1', quantity: 50, status: 'posted' });
    expect(productFromRecord(products.store.get(prodId) as EnterpriseEntity).currentStock).toBe(50);

    const sp = await createIn('maintenance-spare-parts', { partNumber: 'SP-1', workOrder: 'WO-1', product: 'BEARING', warehouse: 'WH-1', quantity: 5, unitCost: 5 });
    const spId = sp.record?.id as string;

    rec.authorized.length = 0;
    expect((await act('maintenance-spare-parts', spId, 'consume')).ok).toBe(true);
    expect(rec.authorized).toContain('inventory:manage'); // the ledger seam re-authorizes
    expect(productFromRecord(products.store.get(prodId) as EnterpriseEntity).currentStock).toBe(45); // 50 − 5
    expect(String((await getRec('maintenance-spare-parts', spId)).fields.consumptionMovement)).toMatch(/^rec_/);

    const again = await act('maintenance-spare-parts', spId, 'consume');
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been consumed/i);
  });
});

describe('RBAC + AI summary surfaces', () => {
  it('reads authorize maintenance:read; writes authorize maintenance:manage', async () => {
    rec.authorized.length = 0;
    await listOf('maintenance-assets');
    expect(rec.authorized).toEqual(['maintenance:read']);
    rec.authorized.length = 0;
    await createIn('maintenance-technicians', { name: 'Sam' });
    expect(rec.authorized).toContain('maintenance:manage');
  });

  it('work orders / assets / downtime expose aiSummary; categories + technicians do not', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{ id: string; aiSummary: boolean }>;
    const ai = (id: string) => summaries.find((s) => s.id === id)?.aiSummary;
    expect(ai('maintenance-work-orders')).toBe(true);
    expect(ai('maintenance-assets')).toBe(true);
    expect(ai('maintenance-downtime')).toBe(true);
    expect(ai('maintenance-asset-categories')).toBe(false);
    expect(ai('maintenance-technicians')).toBe(false);
  });
});
