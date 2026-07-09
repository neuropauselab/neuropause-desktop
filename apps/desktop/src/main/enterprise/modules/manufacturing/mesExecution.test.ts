import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  mesExecutionFromRecord,
  productFromRecord,
  productionOrderFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createBomModule } from './bomModule';
import { createProductionOrderModule } from './productionOrderModule';
import { createScheduleModule } from './scheduleModule';
import { createExecutionModule } from './executionModule';

const T0 = '2026-07-08T00:00:00.000Z';

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
let executions: ReturnType<typeof createExecutionModule>;

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
  registry = new EnterpriseModuleRegistry();
  products = createProductModule(tmp('prod'));
  registry.register(products);
  registry.register(createStockMovementModule(tmp('mv')));
  registry.register(createBomModule(tmp('bom')));
  registry.register(createProductionOrderModule(tmp('mo')));
  registry.register(createScheduleModule(tmp('sch')));
  executions = createExecutionModule(tmp('ex'));
  registry.register(executions);
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
async function updateIn(moduleId: string, id: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields })) as { ok: boolean };
}
function getRec(moduleId: string, id: string) {
  return handler(IpcChannel.EnterpriseModuleGet)({ moduleId, id }) as Promise<EnterpriseEntity>;
}
function stockOf(productId: string) {
  return productFromRecord(products.store.get(productId) as EnterpriseEntity);
}
async function seedStock(sku: string, qty: number): Promise<string> {
  const p = await createIn('inventory-products', { sku, name: sku, standardCost: 2 });
  if (qty > 0) await createIn('inventory-movements', { movementNumber: `SEED-${sku}`, type: 'receive', product: sku, warehouse: 'WH-1', quantity: qty, status: 'posted' });
  return p.record!.id;
}

/** Seed a 2-operation committed schedule for MO-1 building FG-1 from C1×2 + C2×3. */
async function seedDispatchable(): Promise<{ orderId: string; fgId: string; c1: string; c2: string }> {
  const c1 = await seedStock('C1', 100);
  const c2 = await seedStock('C2', 100);
  const fgId = await seedStock('FG-1', 0);
  await createIn('manufacturing-bom', { bomNumber: 'BOM-1', product: 'FG-1', components: '[{"sku":"C1","quantity":2},{"sku":"C2","quantity":3}]', status: 'active' });
  const order = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, status: 'planned' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-10', productionOrder: 'MO-1', workCenter: 'WC-CUT', machine: 'CNC-1', status: 'scheduled' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-20', productionOrder: 'MO-1', workCenter: 'WC-ASM', machine: 'ASM-1', status: 'scheduled' });
  return { orderId: order.record!.id, fgId, c1, c2 };
}

function execList() {
  return executions.store.list().map(mesExecutionFromRecord).sort((a, b) => a.sequence - b.sequence);
}

describe('MES — dispatch a committed schedule into shop-floor execution', () => {
  it('creates one execution per committed operation, flagging first + final', async () => {
    const { orderId } = await seedDispatchable();
    const result = await act('manufacturing-orders', orderId, 'dispatchExecution');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Dispatched 2 operation\(s\)/);
    const ops = execList();
    expect(ops.map((o) => o.sequence)).toEqual([10, 20]);
    expect(ops[0]).toMatchObject({ status: 'dispatched', firstOperation: true, finalOperation: false, machine: 'CNC-1', workCenter: 'WC-CUT' });
    expect(ops[1]).toMatchObject({ firstOperation: false, finalOperation: true, machine: 'ASM-1' });
    // Idempotent: a second dispatch is refused and creates nothing new.
    const second = await act('manufacturing-orders', orderId, 'dispatchExecution');
    expect(second.ok).toBe(false);
    expect(execList()).toHaveLength(2);
  });

  it('will not dispatch without a committed schedule', async () => {
    await seedStock('FG-9', 0);
    const order = await createIn('manufacturing-orders', { orderNumber: 'MO-9', bom: 'BOM-9', product: 'FG-9', warehouse: 'WH-1', productionQuantity: 5, status: 'planned' });
    const result = await act('manufacturing-orders', order.record!.id, 'dispatchExecution');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No committed schedule/);
  });
});

describe('MES — execution consumes and produces through the Inventory Ledger', () => {
  it('backflushes components on the first operation and yields finished goods on the last', async () => {
    const { orderId, fgId, c1, c2 } = await seedDispatchable();
    await act('manufacturing-orders', orderId, 'dispatchExecution');
    const [first, last] = execList();

    // Start the first operation → consume BOM components (2×10 of C1, 3×10 of C2) via the ledger.
    const started = await act('manufacturing-executions', first.id, 'start');
    expect(started.ok).toBe(true);
    expect(stockOf(c1).currentStock).toBe(80);
    expect(stockOf(c2).currentStock).toBe(70);
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).materialMovements).not.toBe('');
    await act('manufacturing-executions', first.id, 'complete'); // non-final: no stock effect

    // Start + complete the final operation → finished goods posted; production order completed.
    await act('manufacturing-executions', last.id, 'start');
    const done = await act('manufacturing-executions', last.id, 'complete');
    expect(done.ok).toBe(true);
    expect(stockOf(fgId).currentStock).toBe(10); // 10 good units produced
    expect(productionOrderFromRecord(await getRec('manufacturing-orders', orderId))).toMatchObject({ status: 'completed', actualQuantity: 10 });
    expect(rec.authorized).toContain('inventory:manage'); // stock writes went through the RBAC gate
  });

  it('writes off scrap as a real inventory movement (produce all, then scrap out)', async () => {
    const { orderId, fgId } = await seedDispatchable();
    await act('manufacturing-orders', orderId, 'dispatchExecution');
    const [first, last] = execList();
    await act('manufacturing-executions', first.id, 'start');
    await act('manufacturing-executions', first.id, 'complete');
    await act('manufacturing-executions', last.id, 'start');
    await updateIn('manufacturing-executions', last.id, { scrapQuantity: 2, scrapReason: 'tooling' });
    const done = await act('manufacturing-executions', last.id, 'complete');
    expect(done.ok).toBe(true);
    // Output +10 then scrap adjustment −2 → net 8 good finished units.
    expect(stockOf(fgId).currentStock).toBe(8);
    const e = mesExecutionFromRecord(await getRec('manufacturing-executions', last.id));
    expect(e).toMatchObject({ status: 'completed', goodQuantity: 8 });
    expect(e.outputMovement).not.toBe('');
    expect(e.scrapMovement).not.toBe('');
  });

  it('blocks and resumes an operation without touching stock', async () => {
    const { orderId, c1 } = await seedDispatchable();
    await act('manufacturing-orders', orderId, 'dispatchExecution');
    const [first] = execList();
    await act('manufacturing-executions', first.id, 'start'); // consumes once
    expect(stockOf(c1).currentStock).toBe(80);
    await act('manufacturing-executions', first.id, 'block');
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).status).toBe('blocked');
    const resumed = await act('manufacturing-executions', first.id, 'resume');
    expect(resumed.ok).toBe(true);
    // Resuming does not re-consume material (materialMovements already recorded).
    expect(stockOf(c1).currentStock).toBe(80);
  });
});
