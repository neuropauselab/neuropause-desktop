/**
 * ERP Session 91 — the S90 reorder-originated Purchase Order continues through the EXISTING canonical
 * P2P receiving path, reusing the EXISTING modules/commands (no new receiving engine, no second
 * inventory ledger, no bypass):
 *
 *   reorder PO (approved/sent) → (receiveGoods) Goods Receipt (pending) → (PostGoodsReceipt command)
 *   → ONE valued `receive` Stock Movement (Dr Inventory / Cr GRNI) → inventory += received quantity
 *
 * Receiving requires an approved/sent PO (draft/cancelled refused — the DEFINED approval-before-receive
 * gate). The economic effect (inventory + GRNI GL) happens ONLY when the governed PostGoodsReceipt
 * command posts the receipt; it is idempotent (one post per GR, one GR per PO). Full reorder lineage
 * flows to the movement. Nothing is auto-received; each step is an explicit governed action.
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
  JOURNAL_ENTRIES_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const STOCK_MOVEMENTS_MODULE_ID = 'inventory-movements';

const paths: string[] = [];
const tmp = (t: string): string => { const p = join(tmpdir(), `np-s91-${t}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let authorized: EnterprisePermission[];
let ctx: EnterpriseModuleContext;
let handlers: ReturnType<typeof buildModuleHandlers>;

function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  registry = new EnterpriseModuleRegistry();
  const products = createProductModule(tmp('prod'));
  const pr = createPurchaseRequestModule(tmp('pr'));
  const po = createPurchaseOrderModule(tmp('po'));
  const gr = createGoodsReceiptModule(tmp('gr'));
  const shipping = createShippingModule(tmp('ship'));
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    products, pr, po, gr, shipping, accounts,
    createStockMovementModule(tmp('mv')),
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handler = (channel: string) => {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean }>;
const listIn = (moduleId: string) => registry.get(moduleId)!.store.list();
const rec = (moduleId: string, id: string) => registry.get(moduleId)!.store.get(id);

function deps(ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps {
  return { registry, ctx: ctxOverride ?? ctx, resolveScope: () => scope, journal };
}
let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(seq += 1)}`, type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: 'corr_s91', idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z', source: 'test',
  };
}

const receiveMovements = () => listIn(STOCK_MOVEMENTS_MODULE_ID).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'receive');
const productStock = (sku: string) => Number(listIn(PRODUCTS_MODULE_ID).find((r) => String(r.fields.sku) === sku)?.fields.currentStock ?? 0);
const journalCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).length;

/** reorder PR → submit → approve → convert → PO(draft). Product carries a standardCost so the GRNI GL values. */
async function reorderPo(): Promise<{ prId: string; poId: string; poNumber: string; requestNumber: string; qty: number }> {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: 5, reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
  const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
  const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder-exec:seed' }), deps());
  const prId = String(confirm.data!.id);
  const requestNumber = String(confirm.data!.requestNumber);
  const qty = Number(confirm.data!.quantity);
  await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub' }), deps());
  await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app' }), deps());
  await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv' }), deps());
  const po = listIn(PURCHASE_ORDERS_MODULE_ID).find((r) => String(r.fields.sourceRequest) === prId)!;
  // A reorder recommendation is SKU-level and carries no warehouse; the operator assigns the receiving
  // warehouse on the (draft) PO before receiving — an operational field edit, not a governed transition
  // (the edit door fences only status/convertedReceipt). Consistent with supplier being a PO-stage input.
  await updateIn(PURCHASE_ORDERS_MODULE_ID, po.id, { warehouse: 'WH-1' });
  return { prId, poId: po.id, poNumber: String(po.fields.poNumber), requestNumber, qty };
}
/** Approve + send the PO, then receiveGoods → return the pending GR id. */
async function approveSendReceive(poId: string): Promise<string> {
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'approve')).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'send')).ok).toBe(true);
  expect((await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods')).ok).toBe(true);
  const gr = listIn(GOODS_RECEIPTS_MODULE_ID).find((r) => String(r.fields.purchaseOrder) === poId)!;
  return gr.id;
}

// ─────────────────────────── HAPPY PATH + LINEAGE + INVENTORY ───────────────────────────
describe('S91 receiving — reorder PO → GR → PostGoodsReceipt → inventory (+GRNI), full lineage', () => {
  it('posts the receipt through the governed command: inventory += qty, one movement, canonical GRNI, lineage', async () => {
    const { poId, poNumber, requestNumber, qty } = await reorderPo();
    const grId = await approveSendReceive(poId);
    // GR carries the PO lineage; PO now 'received' (a receipt exists), GR still 'pending' (not posted)
    const gr = rec(GOODS_RECEIPTS_MODULE_ID, grId)!;
    expect(String(gr.fields.grNumber)).toBe(`GR-${poNumber}`); // GR-PO-PR-REORDER-…
    expect(String(gr.fields.purchaseOrder)).toBe(poId);
    expect(String(gr.fields.status)).toBe('pending');
    expect(String(rec(PURCHASE_ORDERS_MODULE_ID, poId)!.fields.convertedReceipt)).toBe(grId);

    const stockBefore = productStock('SKU-1');
    const movementsBefore = receiveMovements().length;
    const journalBefore = journalCount();

    const post = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: `post:${grId}` }), deps());
    expect(post.ok).toBe(true);
    expect(String(rec(GOODS_RECEIPTS_MODULE_ID, grId)!.fields.status)).toBe('received');
    // inventory ledger: exactly one new receive movement, inventory += received qty
    expect(receiveMovements().length).toBe(movementsBefore + 1);
    expect(productStock('SKU-1')).toBe(stockBefore + qty);
    // the movement traces back to the GR
    const mv = receiveMovements().find((m) => String(m.fields.referenceRecord) === grId);
    expect(mv).toBeTruthy();
    // canonical GR→GL: Dr Inventory / Cr GRNI booked (a journal entry appeared)
    expect(journalCount()).toBeGreaterThan(journalBefore);
    // reorder lineage end-to-end: requestNumber → poNumber → grNumber
    expect(poNumber).toBe(`PO-${requestNumber}`);
    expect(String(gr.fields.grNumber)).toBe(`GR-PO-${requestNumber}`);
    expect(authorized).toContain('procurement:manage');
  });
});

