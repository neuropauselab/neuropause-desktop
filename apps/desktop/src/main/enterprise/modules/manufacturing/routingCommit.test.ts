import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  productionScheduleFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createProductionOrderModule } from './productionOrderModule';
import { createMachineModule } from './machineModule';
import { createScheduleModule } from './scheduleModule';
import { createRoutingModule } from './routingModule';

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
let schedules: ReturnType<typeof createScheduleModule>;

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
  registry.register(createProductionOrderModule(tmp('mo')));
  registry.register(createMachineModule(tmp('mc')));
  schedules = createScheduleModule(tmp('sch'));
  registry.register(schedules);
  registry.register(createRoutingModule(tmp('route')));
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

const OPS_JSON =
  '[{"sequence":10,"operation":"Cutting","workCenter":"WC-CUT","eligibleMachines":["CNC-1"],"setupTime":2,"runTimePerUnit":0.1,"transferTime":1},' +
  '{"sequence":20,"operation":"Assembly","workCenter":"WC-ASM","eligibleMachines":["ASM-1"],"setupTime":1,"runTimePerUnit":0.2,"inspectionTime":1}]';

async function seedRoutingScenario(): Promise<string> {
  await createIn('manufacturing-routings', { routingNumber: 'ROUTE-1', product: 'FG-1', operations: OPS_JSON, status: 'active' });
  await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-CNC', workCenter: 'WC-CUT', runtime: 50, downtime: 50, status: 'running' });
  await createIn('manufacturing-machines', { name: 'ASM-1', code: 'MC-ASM', workCenter: 'WC-ASM', runtime: 50, downtime: 50, status: 'running' });
  const created = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
  return created.record!.id;
}

describe('Commit Schedule — routing plan → real Production Schedule records', () => {
  it('creates one Production Schedule record per scheduled operation, on its qualified machine', async () => {
    const orderId = await seedRoutingScenario();
    const result = await act('manufacturing-orders', orderId, 'commitSchedule');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/2 scheduled operation\(s\).*ROUTE-1/);

    const recs = schedules.store.list().map(productionScheduleFromRecord);
    expect(recs).toHaveLength(2);
    const cut = recs.find((r) => r.machine === 'CNC-1');
    const asm = recs.find((r) => r.machine === 'ASM-1');
    expect(cut).toMatchObject({ productionOrder: 'MO-1', workCenter: 'WC-CUT', status: 'scheduled', scheduleNumber: 'SCH-MO-1-10' });
    expect(asm).toMatchObject({ productionOrder: 'MO-1', workCenter: 'WC-ASM', status: 'scheduled', scheduleNumber: 'SCH-MO-1-20' });

    // The order is stamped so the commit is auditable + idempotent.
    const order = await getRec('manufacturing-orders', orderId);
    expect(String(order.fields.scheduleCommitted).split(',').filter(Boolean)).toHaveLength(2);
    // The write went through the RBAC gate (manufacturing:manage).
    expect(rec.authorized).toContain('manufacturing:manage');
  });

  it('refuses a second commit (idempotent) and never double-writes schedules', async () => {
    const orderId = await seedRoutingScenario();
    await act('manufacturing-orders', orderId, 'commitSchedule');
    const second = await act('manufacturing-orders', orderId, 'commitSchedule');
    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already been committed/);
    expect(schedules.store.list()).toHaveLength(2); // still just the first commit's records
  });

  it('does not commit when the product has no active routing', async () => {
    await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-CNC', workCenter: 'WC-CUT', runtime: 50, downtime: 50, status: 'running' });
    const created = await createIn('manufacturing-orders', { orderNumber: 'MO-2', bom: 'BOM-2', product: 'NO-ROUTE', warehouse: 'WH-1', productionQuantity: 5 });
    const result = await act('manufacturing-orders', created.record!.id, 'commitSchedule');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No active routing/);
    expect(schedules.store.list()).toHaveLength(0);
  });
});
