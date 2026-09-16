/**
 * S139 — governed OPERATIONAL EXCEPTIONS queue. A unified, read-only "needs follow-up" view that UNIFIES
 * the two operational exception signals that already exist but were scattered across three surfaces:
 * RETRYABLE deliveries (S35) and held reconciliations (S40), over the SAME durable command journal.
 *
 * Proven here:
 *   • PURE composer: union + full-tenant counts + most-recent-first ordering + kind filter (fail-closed) +
 *     bounded pagination + honest empty + sanitized fields (no raw payload), each item carrying only fields
 *     that already exist. No invented severity/SLA/priority.
 *   • GOVERNED path through the REAL `runSecureHandler`: a REAL RETRYABLE delivery (reproduced through the
 *     real S31 relay) surfaces as a `delivery_retrying` exception; UNAUTHENTICATED / UNAUTHORIZED /
 *     TENANT_SCOPE_VIOLATION fail closed; tenant isolation; no secret/credential reaches the response.
 * Read-only by construction — the surface offers NO mutating action (resolve/retry are out of scope).
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
import { buildOperationalExceptions } from '../../platform/command/operationalExceptions';

// ===========================================================================
// PART 1 — the PURE composer (deterministic control of BOTH exception kinds)
// ===========================================================================

/** A minimal fake journal exposing only what `buildOperationalExceptions` reads, tenant-scoped. */
function fakeJournal(
  recordsByTenant: Record<string, unknown[]>,
  heldByTenant: Record<string, unknown[]>,
): Parameters<typeof buildOperationalExceptions>[0] {
  return {
    records: (t: string) => (recordsByTenant[t] ?? []),
    heldIntents: (t: string) => (heldByTenant[t] ?? []),
  } as unknown as Parameters<typeof buildOperationalExceptions>[0];
}
const rec = (id: string, status: string, at: string, over: Record<string, unknown> = {}): unknown => ({
  id, committedAt: at,
  event: { eventId: `evt-${id}`, type: 'SalesOrderCreated', aggregateId: `agg-${id}`, correlationId: `corr-${id}` },
  outbox: { status, attempts: status === 'RETRYABLE' ? 2 : 0, ...(status === 'RETRYABLE' ? { lastError: 'sink unreachable' } : {}) },
  ...over,
});
const held = (idem: string, at: string, over: Record<string, unknown> = {}): unknown =>
  ({ id: `tenant-A::${idem}`, idempotencyKey: idem, state: 'HOLD', reservedAt: at, reason: 'RECONCILIATION_REQUIRED', ...over });

