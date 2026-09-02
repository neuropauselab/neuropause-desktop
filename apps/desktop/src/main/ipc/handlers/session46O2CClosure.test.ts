/**
 * ERP Session 46 — closing the remaining O2C governance hazards (main layer).
 *
 *  P5 · ORIGIN BOUNDARY on the legacy `enterprise:module.action` door. S43–S45 routed the O2C lifecycle
 *       actions through the governed command spine, but the legacy door still accepted those verbs from any
 *       authorized caller. Now a NOW-GOVERNED action (ship / convertToInvoice / issue / convertToOrder) is
 *       refused unless the SERVER-SIDE `INTERNAL_ACTION_ORIGIN` token is present — a token the command bus
 *       passes (calling the handler directly) and the renderer CANNOT forge (the request schema is
 *       `.strict()`, so an `origin` field is rejected at the bridge).
 *
 *  P3 · PAYMENT CLEARING FENCE. The transition into `cleared` books real cash GL (Dr Cash / Cr AR), so it
 *       must go through the governed `ReceiveCustomerPayment` command. A "create pending → edit to cleared"
 *       shortcut on the update door is now refused.
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
  ModuleActionRequest,
  FINANCE_MODULE_ID,
  PAYMENTS_MODULE_ID,
  QUOTES_MODULE_ID,
  ORDERS_MODULE_ID,
  orderActionPatch,
  type SalesOrder,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, INTERNAL_ACTION_ORIGIN, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createInvoiceModule } from '../../enterprise/modules/finance/invoiceModule';
import { createPaymentModule } from '../../enterprise/modules/finance/paymentModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createQuoteModule } from '../../enterprise/modules/sales/quoteModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s46-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'operations:read', 'operations:manage', 'crm:read', 'crm:manage'];

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
  const invoices = createInvoiceModule(tmp('inv'));
  for (const m of [
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    invoices,
    createPaymentModule(tmp('pay'), invoices.store),
    createOrderModule(tmp('so')),
    createQuoteModule(tmp('q')),
    createCustomerModule(tmp('cust')),
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
/** Call the legacy action door WITHOUT the internal origin — i.e. exactly as an external caller would. */
const actExternal = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; error?: string; message?: string }>;
/** Call it WITH the server-side origin — i.e. exactly as the command bus does internally. */
const actInternal = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action, origin: INTERNAL_ACTION_ORIGIN }) as Promise<{ ok: boolean; error?: string; message?: string }>;

interface DispatchResult { ok: boolean; data?: { id?: string; orderId?: string }; error?: { code: string; message: string } }
const dispatch = (operation: string, target: string | undefined, idem: string) =>
  runSecureHandler(def, { operation, ...(target ? { target } : {}), payload: {}, idempotencyKey: idem }, { isAuthenticated: () => true }) as Promise<DispatchResult>;

async function acceptedQuote(n = 'Q-1'): Promise<string> {
  const q = await createIn(QUOTES_MODULE_ID, { quoteNumber: n, customer: 'Acme Inc.', status: 'accepted', currency: 'USD', subtotal: 500, total: 500 });
  expect(q.ok).toBe(true);
  return q.record!.id;
}

// ===========================================================================
// P5 — the legacy action door refuses now-governed verbs from external callers
// ===========================================================================

describe('S46 · P5 — legacy action-door origin boundary', () => {
  it('REPRODUCE + CLOSE: an EXTERNAL convertToOrder (no origin token) is refused, minting no order', async () => {
    const qid = await acceptedQuote('Q-EXT');
    const before = registry.get(ORDERS_MODULE_ID)!.store.list().length;
    const r = await actExternal(QUOTES_MODULE_ID, qid, 'convertToOrder');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/governed command/i);
    expect(registry.get(ORDERS_MODULE_ID)!.store.list().length).toBe(before); // no bypass mint
  });

  it('the INTERNAL origin (as the command bus passes it) admits the same action', async () => {
    const qid = await acceptedQuote('Q-INT');
    const r = await actInternal(QUOTES_MODULE_ID, qid, 'convertToOrder');
    expect(r.ok).toBe(true);
  });

  it('the GOVERNED command still works end-to-end (the command bus carries the token internally)', async () => {
    const qid = await acceptedQuote('Q-GOV');
    const r = await dispatch('ConvertQuoteToSalesOrder', qid, 'k-gov');
    expect(r.ok).toBe(true);
    expect(r.data?.orderId).toBeTruthy();
  });

  it('every governed key is refused externally (ship, convertToInvoice, issue, convertToOrder)', async () => {
    // Targets need not exist — the origin guard fires before record lookup for a governed key.
    for (const [mod, act] of [[ORDERS_MODULE_ID, 'ship'], [ORDERS_MODULE_ID, 'convertToInvoice'], [QUOTES_MODULE_ID, 'convertToOrder']] as const) {
      const r = await actExternal(mod, 'rec_missing', act);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/governed command/i);
    }
  });

  it('a NON-governed action is UNAFFECTED on the legacy door (the guard is scoped)', async () => {
    const qid = await acceptedQuote('Q-NG');
    // `reserveStock` is not a governed key; an external call reaches the module (and refuses on its own
    // merits — no stock — not on the origin guard).
    const r = await actExternal(ORDERS_MODULE_ID, qid, 'nope-unknown');
    expect(r.error).toMatch(/unknown action/i); // reached the handler, not blocked by the origin guard
  });

  it('a renderer CANNOT forge the origin — the strict request schema rejects an `origin` field', () => {
    expect(() => ModuleActionRequest.parse({ moduleId: ORDERS_MODULE_ID, id: 'rec_1', action: 'ship' })).not.toThrow();
    expect(() => ModuleActionRequest.parse({ moduleId: ORDERS_MODULE_ID, id: 'rec_1', action: 'ship', origin: INTERNAL_ACTION_ORIGIN })).toThrow();
  });
});

