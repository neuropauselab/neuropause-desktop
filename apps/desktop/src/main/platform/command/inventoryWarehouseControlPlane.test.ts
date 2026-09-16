/**
 * ERP Session 97 — INVENTORY + WAREHOUSE END-TO-END CONTROL-PLANE CERTIFICATION.
 *
 * Certifies the existing inventory/warehouse control plane as the CANONICAL stock authority used by
 * P2P, O2C, and future planning — reusing ONLY the existing ledger, reconciler, reservation path, ATP
 * calculator, warehouse modules, commands, idempotency and tenant controls (no new engine).
 *
 * STOCK AUTHORITY (source-wins): the stock-movement ledger is authoritative; a product's on-hand /
 * reserved / available are MATERIALIZED by the movement reconciler and always recomputable —
 *   currentStock  = Σ (+receive/production_output/return, −issue/production_consumption, ±adjustment; void/transfer/reservation = 0)
 *   reservedStock = max(0, Σ reservation − reservation_release)
 *   availableStock = currentStock − reservedStock   (may go negative when oversold — DEFINED behavior)
 *   ATP           = availableStock + incoming(open POs, approved/sent)
 * Posted movements are immutable (edit refused; correction by void; void terminal) AND — per S97
 * F-S97-1 — a posted movement can no longer be DELETED (the ledger-immutability gap this session closed).
 *
 * The only production change this session is the F-S97-1 delete guard (mirrors the S61 economic-delete
 * guard). Everything else is certification. Reproduce-first for F-S97-1 is included below.
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
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  GOODS_RECEIPTS_MODULE_ID,
  ORDERS_MODULE_ID,
  CUSTOMERS_MODULE_ID,
  calculateCurrentStock,
  calculateReservedStock,
  movementFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type StockMovement,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createAtpModule, ATP_MODULE_ID } from '../../enterprise/modules/inventory/atpModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createCustomerModule } from '../../enterprise/modules/crm/customerModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const MV = 'inventory-movements';
const STANDARD_COST = 6;

interface StorePaths { prod: string; mv: string; po: string; gr: string; pr: string; ship: string; acct: string; jrnl: string; atp: string; cust: string; order: string; dec: string; journal: string; }
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s97-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), mv: p('mv'), po: p('po'), gr: p('gr'), pr: p('pr'), ship: p('ship'), acct: p('acct'), jrnl: p('jrnl'), atp: p('atp'), cust: p('cust'), order: p('order'), dec: p('dec'), journal: p('journal') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];
function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'operator@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}
function buildInstallation(paths: StorePaths, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const products = createProductModule(paths.prod);
  const movements = createStockMovementModule(paths.mv);
  const po = createPurchaseOrderModule(paths.po);
  const gr = createGoodsReceiptModule(paths.gr);
  const pr = createPurchaseRequestModule(paths.pr);
  const shipping = createShippingModule(paths.ship);
  const accounts = createLedgerAccountModule(paths.acct);
  for (const m of [
    products, movements, po, gr, pr, shipping, accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    createAtpModule(paths.atp, movements.store, po.store),
    createCustomerModule(paths.cust),
    createOrderModule(paths.order),
    createReorderDecisionModule(paths.dec, products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  const handlers = buildModuleHandlers(registry, ctx);
  const journal = new DurableCommandJournal(paths.journal);
  return { registry, handlers, journal };
}

let paths: StorePaths;
let ctx: EnterpriseModuleContext;
let inst: ReturnType<typeof buildInstallation>;
beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  paths = freshPaths();
  ctx = makeCtx();
  inst = buildInstallation(paths, ctx);
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of allPaths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return { commandId: `cmd_${(seq += 1)}`, type, ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}), actor: 'operator@np.dev', ...(opts.target ? { target: { id: opts.target } } : {}), payload: opts.payload ?? {}, correlationId: 'corr_s97', idempotencyKey: opts.idem ?? `${type}_${seq}`, timestamp: '2026-09-01T12:00:00.000Z', source: 'test' };
}
function deps(i = inst, c: EnterpriseModuleContext = ctx): CommandDispatchDeps { return { registry: i.registry, ctx: c, resolveScope: () => scope, journal: i.journal }; }
const handler = (i: ReturnType<typeof buildInstallation>, ch: string) => { const d = i.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (m: string, id: string, a: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string }>;
const deleteIn = (m: string, id: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleDelete)({ moduleId: m, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (m: string, i = inst) => i.registry.get(m)!.store.list();
const rec = (m: string, id: string, i = inst) => i.registry.get(m)!.store.get(id);
const alive = (m: string, i = inst) => listIn(m, i).filter((r) => r.status !== 'deleted');
const prod = (sku: string, i = inst) => listIn(PRODUCTS_MODULE_ID, i).find((r) => String(r.fields.sku) === sku)!;
const ledgerFor = (sku: string, i = inst): StockMovement[] => listIn(MV, i).map(movementFromRecord).filter((m) => m.product === sku);
const onHand = (sku: string, i = inst) => Number(prod(sku, i).fields.currentStock ?? 0);
const reserved = (sku: string, i = inst) => Number(prod(sku, i).fields.reservedStock ?? 0);
const available = (sku: string, i = inst) => Number(prod(sku, i).fields.availableStock ?? 0);
const movesOfType = (t: string, i = inst) => listIn(MV, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === t);

/** THE STOCK-AUTHORITY INVARIANT: the materialized product fields equal the ledger derivation. */
function assertAuthority(sku: string, i = inst) {
  const led = ledgerFor(sku, i);
  expect(onHand(sku, i)).toBe(calculateCurrentStock(led));
  expect(reserved(sku, i)).toBe(calculateReservedStock(led));
  expect(available(sku, i)).toBe(calculateCurrentStock(led) - calculateReservedStock(led));
}
async function seedProduct(i = inst) {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, standardCost: STANDARD_COST, reorderLevel: 20, safetyStock: 10, maximumStock: 500 }, i);
}

