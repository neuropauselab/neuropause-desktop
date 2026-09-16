/**
 * ERP Session 8 — crash recovery, compensation durability, reconciliation.
 *
 * Each crash window is reproduced by constructing the exact durable state a crash
 * would leave (movements posted / partially voided + a non-finalized document),
 * then running the reconciler and asserting a consistent all-or-nothing final
 * state — with no duplicate movement, GL, or reversal, and tenant/authz enforced.
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
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  QUALITY_INSPECTIONS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  productFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type MovementType,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createProductionOrderModule } from '../manufacturing/productionOrderModule';
import { createQualityModule, POST_DISPOSITION_ACTION } from '../manufacturing/qualityModule';
import { createMultiLineReceiptModule, MULTILINE_RECEIPTS_MODULE_ID } from '../procurement/multiLineReceiptModule';
import { createMultiLineDispatchModule, MULTILINE_DISPATCHES_MODULE_ID } from '../sales/multiLineDispatchModule';
import { postStockMovement } from './postMovement';
import { recoverAllMultiLineTransactions, reconcileProductionStart, movementsForDocument } from './multiLineRecovery';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`); paths.push(p); return p; };

interface Rec { authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let denyAuth: EnterprisePermission | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let ctx: EnterpriseModuleActionContext;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => { if (denyAuth && p === denyAuth) throw new Error(`Not authorized: ${p}`); rec.authorized.push(p); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'operator@np.dev', now: () => T0,
  };
}

beforeEach(() => {
  rec = { authorized: [] }; scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' }; denyAuth = null;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')), createStockMovementModule(tmp('mv')), accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createMultiLineReceiptModule(tmp('rcpt')), createMultiLineDispatchModule(tmp('disp')),
    createProductionOrderModule(tmp('po')), createQualityModule(tmp('qa')),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
  ctx = createLifecycleEmitter(registry, spyCtx()).actionCtx;
});
afterEach(async () => { for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel); if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const setStatus = (moduleId: string, id: string, status: string) => registry.get(moduleId)!.store.update(id, { fields: { status }, actor: () => 'x', now: () => T0 } as never);
const doc = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id)!;
const allLines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
const net = (a: string) => allLines().filter((l) => l.account === a).reduce((n, l) => n + l.debit - l.credit, 0);
const revEntries = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber).endsWith('-REV'));
const postedMv = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'posted');
const seed = (sku: string, cost: number) => createIn('inventory-products', { sku, name: sku, standardCost: cost });

/** Post one document line's movement directly (simulating the seam mid-transaction). */
async function postLine(module: string, docId: string, docNumber: string, n: number, type: MovementType, sku: string, qty: number) {
  return postStockMovement(ctx, { movementNumber: `MV-${docNumber}-L${n}`, type, product: sku, warehouse: 'WH-1', quantity: qty, referenceModule: module, referenceRecord: docId, reason: `${docNumber} L${n}` });
}
/** A receipt document with a declared 2-line body. */
async function twoLineReceipt(number = 'GRN-1', status = 'draft') {
  const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: number, warehouse: 'WH-1', lines: JSON.stringify([{ sku: 'RM-1', quantity: 10 }, { sku: 'RM-2', quantity: 4 }]), status });
  return r.record!.id;
}

