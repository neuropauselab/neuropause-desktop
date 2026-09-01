/**
 * ERP Session 22 — FG-ERP-LIVE-IPC. Proof that the governed platform command bus is LIVE through
 * the REAL secure bridge, driven exactly as a renderer invocation is: `runSecureHandler(def, payload,
 * deps)` — the transport-neutral core of the secure pipeline (auth gate → RBAC → zod validation →
 * bounded handler) — over the production `platform:command.dispatch` def, into the real command bus,
 * the real Session-18 durable journal (idempotency + transaction + event + outbox), and a real audit
 * sink. Only the principal + registry are injected (the composition seam runtimeCore fills with the
 * live singletons); everything downstream is the real platform stack.
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
  PURCHASE_REQUESTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createSupplierModule } from '../../enterprise/modules/procurement/supplierModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s22-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

const PROC_PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let sessionAuthed: boolean;
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;
let reqSeq = 0;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined,
    audit: (e) => audit.push(e),
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'op@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}
function fullPrincipal(over: Partial<Principal> = {}): Principal {
  return { actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PROC_PERMS, ...over };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  sessionAuthed = true;
  currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const suppliers = createSupplierModule(tmp('supp'));
  for (const m of [
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseRequestModule(tmp('pr')),
    createPurchaseOrderModule(tmp('po')),
    suppliers,
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx()); // exercise the same handler build the app uses
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({
    registry,
    journal,
    audit: (e) => audit.push(e),
    resolvePrincipal: () => currentPrincipal,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const bridgeDeps = () => ({ isAuthenticated: () => sessionAuthed });
type Opts = { target?: string; payload?: Record<string, unknown>; idem?: string; correlationId?: string; claimedTenantId?: string };
interface DispatchResult { ok: boolean; data?: { id?: string; purchaseOrderId?: string }; replayed?: boolean; error?: { code: string; message: string }; requestId: string; correlationId: string; operation: string }
// Drive the REAL secure pipeline exactly as the preload→IPC path does.
async function dispatch(operation: string, opts: Opts = {}): Promise<DispatchResult> {
  reqSeq += 1;
  return (await runSecureHandler(
    def,
    {
      operation,
      ...(opts.target ? { target: opts.target } : {}),
      payload: opts.payload ?? {},
      idempotencyKey: opts.idem ?? `idem_${operation}_${reqSeq}`,
      ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
      ...(opts.claimedTenantId ? { claimedTenantId: opts.claimedTenantId } : {}),
    },
    bridgeDeps(),
  )) as DispatchResult;
}
const prStore = () => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store;
const poStore = () => registry.get(PURCHASE_ORDERS_MODULE_ID)!.store;
const LINES = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);
async function createPR(idem = 'c1', num = 'PR-1'): Promise<string> {
  const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: num, lines: LINES }, idem });
  expect(r.ok).toBe(true);
  return String(r.data!.id);
}
async function approvedPR(idem: string, num: string): Promise<string> {
  const id = await createPR(idem, num);
  expect((await dispatch('SubmitPurchaseRequest', { target: id, idem: `${idem}-s` })).ok).toBe(true);
  expect((await dispatch('ApprovePurchaseRequest', { target: id, idem: `${idem}-a` })).ok).toBe(true);
  return id;
}

// ===========================================================================
// The complete governed chain through the REAL bridge
// ===========================================================================

describe('S22 · platform:command.dispatch is LIVE through the real secure bridge', () => {
  it('CreatePurchaseRequest traverses bridge → command bus → durable journal (event + outbox) + audit', async () => {
    const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-live', lines: LINES }, idem: 'k1', correlationId: 'corr-1' });
    expect(r.ok).toBe(true);
    expect(r.data!.id).toBeTruthy();
    expect(r.correlationId).toBe('corr-1');
    expect(r.operation).toBe('CreatePurchaseRequest');
    // durable transaction + event + outbox (the Session-18 journal), reused — not re-created here.
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('PurchaseRequestCreated');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    // audit persisted through the injected sink (governanceStore in production).
    expect(audit.some((a) => a.action === `module.${PURCHASE_REQUESTS_MODULE_ID}.created`)).toBe(true);
    // the PR really exists in the store, in tenant-A.
    expect(prStore().get(String(r.data!.id))).toBeTruthy();
  });

  it('the bridge AUTH GATE refuses an unauthenticated session before any handler runs', async () => {
    sessionAuthed = false;
    await expect(dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-x', lines: LINES }, idem: 'k2' })).rejects.toThrow(/Sign in/i);
    expect(prStore().list()).toHaveLength(0); // no mutation
  });

  it('the bridge SCHEMA VALIDATION refuses a malformed request (missing idempotencyKey)', async () => {
    await expect(
      runSecureHandler(def, { operation: 'CreatePurchaseRequest', payload: {} }, bridgeDeps()),
    ).rejects.toThrow(/Invalid request/i);
  });

  it('app-boundary UNAUTHENTICATED when the session is authed but no principal resolves (fail-closed)', async () => {
    currentPrincipal = null;
    const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-n', lines: LINES }, idem: 'k3' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHENTICATED');
    expect(prStore().list()).toHaveLength(0);
  });

  it('UNAUTHORIZED when the principal lacks procurement:manage — no economic mutation', async () => {
    currentPrincipal = fullPrincipal({ permissions: ['procurement:read'] });
    const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-z', lines: LINES }, idem: 'k4' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(prStore().list()).toHaveLength(0);
  });

  it('unknown operation → VALIDATION_ERROR (deny-by-default at the command bus)', async () => {
    const r = await dispatch('DropAllTables', { idem: 'k5' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
  });

  it('errors return only the closed contract — no internal detail leaks', async () => {
    currentPrincipal = fullPrincipal({ permissions: [] });
    const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-s', lines: LINES }, idem: 'k6' });
    expect(r.error!.message).toBe('You are not authorized to perform this operation.');
    expect(JSON.stringify(r)).not.toMatch(/Error:|\.json|\/Users\/|tmp|stack/i);
  });
});

// ===========================================================================
// Procurement E2E + PR invariants through the LIVE channel
// ===========================================================================

describe('S22 · procurement PR → approve → convert through the live channel', () => {
  it('submit → approve → convert creates the PO, and convert enforces status=approved at the command path', async () => {
    const id = await approvedPR('e2e', 'PR-e2e');
    expect(String(prStore().get(id)!.fields.status)).toBe('approved');
    const conv = await dispatch('ConvertPurchaseRequestToPO', { target: id, idem: 'e2e-c' });
    expect(conv.ok).toBe(true);
    const poId = String(conv.data!.purchaseOrderId);
    expect(poId).toBeTruthy();
    expect(poStore().get(poId)).toBeTruthy(); // PO really created via the command path
  });

  it('a PENDING purchase request cannot be converted (CONFLICT — no approval skip)', async () => {
    const id = await createPR('pend', 'PR-pend');
    expect((await dispatch('SubmitPurchaseRequest', { target: id, idem: 'pend-s' })).ok).toBe(true);
    const conv = await dispatch('ConvertPurchaseRequestToPO', { target: id, idem: 'pend-c' });
    expect(conv.ok).toBe(false);
    expect(conv.error!.code).toBe('CONFLICT');
    expect(poStore().list()).toHaveLength(0);
  });

  it('a REJECTED purchase request cannot be converted', async () => {
    const id = await createPR('rej', 'PR-rej');
    expect((await dispatch('SubmitPurchaseRequest', { target: id, idem: 'rej-s' })).ok).toBe(true);
    expect((await dispatch('RejectPurchaseRequest', { target: id, idem: 'rej-r' })).ok).toBe(true);
    const conv = await dispatch('ConvertPurchaseRequestToPO', { target: id, idem: 'rej-c' });
    expect(conv.ok).toBe(false);
    expect(conv.error!.code).toBe('CONFLICT');
    expect(poStore().list()).toHaveLength(0);
  });

  it('an already-converted PR cannot mint a duplicate PO', async () => {
    const id = await approvedPR('dup', 'PR-dup');
    expect((await dispatch('ConvertPurchaseRequestToPO', { target: id, idem: 'dup-c1' })).ok).toBe(true);
    const again = await dispatch('ConvertPurchaseRequestToPO', { target: id, idem: 'dup-c2' });
    expect(again.ok).toBe(false); // convertedOrder guard
    expect(poStore().list()).toHaveLength(1); // exactly one PO
  });
});

// ===========================================================================
// Idempotency + tenant isolation through the live channel
// ===========================================================================

describe('S22 · idempotency + tenant isolation at the live boundary', () => {
  it('100 concurrent identical CreatePurchaseRequest → exactly ONE PR', async () => {
    const reqs = Array.from({ length: 100 }, () => dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-once', lines: LINES }, idem: 'once' }));
    const results = await Promise.all(reqs);
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => String(r.data!.id)));
    expect(ids.size).toBe(1); // one economic effect
    expect(prStore().list()).toHaveLength(1);
    expect(journal.records('tenant-A')).toHaveLength(1);
    const after = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-once', lines: LINES }, idem: 'once' });
    expect(after.replayed).toBe(true);
    expect(String(after.data!.id)).toBe([...ids][0]);
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a tenant other than the principal', async () => {
    const r = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-t', lines: LINES }, idem: 'kt', claimedTenantId: 'tenant-EVIL' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(prStore().list()).toHaveLength(0);
  });

  it('two tenants with the same idempotency key are independent (no cross-tenant dedupe)', async () => {
    expect((await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-a', lines: LINES }, idem: 'shared' })).ok).toBe(true);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    currentPrincipal = fullPrincipal();
    const b = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-b', lines: LINES }, idem: 'shared' });
    expect(b.ok).toBe(true);
    expect(b.replayed).toBeFalsy();
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.records('tenant-B')).toHaveLength(1);
  });

  it('survives a restart: the durable journal reloads and the key still replays (no duplicate effect)', async () => {
    const first = await createPR('durable', 'PR-durable');
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
    const replay = await dispatch('CreatePurchaseRequest', { payload: { requestNumber: 'PR-durable', lines: LINES }, idem: 'durable' });
    expect(replay.replayed).toBe(true);
    expect(String(replay.data!.id)).toBe(first);
    expect(prStore().list()).toHaveLength(1);
  });
});
