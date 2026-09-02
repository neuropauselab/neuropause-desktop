/**
 * ERP Session 43 — GOVERNED SALES ORDER UI EXPOSURE (handler-layer certification).
 *
 * S42 found the decisive production gap: the certified governed ERP spine was "correct but dark" —
 * the production UI created Sales Orders through the NON-governed `enterprise:module.create` CRUD
 * door, never through `platform:command.dispatch` → command bus → journal/outbox/audit. S43 wires
 * the UI's Sales Order CREATE onto the governed path (see `session43GovernedSalesOrderUI.test.tsx`
 * for the UI-layer proof + the old-path bypass proof).
 *
 * This file certifies that the EXACT operation the UI now emits — `operation: 'CreateSalesOrder'`,
 * `payload: <form fields>`, a caller-supplied `idempotencyKey`, and NO client tenant — is bound to
 * the full governed guarantees when driven through the REAL secure pipeline (`runSecureHandler` over
 * the production `platform:command.dispatch` def, into the real command bus, the real Session-18
 * durable journal, and a real audit sink). It reuses the S22 harness shape; it does NOT re-implement
 * the S21 command itself, it proves the UI's operation reaches the certified guarantees.
 *
 * Delivery guarantee: at-least-once + idempotent consumer — NOT exactly-once (a duplicate key
 * REPLAYS to one durable order; it never creates a second).
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
  ORDERS_MODULE_ID,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s43-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

// The renderer's `sales:manage` write permission (the Orders module's declared `write`) plus the
// operational reads a governed session carries. Exactly the permission the CRUD create required —
// S43 changes the PATH, not the policy.
const SALES_PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

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
  return { actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: SALES_PERMS, ...over };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  sessionAuthed = true;
  currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  registry.register(createOrderModule(tmp('orders')));
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx()); // the same handler build the app uses
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
type Opts = { payload?: Record<string, unknown>; idem?: string; correlationId?: string; claimedTenantId?: string };
interface DispatchResult { ok: boolean; data?: { id?: string }; replayed?: boolean; error?: { code: string; message: string }; requestId: string; correlationId: string; operation: string }

/** Drive the REAL secure pipeline exactly as the preload→IPC path does for the UI's create. */
async function dispatchCreate(opts: Opts = {}): Promise<DispatchResult> {
  reqSeq += 1;
  return (await runSecureHandler(
    def,
    {
      operation: 'CreateSalesOrder',
      payload: opts.payload ?? { orderNumber: `SO-${reqSeq}`, customer: 'Acme Inc.' },
      idempotencyKey: opts.idem ?? `so_${reqSeq}`,
      ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
      ...(opts.claimedTenantId ? { claimedTenantId: opts.claimedTenantId } : {}),
    },
    bridgeDeps(),
  )) as DispatchResult;
}
const orderStore = () => registry.get(ORDERS_MODULE_ID)!.store;
const ordersInTenant = (t = scope.tenantId): number => journal.records(t).length;