describe('S139 · pure operational-exceptions composer', () => {
  it('unifies RETRYABLE deliveries + held reconciliations; counts reflect the full tenant picture', () => {
    const j = fakeJournal(
      { 'tenant-A': [rec('tx1', 'RETRYABLE', '2026-09-05T10:00:00.000Z'), rec('tx2', 'DELIVERED', '2026-09-05T11:00:00.000Z'), rec('tx3', 'PENDING', '2026-09-05T12:00:00.000Z')] },
      { 'tenant-A': [held('kA', '2026-09-05T13:00:00.000Z')] },
    );
    const r = buildOperationalExceptions(j, 'tenant-A', {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const counts = r.data.counts as Record<string, number>;
    expect(counts.retryingDeliveries).toBe(1); // only RETRYABLE (never DELIVERED/PENDING)
    expect(counts.heldReconciliations).toBe(1);
    expect(counts.total).toBe(2);
    const items = r.data.exceptions as Array<Record<string, unknown>>;
    expect(items.map((i) => i.kind).sort()).toEqual(['delivery_retrying', 'held_reconciliation']);
  });

  it('orders most-recent-first by the item’s OWN timestamp (no urgency/severity policy)', () => {
    const j = fakeJournal(
      { 'tenant-A': [rec('txOld', 'RETRYABLE', '2026-09-01T00:00:00.000Z')] },
      { 'tenant-A': [held('kNew', '2026-09-09T00:00:00.000Z')] },
    );
    const items = (buildOperationalExceptions(j, 'tenant-A', {}) as { data: { exceptions: Array<Record<string, unknown>> } }).data.exceptions;
    expect(items[0].kind).toBe('held_reconciliation'); // newer reservedAt first
    expect(items[1].kind).toBe('delivery_retrying');
  });

  it('kind filter narrows; an unknown kind FAILS CLOSED; counts stay full-picture', () => {
    const j = fakeJournal(
      { 'tenant-A': [rec('tx1', 'RETRYABLE', '2026-09-05T10:00:00.000Z')] },
      { 'tenant-A': [held('kA', '2026-09-05T13:00:00.000Z')] },
    );
    const onlyHeld = buildOperationalExceptions(j, 'tenant-A', { kind: 'held_reconciliation' });
    expect(onlyHeld.ok).toBe(true);
    if (onlyHeld.ok) {
      const items = onlyHeld.data.exceptions as Array<Record<string, unknown>>;
      expect(items.every((i) => i.kind === 'held_reconciliation')).toBe(true);
      expect((onlyHeld.data.counts as Record<string, number>).total).toBe(2); // counts unfiltered
    }
    const bad = buildOperationalExceptions(j, 'tenant-A', { kind: 'not_a_kind' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('INVALID_KIND_FILTER');
  });

  it('bounds the limit (clamped/default) and never returns "everything"; honest empty', () => {
    const many = Array.from({ length: 40 }, (_v, i) => rec(`tx${i}`, 'RETRYABLE', `2026-09-05T10:${String(i).padStart(2, '0')}:00.000Z`));
    const j = fakeJournal({ 'tenant-A': many }, {});
    const dflt = buildOperationalExceptions(j, 'tenant-A', {});
    if (dflt.ok) { expect(dflt.data.limit).toBe(25); expect((dflt.data.exceptions as unknown[]).length).toBe(25); }
    const clamped = buildOperationalExceptions(j, 'tenant-A', { limit: 999999 });
    if (clamped.ok) expect(clamped.data.limit).toBe(100);
    const empty = buildOperationalExceptions(fakeJournal({}, {}), 'tenant-Z', {});
    if (empty.ok) { expect((empty.data.counts as Record<string, number>).total).toBe(0); expect((empty.data.exceptions as unknown[]).length).toBe(0); }
  });

  it('sanitizes: bounds lastError/reason and carries only existing fields (no raw payload/result/detail)', () => {
    const longErr = 'x'.repeat(500);
    const j = fakeJournal(
      { 'tenant-A': [rec('tx1', 'RETRYABLE', '2026-09-05T10:00:00.000Z', { outbox: { status: 'RETRYABLE', attempts: 3, lastError: longErr, result: { secret: 'nope' } } })] },
      { 'tenant-A': [held('kA', '2026-09-05T13:00:00.000Z', { reason: longErr })] },
    );
    const items = (buildOperationalExceptions(j, 'tenant-A', {}) as { data: { exceptions: Array<Record<string, unknown>> } }).data.exceptions;
    const blob = JSON.stringify(items);
    expect(blob).not.toContain('nope'); // no raw outbox.result
    for (const it of items) {
      if (typeof it.lastError === 'string') expect(it.lastError.length).toBeLessThanOrEqual(200);
      if (typeof it.reason === 'string') expect(it.reason.length).toBeLessThanOrEqual(200);
    }
  });
});

// ===========================================================================
// PART 2 — the GOVERNED read path through the REAL secure bridge
// ===========================================================================

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s139-${tag}-${randomUUID()}.json`);
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
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-05T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

function rebuildDef(): void {
  const registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('so')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx());
  def = buildPlatformCommandDispatchDef({
    registry, journal, audit: () => undefined, resolvePrincipal: () => currentPrincipal, deliveredLog,
  });
}
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
const readExc = (payload: Record<string, unknown> = {}, idem = 'r', claimedTenantId?: string) => call('QueryOperationalExceptions', payload, idem, claimedTenantId);
const createOrder = (orderNumber: string, idem: string) => call('CreateSalesOrder', { orderNumber, customer: 'Acme', total: 100 }, idem);
const rowsOf = (r: Resp): Array<Record<string, unknown>> => (r.data!.exceptions as Array<Record<string, unknown>>);
const countsOf = (r: Resp): Record<string, number> => (r.data!.counts as Record<string, number>);

describe('S139 · governed operational-exceptions read', () => {
  it('a REAL RETRYABLE delivery (reproduced through the real relay) surfaces as a delivery_retrying exception', async () => {
    await createOrder('SO-f', 'f1');
    await dispatchOutbox(journal, deliverFail); // REPRODUCE the failure through the real S31 relay
    const r = await readExc({ limit: 10 });
    expect(r.ok).toBe(true);
    expect(countsOf(r).retryingDeliveries).toBe(1);
    expect(countsOf(r).total).toBe(1);
    const row = rowsOf(r)[0];
    expect(row.kind).toBe('delivery_retrying');
    expect(row.eventType).toBe('SalesOrderCreated');
    expect(row.attempts as number).toBeGreaterThanOrEqual(1);
    expect(String(row.lastError)).toContain('downstream sink unreachable');
    expect(String(row.lastError).length).toBeLessThanOrEqual(200);
  });

  it('honest empty when nothing needs attention (a DELIVERED command is not an exception)', async () => {
    await createOrder('SO-ok', 'o1');
    await dispatchOutbox(journal, (e) => deliveredLog.record(e)); // delivered successfully
    const r = await readExc({ limit: 10 });
    expect(r.ok).toBe(true);
    expect(countsOf(r).total).toBe(0);
    expect(rowsOf(r).length).toBe(0);
  });

  it('fails closed: UNAUTHENTICATED with no principal, UNAUTHORIZED without operations:read', async () => {
    currentPrincipal = null;
    const noAuth = await readExc({}, 'na');
    expect(noAuth.ok).toBe(false);
    expect(noAuth.error?.code).toBe('UNAUTHENTICATED');

    currentPrincipal = fullPrincipal({ permissions: ['sales:read'] as EnterprisePermission[] });
    const noPerm = await readExc({}, 'np');
    expect(noPerm.ok).toBe(false);
    expect(noPerm.error?.code).toBe('UNAUTHORIZED');
  });

  it('rejects a mismatched claimed tenant (TENANT_SCOPE_VIOLATION) — correlation/kind is never a tenant selector', async () => {
    const r = await readExc({}, 'tv', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('tenant isolation: tenant-B never sees tenant-A exceptions', async () => {
    await createOrder('SO-a', 'a1');
    await dispatchOutbox(journal, deliverFail); // tenant-A now has a retrying delivery
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = fullPrincipal();
    const r = await readExc({ limit: 50 }, 'b1');
    expect(r.ok).toBe(true);
    expect(countsOf(r).total).toBe(0);
    expect(rowsOf(r).length).toBe(0);
  });

  it('leaks no secret/credential/payload in the response', async () => {
    await createOrder('SO-f', 'f2');
    await dispatchOutbox(journal, deliverFail);
    const r = await readExc({ limit: 10 });
    const blob = JSON.stringify(r).toLowerCase();
    for (const forbidden of ['secret', 'token', 'password', 'authorization', 'bearer', 'credential']) {
      expect(blob).not.toContain(forbidden);
    }
  });
});
