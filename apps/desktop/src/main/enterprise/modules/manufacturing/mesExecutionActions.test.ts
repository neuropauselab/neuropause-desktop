import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  manufacturingEventFromRecord,
  mesExecutionFromRecord,
  productFromRecord,
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
import { createManufacturingEventModule } from './manufacturingEventModule';

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
let ledger: ReturnType<typeof createManufacturingEventModule>;

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
  ledger = createManufacturingEventModule(tmp('evt'));
  registry.register(ledger);
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
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as { ok: boolean; record?: EnterpriseEntity };
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
function eventTypes() {
  return ledger.store.list().map(manufacturingEventFromRecord).sort((a, b) => a.sequence - b.sequence).map((e) => e.eventType);
}
function ledgerEvents() {
  return ledger.store.list().map(manufacturingEventFromRecord).sort((a, b) => a.sequence - b.sequence);
}
function execList() {
  return executions.store.list().map(mesExecutionFromRecord).sort((a, b) => a.sequence - b.sequence);
}
function stockOf(productId: string) {
  return productFromRecord(products.store.get(productId) as EnterpriseEntity);
}

/** Seed a 2-operation committed schedule for MO-1 building FG-1 from C1×2. */
async function seedDispatchable(): Promise<{ orderId: string; fgId: string; c1: string }> {
  const c1p = await createIn('inventory-products', { sku: 'C1', name: 'C1', standardCost: 2 });
  await createIn('inventory-movements', { movementNumber: 'SEED-C1', type: 'receive', product: 'C1', warehouse: 'WH-1', quantity: 100, status: 'posted' });
  const fg = await createIn('inventory-products', { sku: 'FG-1', name: 'FG-1', standardCost: 5 });
  await createIn('manufacturing-bom', { bomNumber: 'BOM-1', product: 'FG-1', components: '[{"sku":"C1","quantity":2}]', status: 'active' });
  const order = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, status: 'planned' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-10', productionOrder: 'MO-1', workCenter: 'WC-CUT', machine: 'CNC-1', status: 'scheduled' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-20', productionOrder: 'MO-1', workCenter: 'WC-ASM', machine: 'ASM-1', status: 'scheduled' });
  await act('manufacturing-orders', order.record!.id, 'dispatchExecution');
  return { orderId: order.record!.id, fgId: fg.record!.id, c1: c1p.record!.id };
}

describe('MES — no operation may execute without an approved, committed schedule', () => {
  it('refuses to start a hand-created execution with no committed schedule, but starts a dispatched one', async () => {
    // A hand-created execution with no `schedule` reference can never be started on the floor.
    const orphan = await createIn('manufacturing-executions', {
      executionNumber: 'EX-ORPHAN',
      productionOrder: 'MO-ORPHAN',
      status: 'dispatched',
      machine: 'CNC-9',
      plannedQuantity: 5,
    });
    const blocked = await act('manufacturing-executions', orphan.record!.id, 'start');
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/no committed Production Schedule/i);
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', orphan.record!.id)).status).toBe('dispatched');
    // No start event was appended for the orphan.
    expect(eventTypes()).not.toContain('operation_started');

    // A dispatched execution (schedule stamped by dispatch) starts normally.
    await seedDispatchable();
    const first = execList().filter((e) => e.productionOrder === 'MO-1')[0];
    expect(first.schedule).not.toBe('');
    const started = await act('manufacturing-executions', first.id, 'start');
    expect(started.ok).toBe(true);
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).status).toBe('running');
  });
});

describe('MES — operator assignment is a first-class, ledgered action', () => {
  it('assigns an operator and appends operator_assigned; refuses with no operator set', async () => {
    await seedDispatchable();
    const [first] = execList();
    // No operator set yet → refused.
    const refused = await act('manufacturing-executions', first.id, 'assignOperator');
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/Set an operator/i);

    await updateIn('manufacturing-executions', first.id, { operator: 'Dana' });
    const assigned = await act('manufacturing-executions', first.id, 'assignOperator');
    expect(assigned.ok).toBe(true);
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).operator).toBe('Dana');
    expect(eventTypes()).toContain('operator_assigned');
    expect(rec.authorized).toContain('manufacturing:manage'); // the event went through the RBAC gate
  });
});

describe('MES — scrap material records a ledger event without touching stock', () => {
  it('appends scrap_recorded with the quantity and never posts a stock movement itself', async () => {
    const { fgId, c1 } = await seedDispatchable();
    const [first] = execList();
    await act('manufacturing-executions', first.id, 'start'); // first-op backflush: C1 100 → 80
    expect(stockOf(c1).currentStock).toBe(80);

    // Scrap with no quantity is refused.
    const empty = await act('manufacturing-executions', first.id, 'scrap');
    expect(empty.ok).toBe(false);

    await updateIn('manufacturing-executions', first.id, { scrapQuantity: 3, scrapReason: 'burr' });
    const scrapped = await act('manufacturing-executions', first.id, 'scrap');
    expect(scrapped.ok).toBe(true);
    const evt = ledgerEvents().find((e) => e.eventType === 'scrap_recorded');
    expect(evt?.quantity).toBe(3);
    expect(evt?.reason).toBe('burr');
    // The scrap ACTION moves no stock: components unchanged, finished goods still zero (final op open).
    expect(stockOf(c1).currentStock).toBe(80);
    expect(stockOf(fgId).currentStock).toBe(0);
    // The operation keeps running — scrap is telemetry, not a lifecycle transition.
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).status).toBe('running');
  });
});

describe('MES — quality hold and rework are distinct, ledgered lifecycle transitions', () => {
  it('places a quality hold (distinct from a machine block) and resumes it', async () => {
    await seedDispatchable();
    const [first] = execList();
    await act('manufacturing-executions', first.id, 'start');
    const held = await act('manufacturing-executions', first.id, 'qualityHold');
    expect(held.ok).toBe(true);
    const onHold = mesExecutionFromRecord(await getRec('manufacturing-executions', first.id));
    expect(onHold).toMatchObject({ status: 'blocked', blockedReason: 'Quality hold', inspectionResult: 'pending' });
    expect(eventTypes()).toContain('downtime_started');

    const resumed = await act('manufacturing-executions', first.id, 'resume');
    expect(resumed.ok).toBe(true);
    const back = mesExecutionFromRecord(await getRec('manufacturing-executions', first.id));
    expect(back.status).toBe('running');
    expect(back.blockedReason).toBe('');
    expect(eventTypes()).toContain('downtime_ended');
  });

  it('reworks a failed operation back to running with the rework quantity accrued', async () => {
    await seedDispatchable();
    const [first] = execList();
    await act('manufacturing-executions', first.id, 'start');
    await act('manufacturing-executions', first.id, 'inspect'); // running → inspection
    await act('manufacturing-executions', first.id, 'inspectFail'); // inspection → blocked
    expect(mesExecutionFromRecord(await getRec('manufacturing-executions', first.id)).status).toBe('blocked');

    await updateIn('manufacturing-executions', first.id, { reworkQuantity: 2 });
    const reworked = await act('manufacturing-executions', first.id, 'rework');
    expect(reworked.ok).toBe(true);
    const e = mesExecutionFromRecord(await getRec('manufacturing-executions', first.id));
    expect(e).toMatchObject({ status: 'running', inspectionResult: 'rework', reworkQuantity: 2, blockedReason: '' });
    expect(eventTypes()).toContain('operation_resumed');
  });
});
