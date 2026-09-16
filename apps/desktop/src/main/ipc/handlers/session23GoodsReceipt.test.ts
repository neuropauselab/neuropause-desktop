/**
 * ERP Session 23 — PostGoodsReceipt through the LIVE platform:command.dispatch path.
 *
 * The next procurement step (PO → Goods Receipt → stock movement → inventory balance + GRNI) is now a
 * governed command on the SAME canonical path as PR, driven through the REAL secure bridge
 * (`runSecureHandler`). It REUSES the existing goods-receipt engine (`postMultiLineReceipt` → per-line
 * valued `receive` movement + Dr Inventory / Cr GRNI, all-or-nothing) — no new inventory store, no
 * `stock += X`, no invented accounting. The economic effect is double-guarded against duplication:
 * the module refuses to re-post a `received` receipt, and the durable journal keys on the command.
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
  GOODS_RECEIPTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s23-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PROC_PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'operations:read', 'operations:manage', 'inventory:read', 'inventory:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
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
  reqSeq = 0;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseOrderModule(tmp('po')),
    createGoodsReceiptModule(tmp('gr')),
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

// Record entry via the existing module-create/action path (draft entry — NOT the consequential step).
const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const movements = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((m) => m.status !== 'deleted');
const journalLines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()
  .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

// The consequential step, driven through the REAL secure bridge exactly as the renderer does.
interface DispatchResult { ok: boolean; data?: { id?: string; movements?: string }; replayed?: boolean; error?: { code: string; message: string }; requestId: string; correlationId: string; operation: string }
async function postReceipt(grId: string, opts: { idem?: string; claimedTenantId?: string } = {}): Promise<DispatchResult> {
  reqSeq += 1;
  return (await runSecureHandler(
    def,
    { operation: 'PostGoodsReceipt', target: grId, payload: {}, idempotencyKey: opts.idem ?? `idem_post_${reqSeq}`, ...(opts.claimedTenantId ? { claimedTenantId: opts.claimedTenantId } : {}) },
    { isAuthenticated: () => sessionAuthed },
  )) as DispatchResult;
}

// Seed products (standard cost) + an approved multi-line PO + a draft goods receipt against it.
async function seedApprovedPO(poNumber = 'PO-23'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn('inventory-products', { sku: 'SKU-B', name: 'B', standardCost: 3 });
  const po = await createIn(PURCHASE_ORDERS_MODULE_ID, {
    poNumber, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD',
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }, { sku: 'SKU-B', quantity: 20, unitPrice: 3 }]),
  });
  expect(po.ok).toBe(true);
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
  return po.record!.id;
}
async function draftReceipt(poId: string, grNumber: string, lines: { sku: string; quantity: number; poLine?: number }[]): Promise<string> {
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const gr = await createIn(GOODS_RECEIPTS_MODULE_ID, {
    grNumber, purchaseOrder: poId, supplier: 'Acme', product: lines[0].sku, warehouse: 'WH-1',
    quantityReceived: total, lines: JSON.stringify(lines),
  });
  expect(gr.ok).toBe(true);
  return gr.record!.id;
}

// ===========================================================================
// PostGoodsReceipt — the governed inventory effect through the live channel
// ===========================================================================

describe('S23 · PostGoodsReceipt traverses the live path → inventory movement + GRNI', () => {
  it('posts the receipt through the real bridge: event + durable journal + audit + REAL stock movement', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-1', [{ sku: 'SKU-A', quantity: 10, poLine: 1 }, { sku: 'SKU-B', quantity: 20, poLine: 2 }]);
    expect(movements()).toHaveLength(0); // nothing received yet

    const r = await postReceipt(grId, { idem: 'p1' });
    expect(r.ok).toBe(true);
    expect(r.operation).toBe('PostGoodsReceipt');
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('GoodsReceiptPosted');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    expect(audit.length).toBeGreaterThan(0);

    // REAL inventory effect: the receipt is 'received' and real valued movements exist.
    const gr = registry.get(GOODS_RECEIPTS_MODULE_ID)!.store.get(grId)!;
    expect(String(gr.fields.status)).toBe('received');
    expect(movements().length).toBe(2); // one valued `receive` movement per line
    // GRNI accounting posted (Dr Inventory / Cr GRNI) — accounting impact, reusing the existing engine.
    await flushUntil(() => journalLines().length > 0);
    expect(journalLines().length).toBeGreaterThan(0);
  });

  it('NO DUPLICATE RECEIPT — re-posting a received receipt is refused (module status guard), no second movement', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-dup', [{ sku: 'SKU-A', quantity: 10, poLine: 1 }]);
    expect((await postReceipt(grId, { idem: 'd1' })).ok).toBe(true);
    const after1 = movements().length;
    const again = await postReceipt(grId, { idem: 'd2' }); // different key → reaches the module, which refuses
    expect(again.ok).toBe(false);
    expect(again.error!.code).toBe('CONFLICT');
    expect(movements().length).toBe(after1); // no second economic effect
  });

  it('100 concurrent PostGoodsReceipt with the same key → exactly ONE post (single-flight)', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-once', [{ sku: 'SKU-A', quantity: 10, poLine: 1 }]);
    const results = await Promise.all(Array.from({ length: 100 }, () => postReceipt(grId, { idem: 'once' })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(movements().length).toBe(1); // one line → exactly one movement, never 100
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    const after = await postReceipt(grId, { idem: 'once' });
    expect(after.replayed).toBe(true); // durable replay, still one effect
    expect(movements().length).toBe(1);
  });

  it('UNAUTHORIZED without procurement:manage — no inventory effect', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-z', [{ sku: 'SKU-A', quantity: 10, poLine: 1 }]);
    currentPrincipal = fullPrincipal({ permissions: ['procurement:read'] });
    const r = await postReceipt(grId, { idem: 'z1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(movements()).toHaveLength(0);
    expect(String(registry.get(GOODS_RECEIPTS_MODULE_ID)!.store.get(grId)!.fields.status)).toBe('pending');
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant — no effect', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-t', [{ sku: 'SKU-A', quantity: 10, poLine: 1 }]);
    const r = await postReceipt(grId, { idem: 't1', claimedTenantId: 'tenant-EVIL' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(movements()).toHaveLength(0);
  });

  it('over-receipt is refused (the defined no-over-receipt invariant) — surfaced as CONFLICT', async () => {
    const poId = await seedApprovedPO();
    const grId = await draftReceipt(poId, 'GR-over', [{ sku: 'SKU-A', quantity: 999, poLine: 1 }]); // ordered 10
    const r = await postReceipt(grId, { idem: 'o1' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
    expect(movements()).toHaveLength(0);
  });
});