// ─────────────────────────── INVENTORY SAFETY / IDEMPOTENCY / RESTART ───────────────────────────
describe('S91 inventory safety — one posting, no double-post on replay/restart', () => {
  it('same-key re-post replays (no second movement); distinct-key re-post refused', async () => {
    const { poId, qty } = await reorderPo();
    const grId = await approveSendReceive(poId);
    const before = productStock('SKU-1');
    await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p' }), deps());
    expect(productStock('SKU-1')).toBe(before + qty);
    const oneMovement = receiveMovements().length;
    const replay = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p' }), deps());
    expect(replay.replayed).toBe(true);
    expect(receiveMovements().length).toBe(oneMovement); // no duplicate movement
    expect(productStock('SKU-1')).toBe(before + qty); // inventory unchanged on replay
    const again = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p2' }), deps());
    expect(again.ok).toBe(false); // already received — document-level idempotency
    expect(receiveMovements().length).toBe(oneMovement);
    expect(productStock('SKU-1')).toBe(before + qty);
  });

  it('replay across a durable-journal RESTART does not double-post inventory', async () => {
    const { poId, qty } = await reorderPo();
    const grId = await approveSendReceive(poId);
    const before = productStock('SKU-1');
    const file = tmp('journal-restart');
    const j1 = new DurableCommandJournal(file);
    await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'pr' }), { registry, ctx, resolveScope: () => scope, journal: j1 });
    expect(productStock('SKU-1')).toBe(before + qty);
    const movements = receiveMovements().length;
    const j2 = new DurableCommandJournal(file); // process restart
    const again = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'pr' }), { registry, ctx, resolveScope: () => scope, journal: j2 });
    expect(again.replayed).toBe(true);
    expect(receiveMovements().length).toBe(movements);
    expect(productStock('SKU-1')).toBe(before + qty);
  });

  it('one GR per PO — a second receiveGoods is refused (no second receipt)', async () => {
    const { poId } = await reorderPo();
    await approveSendReceive(poId);
    const second = await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods');
    expect(second.ok).toBe(false);
    expect(listIn(GOODS_RECEIPTS_MODULE_ID).filter((r) => String(r.fields.purchaseOrder) === poId)).toHaveLength(1);
  });
});