// ===========================================================================
// P2 — the warehouse ship advances the order through the CANONICAL status machine, never a hand-set jump
// ===========================================================================

describe('S46 · P2 — warehouse ship routes order status through the canonical table', () => {
  const NOW = '2026-09-02T12:00:00.000Z';
  const so = (over: Partial<SalesOrder>): SalesOrder => ({ status: 'pending', orderedQty: 5, fulfilledQty: 0, ...over } as SalesOrder);

  it('a PENDING order advances legally pending → shipped → fulfilled (the two transitions the warehouse now applies)', () => {
    expect(orderActionPatch('ship', so({ status: 'pending' }), NOW)?.status).toBe('shipped');
    expect(orderActionPatch('fulfill', so({ status: 'shipped' }), NOW)?.status).toBe('fulfilled');
  });

  it('the ILLEGAL jump the old warehouse code forced (pending → fulfilled directly) is REFUSED by the table', () => {
    // `advanceLinkedOrderToFulfilled` calls `orderActionPatch('fulfill', ...)`; from `pending` that is null,
    // so the order is first shipped, never hand-jumped straight to fulfilled.
    expect(orderActionPatch('fulfill', so({ status: 'pending' }), NOW)).toBeNull();
  });

  it('a CANCELLED / CLOSED / already-FULFILLED order yields NO legal advance — the warehouse cannot force it', () => {
    for (const status of ['cancelled', 'closed', 'fulfilled'] as const) {
      expect(orderActionPatch('ship', so({ status }), NOW)).toBeNull();
      expect(orderActionPatch('fulfill', so({ status }), NOW)).toBeNull();
    }
  });
});

// ===========================================================================
// P3 — payment clearing fence
// ===========================================================================

describe('S46 · P3 — payment clearing must go through the governed command', () => {
  async function invoiceForPayment(): Promise<string> {
    const inv = await createIn(FINANCE_MODULE_ID, { number: 'INV-P', customer: 'Acme Inc.', amount: 200, status: 'issued', currency: 'USD' });
    expect(inv.ok).toBe(true);
    return String(inv.record!.fields.number ?? inv.record!.id);
  }

  it('REPRODUCE + CLOSE: a pending payment edited to `cleared` on the update door is refused', async () => {
    const invRef = await invoiceForPayment();
    const p = await createIn(PAYMENTS_MODULE_ID, { paymentNumber: 'PAY-1', invoiceRef: invRef, amount: 100, status: 'pending', currency: 'USD' });
    expect(p.ok).toBe(true);
    const edit = await updateIn(PAYMENTS_MODULE_ID, p.record!.id, { paymentNumber: 'PAY-1', invoiceRef: invRef, amount: 100, status: 'cleared', currency: 'USD' });
    expect(edit.ok).toBe(false);
    expect(edit.errors?.status).toMatch(/New Payment|cleared/i);
    // the payment stays pending — no accidental cash GL.
    expect(String(registry.get(PAYMENTS_MODULE_ID)!.store.get(p.record!.id)!.fields.status)).toBe('pending');
  });

  it('a pending payment can still be created and edited for NON-status fields', async () => {
    const invRef = await invoiceForPayment();
    const p = await createIn(PAYMENTS_MODULE_ID, { paymentNumber: 'PAY-2', invoiceRef: invRef, amount: 50, status: 'pending', currency: 'USD' });
    expect(p.ok).toBe(true);
    const edit = await updateIn(PAYMENTS_MODULE_ID, p.record!.id, { paymentNumber: 'PAY-2', invoiceRef: invRef, amount: 75, status: 'pending', currency: 'USD' });
    expect(edit.ok).toBe(true); // status unchanged — allowed
  });

  it('the governed ReceiveCustomerPayment path force-sets cleared server-side (create, no prior record)', async () => {
    const invRef = await invoiceForPayment();
    const r = (await runSecureHandler(
      def,
      { operation: 'ReceiveCustomerPayment', payload: { paymentNumber: 'PAY-GOV', invoiceRef: invRef, amount: 200, currency: 'USD' }, idempotencyKey: 'k-pay' },
      { isAuthenticated: () => true },
    )) as DispatchResult;
    expect(r.ok).toBe(true);
    const created = registry.get(PAYMENTS_MODULE_ID)!.store.list().find((x) => String(x.fields.paymentNumber) === 'PAY-GOV');
    expect(String(created?.fields.status)).toBe('cleared'); // governed create → cleared, books GL through the command
  });
});
