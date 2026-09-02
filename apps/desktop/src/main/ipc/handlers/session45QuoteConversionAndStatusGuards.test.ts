/**
 * ERP Session 45 — closing the last O2C bypasses at the MAIN layer.
 *
 *   ConvertQuoteToSalesOrder — the quote→order conversion becomes a governed command (exact
 *   precedent: ConvertPurchaseRequestToPO). Before S45 the conversion ran ONLY through the legacy
 *   `enterprise:module.action` door: real Sales Orders were minted via direct store.create around
 *   the governed create — no journal, no idempotency, no domain event, no outbox.
 *
 *   Status-machine edit guards — the production EDIT door could hand-flip an order to `shipped`
 *   (moving NO stock, silently becoming invoiceable) and an invoice from `draft` into the issued
 *   family (booking real Dr AR / Cr Revenue outside the governed `issue` action). The module
 *   validate hooks now refuse a status change on update; transitions belong to the lifecycle
 *   actions. Creates, the conversion path (create-shaped input), and the actions themselves are
 *   untouched.
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
  IpcChannel,
  FINANCE_MODULE_ID,
  ORDERS_MODULE_ID,
  QUOTES_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createQuoteModule } from '../../enterprise/modules/sales/quoteModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s45-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-02T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createInvoiceModule(tmp('inv')),
    createOrderModule(tmp('so')),
    createQuoteModule(tmp('q')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: (e) => audit.push(e), resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const quote = (id: string) => registry.get(QUOTES_MODULE_ID)!.store.get(id)!;
const order = (id: string) => registry.get(ORDERS_MODULE_ID)!.store.get(id)!;
const orders = () => registry.get(ORDERS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted');

interface DispatchResult { ok: boolean; data?: { id?: string; orderId?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function dispatch(operation: string, target: string | undefined, idem: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation, ...(target ? { target } : {}), payload: {}, idempotencyKey: idem },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}

async function acceptedQuote(quoteNumber = 'Q-1'): Promise<string> {
  const q = await createIn(QUOTES_MODULE_ID, {
    quoteNumber, customer: 'Acme Inc.', status: 'accepted', currency: 'USD', subtotal: 500, total: 500,
  });
  expect(q.ok).toBe(true);
  return q.record!.id;
}

// ===========================================================================
// ConvertQuoteToSalesOrder — the governed conversion
// ===========================================================================

describe('S45 · ConvertQuoteToSalesOrder through the live governed path', () => {
  it('converts an ACCEPTED quote: pending order minted, quote cross-linked, event journaled', async () => {
    const qid = await acceptedQuote('Q-1');

    const r = await dispatch('ConvertQuoteToSalesOrder', qid, 'conv1');
    expect(r.ok).toBe(true);
    const orderId = String(r.data!.orderId);
    expect(orderId).toBeTruthy();
    // the order is born PENDING through the same validate hook the governed create uses.
    expect(String(order(orderId).fields.status)).toBe('pending');
    // the quote is retained + cross-linked, never deleted.
    expect(String(quote(qid).fields.status)).toBe('converted');
    expect(String(quote(qid).fields.convertedOrder)).toBe(orderId);
    // the conversion is a first-class domain event in the durable journal.
    expect(journal.records(scope.tenantId).some((r2) => r2.event.type === 'QuoteConvertedToSalesOrder')).toBe(true);
  });

  it('REPLAYS on the same idempotency key — exactly one order, ever', async () => {
    const qid = await acceptedQuote('Q-2');
    const a = await dispatch('ConvertQuoteToSalesOrder', qid, 'conv2');
    expect(a.ok).toBe(true);
    const b = await dispatch('ConvertQuoteToSalesOrder', qid, 'conv2');
    expect(b.ok).toBe(true);
    expect(b.replayed).toBe(true);
    expect(orders()).toHaveLength(1);
  });

  it('refuses a NON-accepted quote (the action guard holds on the governed path)', async () => {
    const q = await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-d', customer: 'Acme', status: 'draft', currency: 'USD', subtotal: 100, total: 100 });
    const r = await dispatch('ConvertQuoteToSalesOrder', q.record!.id, 'convd');
    expect(r.ok).toBe(false);
    expect(orders()).toHaveLength(0);
  });

  it('refuses a missing target (a conversion always names its quote)', async () => {
    const r = await dispatch('ConvertQuoteToSalesOrder', undefined, 'convx');
    expect(r.ok).toBe(false);
    expect(orders()).toHaveLength(0);
  });

  it('a DOUBLE conversion with a NEW key is refused by the quote status guard (no second order)', async () => {
    const qid = await acceptedQuote('Q-3');
    expect((await dispatch('ConvertQuoteToSalesOrder', qid, 'c3a')).ok).toBe(true);
    const again = await dispatch('ConvertQuoteToSalesOrder', qid, 'c3b');
    expect(again.ok).toBe(false); // quote is now `converted`, not `accepted`
    expect(orders()).toHaveLength(1);
  });
});

// ===========================================================================
// Status-machine edit guards — the edit door can no longer hand-set lifecycle
// ===========================================================================

describe('S45 · the EDIT door can no longer hand-set machine-owned status', () => {
  it('order: pending → shipped via UPDATE is refused (no stock moved ⇒ no hand-flip)', async () => {
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-1', customer: 'Acme', currency: 'USD', total: 100 });
    expect(o.ok).toBe(true);
    const r = await updateIn(ORDERS_MODULE_ID, o.record!.id, { ...o.record!.fields, status: 'shipped' });
    expect(r.ok).toBe(false);
    expect(String(r.errors?.status ?? '')).toMatch(/lifecycle actions/i);
    expect(String(order(o.record!.id).fields.status)).toBe('pending');
  });

  it('order: an ordinary edit that keeps the SAME status still saves', async () => {
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-2', customer: 'Acme', currency: 'USD', total: 100 });
    const r = await updateIn(ORDERS_MODULE_ID, o.record!.id, { ...o.record!.fields, status: 'pending', notes: 'rush order' });
    expect(r.ok).toBe(true);
    expect(String(order(o.record!.id).fields.notes)).toBe('rush order');
  });

  it('invoice: draft → issued via UPDATE is refused (GL belongs to the Issue action)', async () => {
    const inv = await createIn(FINANCE_MODULE_ID, { number: 'INV-1', customer: 'Acme', amount: 900, currency: 'USD', status: 'draft' });
    expect(inv.ok).toBe(true);
    const r = await updateIn(FINANCE_MODULE_ID, inv.record!.id, { ...inv.record!.fields, status: 'issued' });
    expect(r.ok).toBe(false);
    expect(String(r.errors?.status ?? '')).toMatch(/Issue and Cancel actions/i);
  });

  it('invoice: an ordinary edit that keeps DRAFT still saves', async () => {
    const inv = await createIn(FINANCE_MODULE_ID, { number: 'INV-2', customer: 'Acme', amount: 100, currency: 'USD', status: 'draft' });
    const r = await updateIn(FINANCE_MODULE_ID, inv.record!.id, { ...inv.record!.fields, status: 'draft', notes: 'net 30' });
    expect(r.ok).toBe(true);
  });

  it('a STATUS-LESS stored record (importer-minted shape) is still editable — no lockout', async () => {
    // Importer rows bypass hooks.validate and may carry no status; the guard must not compare
    // the default-filled supplied status against an empty stored one and refuse every edit.
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-IMP', customer: 'Acme', currency: 'USD', total: 50 });
    const raw = registry.get(ORDERS_MODULE_ID)!.store;
    raw.update(o.record!.id, { fields: { ...o.record!.fields, status: '' }, actor: 'importer', now: '2026-09-02T12:00:00.000Z' });
    const r = await updateIn(ORDERS_MODULE_ID, o.record!.id, { orderNumber: 'SO-IMP', customer: 'Acme', currency: 'USD', total: 75 });
    expect(r.ok).toBe(true);
    expect(Number(order(o.record!.id).fields.total)).toBe(75);
  });

  it('the lifecycle ACTION path is untouched by the guard (cancel still works)', async () => {
    const o = await createIn(ORDERS_MODULE_ID, { orderNumber: 'SO-3', customer: 'Acme', currency: 'USD', total: 100 });
    const act = (await H(IpcChannel.EnterpriseModuleAction)({ moduleId: ORDERS_MODULE_ID, id: o.record!.id, action: 'cancel' })) as { ok: boolean };
    expect(act.ok).toBe(true);
    expect(String(order(o.record!.id).fields.status)).toBe('cancelled');
  });
});
