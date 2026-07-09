import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  scheduleProposalFromRecord,
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
import { createScheduleProposalModule } from './scheduleProposalModule';

const T0 = '2026-07-08T00:00:00.000Z';
const PROPOSALS = 'manufacturing-schedule-proposals';

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
let proposals: ReturnType<typeof createScheduleProposalModule>;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'planner@np.dev',
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
  proposals = createScheduleProposalModule(tmp('prop'));
  registry.register(proposals);
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
async function update(moduleId: string, id: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields })) as { ok: boolean };
}
function listProposals() {
  return proposals.store.list().map(scheduleProposalFromRecord);
}

const OPS_JSON =
  '[{"sequence":10,"operation":"Cutting","workCenter":"WC-CUT","eligibleMachines":["CNC-1"],"setupTime":2,"runTimePerUnit":0.1,"transferTime":1},' +
  '{"sequence":20,"operation":"Assembly","workCenter":"WC-ASM","eligibleMachines":["ASM-1"],"setupTime":1,"runTimePerUnit":0.2,"inspectionTime":1}]';

async function seed(opts: { cncStatus?: string } = {}): Promise<string> {
  await createIn('manufacturing-routings', { routingNumber: 'ROUTE-1', product: 'FG-1', operations: OPS_JSON, status: 'active' });
  await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-CNC', workCenter: 'WC-CUT', runtime: 50, downtime: 50, status: opts.cncStatus ?? 'running' });
  await createIn('manufacturing-machines', { name: 'ASM-1', code: 'MC-ASM', workCenter: 'WC-ASM', runtime: 50, downtime: 50, status: 'running' });
  const created = await createIn('manufacturing-orders', { orderNumber: 'MO-1', bom: 'BOM-1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10 });
  return created.record!.id;
}

describe('Schedule Proposal — read-only propose → approve → commit governance', () => {
  it('proposes a read-only schedule and commits NO records until approved + committed', async () => {
    const orderId = await seed();
    const proposed = await act('manufacturing-orders', orderId, 'proposeSchedule');
    expect(proposed.ok).toBe(true);
    expect(rec.authorized).toContain('manufacturing:manage'); // RBAC gate

    const props = listProposals();
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ productionOrder: 'MO-1', version: 1, status: 'proposed', scheduledOps: 2, blockedOps: 0 });
    // Read-only: proposing writes NO Production Schedule records.
    expect(schedules.store.list()).toHaveLength(0);

    // Commit before approval is refused (must pass approval before persistence).
    expect((await act(PROPOSALS, props[0].id, 'commit')).ok).toBe(false);
    expect(schedules.store.list()).toHaveLength(0);

    // Approve → commit creates the real Production Schedule records + stamps the order.
    expect((await act(PROPOSALS, props[0].id, 'approve')).ok).toBe(true);
    const committed = await act(PROPOSALS, props[0].id, 'commit');
    expect(committed.ok).toBe(true);
    expect(schedules.store.list()).toHaveLength(2);
    expect(listProposals()[0]).toMatchObject({ status: 'committed', committedBy: 'planner@np.dev' });

    // Committing again is refused (the order is already committed) — never double-writes.
    const second = await act(PROPOSALS, props[0].id, 'commit');
    expect(second.ok).toBe(false);
    expect(schedules.store.list()).toHaveLength(2);
  });

  it('reject requires a reason and blocks commit', async () => {
    const orderId = await seed();
    await act('manufacturing-orders', orderId, 'proposeSchedule');
    const id = listProposals()[0].id;
    expect((await act(PROPOSALS, id, 'reject')).ok).toBe(false); // no reason
    await update(PROPOSALS, id, { rejectionReason: 'Capacity reserved for a priority order.' });
    expect((await act(PROPOSALS, id, 'reject')).ok).toBe(true);
    expect(listProposals()[0].status).toBe('rejected');
    expect((await act(PROPOSALS, id, 'commit')).ok).toBe(false); // cannot commit a rejected proposal
  });

  it('recalculate supersedes the current proposal and mints the next version', async () => {
    const orderId = await seed();
    await act('manufacturing-orders', orderId, 'proposeSchedule');
    const v1 = listProposals()[0];
    expect((await act(PROPOSALS, v1.id, 'recalculate')).ok).toBe(true);
    const all = listProposals();
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === v1.id)!.status).toBe('superseded');
    expect(all.some((p) => p.version === 2 && p.status === 'proposed')).toBe(true);
  });

  it('maintenance / down machines block routing — the blocked operation is reflected in the proposal', async () => {
    const orderId = await seed({ cncStatus: 'down' }); // the Cutting machine is down
    expect((await act('manufacturing-orders', orderId, 'proposeSchedule')).ok).toBe(true);
    const p = listProposals()[0];
    expect(p.blockedOps).toBeGreaterThanOrEqual(1); // Cutting cannot be scheduled on a down machine
    expect(p.operations.find((o) => o.operation === 'Cutting')?.scheduled).toBe(false);
  });

  it('does not propose when the product has no active routing', async () => {
    await createIn('manufacturing-machines', { name: 'CNC-1', code: 'MC-CNC', workCenter: 'WC-CUT', runtime: 50, downtime: 50, status: 'running' });
    const created = await createIn('manufacturing-orders', { orderNumber: 'MO-9', bom: 'BOM-9', product: 'NO-ROUTE', warehouse: 'WH-1', productionQuantity: 5 });
    const res = await act('manufacturing-orders', created.record!.id, 'proposeSchedule');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/No active routing/);
    expect(listProposals()).toHaveLength(0);
  });
});
