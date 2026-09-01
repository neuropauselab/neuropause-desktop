/**
 * ERP Session 21 — client / API adapter boundary (Track B) + Sales Order domain
 * over the platform command path (Track A).
 *
 * The adapter is the outermost governed seam: a serializable `ClientRequest`
 * carrying ZERO authority → the adapter resolves the principal server-side →
 * `handleApplicationRequest` → the SAME command bus → durable journal (idempotency
 * + transaction + event + outbox) → audit. Sales becomes ANOTHER consumer of the
 * identical platform primitives — no second authorization, transaction, event or
 * audit engine, and no bypass for an AI agent.
 *
 * These tests drive the real registry, the real durable journal, and the real
 * Sales Order + Customer modules through the real adapter classes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  CUSTOMERS_MODULE_ID,
  ORDERS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { DurableCommandJournal } from '../command/durableCommandJournal';
import { mapCommandError, safeMessage } from '../application/applicationErrors';
import type { Principal } from '../application/requestContext';
import {
  AIAdapter,
  TestClientAdapter,
  type Authenticator,
  type ClientAdapterDeps,
  type ClientRequest,
} from './clientAdapter';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s21-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

const SALES_PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'crm:read', 'crm:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let audit: { action: string }[];
let idSeq = 0;

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

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  idSeq = 0;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createOrderModule(tmp('so')),
    createCustomerModule(tmp('cust')),
  ]) registry.register(m);
  // Principal-aware scope binding — the true multi-tenant resolution (a background
  // principal wins over the session), so concurrency across tenants is honest.
  registry.bindScope(() => resolveTenantScope(() => scope));
  buildModuleHandlers(registry, moduleCtx()); // exercises the same handler build the app uses
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

// ---- adapter wiring -------------------------------------------------------
function authFor(getP: () => Principal | null): Authenticator {
  return { resolvePrincipal: getP };
}
function fullPrincipal(overrides: Partial<Principal> = {}): Principal {
  return { actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: SALES_PERMS, ...overrides };
}
function adapterDeps(auth: Authenticator): ClientAdapterDeps {
  return {
    registry,
    journal,
    audit: (e) => audit.push(e),
    now: () => '2026-09-01T12:00:00.000Z',
    authenticator: auth,
    newRequestId: () => `req_${(idSeq += 1)}`,
  };
}
const testAdapter = (getP: () => Principal | null = () => fullPrincipal()) => new TestClientAdapter(adapterDeps(authFor(getP)));
const aiAdapter = (getP: () => Principal | null = () => fullPrincipal()) => new AIAdapter(adapterDeps(authFor(getP)));

const LINES = JSON.stringify([
  { sku: 'SKU-A', quantity: 10, unitPrice: 5 },
  { sku: 'SKU-B', quantity: 2, unitPrice: 20 },
]);
const soReq = (over: Partial<ClientRequest> = {}): ClientRequest => ({
  operation: 'CreateSalesOrder',
  payload: { orderNumber: `SO-${over.idempotencyKey ?? 'x'}`, customer: 'Acme Inc.', lines: LINES },
  idempotencyKey: `idem_${over.idempotencyKey ?? 'x'}`,
  ...over,
});

const orderStore = () => registry.get(ORDERS_MODULE_ID)!.store;
const journalEntries = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().length;
async function seedCustomer(name = 'Acme Inc.'): Promise<string> {
  const r = (await (buildModuleHandlers(registry, moduleCtx()).find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>)({
    moduleId: CUSTOMERS_MODULE_ID,
    fields: { name, customerCode: `CUST-${name}` },
  })) as { ok: boolean; record?: EnterpriseEntity };
  expect(r.ok).toBe(true);
  return r.record!.id;
}

// ===========================================================================
// TRACK B + A — adapter → application → command → Sales Order
// ===========================================================================

describe('S21 · client adapter → Sales Order through the governed platform path', () => {
  it('CreateSalesOrder runs the full governed flow and emits a durable event + outbox + audit', async () => {
    const res = await testAdapter().submit(soReq({ idempotencyKey: '1' }));
    expect(res.ok).toBe(true);
    expect(res.event?.type).toBe('SalesOrderCreated');
    expect(res.data?.id).toBeTruthy();
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1); // outbox reused, not adapter-created
    expect(audit.some((a) => a.action === `module.${ORDERS_MODULE_ID}.created`)).toBe(true); // audit reused
    // The order really exists in the sales-orders store, in tenant-A.
    const so = orderStore().get(String(res.data!.id))!;
    expect(so).toBeTruthy();
    expect(String(so.fields.orderNumber)).toBe('SO-1');
  });

  it('the multi-line order derives its total from the lines (Σ qty × unit price — arithmetic, not a pricing policy)', async () => {
    const res = await testAdapter().submit(soReq({ idempotencyKey: 'tot' }));
    const so = orderStore().get(String(res.data!.id))!;
    expect(Number(so.fields.total)).toBe(10 * 5 + 2 * 20); // 90
  });

  it('a create is ALWAYS pending — a client cannot mint a shipped order via `status`', async () => {
    const res = await testAdapter().submit(soReq({ idempotencyKey: 'st', payload: { orderNumber: 'SO-st', customer: 'Acme', lines: LINES, status: 'shipped' } }));
    expect(res.ok).toBe(true);
    expect(String(orderStore().get(String(res.data!.id))!.fields.status)).toBe('pending');
  });

  it('a valid customerRef in the caller\'s own tenant is accepted', async () => {
    const custId = await seedCustomer();
    const res = await testAdapter().submit(soReq({ idempotencyKey: 'cust', payload: { orderNumber: 'SO-c', customer: 'Acme Inc.', customerRef: custId, lines: LINES } }));
    expect(res.ok).toBe(true);
    expect(String(orderStore().get(String(res.data!.id))!.fields.customerRef)).toBe(custId);
  });

  it('creating a Sales Order posts NO GL (an order is a commitment; revenue is out of scope this session)', async () => {
    await testAdapter().submit(soReq({ idempotencyKey: 'nogl' }));
    expect(journalEntries()).toBe(0);
  });
});

describe('S21 · deterministic error contract (incl. APPROVAL_REQUIRED)', () => {
  it('UNAUTHENTICATED when the adapter resolves no principal', async () => {
    const res = await testAdapter(() => null).submit(soReq({ idempotencyKey: 'u' }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('UNAUTHENTICATED');
    expect(orderStore().list()).toHaveLength(0);
  });

  it('UNAUTHORIZED when the principal lacks sales:manage — no economic mutation', async () => {
    const res = await testAdapter(() => fullPrincipal({ permissions: ['sales:read'] })).submit(soReq({ idempotencyKey: 'z' }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('UNAUTHORIZED');
    expect(orderStore().list()).toHaveLength(0);
  });

  it('VALIDATION_ERROR for an unknown operation (deny-by-default at the bus)', async () => {
    const res = await testAdapter().submit({ operation: 'DropAllTables', payload: {}, idempotencyKey: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('VALIDATION_ERROR');
  });

  it('VALIDATION_ERROR for an invalid Sales Order payload (missing required orderNumber)', async () => {
    const res = await testAdapter().submit({ operation: 'CreateSalesOrder', payload: { customer: 'Acme' }, idempotencyKey: 'inv' });
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('VALIDATION_ERROR');
  });

  it('errors expose only the fixed safe message — never internal detail', async () => {
    const res = await testAdapter().submit({ operation: 'CreateSalesOrder', payload: { customer: 'Acme' }, idempotencyKey: 'safe' });
    expect(res.error!.message).toBe('The request was not valid.');
    expect(JSON.stringify(res)).not.toMatch(/Error:|\.json|\/Users\/|stack|tmp/i);
  });

  it('APPROVAL_REQUIRED is part of the closed contract with a fixed safe message', () => {
    expect(mapCommandError('APPROVAL_REQUIRED')).toBe('APPROVAL_REQUIRED');
    expect(safeMessage('APPROVAL_REQUIRED')).toBe('This operation requires approval before it can proceed.');
  });

  it('a misbehaving authenticator never leaks — mapped to TRANSIENT_FAILURE', async () => {
    const res = await testAdapter(() => { throw new Error('secret at /Users/op/.vault/key.json'); }).submit(soReq({ idempotencyKey: 'boom' }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('TRANSIENT_FAILURE');
    expect(JSON.stringify(res)).not.toMatch(/secret|\/Users\/|\.vault/i);
  });
});

describe('S21 · idempotency (Session 18 durable journal reused)', () => {
  it('100 concurrent submits with the same key → exactly ONE Sales Order (single-flight coalescing)', async () => {
    const reqs = Array.from({ length: 100 }, () => testAdapter().submit(soReq({ idempotencyKey: 'once' })));
    const results = await Promise.all(reqs);
    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => String(r.data!.id)));
    expect(ids.size).toBe(1); // one economic effect — all 100 callers got the same id
    expect(orderStore().list()).toHaveLength(1); // exactly one physical order
    expect(journal.records('tenant-A')).toHaveLength(1); // one committed command
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1); // one outbox entry
    // A SUBSEQUENT submit of the same key now finds the durable record → replay.
    const after = await testAdapter().submit(soReq({ idempotencyKey: 'once' }));
    expect(after.replayed).toBe(true);
    expect(String(after.data!.id)).toBe([...ids][0]);
    expect(orderStore().list()).toHaveLength(1); // still one — no new effect
  });

  it('survives a restart: the outbox persists and the key still replays', async () => {
    const first = await testAdapter().submit(soReq({ idempotencyKey: 'durable' }));
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
    const replay = await testAdapter().submit(soReq({ idempotencyKey: 'durable' }));
    expect(replay.replayed).toBe(true);
    expect(replay.data!.id).toBe(first.data!.id);
  });
});

describe('S21 · tenant isolation (§16)', () => {
  it('TENANT_SCOPE_VIOLATION when the client claims a tenant other than its principal', async () => {
    const res = await testAdapter().submit(soReq({ idempotencyKey: 'x', claimedTenantId: 'tenant-EVIL' }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(orderStore().list()).toHaveLength(0);
  });

  it('a Sales Order cannot reference another tenant\'s customer — the foreign master is invisible (NOT_FOUND)', async () => {
    // Seed a customer in tenant-B.
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreignCustomer = await seedCustomer('Globex');
    // Switch back to tenant-A and try to reference tenant-B's customer.
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const res = await testAdapter().submit(soReq({ idempotencyKey: 'foreign', payload: { orderNumber: 'SO-f', customer: 'x', customerRef: foreignCustomer, lines: LINES } }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('NOT_FOUND'); // foreign or absent — indistinguishable by design
    expect(orderStore().list()).toHaveLength(0); // no order minted
  });

  it('two tenants with the same idempotency key are independent (no cross-tenant dedupe)', async () => {
    const a = await testAdapter().submit(soReq({ idempotencyKey: 'shared' }));
    expect(a.ok).toBe(true);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const b = await testAdapter().submit(soReq({ idempotencyKey: 'shared' }));
    expect(b.ok).toBe(true);
    expect(b.replayed).toBeFalsy();
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.records('tenant-B')).toHaveLength(1);
  });
});

describe('S21 · AI is just another client — no special authority, no bypass', () => {
  it('the AI adapter stamps source `agent` and reaches ERP only through the governed path', async () => {
    const res = await aiAdapter().submit(soReq({ idempotencyKey: 'ai' }));
    expect(res.ok).toBe(true);
    expect(res.event?.type).toBe('SalesOrderCreated');
    // source is attribution only — the event proves it went through the durable bus.
    expect(journal.records('tenant-A')).toHaveLength(1);
  });

  it('an AI acting for a principal WITHOUT sales:manage is refused UNAUTHORIZED (cannot self-grant)', async () => {
    const res = await aiAdapter(() => fullPrincipal({ permissions: ['sales:read'] })).submit(soReq({ idempotencyKey: 'ai-z' }));
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe('UNAUTHORIZED');
    expect(orderStore().list()).toHaveLength(0);
  });

  it('AI-smuggled authority in the payload (confirmed / permissions / tenantId / status) is inert data', async () => {
    const res = await aiAdapter().submit({
      operation: 'CreateSalesOrder',
      // Everything below is UNTRUSTED payload data — none of it is authority.
      payload: {
        orderNumber: 'SO-evil',
        customer: 'Acme',
        lines: LINES,
        confirmed: true,
        permissions: ['sales:manage', 'admin:all'],
        principal: { actor: 'root', tenantId: 'tenant-EVIL' },
        tenantId: 'tenant-EVIL',
        status: 'fulfilled',
      },
      idempotencyKey: 'ai-inert',
    });
    expect(res.ok).toBe(true);
    const so = orderStore().get(String(res.data!.id))!;
    expect(String(so.fields.status)).toBe('pending'); // status forced, not 'fulfilled'
    // The order is in the AUTHENTICATED tenant (A), never the payload-claimed 'tenant-EVIL'.
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.records('tenant-EVIL')).toHaveLength(0);
    expect(res.tenantId).toBeUndefined(); // client response carries no tenant echo
  });
});

describe('S21 · serializability + Electron independence', () => {
  it('a ClientRequest is pure serializable data (JSON round-trips and still works)', async () => {
    const req = soReq({ idempotencyKey: 'ser' });
    const roundTripped = JSON.parse(JSON.stringify(req)) as ClientRequest;
    expect(roundTripped).toEqual(req); // no functions, handles, or non-serializable fields
    const res = await testAdapter().submit(roundTripped);
    expect(res.ok).toBe(true);
  });

  it('the adapter + application + command + persistence layers import no Electron / React / IPC', async () => {
    const roots = [__dirname, join(__dirname, '../application'), join(__dirname, '../command'), join(__dirname, '../persistence')];
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const ent of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) await walk(p);
        else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) files.push(p);
      }
    };
    for (const r of roots) await walk(r);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = await fs.readFile(f, 'utf8');
      expect(src, `${f} must not import electron`).not.toMatch(/from ['"]electron['"]/);
      expect(src, `${f} must not import react`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${f} must not import ipcMain/BrowserWindow`).not.toMatch(/ipcMain|BrowserWindow/);
    }
  });
});