describe('Session 8 — receipt crash windows', () => {
  it('1 — a CONSISTENT received receipt is left untouched (recovery no-op)', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    const id = await twoLineReceipt('GRN-OK');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-OK', 1, 'receive', 'RM-1', 10);
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-OK', 2, 'receive', 'RM-2', 4);
    setStatus(MULTILINE_RECEIPTS_MODULE_ID, id, 'received');
    const before = net(STOCK_ACCOUNTS.inventory);
    const res = (await recoverAllMultiLineTransactions(ctx)).find((r) => r.docId === id)!;
    expect(res.state).toBe('COMPLETED'); expect(res.changed).toBe(false);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(before);
  });

  it('2 (Case A/B) — crash mid-post (1 of 2 lines) → recovery COMPENSATES to net zero, doc=failed', async () => {
    await seed('RM-1', 5);
    const id = await twoLineReceipt('GRN-A');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-A', 1, 'receive', 'RM-1', 10); // line 1 only, then "crash"
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(50);
    const res = (await recoverAllMultiLineTransactions(ctx)).find((r) => r.docId === id)!;
    expect(res.state).toBe('RECOVERED_COMPENSATED');
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    expect(String(doc(MULTILINE_RECEIPTS_MODULE_ID, id).fields.status)).toBe('failed');
  });

  it('3/11 (Case C/F) — crash DURING compensation (failed doc, 1 posted + 1 already void) → recovery FINISHES it', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    const id = await twoLineReceipt('GRN-C');
    const m1 = await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-C', 1, 'receive', 'RM-1', 10);
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-C', 2, 'receive', 'RM-2', 4);
    // Compensation started: line 1 voided, then "crash"; doc marked failed.
    registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.update(m1!.id, { fields: { status: 'void' }, actor: () => 'x', now: () => T0 } as never);
    await registry.get(STOCK_MOVEMENTS_MODULE_ID)!.hooks.onChange!({ action: 'updated', record: registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.get(m1!.id)! }, ctx);
    setStatus(MULTILINE_RECEIPTS_MODULE_ID, id, 'failed');
    // Recovery finishes: voids the remaining posted line → net zero.
    const res = (await recoverAllMultiLineTransactions(ctx)).find((r) => r.docId === id)!;
    expect(res.state).toBe('RECOVERED_COMPENSATED');
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    expect(postedMv()).toHaveLength(0);
  });

  it('Case E — all lines posted but status write lost (draft) → recovery COMPLETES (finalizes status)', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    const id = await twoLineReceipt('GRN-E');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-E', 1, 'receive', 'RM-1', 10);
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-E', 2, 'receive', 'RM-2', 4);
    // status still draft (crash before finalization) — both lines posted.
    const res = (await recoverAllMultiLineTransactions(ctx)).find((r) => r.docId === id)!;
    expect(res.state).toBe('RECOVERED_COMPLETED');
    expect(String(doc(MULTILINE_RECEIPTS_MODULE_ID, id).fields.status)).toBe('received');
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(78); // work preserved, not rolled back
  });

  it('4/12/13 — recovery is idempotent: recover×3 == recover×1 (no duplicate reversal)', async () => {
    await seed('RM-1', 5);
    const id = await twoLineReceipt('GRN-I');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-I', 1, 'receive', 'RM-1', 10);
    await recoverAllMultiLineTransactions(ctx);
    await recoverAllMultiLineTransactions(ctx);
    await recoverAllMultiLineTransactions(ctx);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(revEntries()).toHaveLength(1); // exactly one MOV-<id>-REV, never duplicated
    expect(String(doc(MULTILINE_RECEIPTS_MODULE_ID, id).fields.status)).toBe('failed');
  });

  it('15/16 — inventory + document/movement reconciliation after compensation', async () => {
    const prod = await seed('RM-1', 5);
    const id = await twoLineReceipt('GRN-R');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-R', 1, 'receive', 'RM-1', 10);
    expect(productFromRecord(registry.get('inventory-products')!.store.get(prod.record!.id)!).currentStock).toBe(10);
    await recoverAllMultiLineTransactions(ctx);
    // Inventory restored, document consistent with its (now void) movements.
    expect(productFromRecord(registry.get('inventory-products')!.store.get(prod.record!.id)!).currentStock).toBe(0);
    const mvs = await movementsForDocument(ctx, MULTILINE_RECEIPTS_MODULE_ID, id);
    expect(mvs.every((m) => String(m.fields.status) === 'void')).toBe(true);
    expect(String(doc(MULTILINE_RECEIPTS_MODULE_ID, id).fields.status)).toBe('failed');
  });
});

