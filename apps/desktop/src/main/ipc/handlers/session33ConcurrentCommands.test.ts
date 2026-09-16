/**
 * ERP Session 33 — the payoff of the DurableJsonStore fix on the REAL governed path. Before S33,
 * concurrent governed commands (different idempotency keys) failed ~7/8 with ENOENT because their
 * journal commits raced on the shared temp file. After the per-store write serialization, concurrent
 * commands all commit, all deliver, and the operational read + restart stay correct. Driven through
 * the REAL `runSecureHandler` + REAL command bus + REAL durable journal + S31 sink.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { type EnterprisePermission, type PlatformEventInput, type TenantScope } from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { DeliveredEventLog } from '../../platform/command/deliveredEventLog';
import type { OutboxConsumer } from '../../platform/command/outboxDispatcher';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s33-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let deliveredLog: DeliveredEventLog;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
const fullPrincipal = (): Principal => ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS });

function rebuildDef(): void {
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  const consumer: OutboxConsumer = (event) => deliveredLog.record(event);
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal, outboxConsumer: consumer, deliveredLog });
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = fullPrincipal();
  journal = new DurableCommandJournal(tmp('journal'));
  deliveredLog = new DeliveredEventLog(tmp('delivered'));
  rebuildDef();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  await deliveredLog.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface Resp { ok: boolean; data?: Record<string, unknown>; replayed?: boolean; error?: { code: string; message: string } }
const call = (operation: string, payload: Record<string, unknown>, idem: string): Promise<Resp> =>
  runSecureHandler(def, { operation, payload, idempotencyKey: idem }, { isAuthenticated: () => true }) as Promise<Resp>;
const createOrder = (n: string, k: string) => call('CreateSalesOrder', { orderNumber: n, customer: 'Acme', total: 100 }, k);
const read = () => call('QueryOperationalHistory', { limit: 50 }, 'r');

async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

describe('S33 · concurrent governed commands (the DurableJsonStore fix payoff)', () => {
  for (const N of [2, 8, 12]) {
    it(`${N} concurrent CreateSalesOrder (different keys): ALL commit, ALL deliver, none lost`, async () => {
      const results = await Promise.all(Array.from({ length: N }, (_, i) => createOrder(`SO-${i}`, `k${i}`)));
      expect(results.every((r) => r.ok)).toBe(true); // no ENOENT / phantom failure (was ~1/8 before S33)
      expect(journal.records('tenant-A')).toHaveLength(N); // every commit durable
      await flushUntil(() => deliveredLog.count('tenant-A') >= N);
      expect(deliveredLog.count('tenant-A')).toBe(N); // every event delivered
    });
  }

  it('concurrent commands + concurrent operational reads: all writes ok, all reads coherent', async () => {
    const ops = await Promise.all([
      createOrder('SO-a', 'a'), read(),
      createOrder('SO-b', 'b'), read(),
      createOrder('SO-c', 'c'), read(),
    ]);
    expect(ops.every((r) => r.ok)).toBe(true);
    expect(journal.records('tenant-A')).toHaveLength(3);
    const final = await read();
    expect((final.data!.counts as { commands: number }).commands).toBe(3);
  });

  it('restart after concurrent commands recovers the exact committed set', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => createOrder(`SO-${i}`, `k${i}`)));
    await journal.reload();
    await deliveredLog.reload();
    expect(journal.records('tenant-A')).toHaveLength(12);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0); // all DELIVERED, persisted
    expect(deliveredLog.count('tenant-A')).toBe(12);
  });

  it('concurrent DIRECT journal.run (different keys) all commit durably', async () => {
    const j = new DurableCommandJournal(tmp('j2'));
    const runs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      j.run({
        tenantId: 'tenant-A', idempotencyKey: `d${i}`, commandId: `c${i}`, commandType: 'CreateSalesOrder',
        correlationId: `corr${i}`, causationId: `c${i}`, actor: 'op', source: 'test',
        execute: async () => ({ ok: true as const, data: { id: `x${i}` }, aggregateId: `x${i}`, aggregateType: 'SalesOrder' }),
      }),
    ));
    expect(runs.every((r) => r.ok)).toBe(true);
    expect(j.records('tenant-A')).toHaveLength(8);
    await j.reload();
    expect(j.records('tenant-A')).toHaveLength(8); // durable after restart
    await j.destroy().catch(() => undefined);
  });
});
