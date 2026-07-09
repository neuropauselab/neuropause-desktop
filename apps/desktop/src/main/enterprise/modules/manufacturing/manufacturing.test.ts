import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateCapacityUtilization,
  calculateManufacturingCost,
  calculateMachineUtilization,
  calculateOverallEquipmentEffectiveness,
  calculateProductionEfficiency,
  calculateProductionHealth,
  calculateProductionVariance,
  calculateProductionYield,
  calculateQualityScore,
  calculateScrapRate,
  componentConsumption,
  deriveManufacturingInsights,
  manufacturingInsightsToKpis,
  movementFromRecord,
  parseBomComponents,
  productFromRecord,
  type EnterprisePermission,
  type EnterpriseEntity,
  type Machine,
  type PlatformEventInput,
  type ProductionCosting,
  type ProductionOrder,
  type QualityInspection,
  type WorkCenter,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
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

const T0 = '2026-07-08T00:00:00.000Z';

function order(p: Partial<ProductionOrder> = {}): ProductionOrder {
  return { id: 'o1', orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, actualQuantity: 10, scrapQuantity: 0, workCenter: '', machine: '', operator: '', productionTime: 0, status: 'completed', consumptionMovements: '', outputMovement: '', createdAt: T0, updatedAt: T0, ...p };
}
function machine(p: Partial<Machine> = {}): Machine {
  return { id: 'm1', name: 'CNC', code: 'MC-1', workCenter: 'WC-1', runtime: 80, downtime: 20, maintenanceDue: '', status: 'running', ...p };
}
function quality(p: Partial<QualityInspection> = {}): QualityInspection {
  return { id: 'q1', inspectionNumber: 'QC-1', productionOrder: 'MO-1', stage: 'final', inspectedQuantity: 10, passedQuantity: 10, failedQuantity: 0, reworkQuantity: 0, result: 'pass', qualityScore: 100, inspector: '', status: 'inspected', ...p };
}
function costing(p: Partial<ProductionCosting> = {}): ProductionCosting {
  return { id: 'c1', costNumber: 'PC-1', productionOrder: 'MO-1', materialCost: 100, laborCost: 50, machineCost: 30, overheadCost: 20, totalCost: 200, standardCost: 180, variance: 20, status: 'finalized', ...p };
}
function workCenter(p: Partial<WorkCenter> = {}): WorkCenter {
  return { id: 'w1', name: 'WC', code: 'WC-1', capacity: 100, efficiency: 100, shift: 'day', queueLoad: 50, status: 'active', ...p };
}

/* ── deterministic business logic ── */

describe('deterministic manufacturing functions', () => {
  it('efficiency, yield, scrap, utilization, capacity, cost, variance, quality, OEE', () => {
    expect(calculateProductionEfficiency(100, 90)).toBe(90);
    expect(calculateProductionYield(90, 10)).toBe(90);
    expect(calculateScrapRate(90, 10)).toBe(10);
    expect(calculateMachineUtilization(80, 100)).toBe(80);
    expect(calculateCapacityUtilization(50, 100)).toBe(50);
    expect(calculateManufacturingCost({ materialCost: 100, laborCost: 50, machineCost: 30, overheadCost: 20 })).toBe(200);
    expect(calculateProductionVariance(180, 200)).toBe(20);
    expect(calculateQualityScore({ passedQuantity: 8, failedQuantity: 1, reworkQuantity: 1 })).toBe(85); // (8 + 0.5)/10
    expect(calculateOverallEquipmentEffectiveness(90, 90, 90)).toBe(73); // 0.9^3
  });
  it('production health bands', () => {
    expect(calculateProductionHealth({ efficiency: 95, scrapRate: 2, qualityScore: 95, oee: 80 }).level).toBe('low');
    expect(calculateProductionHealth({ efficiency: 95, scrapRate: 2, qualityScore: 70, oee: 80 }).level).toBe('high');
    expect(calculateProductionHealth({ efficiency: 95, scrapRate: 15, qualityScore: 95, oee: 80 }).level).toBe('high');
  });
  it('parses BOM components + scales consumption with waste', () => {
    const parsed = parseBomComponents('[{"sku":"A","quantity":2},{"sku":"","quantity":3},{"sku":"B","quantity":0},{"sku":"C","quantity":4,"waste":25}]');
    expect(parsed.map((c) => c.sku)).toEqual(['A', 'C']); // blank sku + zero qty dropped
    expect(parseBomComponents('not json')).toEqual([]);
    expect(componentConsumption({ sku: 'A', quantity: 2, waste: 0, alternative: '' }, 10, 0)).toBe(20);
    expect(componentConsumption({ sku: 'C', quantity: 4, waste: 25, alternative: '' }, 10, 0)).toBe(50); // +25% waste
  });
});