describe('S43 · the UI Sales Order create reaches the full governed chain', () => {
  it('CreateSalesOrder traverses bridge → command bus → durable journal (event + outbox) + audit + persisted order', async () => {
    const r = await dispatchCreate({ payload: { orderNumber: 'SO-UI', customer: 'Acme Inc.' }, idem: 'k1', correlationId: 'corr-ui' });
    expect(r.ok).toBe(true);
    expect(r.data!.id).toBeTruthy();
    expect(r.operation).toBe('CreateSalesOrder');
    expect(r.correlationId).toBe('corr-ui');
    // durable transaction + domain event + outbox (the Session-18 journal), reused — not re-created.
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('SalesOrderCreated');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    // governance audit persisted through the injected sink (governanceStore in production).
    expect(audit.some((a) => a.action === `module.${ORDERS_MODULE_ID}.created`)).toBe(true);
    // the order really exists in the Sales Order store, in tenant-A, forced to `pending`.
    const rec = orderStore().get(String(r.data!.id));
    expect(rec).toBeTruthy();
    expect(rec!.fields.status).toBe('pending');
  });

  it('a client can NEVER mint a shipped order — status is forced pending even if fields say otherwise', async () => {
    const r = await dispatchCreate({ payload: { orderNumber: 'SO-hack', customer: 'X', status: 'shipped', fulfilledQty: 999 }, idem: 'k2' });
    expect(r.ok).toBe(true);
    expect(orderStore().get(String(r.data!.id))!.fields.status).toBe('pending');
  });

  it('UNAUTHORIZED before effect — a principal without sales:manage creates nothing', async () => {
    currentPrincipal = fullPrincipal({ permissions: ['sales:read'] });
    const r = await dispatchCreate({ payload: { orderNumber: 'SO-no', customer: 'X' }, idem: 'k3' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(orderStore().list()).toHaveLength(0);
    expect(ordersInTenant()).toBe(0);
  });

  it('UNAUTHENTICATED (authed session, no principal) → fail-closed, no order', async () => {
    currentPrincipal = null;
    const r = await dispatchCreate({ payload: { orderNumber: 'SO-n', customer: 'X' }, idem: 'k4' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHENTICATED');
    expect(orderStore().list()).toHaveLength(0);
  });

  it('the bridge auth gate refuses an unauthenticated session before any handler runs', async () => {
    sessionAuthed = false;
    await expect(dispatchCreate({ idem: 'k5' })).rejects.toThrow(/Sign in/i);
    expect(orderStore().list()).toHaveLength(0);
  });

  it('malformed request (missing idempotencyKey) is rejected fail-closed by schema validation', async () => {
    await expect(
      runSecureHandler(def, { operation: 'CreateSalesOrder', payload: { orderNumber: 'SO-m', customer: 'X' } }, bridgeDeps()),
    ).rejects.toThrow(/Invalid request/i);
    expect(orderStore().list()).toHaveLength(0);
  });

  it('DUPLICATE idempotency key → exactly ONE durable order (the UI-retry guarantee)', async () => {
    const a = await dispatchCreate({ payload: { orderNumber: 'SO-dup', customer: 'X' }, idem: 'same' });
    const b = await dispatchCreate({ payload: { orderNumber: 'SO-dup', customer: 'X' }, idem: 'same' });
    expect(a.ok && b.ok).toBe(true);
    expect(a.data!.id).toBe(b.data!.id); // the second REPLAYS the first
    expect(b.replayed).toBe(true);
    expect(orderStore().list()).toHaveLength(1);
    expect(ordersInTenant()).toBe(1);
  });

  it('CONCURRENT same-key submissions → one order (a double-submit / double-click)', async () => {
    const [a, b] = await Promise.all([
      dispatchCreate({ payload: { orderNumber: 'SO-cc', customer: 'X' }, idem: 'race' }),
      dispatchCreate({ payload: { orderNumber: 'SO-cc', customer: 'X' }, idem: 'race' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.data!.id).toBe(b.data!.id);
    expect(orderStore().list()).toHaveLength(1);
  });

  it('CONCURRENT different-key submissions → two independent orders', async () => {
    const [a, b] = await Promise.all([
      dispatchCreate({ payload: { orderNumber: 'SO-1', customer: 'X' }, idem: 'ra' }),
      dispatchCreate({ payload: { orderNumber: 'SO-2', customer: 'Y' }, idem: 'rb' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.data!.id).not.toBe(b.data!.id);
    expect(orderStore().list()).toHaveLength(2);
  });

  it('tenant is SERVER-RESOLVED — the renderer sends no tenant, and a mismatched claim is rejected', async () => {
    // No claimedTenantId (the S43 renderer path): the order lands in the principal's own tenant.
    const clean = await dispatchCreate({ payload: { orderNumber: 'SO-t', customer: 'X' }, idem: 'kt1' });
    expect(clean.ok).toBe(true);
    expect(journal.records('tenant-A')).toHaveLength(1);
    // A forged tenant claim is refused against the authenticated principal — no cross-tenant write.
    const forged = await dispatchCreate({ payload: { orderNumber: 'SO-t2', customer: 'X' }, idem: 'kt2', claimedTenantId: 'tenant-B' });
    expect(forged.ok).toBe(false);
    expect(forged.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(journal.records('tenant-B')).toHaveLength(0);
  });

  it('untrusted payload sets NO authority — injected actor/tenant/confirmed fields are ignored', async () => {
    const r = await dispatchCreate({
      payload: { orderNumber: 'SO-inj', customer: 'X', actor: 'attacker@evil.test', tenantId: 'tenant-B', confirmed: true, permissions: ['*'] },
      idem: 'kinj',
    });
    expect(r.ok).toBe(true);
    // The order was written under the RESOLVED principal/tenant — the injected authority did nothing.
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.records('tenant-B')).toHaveLength(0);
    expect(orderStore().get(String(r.data!.id))).toBeTruthy();
  });

  it('errors return only the closed contract — no internal path/stack detail leaks', async () => {
    currentPrincipal = fullPrincipal({ permissions: [] });
    const r = await dispatchCreate({ payload: { orderNumber: 'SO-e', customer: 'X' }, idem: 'ke' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/Error:|\.json|\/Users\/|tmpdir|stack/i);
  });
});
