/**
 * Transaction-graph spine — REAL end-to-end wiring.
 *
 * Drives the actual production path: an accepted quote is converted to a sales
 * order and then invoiced through the REAL `convertToOrder` / `convertToInvoice`
 * module actions; a stock movement is shipped for that order through the REAL
 * `postStockMovement` funnel; and that movement posts to the REAL General Ledger
 * through the inventory→GL bridge. Then the whole business transaction is
 * reconstructed from PERSISTED metadata with `traceTransactionGraph`.
 *
 * This proves the spine's central claim: after the fix, one correlationId is
 * shared by the quote, the order, the invoice, the movement, and the journal
 * entry — with correct causation edges — so "show me everything that happened to
 * this order" is answerable from stored data. Before the fix (negative control in
 * the evidence) each record carried only its own document cross-reference and the
 * trace returned nothing connected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import {
  FINANCE_MODULE_ID,
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  ORDERS_MODULE_ID,
  QUOTES_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, INTERNAL_ACTION_ORIGIN, buildModuleHandlers, createLifecycleEmitter } from './moduleRegistry';
import { globalRef, readCorrelation, traceTransactionGraph } from './transactionGraph';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createQuoteModule } from '../modules/sales/quoteModule';
import { createOrderModule } from '../modules/sales/orderModule';
import { createInvoiceModule } from '../modules/finance/invoiceModule';
import { createProductModule } from '../modules/inventory/productModule';
import { createStockMovementModule } from '../modules/inventory/stockMovementModule';
import { createJournalEntryModule } from '../modules/finance/journalEntryModule';
import { createLedgerAccountModule } from '../modules/finance/ledgerAccountModule';
import { postStockMovement } from '../modules/inventory/postMovement';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}

function buildRegistry() {
  const registry = new EnterpriseModuleRegistry();
  const quotes = createQuoteModule(tmp('quote'));
  const orders = createOrderModule(tmp('order'));
  const invoices = createInvoiceModule(tmp('inv'));
  const products = createProductModule(tmp('prod'));
  const movements = createStockMovementModule(tmp('mov'));
  const accounts = createLedgerAccountModule(tmp('acct'));
  const journal = createJournalEntryModule(tmp('jrnl'), accounts.store);
  for (const m of [quotes, orders, invoices, products, movements, accounts, journal]) registry.register(m);
  registry.bindScope(() => scope);
  const handlers = buildModuleHandlers(registry, spyCtx());
  const { actionCtx } = createLifecycleEmitter(registry, spyCtx());
  return { registry, handlers, actionCtx, quotes, orders, invoices, movements, journal };
}

function handler(handlers: SecureHandlerDef[], channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const create = (h: SecureHandlerDef[], moduleId: string, fields: Record<string, unknown>) =>
  handler(h, IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const act = (h: SecureHandlerDef[], moduleId: string, id: string, action: string) =>
  handler(h, IpcChannel.EnterpriseModuleAction)({ moduleId, id, action, origin: INTERNAL_ACTION_ORIGIN }) as Promise<{ ok: boolean; message?: string; error?: string }>;

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

/** Convert an accepted quote → order → (shipped) → invoice; return the ids. */
async function runSalesChain(h: SecureHandlerDef[], reg: EnterpriseModuleRegistry) {
  const q = await create(h, QUOTES_MODULE_ID, {
    quoteNumber: 'Q-0001', customer: 'Acme Inc.', contact: 'Ada', salesRep: 'rep@np.dev',
    status: 'accepted', subtotal: 20000, discount: 2000, cost: 10000,
  });
  const quoteId = q.record!.id;
  expect((await act(h, QUOTES_MODULE_ID, quoteId, 'convertToOrder')).ok).toBe(true);
  const orders = reg.get(ORDERS_MODULE_ID)!;
  const orderId = orders.store.list()[0].id;
  // Ship the order so it becomes invoiceable, then invoice it (real action).
  orders.store.update(orderId, { fields: { status: 'shipped' }, actor: 'tester@np.dev', now: T0 });
  expect((await act(h, ORDERS_MODULE_ID, orderId, 'convertToInvoice')).ok).toBe(true);
  return { quoteId, orderId };
}

