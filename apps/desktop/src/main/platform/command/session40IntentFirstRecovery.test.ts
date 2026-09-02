/**
 * ERP Session 40 — INTENT-FIRST DUAL-WRITE RECOVERY (closes S37 Finding #2, per the S39 Option A memo).
 *
 * The governed command sequence is `journal.run(execute)` where `execute` performs the DOMAIN effect
 * and the journal then commits idempotency + event + outbox. S40 durably RESERVES an intent keyed by
 * (tenantId, idempotencyKey) BEFORE `execute`. A crash between the reservation and the commit leaves
 * the intent IN_FLIGHT with a PRIOR process's bootEpoch and no committed record — provably orphaned —
 * which boot reconciliation transitions to HOLD, so a same-key retry returns RECONCILIATION_REQUIRED
 * instead of silently re-executing the domain effect (no duplicate business effect).
 *
 * These tests exercise the REAL journal + REAL order module + REAL durable persistence (no mocking of
 * the intent store). A "crash" is DETERMINISTIC FAILURE INJECTION — a real `execute` that persists the
 * domain effect and then throws, followed by a fresh journal instance (new bootEpoch) re-reading the
 * same durable files — NOT a real OS kill. Guarantee: at-least-once + idempotent, NOT exactly-once.
 *
 * NEGATIVE CONTROL: a journal built with `{ intentRecovery: false }` (production NEVER does this)
 * reproduces the S39 duplicate-on-retry, proving the intent reservation is load-bearing.
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

import { IpcChannel, ORDERS_MODULE_ID, type EnterprisePermission, type PlatformEventInput, type TenantScope, type EnterpriseEntity } from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext, type SecureHandlerDef } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { dispatchCommand } from './commandBus';
import { DurableCommandJournal, type JournalRunInput } from './durableCommandJournal';
import { DeliveredEventLog } from './deliveredEventLog';
import { dispatchOutbox, type OutboxConsumer } from './outboxDispatcher';
import { buildDeliveryOperations } from './deliveryOperations';
import type { DomainCommand } from './domainCommand';

let orderPath: string, journalPath: string, sinkPath: string, intentsPath: string;
const cleanup: string[] = [];
let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let ctx: EnterpriseModuleContext;
let handlers: SecureHandlerDef[];
let journal: DurableCommandJournal;
let denyPerm: EnterprisePermission | null = null;

function makeCtx(): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { if (denyPerm && p === denyPerm) throw new Error(`denied ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'operator@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
/** Construct fresh production instances over the stable files — a "process (re)start". */
async function boot(intentRecovery = true): Promise<void> {
  registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(orderPath));
  registry.bindScope(() => resolveTenantScope(() => scope));
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(journalPath, { intentRecovery });
  await journal.load();
  await registry.get(ORDERS_MODULE_ID)!.store.load();
}
beforeEach(async () => {
  const tag = randomUUID();
  orderPath = join(tmpdir(), `np-s40-order-${tag}.json`);
  journalPath = join(tmpdir(), `np-s40-journal-${tag}.json`);
  intentsPath = journalPath.replace(/\.json$/, '.intents.json');
  sinkPath = join(tmpdir(), `np-s40-sink-${tag}.json`);
  cleanup.push(orderPath, journalPath, intentsPath, sinkPath);
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  denyPerm = null;
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

/** The REAL domain effect the command bus route performs, durably flushed to disk. */
async function domainEffect(orderNumber: string): Promise<string> {
  const store = registry.get(ORDERS_MODULE_ID)!.store as { flush: () => Promise<void> };
  const r = await (handlers.find((h) => h.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<{ record?: EnterpriseEntity }>)(
    { moduleId: ORDERS_MODULE_ID, fields: { orderNumber, customer: 'Acme', total: 100, status: 'pending' } },
  );
  await store.flush();
  return r.record!.id;
}
/** Drive the REAL journal transaction boundary with a chosen execute (domain effect + optional crash). */
function runJournal(idem: string, execute: JournalRunInput['execute'], tenantId = 'tenant-A'): Promise<unknown> {
  return journal.run({
    tenantId, idempotencyKey: idem, commandId: `cmd-${idem}`, commandType: 'CreateSalesOrder',
    correlationId: `corr-${idem}`, actor: 'operator@np.dev', source: 'test', execute,
  });
}
async function orderCount(tenant = 'tenant-A'): Promise<number> {
  scope = { tenantId: tenant, workspaceId: `ws-${tenant.slice(-1)}` };
  const s = registry.get(ORDERS_MODULE_ID)!.store;
  await s.load();
  return s.list().length;
}
const okExecute = (orderNumber: string): JournalRunInput['execute'] => async () => {
  const id = await domainEffect(orderNumber);
  return { ok: true, data: { id }, aggregateId: id, aggregateType: 'SalesOrder' };
};
const crashAfterEffect = (orderNumber: string): JournalRunInput['execute'] => async () => {
  await domainEffect(orderNumber); // domain effect DURABLE
  throw new Error('CRASH: after domain effect, before journal commit'); // process dies here
};

// ===========================================================================
// A + C — governed crash → HOLD (the S39 window, closed), and B/E — success + replay
// ===========================================================================

describe('S40 · A/C — the dual-write window is CLOSED on the governed path', () => {
  it('C — crash after the domain effect but before journal commit → restart → same-key retry returns HOLD, no second effect', async () => {
    await runJournal('kC', crashAfterEffect('SO-C')).catch(() => undefined); // process A crashes mid-window
    expect(await orderCount()).toBe(1); // the domain effect is durable
    expect(journal.records('tenant-A')).toHaveLength(0); // but no committed command (the window state)

    await boot(); // restart — fresh journal instance, new bootEpoch

    // The retry of the SAME idempotency key must NOT re-execute the domain effect.
    const retry = (await runJournal('kC', okExecute('SO-C-RETRY'))) as { ok: boolean; error?: string };
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe('RECONCILIATION_REQUIRED'); // HOLD
    expect(await orderCount()).toBe(1); // still ONE order — no duplicate business effect
    expect(journal.heldIntents('tenant-A').map((h) => h.idempotencyKey)).toContain('kC');
  });

  it('B — a successful command persists exactly one domain effect + one committed record; replay is idempotent; the intent is cleared', async () => {
    const r = await dispatch(mkOrder('SO-B', 'kB'));
    expect(r.ok).toBe(true);
    expect(await orderCount()).toBe(1);
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.heldIntents('tenant-A')).toHaveLength(0); // no HOLD
    // the intents ledger holds no lingering IN_FLIGHT for a committed command
    const intentsRaw = await fsp.readFile(intentsPath, 'utf8').catch(() => '{"records":[]}');
    expect(intentsRaw).not.toMatch(/kB/);

    await boot(); // E — restart
    const replay = await dispatch(mkOrder('SO-B', 'kB'));
    expect(replay.replayed).toBe(true); // committed replay unchanged (S18)
    expect(await orderCount()).toBe(1);
  });
});

// ===========================================================================
// D — crash BEFORE the domain effect → no effect; recovery safe
// ===========================================================================

describe('S40 · D — crash before the domain effect', () => {
  it('no domain effect exists; the retry is safely HELD (never a silent re-execute)', async () => {
    await runJournal('kD', async () => { throw new Error('CRASH before domain effect'); }).catch(() => undefined);
    expect(await orderCount()).toBe(0); // no domain effect
    await boot();
    const retry = (await runJournal('kD', okExecute('SO-D'))) as { ok: boolean; error?: string };
    expect(retry.error).toBe('RECONCILIATION_REQUIRED'); // conservative HOLD — never re-executes
    expect(await orderCount()).toBe(0);
  });
});

// ===========================================================================
// F — HOLD retry stays HOLD; G — boot reconciliation transitions exactly once
// ===========================================================================

describe('S40 · F/G — HOLD is stable and boot reconciliation is exactly-once', () => {
  it('F — repeated same-key attempts against a held command remain RECONCILIATION_REQUIRED with no duplicate effect', async () => {
    await runJournal('kF', crashAfterEffect('SO-F')).catch(() => undefined);
    await boot();
    for (let i = 0; i < 3; i += 1) {
      const r = (await runJournal('kF', okExecute(`SO-F-${i}`))) as { ok: boolean; error?: string };
      expect(r.error).toBe('RECONCILIATION_REQUIRED');
    }
    expect(await orderCount()).toBe(1); // never a second effect across repeated retries
  });

  it('G — boot reconciliation discovers the orphaned intent and transitions it to HOLD exactly once (idempotent)', async () => {
    await runJournal('kG', crashAfterEffect('SO-G')).catch(() => undefined);
    await boot();
    const first = await journal.reconcileOrphanedIntents();
    expect(first.held).toHaveLength(1); // the orphan → HOLD
    const second = await journal.reconcileOrphanedIntents();
    expect(second.held).toHaveLength(0); // already HOLD — nothing new
    await boot();
    const third = await journal.reconcileOrphanedIntents();
    expect(third.held).toHaveLength(0); // still nothing new after another restart
    expect(journal.heldIntents('tenant-A')).toHaveLength(1);
  });
});

// ===========================================================================
// H/I — concurrency
// ===========================================================================

describe('S40 · H/I — concurrency', () => {
  it('H — concurrent same-key dispatch yields a SINGLE durable intent + effect (no duplicate)', async () => {
    const [a, b, c] = await Promise.all([dispatch(mkOrder('SO-H', 'kH')), dispatch(mkOrder('SO-H', 'kH')), dispatch(mkOrder('SO-H', 'kH'))]);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(await orderCount()).toBe(1); // single effect
    expect(journal.records('tenant-A')).toHaveLength(1); // single committed record
  });

  it('I — concurrent DIFFERENT-key commands do not corrupt each other; each commits once', async () => {
    await Promise.all([dispatch(mkOrder('SO-I1', 'kI1')), dispatch(mkOrder('SO-I2', 'kI2')), dispatch(mkOrder('SO-I3', 'kI3'))]);
    expect(await orderCount()).toBe(3);
    expect(new Set(journal.records('tenant-A').map((r) => r.idempotencyKey)).size).toBe(3);
    const raw = await fsp.readFile(journalPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ===========================================================================
// J/K — tenant isolation + authorization
// ===========================================================================

describe('S40 · J/K — tenant + security', () => {
  it('J — two tenants with the SAME idempotency key are completely isolated (a crash-HOLD in A never affects B)', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    await runJournal('shared-key', crashAfterEffect('SO-A'), 'tenant-A').catch(() => undefined); // A crashes → orphan
    await boot();
    // Tenant B dispatches the SAME key — must succeed (B has no intent), never blocked by A's HOLD.
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const b = (await runJournal('shared-key', okExecute('SO-B'), 'tenant-B')) as { ok: boolean };
    expect(b.ok).toBe(true);
    expect(journal.records('tenant-B')).toHaveLength(1);
    // Tenant A's same key is still HELD.
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const a = (await runJournal('shared-key', okExecute('SO-A2'), 'tenant-A')) as { ok: boolean; error?: string };
    expect(a.error).toBe('RECONCILIATION_REQUIRED');
    expect(journal.heldIntents('tenant-A').map((h) => h.idempotencyKey)).toContain('shared-key');
    expect(journal.heldIntents('tenant-B')).toHaveLength(0); // B never held
  });

  it('K — an unauthorized command fails UNAUTHORIZED, produces no effect, and leaves no lingering intent (no bypass)', async () => {
    denyPerm = 'sales:manage';
    const r = await dispatch(mkOrder('SO-K', 'kK'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UNAUTHORIZED');
    expect(await orderCount()).toBe(0);
    expect(journal.records('tenant-A')).toHaveLength(0);
    expect(journal.heldIntents('tenant-A')).toHaveLength(0); // intent released, not held → still retryable
    // and the same key, once authorized, executes normally (the failed intent did not block it)
    denyPerm = null;
    const ok = await dispatch(mkOrder('SO-K', 'kK'));
    expect(ok.ok).toBe(true);
    expect(await orderCount()).toBe(1);
  });
});

// ===========================================================================
// L/M/N — delivery unchanged, restart durability, corrupt-fail-closed
// ===========================================================================

describe('S40 · L/M/N — delivery, durability, fail-closed', () => {
  it('L — existing S31/S38 outbox delivery is unchanged and idempotent', async () => {
    const sink = new DeliveredEventLog(sinkPath);
    const consumer: OutboxConsumer = (event) => sink.record(event);
    await dispatch(mkOrder('SO-L', 'kL'));
    const res = await dispatchOutbox(journal, consumer);
    expect(res.delivered).toBe(1);
    await dispatchOutbox(journal, consumer); // re-drive
    expect(sink.count('tenant-A')).toBe(1); // never delivered twice
    await sink.destroy();
  });

  it('M — a HELD intent survives a restart exactly (durable)', async () => {
    await runJournal('kM', crashAfterEffect('SO-M')).catch(() => undefined);
    await boot();
    await journal.reconcileOrphanedIntents(); // → HOLD
    await boot(); // restart again
    expect(journal.heldIntents('tenant-A').map((h) => h.idempotencyKey)).toContain('kM'); // HOLD persisted
    const retry = (await runJournal('kM', okExecute('SO-M2'))) as { ok: boolean; error?: string };
    expect(retry.error).toBe('RECONCILIATION_REQUIRED');
  });

  it('N — a corrupt intent ledger FAILS CLOSED: a new command is refused, never silently executed', async () => {
    await runJournal('kN', crashAfterEffect('SO-N')).catch(() => undefined); // creates the intents file
    await fsp.writeFile(intentsPath, '{ this is not valid json'); // corrupt it
    await boot();
    const r = (await runJournal('kN2', okExecute('SO-N2'))) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBe('RECONCILIATION_REQUIRED'); // fail closed — the domain effect never ran
    expect(await orderCount()).toBe(1); // only SO-N (the pre-corruption crash effect); SO-N2 never executed
  });
});

// ===========================================================================
// P — S35 observability of held reconciliations (existing read surface)
// ===========================================================================

describe('S40 · P — S35 delivery-operations surfaces held reconciliations', () => {
  it('a held command appears in the governed S35 read (sanitized: ids/reason only, no paths/secrets)', async () => {
    await runJournal('kP', crashAfterEffect('SO-P')).catch(() => undefined);
    await boot();
    await journal.reconcileOrphanedIntents();
    const ops = buildDeliveryOperations(journal, undefined, 'tenant-A', {});
    const data = (ops as { ok: true; data: Record<string, unknown> }).data;
    expect((data.counts as { heldReconciliations: number }).heldReconciliations).toBe(1);
    const held = data.heldReconciliations as Record<string, unknown>[];
    expect(held[0].idempotencyKey).toBe('kP');
    expect(held[0].reason).toBe('reconciliation required after unclean shutdown');
    // no filesystem paths / secrets leaked
    expect(JSON.stringify(held)).not.toMatch(/\/(Users|home|tmp|var)\/|password|token|secret/i);
  });
});

// ===========================================================================
// NEGATIVE CONTROL — the intent reservation is LOAD-BEARING
// ===========================================================================

describe('S40 · NEGATIVE CONTROL — disabling intent recovery reproduces the S39 duplicate', () => {
  it('with intentRecovery=false the same crash → retry creates a SECOND domain effect (the S39 failure returns)', async () => {
    await boot(false); // intent recovery OFF (production never does this)
    await runJournal('kNC', crashAfterEffect('SO-NC')).catch(() => undefined);
    expect(await orderCount()).toBe(1);
    await boot(false); // restart, still OFF
    const retry = (await runJournal('kNC', okExecute('SO-NC-2'))) as { ok: boolean; error?: string };
    expect(retry.ok).toBe(true); // NOT held — the S39 window is open again
    expect(retry.error).toBeUndefined();
    expect(await orderCount()).toBe(2); // DUPLICATE business effect — proves the intent reservation is load-bearing
  });

  it('and with intentRecovery=true (production default) the identical scenario is HELD (no duplicate)', async () => {
    await runJournal('kNC2', crashAfterEffect('SO-NC2')).catch(() => undefined);
    await boot(); // default: intent recovery ON
    const retry = (await runJournal('kNC2', okExecute('SO-NC2-2'))) as { ok: boolean; error?: string };
    expect(retry.error).toBe('RECONCILIATION_REQUIRED');
    expect(await orderCount()).toBe(1);
  });
});
