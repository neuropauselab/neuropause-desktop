/**
 * ERP Session 39 — DECISION-GATE reproduction of S37 Finding #2 (the pre-commit dual-write window).
 *
 * The governed command sequence is `journal.run(execute)` where `execute` performs the DOMAIN effect
 * FIRST (persistence boundary #1 — the module store's atomic write) and the journal then commits
 * idempotency + event + outbox (persistence boundary #2 — the journal's atomic write). A commit
 * FAILURE runs the in-process `rollback` (compensation); a true CRASH between the two boundaries skips
 * it, stranding the domain effect with no committed command. These tests REPRODUCE that window on the
 * REAL production command path and characterize the current guarantee. NO production code is changed
 * or weakened — this is evidence for `ERP-SESSION39-TRANSACTIONAL-OUTBOX-DECISION-MEMO.md`.
 *
 * MECHANISM: DETERMINISTIC FAILURE INJECTION (labelled), NOT a real OS kill. A "crash + restart" is a
 * fresh instance re-reading the same durable files; a commit failure is the journal's atomic rename
 * forced to reject on the REAL path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { IpcChannel, ORDERS_MODULE_ID, type PlatformEventInput, type TenantScope, type EnterpriseEntity } from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext, type SecureHandlerDef } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { dispatchCommand } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand } from './domainCommand';

let orderPath: string, journalPath: string;
const cleanup: string[] = [];
let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let ctx: EnterpriseModuleContext;
let handlers: SecureHandlerDef[];
let journal: DurableCommandJournal;

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
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(journalPath);
  await journal.load();
  await registry.get(ORDERS_MODULE_ID)!.store.load();
}
beforeEach(async () => {
  const tag = randomUUID();
  orderPath = join(tmpdir(), `np-s39-order-${tag}.json`);
  journalPath = join(tmpdir(), `np-s39-journal-${tag}.json`);
  cleanup.push(orderPath, journalPath);
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  await boot();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of cleanup.splice(0)) await fsp.rm(p, { force: true }).catch(() => undefined);
});

let seq = 0;
const mkOrder = (orderNumber: string, idem: string): DomainCommand => ({
  commandId: `cmd_${(seq += 1)}`, type: 'CreateSalesOrder',
  actor: 'operator@np.dev', payload: { orderNumber, customer: 'Acme', total: 100 },
  correlationId: `corr_${idem}`, idempotencyKey: idem, timestamp: '2026-09-02T12:00:00.000Z', source: 'test',
});
const dispatch = (cmd: DomainCommand) =>
  dispatchCommand(cmd, { registry, ctx, resolveScope: () => resolveTenantScope(() => scope), journal });
/**
 * The exact domain-persistence call the command bus route makes (persistence boundary #1), then
 * `flush()` to force the write DURABLY to disk — so the "crash" that follows leaves a genuinely
 * persisted domain effect (the store's create schedules a coalesced background persist; flush awaits it).
 */
const createOrderDirect = async (orderNumber: string): Promise<{ ok: boolean; record?: EnterpriseEntity }> => {
  const store = registry.get(ORDERS_MODULE_ID)!.store as { flush: () => Promise<void> };
  const r = await (handlers.find((h) => h.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<{ ok: boolean; record?: EnterpriseEntity }>)(
    { moduleId: ORDERS_MODULE_ID, fields: { orderNumber, customer: 'Acme', total: 100, status: 'pending' } },
  );
  await store.flush(); // durably persist boundary #1 before the simulated crash
  return r;
};
async function orderCount(): Promise<number> {
  const s = registry.get(ORDERS_MODULE_ID)!.store;
  await s.load();
  return s.list().length;
}

// ===========================================================================
// CONTROL — the normal path is safe (both boundaries land; replay is idempotent)
// ===========================================================================

describe('S39 · control: the normal committed path is safe', () => {
  it('a successful dispatch persists BOTH the domain effect and the committed command; replay is idempotent', async () => {
    const r = await dispatch(mkOrder('SO-ok', 'kok'));
    expect(r.ok).toBe(true);
    expect(await orderCount()).toBe(1); // domain effect
    expect(journal.records('tenant-A')).toHaveLength(1); // committed command
    await boot(); // restart
    const replay = await dispatch(mkOrder('SO-ok', 'kok')); // same key
    expect(replay.replayed).toBe(true);
    expect(await orderCount()).toBe(1); // still one — no duplicate
    expect(journal.records('tenant-A')).toHaveLength(1);
  });
});

// ===========================================================================
// REPRODUCTION — in-process commit failure (rollback path) on the REAL path
// ===========================================================================

describe('S39 · in-process journal-commit failure (rollback compensation path)', () => {
  it('a journal commit that never lands returns COMMIT_FAILED and leaves NO committed command after restart', async () => {
    const origRename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(((src: string, dest: string) =>
      basename(String(dest)) === basename(journalPath)
        ? Promise.reject(new Error('SIMULATED commit failure (journal rename)'))
        : origRename(src, dest)) as typeof fsp.rename);

    const r = await dispatch(mkOrder('SO-cf', 'kcf'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('COMMIT_FAILED'); // journal.run caught the commit failure and ran rollback
    vi.restoreAllMocks();

    await boot(); // restart
    // The authoritative COMMITTED-COMMAND layer is clean — the mission's central assertion.
    expect(journal.records('tenant-A')).toHaveLength(0);
    expect(journal.events('tenant-A')).toHaveLength(0);
    // OBSERVED current behavior of the in-process compensation (recorded for the memo, not asserted
    // as a guarantee): the rollback's soft-delete is best-effort; the domain effect may survive.
    const stranded = await orderCount();
    expect(stranded).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// REPRODUCTION — TRUE CRASH between the two persistence boundaries (no rollback)
// ===========================================================================

describe('S39 · true crash between domain effect and journal commit (no rollback)', () => {
  it('REPRODUCES the unsafe state: a domain effect exists but NO committed command/journal/outbox record exists', async () => {
    // Persistence boundary #1 only: the domain effect is written through the SAME module handler the
    // command bus route uses. The process then "crashes" BEFORE journal.run commits (boundary #2) and
    // BEFORE any rollback — so we do NOT call the journal at all, exactly as a kill in that window.
    const created = await createOrderDirect('SO-crash');
    expect(created.ok).toBe(true);

    await boot(); // restart — fresh journal + order store from the same files

    // THE WINDOW, REPRODUCED: the domain effect is durable, but the journal has no record of it.
    expect(await orderCount()).toBe(1); // domain effect exists
    expect(journal.records('tenant-A')).toHaveLength(0); // NO committed command
    expect(journal.events('tenant-A')).toHaveLength(0); // NO event
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0); // NO outbox record
  });

  it('DUPLICATE on retry: re-dispatching the same idempotency key after such a crash creates a SECOND domain effect', async () => {
    // Stranded domain effect from a crash-in-window (boundary #1 only, no journal record).
    await createOrderDirect('SO-dup');
    expect(await orderCount()).toBe(1);

    await boot(); // restart

    // The client retries the SAME command (same idempotency key). The journal has no committed record
    // to replay (the commit never landed), so execute runs AGAIN and the order store — which mints a
    // fresh id per create — produces a SECOND order. The dual-write window's duplicate, reproduced.
    const retry = await dispatch(mkOrder('SO-dup', 'kdup'));
    expect(retry.ok).toBe(true);
    expect(retry.replayed).toBeUndefined(); // NOT a replay — no committed record existed
    expect(await orderCount()).toBe(2); // TWO orders — duplicate business effect
  });
});
