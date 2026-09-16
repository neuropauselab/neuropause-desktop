/**
 * ERP Session 44 — GOVERNED HOLD / RECONCILIATION OPERATIONS.
 *
 * S40 made the ambiguous crash boundary fail-closed: a crash-orphaned governed command intent becomes a
 * durable HOLD so the command is NEVER silently re-executed — but that HOLD lived only in the journal, with
 * no operator path to resolve it. S44 surfaces it into the EXISTING canonical Hold Center (HoldStore +
 * raiseHold + HoldResolve + DecisionRecord + governance audit) and makes it operator-actionable. It REUSES
 * that mechanism whole; it adds only the mapping + the surfacing pass. NOTHING re-executes.
 *
 * These tests drive the REAL journal (a real crash → a real held intent), the REAL `surfaceHeldHolds` mapper,
 * the REAL tenant-scoped HoldStore/DecisionRecordStore, and the REAL `HoldResolve` handler from `initDecisions`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import { IpcChannel, type HoldCenterView, type HoldRecord, type TenantScope } from '@neuropause/shared';
import { HoldResolveRequest } from '@neuropause/shared';
import { RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';
import { DurableCommandJournal, type JournalRunInput } from '../platform/command/durableCommandJournal';
import { DurableJsonStore } from '../platform/persistence/durableJsonStore';
import { HoldStore } from './holdStore';
import { DecisionRecordStore } from './decisionService';
import { createHoldRaiser, type HoldRaiser } from './raiseHold';
import { buildHeldCommandHoldInput } from './heldCommandHold';
import { surfaceHeldHolds, type HeldCommandHoldDeps } from './heldCommandHoldService';
import { initDecisions } from './index';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s44-${tag}-${randomUUID()}`);
  paths.push(p);
  return p;
};

interface Order { id: string; tenantId: string; orderNumber: string }

/** Produce a REAL crash-orphaned HELD intent: run a crashing effect, then a fresh journal reconciles it. */
async function makeHeldJournal(dir: string, key: string, tenant = 'tenant-A'): Promise<{ journal: DurableCommandJournal; orders: DurableJsonStore<Order> }> {
  await fs.mkdir(dir, { recursive: true });
  const journalPath = join(dir, 'journal.json');
  const orders = new DurableJsonStore<Order>(join(dir, 'orders.json'));
  const crash: JournalRunInput['execute'] = async () => {
    await orders.put({ id: `ord_${randomUUID()}`, tenantId: tenant, orderNumber: 'SO-1' }); // domain effect DURABLE
    throw new Error('CRASH: after effect, before commit'); // the S40 dual-write window
  };
  const j1 = new DurableCommandJournal(journalPath);
  await j1.load();
  await j1.run({ tenantId: tenant, idempotencyKey: key, commandId: `cmd-${key}`, commandType: 'CreateSalesOrder', correlationId: `c-${key}`, actor: 'op@np.dev', source: 'test', execute: crash }).catch(() => undefined);
  // Restart: a fresh journal (new bootEpoch) reconciles the orphan → HOLD.
  const journal = new DurableCommandJournal(journalPath);
  await journal.load();
  await journal.reconcileOrphanedIntents();
  return { journal, orders };
}

/** A real tenant-scoped Hold Center: HoldStore + DecisionRecordStore + a raiseHold + the HoldResolve handler. */
async function makeHoldCenter(dir: string, scope: TenantScope): Promise<{
  holds: HoldStore; decisions: DecisionRecordStore; raise: HoldRaiser; audit: string[];
  list: () => HoldCenterView; resolve: (req: unknown) => HoldRecord | null;
}> {
  await fs.mkdir(dir, { recursive: true });
  const holds = new HoldStore(join(dir, 'holds.json'));
  const decisions = new DecisionRecordStore(join(dir, 'decisions.json'));
  holds.bindScope(() => scope);
  decisions.bindScope(() => scope);
  await Promise.all([holds.load(), decisions.load()]);
  const audit: string[] = [];
  const raise = createHoldRaiser({ holds, decisions, actor: () => 'system', audit: (a, t) => audit.push(`${a}|${t}`) });
  const handlers = initDecisions({
    decisionRecords: decisions, holds,
    assessmentLive: () => false, relationshipsDeclared: () => 0,
    actor: () => 'operator@np.dev', audit: (a, t, s) => audit.push(`${a}|${t}|${s}`),
  }).handlers;
  const list = () => (handlers.find((h) => h.channel === IpcChannel.HoldList)!.handler as (p: unknown) => HoldCenterView)({});
  const resolve = (req: unknown) => (handlers.find((h) => h.channel === IpcChannel.HoldResolve)!.handler as (p: unknown) => HoldRecord | null)(req);
  return { holds, decisions, raise, audit, list, resolve };
}

