/**
 * ERP Session 38 — BOOT-TIME RECOVERY OF CRASH-ORPHANED PROCESSING OUTBOX RECORDS (S37 Finding 1).
 *
 * A record left `PROCESSING` by an unclean termination is excluded from `pendingOutbox` (PENDING |
 * RETRYABLE only), so the S31 relay never re-drives it — orphaned forever (S37 TEST D reproduced this).
 * S38 adds `DurableCommandJournal.reconcileStaleProcessing()`: a bounded, boot-time transition of
 * genuinely STALE `PROCESSING → RETRYABLE`, after which the EXISTING `pendingOutbox` → `dispatchOutbox`
 * → consumer → `DeliveredEventLog` machinery performs the retry. NO new state, queue, engine, or
 * recovery-specific delivery path; reconciliation never invokes a consumer and never marks DELIVERED.
 *
 * STALE CRITERION (central safety invariant, §3/§7): a record is reclaimed ONLY when its
 * `processingEpoch` is not THIS process's `bootEpoch` — i.e. it was set PROCESSING by a process that is
 * no longer running. A record set PROCESSING by the CURRENT process (current epoch) is ACTIVE and is
 * NEVER reclaimed. An identity nonce, not a clock — no age threshold, no false-positive on a live
 * slow delivery. Reconciliation is intended to run ONCE at boot, before the first drain.
 *
 * MECHANISM: DETERMINISTIC FAILURE INJECTION (labelled), NOT a real OS kill — a "crash + restart" is a
 * fresh journal instance (new bootEpoch) re-reading the same durable file, exactly what a restarted
 * process does. Delivery is AT-LEAST-ONCE + IDEMPOTENT consumer, NOT exactly-once.
 *
 * S37 Finding 2 (the pre-commit dual-write window) is OUT OF SCOPE and untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { ORDERS_MODULE_ID, type EnterprisePermission, type PlatformEventInput, type TenantScope } from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { dispatchCommand } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import { DeliveredEventLog } from './deliveredEventLog';
import { dispatchOutbox, type OutboxConsumer } from './outboxDispatcher';
import { computePlatformHealth } from './platformHealth';
import { buildDeliveryOperations } from './deliveryOperations';
import { buildPlatformCommandDispatchDef } from '../../ipc/handlers/platformCommandIpc';
import { runSecureHandler } from '../../ipc/secureBridge';
import type { Principal } from '../application/requestContext';
import type { DomainCommand } from './domainCommand';

let orderPath: string, journalPath: string, sinkPath: string;
const cleanup: string[] = [];
let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let ctx: EnterpriseModuleContext;
let journal: DurableCommandJournal;
let sink: DeliveredEventLog;

function makeCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'operator@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
async function boot(): Promise<void> {
  registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(orderPath));
  registry.bindScope(() => resolveTenantScope(() => scope));
  ctx = makeCtx();
  buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(journalPath);
  await journal.load();
  sink = new DeliveredEventLog(sinkPath);
  await sink.reload();
  await registry.get(ORDERS_MODULE_ID)!.store.load();
}
beforeEach(async () => {
  const tag = randomUUID();
  orderPath = join(tmpdir(), `np-s38-order-${tag}.json`);
  journalPath = join(tmpdir(), `np-s38-journal-${tag}.json`);
  sinkPath = join(tmpdir(), `np-s38-sink-${tag}.json`);
  cleanup.push(orderPath, journalPath, sinkPath);
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  await boot();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of cleanup.splice(0)) await fsp.rm(p, { force: true }).catch(() => undefined);
});

let seq = 0;
const mkOrder = (orderNumber: string, idem: string, tenantId?: string): DomainCommand => ({
  commandId: `cmd_${(seq += 1)}`, type: 'CreateSalesOrder',
  ...(tenantId ? { tenantId } : {}),
  actor: 'operator@np.dev', payload: { orderNumber, customer: 'Acme', total: 100 },
  correlationId: `corr_${idem}`, idempotencyKey: idem, timestamp: '2026-09-02T12:00:00.000Z', source: 'test',
});
const dispatch = (cmd: DomainCommand) =>
  dispatchCommand(cmd, { registry, ctx, resolveScope: () => resolveTenantScope(() => scope), journal });
const deliverOk: OutboxConsumer = (event) => sink.record(event);
const statusOf = (id: string, tenant = 'tenant-A') => journal.records(tenant).find((r) => r.id === id)!.outbox.status;

// ===========================================================================
// REPRODUCE-FIRST (§6) — stuck before, recovered after
// ===========================================================================

describe('S38 · reproduce-first: PROCESSING orphan → reconcile → RETRYABLE → DELIVERED', () => {
  it('BEFORE reconciliation: a PROCESSING record left by a crash is NOT re-driven (the S37 gap)', async () => {
    await dispatch(mkOrder('SO-1', 'k1'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id); // enters PROCESSING (previous "process")

    await boot(); // CRASH + RESTART (fresh journal instance = new bootEpoch)

    // Without reconciliation, dispatchOutbox alone still ignores PROCESSING (unchanged S31 behavior).
    expect(statusOf(id)).toBe('PROCESSING');
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0);
    const res = await dispatchOutbox(journal, deliverOk);
    expect(res.attempted).toBe(0); // orphaned — never re-driven
    expect(sink.count('tenant-A')).toBe(0);
  });

  it('AFTER reconciliation: the stale PROCESSING becomes RETRYABLE, re-drives, and DELIVERS exactly once', async () => {
    await dispatch(mkOrder('SO-2', 'k2'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id);

    await boot(); // CRASH + RESTART

    const rec = await journal.reconcileStaleProcessing(); // S38 boot recovery
    expect(rec.reclaimed).toBe(1);
    expect(rec.ids).toEqual([id]);
    expect(statusOf(id)).toBe('RETRYABLE');
    expect(journal.records('tenant-A')[0].outbox.lastError).toBe('reclaimed after unclean shutdown');
    // now the EXISTING relay re-drives it
    const res = await dispatchOutbox(journal, deliverOk);
    expect(res.delivered).toBe(1);
    expect(statusOf(id)).toBe('DELIVERED');
    expect(sink.count('tenant-A')).toBe(1); // exactly one delivery effect
  });
});

// ===========================================================================
// ACTIVE-vs-STALE (§7) — mandatory, load-bearing
// ===========================================================================

describe('S38 · active vs stale (the central safety invariant)', () => {
  it('a PROCESSING record set by the CURRENT process (active) is NEVER reclaimed', async () => {
    await dispatch(mkOrder('SO-a', 'ka'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id); // stamped with THIS instance's bootEpoch → ACTIVE

    // Reconcile on the SAME instance (same bootEpoch) — must NOT reclaim the active record.
    const rec = await journal.reconcileStaleProcessing();
    expect(rec.reclaimed).toBe(0);
    expect(statusOf(id)).toBe('PROCESSING'); // untouched, active operation continues
  });

  it('a PROCESSING record set by a PREVIOUS process (stale) IS reclaimed', async () => {
    await dispatch(mkOrder('SO-s', 'ks'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id); // epoch of instance #1

    await boot(); // instance #2 — different bootEpoch

    const rec = await journal.reconcileStaleProcessing();
    expect(rec.reclaimed).toBe(1);
    expect(statusOf(id)).toBe('RETRYABLE');
  });
});

// ===========================================================================
// DUPLICATE-DELIVERY SAFETY (§8) — at-least-once + idempotent, NOT exactly-once
// ===========================================================================

describe('S38 · duplicate-delivery safety', () => {
  it('a crash AFTER the sink write but before markDelivered yields NO duplicate effect after recovery', async () => {
    await dispatch(mkOrder('SO-d', 'kd'));
    const rec = journal.records('tenant-A')[0];
    await journal.markProcessing(rec.id);
    await sink.record(rec.event); // consumer delivered, then crash before markDelivered
    expect(sink.count('tenant-A')).toBe(1);

    await boot(); // CRASH + RESTART

    const r = await journal.reconcileStaleProcessing(); // PROCESSING → RETRYABLE
    expect(r.reclaimed).toBe(1);
    const res = await dispatchOutbox(journal, deliverOk); // re-drive; consumer is idempotent by eventId
    expect(res.delivered).toBe(1); // the relay reports a delivery pass
    expect(sink.count('tenant-A')).toBe(1); // but the SINK stays at exactly one — no duplicate effect
    expect(statusOf(rec.id)).toBe('DELIVERED');
  });
});

// ===========================================================================
// MIXED OUTBOX STATE (§9)
// ===========================================================================

describe('S38 · mixed outbox state', () => {
  it('PENDING → delivery; stale PROCESSING → RETRYABLE → delivery; active PROCESSING stays; RETRYABLE → delivery; DELIVERED stays', async () => {
    for (const [n, k] of [['P', 'kp'], ['S', 'kstale'], ['R', 'kr'], ['D', 'kd']] as const) await dispatch(mkOrder(`SO-${n}`, k));
    const recs = journal.records('tenant-A');
    const idPending = recs[0].id; // leave PENDING
    const idStale = recs[1].id;
    const idRetry = recs[2].id;
    const idDelivered = recs[3].id;
    await journal.markProcessing(idStale); // epoch #1 (will be stale after boot)
    await journal.markProcessing(idRetry); await journal.markRetryable(idRetry, 'boom');
    await journal.markProcessing(idDelivered); await journal.markDelivered(idDelivered);

    await boot(); // instance #2 — new epoch; idStale becomes stale
    // Add an ACTIVE PROCESSING under the CURRENT (instance #2) epoch.
    await dispatch(mkOrder('SO-A', 'kactive'));
    const idActive = journal.records('tenant-A').find((r) => r.idempotencyKey === 'kactive')!.id;
    await journal.markProcessing(idActive); // current epoch → ACTIVE

    const rec = await journal.reconcileStaleProcessing();
    expect(rec.ids).toEqual([idStale]); // ONLY the stale one
    expect(statusOf(idStale)).toBe('RETRYABLE');
    expect(statusOf(idActive)).toBe('PROCESSING'); // active protected
    expect(statusOf(idDelivered)).toBe('DELIVERED'); // terminal, untouched
    expect(statusOf(idRetry)).toBe('RETRYABLE'); // untouched
    expect(statusOf(idPending)).toBe('PENDING'); // untouched

    await dispatchOutbox(journal, deliverOk); // existing relay drains PENDING + RETRYABLE (incl. reclaimed)
    expect(statusOf(idPending)).toBe('DELIVERED');
    expect(statusOf(idStale)).toBe('DELIVERED');
    expect(statusOf(idRetry)).toBe('DELIVERED');
    expect(statusOf(idActive)).toBe('PROCESSING'); // still active — never touched by recovery or drain
    expect(statusOf(idDelivered)).toBe('DELIVERED');
  });
});

// ===========================================================================
// CONCURRENCY (§10) — reuse S33 serialization, no new lock
// ===========================================================================

describe('S38 · concurrency + durability', () => {
  it('multiple stale PROCESSING + concurrent reconcile calls → no duplicate transition, no lost record, valid JSON', async () => {
    for (let i = 0; i < 4; i += 1) {
      await dispatch(mkOrder(`SO-c${i}`, `kc${i}`));
    }
    const ids = journal.records('tenant-A').map((r) => r.id);
    for (const id of ids) await journal.markProcessing(id); // all PROCESSING under instance #1

    await boot(); // instance #2 — all four are now stale

    // Concurrent reconciliation attempts (idempotent + S33-serialized writes).
    const results = await Promise.all([journal.reconcileStaleProcessing(), journal.reconcileStaleProcessing(), journal.reconcileStaleProcessing()]);
    // Every stale record ends RETRYABLE exactly once; total reclaimed across all calls never double-counts a record.
    for (const id of ids) expect(statusOf(id)).toBe('RETRYABLE');
    const allReclaimed = results.flatMap((r) => r.ids);
    expect(new Set(allReclaimed).size).toBe(4); // 4 distinct records reclaimed (never more than the 4)
    expect(journal.records('tenant-A')).toHaveLength(4); // none lost
    const raw = await fsp.readFile(journalPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow(); // valid JSON after concurrent writes

    const res = await dispatchOutbox(journal, deliverOk);
    expect(res.delivered).toBe(4); // each delivered once
    expect(sink.count('tenant-A')).toBe(4);
  });

  it('repeated reconciliation is idempotent (a second boot reclaims nothing new)', async () => {
    await dispatch(mkOrder('SO-i', 'ki'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id);
    await boot();
    expect((await journal.reconcileStaleProcessing()).reclaimed).toBe(1);
    expect((await journal.reconcileStaleProcessing()).reclaimed).toBe(0); // already RETRYABLE
    await boot(); // yet another restart
    expect((await journal.reconcileStaleProcessing()).reclaimed).toBe(0); // still nothing to reclaim
    expect(statusOf(id)).toBe('RETRYABLE');
  });
});

// ===========================================================================
// TENANT + SECURITY (§11)
// ===========================================================================

describe('S38 · tenant attribution preserved', () => {
  it('reclaims each tenant\'s stale PROCESSING with tenantId unchanged and no cross-tenant mutation', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    await dispatch(mkOrder('SO-A', 'ka', 'tenant-A'));
    const idA = journal.records('tenant-A')[0].id;
    await journal.markProcessing(idA);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    await dispatch(mkOrder('SO-B', 'kb', 'tenant-B'));
    const idB = journal.records('tenant-B')[0].id;
    await journal.markProcessing(idB);

    await boot(); // both become stale

    const rec = await journal.reconcileStaleProcessing();
    expect(rec.reclaimed).toBe(2);
    expect(statusOf(idA, 'tenant-A')).toBe('RETRYABLE');
    expect(statusOf(idB, 'tenant-B')).toBe('RETRYABLE');
    expect(journal.records('tenant-A')[0].tenantId).toBe('tenant-A');
    expect(journal.records('tenant-B')[0].tenantId).toBe('tenant-B');
    // tenant-A read never returns tenant-B rows
    expect(JSON.stringify(journal.records('tenant-A'))).not.toMatch(/SO-B|tenant-B/);
  });
});

// ===========================================================================
// S34 / S35 / S36 INTEGRATION (§12, §16)
// ===========================================================================

describe('S38 · S34/S35/S36 integration after recovery', () => {
  it('S35 delivery-operations surfaces the reclaimed record as RETRYING with the recovery reason, then DELIVERED', async () => {
    await dispatch(mkOrder('SO-o', 'ko'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id);
    await boot();
    await journal.reconcileStaleProcessing();
    const mid = buildDeliveryOperations(journal, sink, 'tenant-A', {});
    const midData = (mid as { ok: true; data: Record<string, unknown> }).data;
    expect((midData.counts as { retryable: number }).retryable).toBe(1); // surfaced honestly, not hidden
    const row = (midData.deliveries as Record<string, unknown>[]).find((d) => d.txId === id)!;
    expect(row.lastError).toBe('reclaimed after unclean shutdown');
    await dispatchOutbox(journal, deliverOk);
    const done = buildDeliveryOperations(journal, sink, 'tenant-A', {});
    expect(((done as { ok: true; data: Record<string, unknown> }).data.counts as { delivered: number }).delivered).toBe(1);
  });

  it('S34 health stays HEALTHY (valid journal) and S36 backup precondition holds (valid JSON) after reconciliation', async () => {
    await dispatch(mkOrder('SO-h', 'kh'));
    const id = journal.records('tenant-A')[0].id;
    await journal.markProcessing(id);
    await boot();
    await journal.reconcileStaleProcessing();
    const health = await computePlatformHealth({ journal, deliveredLog: sink, runtimeReady: () => true });
    expect(health.status).toBe('HEALTHY');
    // The journal was written; the sink file may not exist yet (no delivery in this test — a missing
    // sink is a healthy first-run). Any file that DOES exist must be complete valid JSON (S33 → S36).
    for (const p of [journalPath, sinkPath]) {
      const raw = await fsp.readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? '{}' : Promise.reject(e)));
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });
});

// ===========================================================================
// PRODUCTION BOOT WIRING (§5) — the def actually recovers at composition
// ===========================================================================

describe('S38 · production boot wiring (reconcileStaleProcessingOnBoot)', () => {
  const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

  it('a def built with reconcileStaleProcessingOnBoot recovers a stale PROCESSING record at boot and delivers it', async () => {
    // instance #1 leaves a stale PROCESSING record on disk
    await dispatch(mkOrder('SO-boot', 'kboot'));
    const staleId = journal.records('tenant-A')[0].id;
    await journal.markProcessing(staleId);

    // "restart": a fresh journal instance (new bootEpoch) + the PRODUCTION boot flag on the def.
    const journal2 = new DurableCommandJournal(journalPath);
    const sink2 = new DeliveredEventLog(sinkPath);
    const consumer: OutboxConsumer = (event) => sink2.record(event);
    const registry2 = new EnterpriseModuleRegistry();
    registry2.register(createOrderModule(orderPath));
    registry2.bindScope(() => resolveTenantScope(() => scope));
    buildModuleHandlers(registry2, makeCtx());
    const principal: Principal = { actor: 'op@np.dev', tenantId: 'tenant-A', workspaceId: 'ws-A', permissions: PERMS };
    const def = buildPlatformCommandDispatchDef({
      registry: registry2, journal: journal2, audit: () => undefined,
      resolvePrincipal: () => principal, outboxConsumer: consumer, deliveredLog: sink2,
      reconcileStaleProcessingOnBoot: true,
    });

    // Dispatch any command through the real secure bridge; its drain is chained AFTER the boot
    // reconcile+drain, so awaiting it guarantees boot recovery completed.
    await runSecureHandler(def, { operation: 'CreateSalesOrder', payload: { orderNumber: 'SO-flush', customer: 'Acme', total: 1 }, idempotencyKey: 'kflush' }, { isAuthenticated: () => true });

    await journal2.load();
    await sink2.reload();
    const staleRec = journal2.records('tenant-A').find((r) => r.id === staleId)!;
    expect(staleRec.outbox.status).toBe('DELIVERED'); // recovered + delivered at boot
    expect(sink2.delivered('tenant-A').some((d) => d.id === staleRec.event.eventId)).toBe(true);
  });
});
