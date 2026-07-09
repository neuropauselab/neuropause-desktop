import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  deriveEventInsights,
  manufacturingEventFromRecord,
  mesExecutionFromRecord,
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
  registry.register(createProductModule(tmp('prod')));
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
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
}
function events() {
  return ledger.store.list().map(manufacturingEventFromRecord).sort((a, b) => a.sequence - b.sequence);
}
function execList() {
  return executions.store.list().map(mesExecutionFromRecord).sort((a, b) => a.sequence - b.sequence);
}

async function seedAndDispatch(): Promise<string> {
  await createIn('inventory-products', { sku: 'C1', name: 'C1', standardCost: 2 });
  await createIn('inventory-movements', { movementNumber: 'SEED-C1', type: 'receive', product: 'C1', warehouse: 'WH-1', quantity: 100, status: 'posted' });
  await createIn('inventory-products', { sku: 'FG-1', name: 'FG-1', standardCost: 5 });
  await createIn('manufacturing-bom', { bomNumber: 'BOM-1', product: 'FG-1', components: '[{"sku":"C1","quantity":2}]', status: 'active' });
  const order = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, status: 'planned' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-10', productionOrder: 'MO-1', workCenter: 'WC-CUT', machine: 'CNC-1', status: 'scheduled' });
  await createIn('manufacturing-schedules', { scheduleNumber: 'SCH-MO-1-20', productionOrder: 'MO-1', workCenter: 'WC-ASM', machine: 'ASM-1', status: 'scheduled' });
  await act('manufacturing-orders', order.record!.id, 'dispatchExecution');
  return order.record!.id;
}

describe('Shop-Floor Event Ledger — lifecycle actions append immutable events', () => {
  it('dispatch and execution actions each append the right event, in monotonic sequence', async () => {
    await seedAndDispatch();
    // Dispatch appended one operation_released per committed operation.
    expect(events().filter((e) => e.eventType === 'operation_released')).toHaveLength(2);

    const [first] = execList();
    await act('manufacturing-executions', first.id, 'start'); // machine_started + material_issued + operation_started
    await act('manufacturing-executions', first.id, 'pause'); // operation_paused

    const log = events();
    expect(log.map((e) => e.eventType)).toEqual([
      'operation_released',
      'operation_released',
      'machine_started',
      'material_issued',
      'operation_started',
      'operation_paused',
    ]);
    // Append-only: contiguous monotonic sequence, every event stamped + attributed.
    expect(log.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(log.every((e) => e.timestamp !== '' && e.user === 'tester@np.dev')).toBe(true);
    // The events flowed through the RBAC gate (manufacturing:manage) and the derived KPIs read them.
    expect(rec.authorized).toContain('manufacturing:manage');
    expect(deriveEventInsights(log, Date.parse(T0)).eventThroughput).toBe(6);
  });

  it('completing the final operation appends completion + finished-goods + order-closed events', async () => {
    await seedAndDispatch();
    const [first, last] = execList();
    await act('manufacturing-executions', first.id, 'start');
    await act('manufacturing-executions', first.id, 'complete');
    await act('manufacturing-executions', last.id, 'start');
    await act('manufacturing-executions', last.id, 'complete'); // final op

    const types = events().map((e) => e.eventType);
    expect(types).toContain('operation_completed');
    expect(types).toContain('finished_goods_posted');
    expect(types).toContain('order_closed');
    // The finished-goods event carries the produced quantity (derived, not entered).
    const fg = events().find((e) => e.eventType === 'finished_goods_posted');
    expect(fg?.quantity).toBe(10);
  });
});
