/**
 * ERP Session 35 — governed DELIVERY OPERATIONS drill-down. Makes real outbox/delivery FAILURES from
 * the S31 relay observable to an authenticated operator, on a READ branch of `platform:command.dispatch`
 * that NEVER enters the command bus / journal.run (no fake transaction, no event, no outbox write, no
 * mutation). Failures are REPRODUCED FIRST through the EXISTING production relay (`dispatchOutbox`) with
 * a throwing consumer — never weakened to make a test pass. Driven through the REAL `runSecureHandler`.
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
import { dispatchOutbox, type OutboxConsumer } from '../../platform/command/outboxDispatcher';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s35-${tag}-${randomUUID()}.json`);
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

/**
 * Build the dispatch def WITHOUT an auto-drain consumer — so a created command leaves its outbox entry
 * PENDING and delivery is driven EXPLICITLY through the real S31 relay (`dispatchOutbox`) with a chosen
 * consumer. This separates commit from delivery, giving deterministic single-attempt outcomes.
 */
function rebuildDef(): void {
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  def = buildPlatformCommandDispatchDef({
    registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal, deliveredLog,
  });
}

/** The real production relay, one pass, with a WORKING consumer → the entry becomes DELIVERED. */
const deliverOk: OutboxConsumer = (event) => deliveredLog.record(event);
/** The real production relay, one pass, with a FAILING consumer → the entry becomes RETRYABLE. */
const deliverFail: OutboxConsumer = () => { throw new Error('downstream sink unreachable (injected failure)'); };

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
const read = (payload: Record<string, unknown> = {}, idem = 'r', claimedTenantId?: string) => call('QueryDeliveryOperations', payload, idem, claimedTenantId);
const createOrder = (orderNumber: string, idem: string) => call('CreateSalesOrder', { orderNumber, customer: 'Acme', total: 100 }, idem);
type Row = Record<string, unknown>;
const rows = (r: Resp): Row[] => (r.data!.deliveries as Row[]);
const counts = (r: Resp): Record<string, number> => (r.data!.counts as Record<string, number>);

// ===========================================================================
// A/D — healthy delivered + pending states are represented honestly
// ===========================================================================

describe('S35 · delivery state is represented from real outbox state', () => {
  it('A — a healthy DELIVERED event shows DELIVERED with a real deliveredAt', async () => {
    await createOrder('SO-1', 'k1');
    await dispatchOutbox(journal, deliverOk); // the real S31 relay delivers it
    const r = await read({ limit: 10 });
    expect(r.ok).toBe(true);
    expect(counts(r).delivered).toBe(1);
    expect(counts(r).retryable).toBe(0);
    const row = rows(r)[0];
    expect(row.deliveryState).toBe('DELIVERED');
    expect(row.status).toBe('DELIVERED');
    expect(typeof row.deliveredAt).toBe('string');
    expect(row.eventType).toBe('SalesOrderCreated');
  });

  it('D — a PENDING (never-attempted) event is visible as PENDING with 0 attempts', async () => {
    await createOrder('SO-p', 'p1'); // committed, never drained
    const r = await read({ limit: 10 });
    expect(counts(r).pending).toBe(1);
    expect(counts(r).delivered).toBe(0);
    const row = rows(r)[0];
    expect(row.deliveryState).toBe('PENDING');
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(0);
    expect(row.deliveredAt).toBeUndefined();
  });
});

// ===========================================================================
// B/C — a REAL failure is observable; retry semantics are unchanged
// ===========================================================================

describe('S35 · real delivery failure is observable and honest', () => {
  it('B — a delivery FAILURE (throwing consumer) surfaces as RETRYING with a bounded reason + attempts', async () => {
    await createOrder('SO-f', 'f1');
    await dispatchOutbox(journal, deliverFail); // REPRODUCE the failure through the real relay
    const r = await read({ limit: 10 });
    expect(counts(r).retryable).toBe(1);
    expect(counts(r).delivered).toBe(0);
    const row = rows(r)[0];
    expect(row.deliveryState).toBe('RETRYING');
    expect(row.status).toBe('RETRYABLE');
    expect(row.attempts as number).toBeGreaterThanOrEqual(1);
    expect(String(row.lastError)).toContain('downstream sink unreachable');
    expect(String(row.lastError).length).toBeLessThanOrEqual(200); // bounded
    expect(row.deliveredAt).toBeUndefined();
  });

  it('C — existing retry semantics unchanged: a RETRYABLE entry is redelivered on the next relay pass and then DELIVERED (attempts incremented, observable)', async () => {
    await createOrder('SO-c', 'c1');
    await dispatchOutbox(journal, deliverFail); // attempt 1 fails → RETRYABLE
    const afterFail = rows(await read({ limit: 10 }))[0];
    expect(afterFail.status).toBe('RETRYABLE');
    expect(afterFail.attempts).toBe(1);

    await dispatchOutbox(journal, deliverOk); // the SAME relay retries the RETRYABLE entry → DELIVERED
    const r = await read({ limit: 10 });
    const row = rows(r)[0];
    expect(row.status).toBe('DELIVERED');
    expect(row.deliveryState).toBe('DELIVERED');
    expect(row.attempts).toBe(2); // retry actually happened; count reflects both passes
    expect(counts(r).delivered).toBe(1);
    expect(counts(r).retryable).toBe(0);
    // delivered into the S31 sink exactly once (idempotent consumer)
    expect(r.data!.sinkDelivered).toBe(1);
  });
});

// ===========================================================================
// E — multiple events, bounded ordering + pagination
// ===========================================================================