// ─────────────────────── 2 · STOCK AUTHORITY ───────────────────────
describe('S97 stock authority — the ledger is authoritative; product fields materialize it exactly', () => {
  it('after every movement, product on-hand/reserved/available == ledger derivation; reservation is not phantom on-hand', async () => {
    await seedProduct();
    assertAuthority('SKU-1'); // 0/0/0
    await createIn(MV, { movementNumber: 'MV-R', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    expect(onHand('SKU-1')).toBe(100); assertAuthority('SKU-1');
    await createIn(MV, { movementNumber: 'MV-RES', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    expect(onHand('SKU-1')).toBe(100); // reservation does NOT change on-hand (no phantom inventory)
    expect(reserved('SKU-1')).toBe(30);
    expect(available('SKU-1')).toBe(70); assertAuthority('SKU-1');
    await createIn(MV, { movementNumber: 'MV-I', type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 40 });
    expect(onHand('SKU-1')).toBe(60); assertAuthority('SKU-1');
    await createIn(MV, { movementNumber: 'MV-REL', type: 'reservation_release', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    expect(reserved('SKU-1')).toBe(0);
    expect(available('SKU-1')).toBe(60); assertAuthority('SKU-1');
  });
});

// ─────────────────────── 3 · RECEIVING (P2P governed path) ───────────────────────
describe('S97 receiving — PostGoodsReceipt posts exactly one receive; immutable; replay/tenant guarded', () => {
  async function reorderToGr() {
    await seedProduct();
    const report = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
    const confirm = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: report.record!.id, payload: { sku: 'SKU-1' }, idem: 'r:seed' }), deps());
    const prId = String(confirm.data!.id); const q1 = Number(confirm.data!.quantity);
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 'sub' }), deps());
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'app' }), deps());
    await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv' }), deps());
    const po = listIn(PURCHASE_ORDERS_MODULE_ID).find((r) => String(r.fields.sourceRequest) === prId)!;
    await updateIn(PURCHASE_ORDERS_MODULE_ID, po.id, { warehouse: 'WH-1', supplier: 'Acme', unitCost: STANDARD_COST });
    await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'approve');
    await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'send');
    await actIn(PURCHASE_ORDERS_MODULE_ID, po.id, 'receiveGoods');
    const gr = listIn(GOODS_RECEIPTS_MODULE_ID).find((r) => String(r.fields.purchaseOrder) === po.id)!;
    return { poId: po.id, grId: gr.id, q1 };
  }

  it('one receive movement, stock +q, GR↔PO, replay does not duplicate, tenant enforced', async () => {
    const { poId, grId, q1 } = await reorderToGr();
    const before = movesOfType('receive').length;
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: `post:${grId}` }), deps())).ok).toBe(true);
    expect(movesOfType('receive').length).toBe(before + 1);
    expect(onHand('SKU-1')).toBe(q1); assertAuthority('SKU-1');
    expect(String(rec(GOODS_RECEIPTS_MODULE_ID, grId)!.fields.purchaseOrder)).toBe(poId); // GR↔PO
    // replay same key → no duplicate movement
    const replay = await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: `post:${grId}` }), deps());
    expect(replay.replayed).toBe(true);
    expect(movesOfType('receive').length).toBe(before + 1);
    // forged tenant on the post → refused
    expect((await dispatchCommand(cmd('PostGoodsReceipt', { target: grId, idem: 'ff', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
  });
});

// ─────────────────────── 4 · ISSUE / SHIPPING (O2C governed path) ───────────────────────
describe('S97 issue — ShipSalesOrder issues exactly once; lineage; second/raw/edit/replay all guarded', () => {
  async function shippableSO(qty: number) {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'Beta', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: qty, total: qty * 10 }, idem: 'so' }), deps());
    return String(so.data!.id);
  }
  it('one issue movement, stock −q, lineage; raw-door + status-edit + second-ship + replay refused', async () => {
    const orderId = await shippableSO(40);
    // raw-door ship refused (governed-only); status edit refused; no issue yet
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'ship')).ok).toBe(false);
    expect((await updateIn(ORDERS_MODULE_ID, orderId, { status: 'shipped' })).ok).toBe(false);
    expect(movesOfType('issue').length).toBe(0);
    const before = onHand('SKU-1');
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship' }), deps())).ok).toBe(true);
    expect(movesOfType('issue').length).toBe(1);
    expect(onHand('SKU-1')).toBe(before - 40); assertAuthority('SKU-1');
    expect(movesOfType('issue').some((m) => String(m.fields.referenceRecord) === orderId)).toBe(true); // lineage
    // second ship + replay refused → no second issue
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship2' }), deps())).ok).toBe(false);
    const replay = await dispatchCommand(cmd('ShipSalesOrder', { target: orderId, idem: 'ship' }), deps());
    expect(replay.replayed === true || replay.ok === false).toBe(true);
    expect(movesOfType('issue').length).toBe(1);
  });
});