describe('transaction-graph spine — real chain shares one correlationId', () => {
  it('quote → order → invoice inherit one correlationId with correct causation edges', async () => {
    const { handlers, registry, orders, invoices, quotes } = buildRegistry();
    const { quoteId, orderId } = await runSalesChain(handlers, registry);
    const CID = globalRef(QUOTES_MODULE_ID, quoteId);

    const order = orders.store.get(orderId)!;
    const invoice = invoices.store.list()[0];
    const quote = quotes.store.get(quoteId)!;

    // The quote self-identifies as the transaction root.
    expect(readCorrelation(quote).correlationId).toBe(CID);
    // The order is caused by the quote, sharing its correlationId.
    expect(readCorrelation(order)).toMatchObject({ correlationId: CID, causationId: quoteId, causedByModule: QUOTES_MODULE_ID });
    // The invoice is caused by the order, still the same correlationId.
    expect(readCorrelation(invoice)).toMatchObject({ correlationId: CID, causationId: orderId, causedByModule: ORDERS_MODULE_ID });
  });

  it('a shipped movement + its GL entry join the SAME transaction as the order', async () => {
    const { handlers, registry, actionCtx, orders, movements, journal } = buildRegistry();
    const { quoteId, orderId } = await runSalesChain(handlers, registry);
    const CID = globalRef(QUOTES_MODULE_ID, quoteId);

    // Ship stock for the order through the real funnel (the same seam sales uses).
    const movement = await postStockMovement(actionCtx, {
      movementNumber: 'MV-1', type: 'issue', product: 'SKU-1', warehouse: 'WH-1',
      quantity: 4, unitCost: 5, referenceModule: ORDERS_MODULE_ID, referenceRecord: orderId,
    });
    expect(movement, 'movement posted').not.toBeNull();

    // The movement inherited the order's correlation.
    const mv = movements.store.get(movement!.id)!;
    expect(readCorrelation(mv)).toMatchObject({ correlationId: CID, causationId: orderId, causedByModule: ORDERS_MODULE_ID });

    // The GL entry the movement posted (MOV-<id>) inherited the movement's correlation.
    const glEntry = journal.store.list().find((e) => String(e.fields.entryNumber) === `MOV-${movement!.id}`);
    expect(glEntry, 'movement posted a journal entry').toBeTruthy();
    expect(readCorrelation(glEntry!)).toMatchObject({ correlationId: CID, causationId: movement!.id, causedByModule: STOCK_MOVEMENTS_MODULE_ID });

    // Sanity: the order still carries the correlation (never overwritten).
    expect(readCorrelation(orders.store.get(orderId)!).correlationId).toBe(CID);
  });

  it('traceTransactionGraph reconstructs the whole multi-module transaction, root-first', async () => {
    const { handlers, registry, actionCtx } = buildRegistry();
    const { quoteId, orderId } = await runSalesChain(handlers, registry);
    const CID = globalRef(QUOTES_MODULE_ID, quoteId);
    const movement = await postStockMovement(actionCtx, {
      movementNumber: 'MV-1', type: 'issue', product: 'SKU-1', warehouse: 'WH-1',
      quantity: 4, unitCost: 5, referenceModule: ORDERS_MODULE_ID, referenceRecord: orderId,
    });

    const graph = await traceTransactionGraph(registry.list(), CID);
    const refs = graph.map((n) => `${n.moduleId}:${n.recordId}`);

    // Every leg of the transaction is present and carries the shared correlationId.
    expect(refs).toContain(globalRef(QUOTES_MODULE_ID, quoteId));
    expect(refs).toContain(globalRef(ORDERS_MODULE_ID, orderId));
    expect(refs).toContain(globalRef(STOCK_MOVEMENTS_MODULE_ID, movement!.id));
    expect(refs).toContain(globalRef(JOURNAL_ENTRIES_MODULE_ID, graph.find((n) => n.moduleId === JOURNAL_ENTRIES_MODULE_ID)!.recordId));
    expect(graph.every((n) => n.recordId !== '' )).toBe(true);

    // The quote is the root; nothing precedes it.
    expect(graph[0].moduleId).toBe(QUOTES_MODULE_ID);
    expect(graph[0].isRoot).toBe(true);
    expect(graph[0].depth).toBe(0);
    // The order sits directly under the quote.
    const orderNode = graph.find((n) => n.moduleId === ORDERS_MODULE_ID)!;
    expect(orderNode.depth).toBe(1);
    expect(orderNode.parentRef).toBe(globalRef(QUOTES_MODULE_ID, quoteId));
  });

  it('tenant isolation — a trace under another tenant returns nothing', async () => {
    const { handlers, registry } = buildRegistry();
    const { quoteId } = await runSalesChain(handlers, registry);
    const CID = globalRef(QUOTES_MODULE_ID, quoteId);
    expect((await traceTransactionGraph(registry.list(), CID)).length).toBeGreaterThan(0);

    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' }; // different tenant
    expect(await traceTransactionGraph(registry.list(), CID)).toEqual([]);
  });

  it('an order created directly (no quote) becomes its own transaction root', async () => {
    const { handlers, registry, orders, invoices } = buildRegistry();
    // Create an order directly, ship it, invoice it — no quote in the chain.
    const o = await create(handlers, ORDERS_MODULE_ID, {
      orderNumber: 'SO-DIRECT', customer: 'Direct Co.', status: 'shipped', total: 500, currency: 'USD',
    });
    const orderId = o.record!.id;
    expect((await act(handlers, ORDERS_MODULE_ID, orderId, 'convertToInvoice')).ok).toBe(true);
    const order = orders.store.get(orderId)!;
    const invoice = invoices.store.list()[0];
    const CID = globalRef(ORDERS_MODULE_ID, orderId);
    // The order roots the transaction; the invoice inherits it.
    expect(readCorrelation(order).correlationId).toBe(CID);
    expect(readCorrelation(invoice)).toMatchObject({ correlationId: CID, causationId: orderId, causedByModule: ORDERS_MODULE_ID });
    const graph = await traceTransactionGraph(registry.list(), CID);
    expect(graph[0].isRoot).toBe(true);
    expect(graph.some((n) => n.moduleId === FINANCE_MODULE_ID)).toBe(true);
  });
});