describe('deriveManufacturingInsights + KPIs', () => {
  it('rolls production records into the ten KPIs', () => {
    const insights = deriveManufacturingInsights({
      orders: [order()],
      machines: [machine()],
      qualityInspections: [quality()],
      costings: [costing()],
      workCenters: [workCenter()],
    });
    expect(insights).toMatchObject({
      productionEfficiency: 100,
      productionThroughput: 10,
      manufacturingCost: 200,
      machineUtilization: 80,
      oee: 80, // availability 80 × efficiency 100 × quality 100
      scrapRate: 0,
      yield: 100,
      qualityScore: 100,
      openProductionOrders: 0,
    });
    expect(manufacturingInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'mfg-efficiency',
      'mfg-throughput',
      'mfg-cost',
      'mfg-machine-util',
      'mfg-oee',
      'mfg-scrap',
      'mfg-yield',
      'mfg-accuracy',
      'mfg-quality',
      'mfg-health',
    ]);
  });
});

/* ── modules + the critical BOM → production → inventory ledger integration ── */

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
let movements: ReturnType<typeof createStockMovementModule>;

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
  movements = createStockMovementModule(tmp('mv'));
  registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(movements);
  registry.register(createBomModule(tmp('bom')));
  registry.register(createProductionOrderModule(tmp('mo')));
  registry.register(createWorkCenterModule(tmp('wc')));
  registry.register(createMachineModule(tmp('mc')));
  registry.register(createScheduleModule(tmp('sch')));
  registry.register(createExecutionModule(tmp('ex')));
  registry.register(createQualityModule(tmp('qc')));
  registry.register(createCostingModule(tmp('pc')));
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
function stockOf(productId: string) {
  return productFromRecord(products.store.get(productId) as EnterpriseEntity);
}
async function seedStock(sku: string, name: string, qty: number): Promise<string> {
  const p = await createIn('inventory-products', { sku, name, standardCost: 2 });
  await createIn('inventory-movements', { movementNumber: `SEED-${sku}`, type: 'receive', product: sku, warehouse: 'WH-1', quantity: qty, status: 'posted' });
  return p.record?.id as string;
}