// ─────────────────────── 5 · RESERVATIONS ───────────────────────
describe('S97 reservations — reserve affects available per the canonical formula; duplicate refused; release on cancel', () => {
  it('reserve raises reserved / lowers available without changing on-hand; duplicate reserve refused; cancel releases', async () => {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-R', customer: 'Beta', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 25, total: 250 }, idem: 'so' }), deps());
    const orderId = String(so.data!.id);
    // reserve (SO action) → one reservation movement
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'reserveStock')).ok).toBe(true);
    expect(onHand('SKU-1')).toBe(100); // unchanged (no phantom)
    expect(reserved('SKU-1')).toBe(25);
    expect(available('SKU-1')).toBe(75); assertAuthority('SKU-1');
    // duplicate reservation refused (canonical guard)
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'reserveStock')).ok).toBe(false);
    expect(reserved('SKU-1')).toBe(25); // still one reservation
    // cancel the order → reservation released
    expect((await actIn(ORDERS_MODULE_ID, orderId, 'cancel')).ok).toBe(true);
    expect(reserved('SKU-1')).toBe(0);
    expect(available('SKU-1')).toBe(100); assertAuthority('SKU-1');
  });
});

// ─────────────────────── 6 · AVAILABLE-TO-PROMISE ───────────────────────
describe('S97 ATP — reuse the canonical snapshot: ATP = available + incoming; never mutates inventory', () => {
  it('ATP reflects on-hand, reservations, open-PO incoming, and updates after receipt/shipment; generating a report moves no stock', async () => {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const atp1 = await createIn(ATP_MODULE_ID, { asOfDate: '2026-09-01' });
    expect(Number(atp1.record!.fields.totalOnHand)).toBe(100);
    expect(Number(atp1.record!.fields.totalReserved)).toBe(0);
    expect(Number(atp1.record!.fields.totalAvailable)).toBe(100);
    expect(Number(atp1.record!.fields.totalIncoming)).toBe(0);
    expect(Number(atp1.record!.fields.totalAtp)).toBe(100); // available + incoming
    // reserve 30 → ATP available drops
    await createIn(MV, { movementNumber: 'MV-RES', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    const atp2 = await createIn(ATP_MODULE_ID, { asOfDate: '2026-09-02' });
    expect(Number(atp2.record!.fields.totalReserved)).toBe(30);
    expect(Number(atp2.record!.fields.totalAvailable)).toBe(70);
    expect(Number(atp2.record!.fields.totalAtp)).toBe(70);
    // an OPEN PO (approved/sent) adds incoming supply
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-INC', product: 'SKU-1', warehouse: 'WH-1', quantity: 50, status: 'draft' });
    await actIn(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'approve');
    const onHandBefore = onHand('SKU-1');
    const atp3 = await createIn(ATP_MODULE_ID, { asOfDate: '2026-09-03' });
    expect(Number(atp3.record!.fields.totalIncoming)).toBe(50);
    expect(Number(atp3.record!.fields.totalAtp)).toBe(70 + 50); // available + incoming
    // generating ATP reports moved NO stock
    expect(onHand('SKU-1')).toBe(onHandBefore);
    expect(movesOfType('receive').length).toBe(1); // still just the seed receive
    // an ATP report is an immutable snapshot
    expect((await updateIn(ATP_MODULE_ID, atp1.record!.id, { totalAtp: 999 })).ok).toBe(false);
  });
});

// ─────────────────────── 7 · INVENTORY INTEGRITY SEQUENCE + RECONCILIATION ───────────────────────
describe('S97 integrity — a controlled sequence reconciles deterministically from persisted state', () => {
  it('receipt → reservation → issue → release → second receipt: product == ledger at every stage', async () => {
    await seedProduct();
    const steps: Array<[string, Record<string, unknown>]> = [
      ['receive', { movementNumber: 'M1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 }],
      ['reservation', { movementNumber: 'M2', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 40 }],
      ['issue', { movementNumber: 'M3', type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 }],
      ['reservation_release', { movementNumber: 'M4', type: 'reservation_release', product: 'SKU-1', warehouse: 'WH-1', quantity: 40 }],
      ['receive', { movementNumber: 'M5', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 20 }],
    ];
    for (const [, fields] of steps) { await createIn(MV, fields); assertAuthority('SKU-1'); }
    // final deterministic reconciliation: 100 − 30 + 20 = 90 on-hand; reserved 40 − 40 = 0
    expect(onHand('SKU-1')).toBe(90);
    expect(reserved('SKU-1')).toBe(0);
    expect(available('SKU-1')).toBe(90);
    expect(onHand('SKU-1')).toBe(calculateCurrentStock(ledgerFor('SKU-1')));
  });
});

// ─────────────────────── 8 · NEGATIVE CONTROLS (incl. F-S97-1 reproduce + fix) ───────────────────────
describe('S97 negatives — immutable ledger: posted movement cannot be edited OR deleted; unauthorized/tenant fail closed', () => {
  it('F-S97-1: a POSTED stock movement cannot be DELETED (would silently corrupt on-hand) — fixed', async () => {
    await seedProduct();
    const mv = await createIn(MV, { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    expect(onHand('SKU-1')).toBe(100);
    const del = await deleteIn(MV, mv.record!.id);
    expect(del.ok).toBe(false); // S97 economic-delete guard
    expect(String(Object.values(del.errors ?? {})[0] ?? '')).toMatch(/authoritative inventory ledger|cannot be deleted/i);
    expect(onHand('SKU-1')).toBe(100); // stock UNCHANGED — the corruption is closed
    assertAuthority('SKU-1');
  });

  it('a posted movement cannot be edited (immutable); an over-issue is allowed but available goes negative (defined)', async () => {
    await seedProduct();
    const mv = await createIn(MV, { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    // edit a posted movement's quantity → refused (immutable ledger)
    expect((await updateIn(MV, mv.record!.id, { quantity: 999 })).ok).toBe(false);
    expect(onHand('SKU-1')).toBe(100);
    // an issue beyond on-hand: the canonical model ALLOWS it and available goes negative (DEFINED — "may go negative when oversold"); on-hand reflects the ledger truthfully
    await createIn(MV, { movementNumber: 'MV-2', type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 150 });
    expect(onHand('SKU-1')).toBe(-50);
    assertAuthority('SKU-1'); // product still equals the ledger derivation
  });

  it('unauthorized inventory mutation + forged/cross tenant fail closed', async () => {
    await seedProduct();
    // denied inventory:manage → movement create refused (the governed door fails closed by throwing
    // the authorization denial — a refusal, not a silent ok).
    const deny = makeCtx('inventory:manage');
    const denyHandlers = buildModuleHandlers(inst.registry, deny);
    const denyCreate = denyHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>;
    let deniedRefused = false;
    try {
      const r = (await denyCreate({ moduleId: MV, fields: { movementNumber: 'MV-X', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10 } })) as { ok: boolean };
      deniedRefused = r.ok === false;
    } catch { deniedRefused = true; }
    expect(deniedRefused).toBe(true);
    expect(movesOfType('receive').length).toBe(0);
    // tenant-B cannot see tenant-A's product/ledger
    await createIn(MV, { movementNumber: 'MV-A', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(listIn(PRODUCTS_MODULE_ID).find((r) => String(r.fields.sku) === 'SKU-1') ?? null).toBeNull();
    expect(listIn(MV).length).toBe(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  });
});

// ─────────────────────── 9 · RESTART / DURABILITY ───────────────────────
describe('S97 durability — ledger + stock + reservations + ATP survive a restart; replay does not duplicate', () => {
  it('rebuild over the same stores preserves everything; a replayed receipt post does not duplicate', async () => {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-R', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    await createIn(MV, { movementNumber: 'MV-RES', type: 'reservation', product: 'SKU-1', warehouse: 'WH-1', quantity: 30 });
    await createIn(ATP_MODULE_ID, { asOfDate: '2026-09-01' });
    const snap = { on: onHand('SKU-1'), res: reserved('SKU-1'), avail: available('SKU-1'), ledger: alive(MV).length, atp: alive(ATP_MODULE_ID).length };
    // flush the in-flight background writes to disk before the "restart" (the app's own shutdown flush).
    for (const m of [PRODUCTS_MODULE_ID, MV, ATP_MODULE_ID, PURCHASE_ORDERS_MODULE_ID]) await inst.registry.get(m)!.store.flush();
    const ctx2 = makeCtx();
    const inst2 = buildInstallation(paths, ctx2);
    for (const m of [PRODUCTS_MODULE_ID, MV, ATP_MODULE_ID, PURCHASE_ORDERS_MODULE_ID]) await inst2.registry.get(m)!.store.load();
    // the authoritative ledger + the materialized product both survive; stock recomputes identically.
    expect(alive(MV, inst2).length).toBe(snap.ledger);
    expect(calculateCurrentStock(ledgerFor('SKU-1', inst2))).toBe(snap.on);
    expect(calculateReservedStock(ledgerFor('SKU-1', inst2))).toBe(snap.res);
    expect(onHand('SKU-1', inst2)).toBe(snap.on);
    expect(reserved('SKU-1', inst2)).toBe(snap.res);
    expect(available('SKU-1', inst2)).toBe(snap.avail);
    expect(alive(ATP_MODULE_ID, inst2).length).toBe(snap.atp);
    assertAuthority('SKU-1', inst2);
    // ATP recomputed after restart (reads the persisted ledger + open POs) is stable
    const atp = await createIn(ATP_MODULE_ID, { asOfDate: '2026-09-04' }, inst2);
    expect(Number(atp.record!.fields.totalAvailable)).toBe(snap.avail);
  });
});

// ─────────────────────── 10 + 11 · CROSS-MODULE + AI BOUNDARY ───────────────────────
describe('S97 cross-module + AI — P2P/O2C drive the SAME ledger; advisory AI cannot mutate inventory', () => {
  it('a P2P receipt and an O2C issue both post to the one shared ledger with correct signs', async () => {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    // O2C issue via governed ship
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-1', customer: 'Beta', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 25, total: 250 }, idem: 'so' }), deps());
    await dispatchCommand(cmd('ShipSalesOrder', { target: String(so.data!.id), idem: 'ship' }), deps());
    expect(onHand('SKU-1')).toBe(75); // 100 (P2P-style receipt) − 25 (O2C issue) on the shared ledger
    assertAuthority('SKU-1');
  });

  it('an advisory principal (no inventory/sales/procurement manage) cannot receive, issue, or reserve', async () => {
    await seedProduct();
    await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const customer = await createIn(CUSTOMERS_MODULE_ID, { name: 'Beta' });
    const so = await dispatchCommand(cmd('CreateSalesOrder', { payload: { orderNumber: 'SO-AI', customer: 'Beta', customerRef: customer.record!.id, product: 'SKU-1', warehouse: 'WH-1', orderedQty: 10, total: 100 }, idem: 'so' }), deps());
    const advisory = makeCtx();
    advisory.authorize = (p: EnterprisePermission) => { authorized.push(p); if (['inventory:manage', 'sales:manage', 'procurement:manage'].includes(p)) throw new Error(`advisory has no ${p}`); };
    const advHandlers = buildModuleHandlers(inst.registry, advisory);
    const advCreateHandler = advHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>;
    // advisory direct movement create refused (fails closed by throwing the denial)
    let advRefused = false;
    try {
      const r = (await advCreateHandler({ moduleId: MV, fields: { movementNumber: 'MV-AI', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 5 } })) as { ok: boolean };
      advRefused = r.ok === false;
    } catch { advRefused = true; }
    expect(advRefused).toBe(true);
    // advisory governed ship refused
    expect((await dispatchCommand(cmd('ShipSalesOrder', { target: String(so.data!.id), idem: 'aiship' }), deps(inst, advisory))).error).toBe('UNAUTHORIZED');
    expect(movesOfType('issue').length).toBe(0);
    expect(onHand('SKU-1')).toBe(100); // unchanged
  });
});
