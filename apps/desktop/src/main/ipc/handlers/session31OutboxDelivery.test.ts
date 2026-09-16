/**
 * ERP Session 31 — production outbox delivery relay (production-readiness track).
 *
 * Before S31 the durable command journal committed a PENDING outbox entry on every governed write,
 * but `dispatchOutbox` (the at-least-once relay) had ONLY test callers — in production the outbox was
 * written and never drained. S31 wires the relay into the live composition seam with a durable,
 * tenant-scoped, idempotent sink (`DeliveredEventLog`). This suite drives the REAL `runSecureHandler`
 * + REAL command bus + REAL durable journal and attacks the delivery guarantee.
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

import {
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { DeliveredEventLog } from '../../platform/command/deliveredEventLog';
import { dispatchOutbox, type OutboxConsumer } from '../../platform/command/outboxDispatcher';
import type { DomainEvent } from '../../platform/command/domainCommand';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s31-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let journal: DurableCommandJournal;
let deliveredLog: DeliveredEventLog;
let currentPrincipal: Principal | null;
let deliveredEvents: DomainEvent[];
let consumer: OutboxConsumer;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function buildDef(over: { outboxConsumer?: OutboxConsumer | undefined } = {}) {
  const registryLocal = new EnterpriseModuleRegistry();
  registryLocal.register(createOrderModule(tmp('so')));
  registryLocal.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registryLocal, moduleCtx()); // warm the handlers path
  return buildPlatformCommandDispatchDef({
    registry: registryLocal,
    journal,
    audit: () => undefined,
    resolvePrincipal: () => currentPrincipal,
    ...('outboxConsumer' in over ? { outboxConsumer: over.outboxConsumer } : { outboxConsumer: consumer }),
  });
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  currentPrincipal = fullPrincipal();
  journal = new DurableCommandJournal(tmp('journal'));
  deliveredLog = new DeliveredEventLog(tmp('delivered'));
  deliveredEvents = [];
  // The production-shaped consumer: record into the durable sink AND capture for assertions.
  consumer = async (event) => { deliveredEvents.push(event); await deliveredLog.record(event); };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  await deliveredLog.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

interface DispatchResult { ok: boolean; data?: { id?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function createOrder(def: ReturnType<typeof buildPlatformCommandDispatchDef>, orderNumber: string, idem: string, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation: 'CreateSalesOrder', payload: { orderNumber, customer: 'Acme', total: 100 }, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

// ===========================================================================
// Delivery + backward-compat
// ===========================================================================

describe('S31 · production outbox delivery relay', () => {
  it('drains the durable outbox after a governed write — event DELIVERED, sink recorded', async () => {
    const def = buildDef();
    const r = await createOrder(def, 'SO-1', 'k1');
    expect(r.ok).toBe(true);
    // outbox drained → nothing pending, sink has exactly one delivered row for this tenant
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0);
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1);
    expect(deliveredLog.delivered('tenant-A')[0].type).toBe('SalesOrderCreated');
    expect(deliveredEvents).toHaveLength(1);
  });

  it('BACKWARD-COMPAT: with no consumer injected, the outbox is NOT drained (S17–S30 behavior)', async () => {
    const def = buildDef({ outboxConsumer: undefined });
    const r = await createOrder(def, 'SO-bc', 'bc1');
    expect(r.ok).toBe(true);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1); // still pending — unchanged behavior
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(0);
  });

  it('delivery NEVER fails or alters the command when the consumer throws (fail-open) → entry RETRYABLE, retried later', async () => {
    let fail = true;
    const flaky: OutboxConsumer = async (event) => { if (fail) throw new Error('sink down'); await deliveredLog.record(event); };
    const def = buildDef({ outboxConsumer: flaky });
    const r = await createOrder(def, 'SO-f', 'f1');
    expect(r.ok).toBe(true);                                  // business command still succeeds
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(0); // nothing delivered yet
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);  // retained as RETRYABLE for retry
    // recovery: a later drain with a working consumer delivers it (at-least-once)
    fail = false;
    await dispatchOutbox(journal, flaky, { tenantId: 'tenant-A' });
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0);
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1);
  });
});

// ===========================================================================
// Attack: tenant isolation, idempotency, concurrency, restart
// ===========================================================================

describe('S31 · attack + operate', () => {
  it('TENANT ISOLATION: each delivery is attributed to the EVENT tenant; no cross-tenant leak', async () => {
    const defA = buildDef();
    await createOrder(defA, 'SO-A', 'a1');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = fullPrincipal();
    const defB = buildDef();
    await createOrder(defB, 'SO-B', 'b1');
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1);
    expect(deliveredLog.delivered('tenant-B')).toHaveLength(1);
    expect(deliveredLog.delivered('tenant-A')[0].tenantId).toBe('tenant-A');
    expect(deliveredLog.delivered('tenant-B')[0].tenantId).toBe('tenant-B');
    // A cannot see B's delivered event and vice-versa
    expect(deliveredLog.delivered('tenant-A').some((r) => r.tenantId === 'tenant-B')).toBe(false);
  });

  it('AT-LEAST-ONCE IDEMPOTENCY: a replayed command posts no second outbox entry; sink stays one row', async () => {
    const def = buildDef();
    await createOrder(def, 'SO-i', 'once');
    const replay = await createOrder(def, 'SO-i', 'once'); // same idempotency key
    expect(replay.replayed).toBe(true);
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1); // journal replay → no new event → one row
    // even a direct re-drain of the same event is idempotent (id-keyed upsert)
    await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1);
  });

  it('CONCURRENCY: concurrent dispatches → exactly one delivered row per event, none lost, none duplicated', async () => {
    const def = buildDef();
    await Promise.all([
      createOrder(def, 'SO-c1', 'c1'),
      createOrder(def, 'SO-c2', 'c2'),
      createOrder(def, 'SO-c3', 'c3'),
    ]);
    // drain once more to settle any at-least-once stragglers (idempotent)
    await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0);
    const rows = deliveredLog.delivered('tenant-A');
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3); // no duplicate event rows
  });

  it('RESTART: DELIVERED state + delivered rows survive a reload; a re-drain delivers nothing new', async () => {
    const def = buildDef();
    await createOrder(def, 'SO-r', 'r1');
    await journal.reload();
    await deliveredLog.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0); // DELIVERED persisted
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1); // sink persisted
    await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(deliveredLog.delivered('tenant-A')).toHaveLength(1); // nothing re-delivered
  });
});