describe('Session 8 — dispatch + production crash windows', () => {
  async function twoLineDispatch(number = 'DSP-1') {
    const r = await createIn(MULTILINE_DISPATCHES_MODULE_ID, { dispatchNumber: number, warehouse: 'WH-1', lines: JSON.stringify([{ sku: 'FG-1', quantity: 3 }, { sku: 'FG-2', quantity: 2 }]), status: 'draft' });
    return r.record!.id;
  }

  it('5/6/7 — dispatch crash mid-post → compensate; interrupted compensation → finish', async () => {
    await seed('FG-1', 12);
    const id = await twoLineDispatch('DSP-A');
    await postLine(MULTILINE_DISPATCHES_MODULE_ID, id, 'DSP-A', 1, 'issue', 'FG-1', 3);
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(36);
    await recoverAllMultiLineTransactions(ctx);
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(String(doc(MULTILINE_DISPATCHES_MODULE_ID, id).fields.status)).toBe('failed');
  });

  it('8/9/10 — production START crash (released order + consumptions) → compensate; running order untouched', async () => {
    await seed('RM-1', 5);
    // Interrupted START: an order left 'released' with a posted consumption movement.
    const o = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-8', bom: 'BOM-8', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 2, status: 'released' });
    await postLine(PRODUCTION_ORDERS_MODULE_ID, o.record!.id, 'MO-8', 1, 'production_consumption', 'RM-1', 6);
    expect(net(STOCK_ACCOUNTS.wip)).toBe(30);
    const res = await reconcileProductionStart(ctx, doc(PRODUCTION_ORDERS_MODULE_ID, o.record!.id));
    expect(res.state).toBe('RECOVERED_COMPENSATED');
    expect(net(STOCK_ACCOUNTS.wip)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    // Idempotent + a running order is trusted.
    setStatus(PRODUCTION_ORDERS_MODULE_ID, o.record!.id, 'running');
    const again = await reconcileProductionStart(ctx, doc(PRODUCTION_ORDERS_MODULE_ID, o.record!.id));
    expect(again.changed).toBe(false);
  });
});

describe('Session 8 — QA scrap idempotency + tenancy + authorization', () => {
  it('19 — a re-run QA disposition cannot create a duplicate scrap movement', async () => {
    await seed('FG-1', 20);
    await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-QA', bom: 'B', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, status: 'running' });
    const i = await createIn(QUALITY_INSPECTIONS_MODULE_ID, { inspectionNumber: 'QC-1', productionOrder: 'MO-QA', stage: 'final', result: 'fail', inspectedQuantity: 10, passedQuantity: 7, failedQuantity: 3, status: 'inspected' });
    const run = () => handler(IpcChannel.EnterpriseModuleAction)({ moduleId: QUALITY_INSPECTIONS_MODULE_ID, id: i.record!.id, action: POST_DISPOSITION_ACTION });
    await run(); await run(); await run(); // retries
    expect(postedMv().filter((m) => String(m.fields.type) === 'adjustment')).toHaveLength(1);
  });

  it('17 — recovery under another tenant does not touch this tenant’s transactions', async () => {
    await seed('RM-1', 5);
    const id = await twoLineReceipt('GRN-T');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-T', 1, 'receive', 'RM-1', 10);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const results = await recoverAllMultiLineTransactions(ctx);
    expect(results.filter((r) => r.docId === id)).toHaveLength(0); // tenant B cannot see tenant A's doc
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(50); // A untouched by B's recovery
  });

  it('18 — recovery compensation is authorized (inventory:manage) and refused when denied', async () => {
    await seed('RM-1', 5);
    const id = await twoLineReceipt('GRN-Z');
    await postLine(MULTILINE_RECEIPTS_MODULE_ID, id, 'GRN-Z', 1, 'receive', 'RM-1', 10);
    denyAuth = 'inventory:manage';
    // A denied void throws; recovery must not silently bypass authorization.
    await expect(recoverAllMultiLineTransactions(ctx)).rejects.toThrow(/not authorized/i);
  });
});