// ─────────────────────────── STATUS MACHINE NEGATIVES ───────────────────────────
describe('S91 status machine — receiving requires approval; edits cannot mutate inventory', () => {
  it('a DRAFT PO cannot be received (approval-before-receive gate)', async () => {
    const { poId } = await reorderPo(); // PO is draft
    const r = await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'receiveGoods');
    expect(r.ok).toBe(false);
    expect(listIn(GOODS_RECEIPTS_MODULE_ID)).toHaveLength(0);
  });

  it('a receipt against a CANCELLED PO cannot be posted', async () => {
    const { poId } = await reorderPo();
    const grId = await approveSendReceive(poId);
    // receiving stamped the PO 'received'; the post ingress independently refuses a cancelled PO —
    // reproduce by cancelling the PO via its action is refused for 'received', so simulate the guard
    // by pointing a fresh pending receipt at a cancelled PO.
    await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-CANCEL', product: 'SKU-1', quantity: 5, status: 'draft' });
    const cancelPo = listIn(PURCHASE_ORDERS_MODULE_ID).find((r) => String(r.fields.poNumber) === 'PO-CANCEL')!;
    await actIn(PURCHASE_ORDERS_MODULE_ID, cancelPo.id, 'cancel');
    await createIn(GOODS_RECEIPTS_MODULE_ID, { grNumber: 'GR-CANCEL', purchaseOrder: cancelPo.id, product: 'SKU-1', warehouse: 'WH-1', quantityReceived: 5, status: 'pending' });
    const badGr = listIn(GOODS_RECEIPTS_MODULE_ID).find((r) => String(r.fields.grNumber) === 'GR-CANCEL')!;
    const post = await dispatchCommand(cmd('PostGoodsReceipt', { target: badGr.id, idem: 'badpost' }), deps());
    expect(post.ok).toBe(false);
    expect(String(rec(GOODS_RECEIPTS_MODULE_ID, badGr.id)!.fields.status)).toBe('pending');
    void grId;
  });

  it('a generic EDIT cannot hand-set the GR to received (no inventory bypass)', async () => {
    const { poId } = await reorderPo();
    const grId = await approveSendReceive(poId);
    const before = productStock('SKU-1');
    const edit = await updateIn(GOODS_RECEIPTS_MODULE_ID, grId, { status: 'received' });
    expect(edit.ok).toBe(false);
    expect(String(rec(GOODS_RECEIPTS_MODULE_ID, grId)!.fields.status)).toBe('pending');
    expect(receiveMovements().length).toBe(0);
    expect(productStock('SKU-1')).toBe(before);
  });

  it('a generic EDIT cannot hand-set the PO to received (receipt link is action-owned)', async () => {
    const { poId } = await reorderPo();
    await actIn(PURCHASE_ORDERS_MODULE_ID, poId, 'approve');
    const edit = await updateIn(PURCHASE_ORDERS_MODULE_ID, poId, { status: 'received' });
    expect(edit.ok).toBe(false);
  });
});

// ─────────────────────────── SECURITY / TENANT ───────────────────────────
describe('S91 security — receiving authority + tenancy fail closed', () => {
  it('PostGoodsReceipt requires procurement:manage — denied actor cannot post', async () => {
    const { poId } = await reorderPo();
    const grId = await approveSendReceive(poId);
    const denied = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p' }), deps(makeCtx('procurement:manage')));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('UNAUTHORIZED');
    expect(receiveMovements().length).toBe(0);
  });

  it('NO_TENANT / forged tenant / cross-tenant receipt fail closed', async () => {
    const { poId } = await reorderPo();
    const grId = await approveSendReceive(poId);
    scope = null;
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p' }), deps())).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p2', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' }; // foreign tenant cannot see the GR
    const foreign = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p3' }), deps());
    expect(foreign.ok).toBe(false);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(receiveMovements().length).toBe(0);
  });
});

// ─────────────────────────── SIDE-EFFECT BOUNDARY ───────────────────────────
describe('S91 side effects — one movement + canonical GRNI; nothing else', () => {
  it('the receipt posts exactly one movement + GRNI GL and creates NO second PO / GR', async () => {
    const { poId, qty } = await reorderPo();
    const grId = await approveSendReceive(poId);
    await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'p' }), deps());
    expect(receiveMovements()).toHaveLength(1); // one inventory movement
    expect(listIn(PURCHASE_ORDERS_MODULE_ID).filter((r) => r.status !== 'deleted')).toHaveLength(1); // no duplicate PO
    expect(listIn(GOODS_RECEIPTS_MODULE_ID).filter((r) => r.status !== 'deleted')).toHaveLength(1); // one GR
    expect(productStock('SKU-1')).toBe(qty); // inventory reflects exactly the received quantity
  });
});