describe('Production Order → BOM-driven consumption + output movements (Inventory is the source of truth)', () => {
  it('allocate reserves, start consumes each component, complete yields finished goods', async () => {
    const comp1Id = await seedStock('COMP-1', 'Bolt', 100);
    const comp2Id = await seedStock('COMP-2', 'Nut', 100);
    const fgId = await seedStock('FG-1', 'Assembly', 0);
    expect(stockOf(comp1Id).currentStock).toBe(100);

    await createIn('manufacturing-bom', {
      bomNumber: 'BOM-1',
      product: 'FG-1',
      yield: 100,
      status: 'active',
      components: JSON.stringify([{ sku: 'COMP-1', quantity: 2 }, { sku: 'COMP-2', quantity: 5 }]),
    });

    const mo = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
    const moId = mo.record?.id as string;

    expect((await act('manufacturing-orders', moId, 'plan')).ok).toBe(true);

    rec.authorized.length = 0;
    expect((await act('manufacturing-orders', moId, 'allocate')).ok).toBe(true);
    // defense in depth: the action needs manufacturing:manage AND the reservation needs inventory:manage
    expect(rec.authorized).toContain('manufacturing:manage');
    expect(rec.authorized).toContain('inventory:manage');
    // components reserved (2×10 and 5×10), on-hand unchanged
    expect(stockOf(comp1Id)).toMatchObject({ currentStock: 100, reservedStock: 20 });
    expect(stockOf(comp2Id)).toMatchObject({ currentStock: 100, reservedStock: 50 });

    expect((await act('manufacturing-orders', moId, 'start')).ok).toBe(true);
    // components consumed and reservations released
    expect(stockOf(comp1Id)).toMatchObject({ currentStock: 80, reservedStock: 0 });
    expect(stockOf(comp2Id)).toMatchObject({ currentStock: 50, reservedStock: 0 });

    expect((await act('manufacturing-orders', moId, 'complete')).ok).toBe(true);
    // finished goods produced into inventory
    expect(stockOf(fgId).currentStock).toBe(10);

    // real movements of the correct production types
    const moves = movements.store.list().map(movementFromRecord);
    expect(moves.filter((m) => m.type === 'production_consumption')).toHaveLength(2);
    expect(moves.filter((m) => m.type === 'production_output')).toHaveLength(1);

    const moRec = await getRec('manufacturing-orders', moId);
    expect(moRec.fields.status).toBe('completed');
    expect(String(moRec.fields.outputMovement)).toMatch(/^rec_/);
    expect(moRec.fields.actualQuantity).toBe(10);
    // timeline: consumption/output movements created + products reconciled
    expect(rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:inventory-movements')).toBe(true);
    expect(rec.publish.some((e) => e.type === 'enterprise.record.updated' && e.source === 'enterprise:inventory-products')).toBe(true);
  });

  it('rejects allocation when the BOM is missing', async () => {
    const mo = await createIn('manufacturing-orders', { orderNumber: 'MO-2', bom: 'NOPE', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 5 });
    const moId = mo.record?.id as string;
    await act('manufacturing-orders', moId, 'plan');
    const res = await act('manufacturing-orders', moId, 'allocate');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });

  it('a yield below 100% produces fewer finished goods', async () => {
    await seedStock('COMP-1', 'Bolt', 100);
    const fgId = await seedStock('FG-2', 'Widget', 0);
    await createIn('manufacturing-bom', { bomNumber: 'BOM-2', product: 'FG-2', yield: 90, status: 'active', components: JSON.stringify([{ sku: 'COMP-1', quantity: 1 }]) });
    const mo = await createIn('manufacturing-orders', { orderNumber: 'MO-3', bom: 'BOM-2', product: 'FG-2', warehouse: 'WH-1', productionQuantity: 100 });
    const moId = mo.record?.id as string;
    await act('manufacturing-orders', moId, 'plan');
    await act('manufacturing-orders', moId, 'allocate');
    await act('manufacturing-orders', moId, 'start');
    await act('manufacturing-orders', moId, 'complete');
    expect(stockOf(fgId).currentStock).toBe(90); // 100 × 90% yield
  });
});

describe('Quality + Costing stamp deterministic values', () => {
  it('quality inspection stamps the quality score; costing stamps total + variance', async () => {
    const qc = await createIn('manufacturing-quality', { inspectionNumber: 'QC-1', stage: 'final', inspectedQuantity: 10, passedQuantity: 8, failedQuantity: 1, reworkQuantity: 1, result: 'pass' });
    expect(qc.record?.fields.qualityScore).toBe(85);

    const pc = await createIn('manufacturing-costing', { costNumber: 'PC-1', materialCost: 100, laborCost: 50, machineCost: 30, overheadCost: 20, standardCost: 180 });
    expect(pc.record?.fields.totalCost).toBe(200);
    expect(pc.record?.fields.variance).toBe(20);
  });
});

describe('RBAC + AI summary surfaces', () => {
  it('reads authorize manufacturing:read; writes authorize manufacturing:manage', async () => {
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'manufacturing-bom' });
    expect(rec.authorized).toEqual(['manufacturing:read']);
    rec.authorized.length = 0;
    await createIn('manufacturing-work-centers', { name: 'Line 1', capacity: 100 });
    expect(rec.authorized).toContain('manufacturing:manage');
  });

  it('orders / quality / costing / machines expose aiSummary; BOM + work centers do not', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{ id: string; aiSummary: boolean }>;
    const ai = (id: string) => summaries.find((s) => s.id === id)?.aiSummary;
    expect(ai('manufacturing-orders')).toBe(true);
    expect(ai('manufacturing-quality')).toBe(true);
    expect(ai('manufacturing-costing')).toBe(true);
    expect(ai('manufacturing-machines')).toBe(true);
    expect(ai('manufacturing-bom')).toBe(false);
    expect(ai('manufacturing-work-centers')).toBe(false);
  });
});