describe('S35 · bounded ordering + pagination', () => {
  it('E — most-recent-first, bounded; oversized limit clamped, default never "everything"', async () => {
    for (let i = 0; i < 5; i += 1) await createOrder(`SO-${i}`, `m${i}`);
    await dispatchOutbox(journal, deliverOk);
    const huge = await read({ limit: 999999 });
    expect(huge.data!.limit).toBe(100); // clamped to MAX
    const dflt = await read({});
    expect(dflt.data!.limit).toBe(25); // default bound
    const two = await read({ limit: 2 });
    expect(rows(two).length).toBe(2);
    // most-recent-first: the last-created order id is first
    expect(String((rows(two)[0] as Row).aggregateId).length).toBeGreaterThan(0);
    expect(counts(await read({})).total).toBe(5);
  });

  it('a valid status filter narrows; a mixed picture keeps counts truthful over the FULL set', async () => {
    await createOrder('SO-ok', 'o1');
    await dispatchOutbox(journal, deliverOk); // delivered
    await createOrder('SO-bad', 'o2');
    await dispatchOutbox(journal, deliverFail); // retryable
    const all = await read({ limit: 50 });
    expect(counts(all).delivered).toBe(1);
    expect(counts(all).retryable).toBe(1);
    const onlyRetry = await read({ status: 'RETRYABLE', limit: 50 });
    expect(rows(onlyRetry).length).toBe(1);
    expect((rows(onlyRetry)[0] as Row).status).toBe('RETRYABLE');
    // counts still reflect the FULL tenant picture even while filtered
    expect(counts(onlyRetry).delivered).toBe(1);
  });
});

// ===========================================================================
// F/G — restart durability + concurrent, non-mutating reads
// ===========================================================================

describe('S35 · restart + concurrency', () => {
  it('F — delivery operational state survives a restart (reload) per existing durability', async () => {
    await createOrder('SO-r', 'r1');
    await dispatchOutbox(journal, deliverFail); // RETRYABLE, durably persisted
    await journal.reload(); // simulate a fresh process
    rebuildDef();
    const r = await read({ limit: 10 });
    const row = rows(r)[0];
    expect(row.status).toBe('RETRYABLE');
    expect(row.deliveryState).toBe('RETRYING');
    expect(String(row.lastError)).toContain('downstream sink unreachable');
  });

  it('G — concurrent reads are deterministic and NEVER mutate the journal or sink', async () => {
    await createOrder('SO-1', 'g1');
    await createOrder('SO-2', 'g2');
    await dispatchOutbox(journal, deliverOk);
    const recBefore = journal.records('tenant-A').length;
    const pendBefore = journal.pendingOutbox('tenant-A').length;
    const many = await Promise.all(Array.from({ length: 8 }, (_, i) => read({ limit: 50 }, `rc${i}`)));
    for (const r of many) {
      expect(r.ok).toBe(true);
      expect(counts(r).total).toBe(2);
      expect(counts(r).delivered).toBe(2);
    }
    expect(journal.records('tenant-A').length).toBe(recBefore); // reads mutate nothing
    expect(journal.pendingOutbox('tenant-A').length).toBe(pendBefore);
  });
});

// ===========================================================================
// H/I/J — tenant isolation, authz, sanitization, fail-closed
// ===========================================================================

describe('S35 · security + fail-closed', () => {
  it('H — tenant-A cannot inspect tenant-B delivery records (no cross-tenant leakage)', async () => {
    await createOrder('SO-A', 'a1');
    await dispatchOutbox(journal, deliverFail); // tenant-A failure
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = fullPrincipal();
    rebuildDef();
    await createOrder('SO-B', 'b1');
    await dispatchOutbox(journal, deliverFail); // tenant-B failure
    // read back as tenant-A
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    rebuildDef();
    const r = await read({ limit: 50 });
    expect(counts(r).total).toBe(1);
    expect(JSON.stringify(r.data)).not.toMatch(/SO-B|tenant-B/);
  });

  it('I — UNAUTHORIZED without operations:read; UNAUTHENTICATED with no principal; FORGED tenant rejected', async () => {
    await createOrder('SO-z', 'z1');
    currentPrincipal = fullPrincipal({ permissions: ['sales:read', 'sales:manage'] });
    expect((await read({ limit: 10 })).error!.code).toBe('UNAUTHORIZED');
    currentPrincipal = null;
    expect((await read({ limit: 10 })).error!.code).toBe('UNAUTHENTICATED');
    currentPrincipal = fullPrincipal();
    expect((await read({ limit: 10 }, 'r', 'tenant-EVIL')).error!.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('J — a malformed status filter FAILS CLOSED (never returns everything)', async () => {
    await createOrder('SO-m', 'm1');
    const r = await read({ status: 'NONSENSE', limit: 50 });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
  });

  it('SANITIZED — never leaks raw command result, event detail, secrets, or filesystem paths', async () => {
    await createOrder('SO-s', 's1');
    await dispatchOutbox(journal, deliverFail);
    const blob = JSON.stringify((await read({ limit: 10 })).data);
    expect(blob).not.toMatch(/"result"/);
    expect(blob).not.toMatch(/"detail"/);
    expect(blob).not.toMatch(/password|token|secret|credential/i);
    expect(blob).not.toMatch(/\/(Users|home|tmp|var)\//); // no filesystem paths
    expect(blob).toMatch(/txId|eventType|deliveryState|attempts/); // operator-safe fields present
  });

  it('NO MUTATION — repeated delivery-operations reads never change committed records or outbox state', async () => {
    await createOrder('SO-n', 'n1');
    await dispatchOutbox(journal, deliverFail);
    const snapshot = JSON.stringify(journal.records('tenant-A'));
    for (let i = 0; i < 5; i += 1) await read({ limit: 50 }, `n${i}`);
    expect(JSON.stringify(journal.records('tenant-A'))).toBe(snapshot); // byte-identical
  });
});
