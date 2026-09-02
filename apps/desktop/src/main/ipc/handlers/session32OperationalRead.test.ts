/**
 * ERP Session 32 — governed operational READ surface. A tenant-safe, bounded, sanitized read over the
 * EXISTING durable command journal + the S31 delivered-event sink, answered on a READ branch of the
 * `platform:command.dispatch` handler that NEVER enters the command bus / journal.run (no fake
 * transaction, no event, no outbox write). Driven here through the REAL `runSecureHandler`.
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
  const p = join(tmpdir(), `np-s32-${tag}-${randomUUID()}.json`);
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
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function rebuildDef(): void {
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  const consumer: OutboxConsumer = (event) => deliveredLog.record(event);
  def = buildPlatformCommandDispatchDef({
    registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal, outboxConsumer: consumer, deliveredLog,
  });
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

interface Resp { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }
async function call(operation: string, payload: Record<string, unknown>, idem: string, claimedTenantId?: string): Promise<Resp> {
  return (await runSecureHandler(
    def,
    { operation, payload, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as Resp;
}
const read = (payload: Record<string, unknown> = {}, idem = 'r', claimedTenantId?: string) => call('QueryOperationalHistory', payload, idem, claimedTenantId);
const createOrder = (orderNumber: string, idem: string) => call('CreateSalesOrder', { orderNumber, customer: 'Acme', total: 100 }, idem);

// ===========================================================================
// Happy path + read model
// ===========================================================================

describe('S32 · governed operational read surface', () => {
  it('returns tenant-scoped command history + outbox status + delivered-event status', async () => {
    await createOrder('SO-1', 'k1');
    await createOrder('SO-2', 'k2');
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(true);
    const d = r.data!;
    expect((d.counts as { commands: number }).commands).toBe(2);
    expect((d.commands as unknown[]).length).toBe(2);
    const first = (d.commands as Record<string, unknown>[])[0];
    expect(first.commandType).toBe('CreateSalesOrder');
    expect((first.outbox as { status: string }).status).toBe('DELIVERED');
    expect((d.counts as { delivered: number }).delivered).toBe(2);
    expect((d.counts as { pendingOutbox: number }).pendingOutbox).toBe(0);
  });

  it('SANITIZED: never leaks raw command payloads, event detail, or secret-shaped fields', async () => {
    await createOrder('SO-s', 's1');
    const r = await read({ limit: 10 });
    const blob = JSON.stringify(r.data);
    expect(blob).not.toMatch(/"result"/);
    expect(blob).not.toMatch(/"detail"/);
    expect(blob).not.toMatch(/password|token|secret|credential/i);
    // it DOES expose operator-safe fields
    expect(blob).toMatch(/txId|commandType|committedAt/);
  });

  it('empty history reads safely (counts zero, no crash)', async () => {
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(true);
    expect((r.data!.counts as { commands: number }).commands).toBe(0);
    expect((r.data!.commands as unknown[]).length).toBe(0);
  });
});

// ===========================================================================
// Attack
// ===========================================================================

describe('S32 · attack', () => {
  it('UNAUTHORIZED without operations:read', async () => {
    await createOrder('SO-z', 'z1');
    currentPrincipal = fullPrincipal({ permissions: ['sales:read', 'sales:manage'] });
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
  });

  it('UNAUTHENTICATED when no principal resolves', async () => {
    currentPrincipal = null;
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHENTICATED');
  });

  it('CROSS-TENANT: tenant-A read cannot see tenant-B commands', async () => {
    await createOrder('SO-A', 'a1');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = fullPrincipal();
    rebuildDef();
    await createOrder('SO-B', 'b1');
    // read as tenant-A
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    rebuildDef();
    const r = await read({ limit: 50 });
    expect((r.data!.counts as { commands: number }).commands).toBe(1);
    const cmds = r.data!.commands as Record<string, unknown>[];
    expect(cmds.every((c) => String(c.txId).length > 0)).toBe(true);
    expect(JSON.stringify(r.data)).not.toMatch(/SO-B|tenant-B/);
  });

  it('FORGED tenant id is rejected (TENANT_SCOPE_VIOLATION)', async () => {
    await createOrder('SO-f', 'f1');
    const r = await read({ limit: 10 }, 'r', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('MALFORMED status filter fails closed', async () => {
    await createOrder('SO-m', 'm1');
    const r = await read({ outboxStatus: 'NONSENSE' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
  });

  it('OVERSIZED / unbounded pagination is clamped (never returns everything unbounded)', async () => {
    for (let i = 0; i < 5; i += 1) await createOrder(`SO-p${i}`, `p${i}`);
    const huge = await read({ limit: 999999 });
    expect(huge.ok).toBe(true);
    expect(huge.data!.limit).toBe(100); // clamped to MAX
    const noLimit = await read({});
    expect(noLimit.data!.limit).toBe(25); // default bound, never "everything"
  });

  it('a valid status filter narrows results (DELIVERED vs PENDING)', async () => {
    await createOrder('SO-d', 'd1'); // delivered
    const delivered = await read({ outboxStatus: 'DELIVERED', limit: 50 });
    expect((delivered.data!.commands as unknown[]).length).toBe(1);
    const pending = await read({ outboxStatus: 'PENDING', limit: 50 });
    expect((pending.data!.commands as unknown[]).length).toBe(0);
  });
});

// ===========================================================================
// Concurrency + restart
// ===========================================================================

describe('S32 · concurrency + restart', () => {
  it('CONCURRENT reads are safe, deterministic, and NEVER mutate the journal', async () => {
    // Populate sequentially (concurrent WRITES are a separate, pre-existing DurableJsonStore
    // concurrency limit — see the S32 evidence RED gate — and out of scope for the read surface).
    await createOrder('SO-c1', 'c1');
    await createOrder('SO-c2', 'c2');
    await createOrder('SO-c3', 'c3');
    const before = journal.records('tenant-A').length;
    // Many concurrent reads — the read is pure, so this must never race, throw, or mutate.
    const reads = await Promise.all(Array.from({ length: 8 }, (_, i) => read({ limit: 50 }, `rc${i}`)));
    for (const r of reads) {
      expect(r.ok).toBe(true);
      expect((r.data!.counts as { commands: number }).commands).toBe(3); // deterministic snapshot
    }
    // reads mutated nothing: record count + outbox state unchanged
    expect(journal.records('tenant-A').length).toBe(before);
    expect(journal.pendingOutbox('tenant-A').length).toBe(0);
  });

  it('RESTART: history + delivery status survive a reload and remain readable', async () => {
    await createOrder('SO-r', 'r1');
    await journal.reload();
    await deliveredLog.reload();
    rebuildDef();
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(true);
    expect((r.data!.counts as { commands: number }).commands).toBe(1);
    expect((r.data!.counts as { delivered: number }).delivered).toBe(1);
    expect((r.data!.commands as Record<string, unknown>[])[0].commandType).toBe('CreateSalesOrder');
  });
});
