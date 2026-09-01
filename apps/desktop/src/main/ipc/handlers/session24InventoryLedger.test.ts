/**
 * ERP Session 24 — Goods Receipt → inventory stock ledger → balance, through the LIVE
 * platform:command.dispatch path. Reuses the S23 governed PostGoodsReceipt command and the
 * existing inventory movement ledger (`deriveStockLedger` — the derived, single-source-of-truth
 * balance; no mutable stock store). REPRODUCE-FIRST for the Part-6 concurrency invariant.
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
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { deriveStockLedger, movementFromRecord } from '@neuropause/shared';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule, __resetReceiptPostChainsForTests } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s24-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PROC_PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'inventory:read', 'inventory:manage'];

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
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PROC_PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  __resetReceiptPostChainsForTests();
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

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean }>;
const movements = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((m) => m.status !== 'deleted');
// The CANONICAL derived balance — on-hand from the movement ledger (no mutable balance store).
function onHand(sku: string, warehouse = 'WH-1'): number {
  const cell = deriveStockLedger(movements().map(movementFromRecord)).find((c) => c.product === sku && c.warehouse === warehouse);
  return cell ? cell.onHand : 0;
}
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

interface DispatchResult { ok: boolean; data?: { id?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function postReceipt(grId: string, idem: string): Promise<DispatchResult> {
  return (await runSecureHandler(def, { operation: 'PostGoodsReceipt', target: grId, payload: {}, idempotencyKey: idem }, { isAuthenticated: () => true })) as DispatchResult;
}
async function approvedPO(qty: number, poNumber = 'PO-24'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  const po = await createIn(PURCHASE_ORDERS_MODULE_ID, {
    poNumber, supplier: 'Acme', warehouse: 'WH-1', currency: 'USD',
    lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, unitPrice: 5 }]),
  });
  await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
  return po.record!.id;
}
async function draftReceipt(poId: string, grNumber: string, qty: number): Promise<string> {
  const gr = await createIn(GOODS_RECEIPTS_MODULE_ID, {
    grNumber, purchaseOrder: poId, supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1',
    quantityReceived: qty, lines: JSON.stringify([{ sku: 'SKU-A', quantity: qty, poLine: 1 }]),
  });
  return gr.record!.id;
}

// ===========================================================================
// Part 5 — partial-receipt invariants (sequential)
// ===========================================================================

describe('S24 · partial receipts → derived inventory balance', () => {
  it('A–D: PO 100, receive 40 then 60 (on-hand tracks), one-more refused', async () => {
    const po = await approvedPO(100);
    const gr40 = await draftReceipt(po, 'GR-40', 40);
    expect((await postReceipt(gr40, 'r40')).ok).toBe(true);
    await flushUntil(() => movements().length >= 1);
    expect(onHand('SKU-A')).toBe(40); // derived balance = +40

    const gr60 = await draftReceipt(po, 'GR-60', 60);
    expect((await postReceipt(gr60, 'r60')).ok).toBe(true);
    await flushUntil(() => movements().length >= 2);
    expect(onHand('SKU-A')).toBe(100); // cumulative +100

    const grOver = await draftReceipt(po, 'GR-1more', 1);
    const over = await postReceipt(grOver, 'r1');
    expect(over.ok).toBe(false); // ordered 100 fully received → one more refused
    expect(onHand('SKU-A')).toBe(100); // unchanged
  });

  it('balance is derived from the durable movement ledger and survives a restart', async () => {
    const po = await approvedPO(50);
    const gr = await draftReceipt(po, 'GR-durable', 50);
    expect((await postReceipt(gr, 'rd')).ok).toBe(true);
    await flushUntil(() => movements().length >= 1);
    expect(onHand('SKU-A')).toBe(50);
    // Reload the movement store from disk (restart) → recompute the ledger → identical.
    await registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.load();
    expect(onHand('SKU-A')).toBe(50);
  });
});

// ===========================================================================
// Part 6 — REPRODUCE-FIRST: concurrent different-key over-receipt
// ===========================================================================

describe('S24 · concurrency invariant (the critical Part-6 case)', () => {
  it('N concurrent DIFFERENT-key receipts of the full qty → aggregate received NEVER exceeds PO', async () => {
    const po = await approvedPO(100);
    // Three separate draft receipts, each for the FULL 100, against the same PO.
    const grs = await Promise.all([1, 2, 3].map((i) => draftReceipt(po, `GR-c${i}`, 100)));
    // Post all three CONCURRENTLY with DIFFERENT idempotency keys (idempotency cannot dedupe these).
    const results = await Promise.all(grs.map((id, i) => postReceipt(id, `conc-${i}`)));
    await flushUntil(() => movements().length >= 1);
    const accepted = results.filter((r) => r.ok).length;
    const onHandQty = onHand('SKU-A');
    // THE BUSINESS INVARIANT: aggregate received must never exceed the PO quantity, under concurrency.
    expect(onHandQty).toBeLessThanOrEqual(100);
    // And exactly one 100-unit receipt can be accepted (a second would be over-receipt).
    expect(accepted).toBe(1);
    expect(onHandQty).toBe(100);
  });
});
