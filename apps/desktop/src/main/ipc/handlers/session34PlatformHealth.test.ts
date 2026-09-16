/**
 * ERP Session 34 — governed platform health / readiness probe. A read-only operation over REAL
 * runtime + persistence state, answered on a READ branch of `platform:command.dispatch` (no command
 * bus, no journal.run, no mutation). Driven through the REAL `runSecureHandler`. Attacks the failure
 * cases — not just the healthy one — and proves the probe never mutates durable state.
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
import { buildPlatformCommandDispatchDef, type PlatformCommandDispatchDeps } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s34-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let journalPath: string;
let deliveredPath: string;
let journal: DurableCommandJournal;
let deliveredLog: DeliveredEventLog;
let currentPrincipal: Principal | null;
let runtimeReady: () => boolean;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function rebuildDef(opts: { withDelivered?: boolean; withConsumer?: boolean } = {}): void {
  const withDelivered = opts.withDelivered ?? true;
  const withConsumer = opts.withConsumer ?? true;
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  const consumer: OutboxConsumer = (event) => deliveredLog.record(event);
  const deps: PlatformCommandDispatchDeps = {
    registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal,
    runtimeReady: () => runtimeReady(),
    ...(withConsumer ? { outboxConsumer: consumer } : {}),
    ...(withDelivered ? { deliveredLog } : {}),
  };
  def = buildPlatformCommandDispatchDef(deps);
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = fullPrincipal();
  runtimeReady = () => true;
  journalPath = tmp('journal');
  deliveredPath = tmp('delivered');
  journal = new DurableCommandJournal(journalPath);
  deliveredLog = new DeliveredEventLog(deliveredPath);
  rebuildDef();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  await deliveredLog.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface Health {
  status: string; live: boolean; ready: boolean; checkedAt: string;
  components: { runtime: { status: string }; journal: { status: string }; delivery: { status: string; pendingOutbox: number | null } };
}
interface Resp { ok: boolean; data?: Health; error?: { code: string; message: string } }
const health = (claimedTenantId?: string): Promise<Resp> =>
  runSecureHandler(def, { operation: 'QueryPlatformHealth', payload: {}, idempotencyKey: 'h', ...(claimedTenantId ? { claimedTenantId } : {}) }, { isAuthenticated: () => true }) as Promise<Resp>;
const createOrder = (n: string, k: string): Promise<{ ok: boolean }> =>
  runSecureHandler(def, { operation: 'CreateSalesOrder', payload: { orderNumber: n, customer: 'Acme', total: 100 }, idempotencyKey: k }, { isAuthenticated: () => true }) as Promise<{ ok: boolean }>;

// ===========================================================================
// Healthy + readiness distinction
// ===========================================================================

describe('S34 · platform health/readiness', () => {
  it('HEALTHY when runtime is ready and persistence is operational', async () => {
    await createOrder('SO-1', 'k1'); // exercise the journal so the files exist
    const r = await health();
    expect(r.ok).toBe(true);
    const h = r.data!;
    expect(h.live).toBe(true);
    expect(h.ready).toBe(true);
    expect(h.status).toBe('HEALTHY');
    expect(h.components.runtime.status).toBe('ok');
    expect(['ok', 'first-run']).toContain(h.components.journal.status);
    expect(['ok', 'first-run']).toContain(h.components.delivery.status);
    expect(typeof h.checkedAt).toBe('string');
  });

  it('ALIVE_NOT_READY when the runtime is not yet initialized (live but not ready)', async () => {
    runtimeReady = () => false;
    const r = await health();
    const h = r.data!;
    expect(h.live).toBe(true);
    expect(h.ready).toBe(false);
    expect(h.status).toBe('ALIVE_NOT_READY');
    expect(h.components.runtime.status).toBe('not_ready');
  });

  it('UNHEALTHY when the durable journal file is CORRUPT (persistence failure not hidden)', async () => {
    await fs.writeFile(journalPath, 'this is not json', 'utf8'); // corrupt the backing file
    const r = await health();
    const h = r.data!;
    expect(h.components.journal.status).toBe('corrupt');
    expect(h.ready).toBe(false);
    expect(h.status).toBe('UNHEALTHY');
    // the probe must NOT quarantine/rename the corrupt file (health is read-only)
    expect(await fs.readFile(journalPath, 'utf8')).toBe('this is not json');
  });

  it('UNHEALTHY when the delivered-event sink file is CORRUPT', async () => {
    await fs.writeFile(deliveredPath, '{ broken', 'utf8');
    const r = await health();
    expect(r.data!.components.delivery.status).toBe('corrupt');
    expect(r.data!.status).toBe('UNHEALTHY');
  });

  it('a pending outbox backlog is a METRIC, not a readiness failure', async () => {
    // Sink present (delivery ok) but NO consumer wired → the command leaves a PENDING outbox entry.
    rebuildDef({ withConsumer: false });
    await createOrder('SO-p', 'p1');
    const r = await health();
    const h = r.data!;
    expect(['ok', 'first-run']).toContain(h.components.delivery.status); // sink itself is healthy
    expect(h.components.delivery.pendingOutbox).toBeGreaterThanOrEqual(1); // backlog surfaced as a METRIC
    expect(h.ready).toBe(true); // a delivery backlog does NOT make the platform not-ready
    expect(h.status).toBe('HEALTHY');
  });

  it('delivery reports not_ready when the sink is not wired at all', async () => {
    rebuildDef({ withDelivered: false, withConsumer: false });
    const r = await health();
    expect(r.data!.components.delivery.status).toBe('not_ready');
    expect(r.data!.ready).toBe(false);
  });
});

// ===========================================================================
// Security + no-mutation + concurrency + restart
// ===========================================================================

describe('S34 · security, no-mutation, concurrency, restart', () => {
  it('UNAUTHORIZED without operations:read', async () => {
    currentPrincipal = fullPrincipal({ permissions: ['sales:read'] });
    const r = await health();
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
  });

  it('UNAUTHENTICATED when no principal resolves', async () => {
    currentPrincipal = null;
    const r = await health();
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHENTICATED');
  });

  it('a forged tenant claim is rejected', async () => {
    const r = await health('tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('the health probe NEVER mutates durable state', async () => {
    await createOrder('SO-nm', 'nm');
    const recordsBefore = journal.records('tenant-A').length;
    const journalBytes = await fs.readFile(journalPath, 'utf8');
    for (let i = 0; i < 5; i += 1) await health();
    expect(journal.records('tenant-A').length).toBe(recordsBefore); // no records added
    expect(await fs.readFile(journalPath, 'utf8')).toBe(journalBytes); // journal file byte-identical
  });

  it('CONCURRENT health queries + a command in flight: all coherent, nothing mutated by reads', async () => {
    const before = journal.records('tenant-A').length;
    const results = await Promise.all([health(), createOrder('SO-c', 'c'), health(), health(), health()]);
    expect(results.every((r) => (r as Resp).ok !== false || (r as { ok: boolean }).ok !== false)).toBe(true);
    // exactly one write happened; the health reads added nothing
    expect(journal.records('tenant-A').length).toBe(before + 1);
  });

  it('RESTART then readiness check: healthy after reload', async () => {
    await createOrder('SO-r', 'r');
    await journal.reload();
    await deliveredLog.reload();
    rebuildDef();
    const r = await health();
    expect(r.data!.ready).toBe(true);
    expect(r.data!.status).toBe('HEALTHY');
  });
});