function depsFor(journal: DurableCommandJournal, raise: HoldRaiser): HeldCommandHoldDeps {
  return { heldIntentsFor: (t) => journal.heldIntents(t), raise: (intent) => raise(buildHeldCommandHoldInput(intent)) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
});

const A: TenantScope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
const B: TenantScope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };

describe('S44 · the pure held-command hold mapper is honest', () => {
  it('maps to verification_unavailable, states what is NOT known, and leaks no tenant/secret', () => {
    const input = buildHeldCommandHoldInput({ idempotencyKey: 'so-create-abc', reservedAt: '2026-09-02T12:00:00.000Z', reason: 'reconciliation required after unclean shutdown' });
    expect(input.reason).toBe('verification_unavailable');
    expect(input.subject).toBe('command-hold:so-create-abc');
    expect(input.known.join(' ')).toContain('so-create-abc');
    // The ambiguity is stated explicitly — the effect's existence is UNKNOWN, never assumed.
    expect(input.unknown.join(' ')).toMatch(/whether the underlying business effect/i);
    expect(input.unknown.join(' ')).toMatch(/which command/i);
    // Forbids blind retry; no tenant id anywhere on the surfaced hold.
    expect(input.resolution).toMatch(/do not re-run|new governed action/i);
    expect(JSON.stringify(input)).not.toMatch(/tenant-A|ws-A/);
  });
});

describe('S44 · operator authority is the existing governance permission', () => {
  it('HoldResolve requires governance:manage and HoldList requires governance:read (no new permission)', () => {
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldResolve]).toBe('governance:manage');
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.HoldList]).toBe('governance:read');
  });
});

describe('S44 · surface + resolve through the canonical Hold Center', () => {
  it('REPRODUCE-FIRST: a real held intent exists but NO hold is surfaced (the S44 gap)', async () => {
    const { journal } = await makeHeldJournal(tmp('gap'), 'kGAP');
    expect(journal.heldIntents('tenant-A').map((h) => h.idempotencyKey)).toContain('kGAP');
    const center = await makeHoldCenter(tmp('gap-hc'), A);
    expect(center.list().open).toHaveLength(0); // the held command is invisible to the operator — the gap
  });

  it('after surfacing, the held command is an OPEN hold with truthful known/unknown', async () => {
    const { journal } = await makeHeldJournal(tmp('surf'), 'kS');
    const center = await makeHoldCenter(tmp('surf-hc'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const open = center.list().open;
    expect(open).toHaveLength(1);
    expect(open[0].reason).toBe('verification_unavailable');
    expect(open[0].status).toBe('open');
    expect(open[0].known.join(' ')).toContain('kS');
    expect(open[0].unknown.length).toBeGreaterThan(0);
  });

  it('an authorized resolve closes the hold, writes a Decision Record, and audits — no re-execution', async () => {
    const { journal, orders } = await makeHeldJournal(tmp('res'), 'kR');
    await orders.reload();
    const ordersBefore = orders.all().length;
    const center = await makeHoldCenter(tmp('res-hc'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const hold = center.list().open[0];

    const resolved = center.resolve({ id: hold.id, outcome: 'took_alternative', note: 'Confirmed the order was not created; handled manually.' });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedOutcome).toBe('took_alternative');
    // a Decision Record paired to the hold exists.
    expect(center.decisions.forSubject(hold.subject).some((r) => r.holdId === hold.id)).toBe(true);
    // audit carries the resolution.
    expect(center.audit.some((a) => a.startsWith('hold.resolved|'))).toBe(true);
    // NO ERP RE-EXECUTION: the journal intent stays HELD and the order store is untouched.
    expect(journal.heldIntents('tenant-A').map((h) => h.idempotencyKey)).toContain('kR');
    await orders.reload();
    expect(orders.all().length).toBe(ordersBefore);
  });

  it('a malformed resolve request is rejected fail-closed by the schema', () => {
    expect(() => HoldResolveRequest.parse({ id: 'hold_x', outcome: 'definitely_done' })).toThrow();
    expect(() => HoldResolveRequest.parse({ outcome: 'proceeded' })).toThrow(); // missing id
    expect(() => HoldResolveRequest.parse({ id: 'hold_x', outcome: 'proceeded', evil: 1 })).toThrow(); // .strict()
  });

  it('duplicate surfacing ticks produce exactly ONE hold (dedupe by subject)', async () => {
    const { journal } = await makeHeldJournal(tmp('dup'), 'kD');
    const center = await makeHoldCenter(tmp('dup-hc'), A);
    const deps = depsFor(journal, center.raise);
    surfaceHeldHolds('tenant-A', deps);
    surfaceHeldHolds('tenant-A', deps);
    surfaceHeldHolds('tenant-A', deps);
    expect(center.list().open).toHaveLength(1);
  });

  it('a duplicate resolve is a no-op — one authoritative outcome, one decision record', async () => {
    const { journal } = await makeHeldJournal(tmp('dupres'), 'kDR');
    const center = await makeHoldCenter(tmp('dupres-hc'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const hold = center.list().open[0];
    const first = center.resolve({ id: hold.id, outcome: 'cancelled' });
    const second = center.resolve({ id: hold.id, outcome: 'proceeded' }); // a second, conflicting attempt
    expect(first?.status).toBe('resolved');
    expect(second).toBeNull(); // already resolved — refused
    expect(center.list().resolved.filter((h) => h.id === hold.id)).toHaveLength(1);
    expect(center.decisions.forSubject(hold.subject).filter((r) => r.holdId === hold.id && r.requestedAction.startsWith('Resolve hold'))).toHaveLength(1);
  });

  it('concurrent resolves against one hold yield exactly one durable resolution', async () => {
    const { journal } = await makeHeldJournal(tmp('cc'), 'kCC');
    const center = await makeHoldCenter(tmp('cc-hc'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const hold = center.list().open[0];
    const results = await Promise.all([
      Promise.resolve().then(() => center.resolve({ id: hold.id, outcome: 'cancelled' })),
      Promise.resolve().then(() => center.resolve({ id: hold.id, outcome: 'took_alternative' })),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1); // exactly one wins
    expect(center.list().resolved.filter((h) => h.id === hold.id)).toHaveLength(1);
  });

  it('the resolution survives a restart — a resolved hold is NOT re-presented as unresolved', async () => {
    const dir = tmp('restart-hc');
    const { journal } = await makeHeldJournal(tmp('restart-j'), 'kRS');
    const center = await makeHoldCenter(dir, A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const hold = center.list().open[0];
    center.resolve({ id: hold.id, outcome: 'took_alternative', note: 'reconciled' });
    await Promise.all([center.holds.flush(), center.decisions.flush()]);

    // RESTART: fresh stores over the same files.
    const holds2 = new HoldStore(join(dir, 'holds.json'));
    holds2.bindScope(() => A);
    await holds2.load();
    expect(holds2.openHolds()).toHaveLength(0); // not re-presented as open
    expect(holds2.get(hold.id)?.status).toBe('resolved'); // still resolved
  });
});

describe('S44 · tenant isolation — a hold is visible and resolvable ONLY in its own tenant', () => {
  it('surfacing reads only the scoped tenant, and tenant B can neither see nor resolve tenant A’s hold', async () => {
    const { journal } = await makeHeldJournal(tmp('iso'), 'kISO', 'tenant-A');
    // Tenant A surfaces + sees its hold.
    const centerA = await makeHoldCenter(tmp('iso-a'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, centerA.raise));
    const holdA = centerA.list().open[0];
    expect(holdA).toBeTruthy();

    // The journal reader is tenant-filtered: tenant B has no held intents at all.
    expect(journal.heldIntents('tenant-B')).toHaveLength(0);

    // A Hold Center scoped to tenant B (same files would still be tenant-filtered by the store) sees nothing,
    // and cannot resolve A's hold id.
    const centerB = await makeHoldCenter(tmp('iso-b'), B);
    surfaceHeldHolds('tenant-B', depsFor(journal, centerB.raise)); // nothing to surface for B
    expect(centerB.list().open).toHaveLength(0);
    expect(centerB.resolve({ id: holdA.id, outcome: 'cancelled' })).toBeNull(); // cross-tenant resolve refused
  });
});

describe('S44 · S40 invariant remains intact — surfacing never re-executes or clears the guard', () => {
  it('after surface + resolve, a same-key dispatch STILL returns the fail-closed HOLD (never a re-run)', async () => {
    const dir = tmp('s40');
    const { journal } = await makeHeldJournal(dir, 'kS40');
    const center = await makeHoldCenter(tmp('s40-hc'), A);
    surfaceHeldHolds('tenant-A', depsFor(journal, center.raise));
    const hold = center.list().open[0];
    center.resolve({ id: hold.id, outcome: 'took_alternative' });

    // The journal's fail-closed guard is untouched by the operator decision: the intent is still HELD, so a
    // same-key retry is still refused. Resolving the OPERATOR hold records a human decision; it does NOT
    // license a silent replay of the ambiguous command.
    const retry = (await journal.run({
      tenantId: 'tenant-A', idempotencyKey: 'kS40', commandId: 'cmd-retry', commandType: 'CreateSalesOrder',
      correlationId: 'c-retry', actor: 'op@np.dev', source: 'test', execute: async () => ({ ok: true }),
    })) as { ok: boolean; error?: string };
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe('RECONCILIATION_REQUIRED');
  });
});
