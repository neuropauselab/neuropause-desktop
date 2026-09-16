/**
 * ERP Session 98 — MANUFACTURING END-TO-END CONTROL-PLANE CERTIFICATION.
 *
 * Certifies Manufacturing as a governed CONSUMER and PRODUCER of the same canonical inventory + finance
 * control plane — reusing ONLY the existing production-order lifecycle, BOM recipe, stock-movement ledger,
 * standard-cost GL bridge, WIP/FG accounts, variance settlement, idempotency and tenant controls. No new
 * engine. Manufacturing has NO domain commands: it is driven through governed module ACTIONS (RBAC + tenant
 * + audit), so this suite exercises the real IPC action door end to end.
 *
 * THE LIFECYCLE (each transition posts the real inventory movement + GL, never edits stock directly):
 *   plan      draft   → planned    (no material)
 *   allocate  planned → released   (reservation movements per BOM component — reserved↑, on-hand unchanged)
 *   start     released→ running    (production_consumption per component: on-hand↓, Dr WIP/Cr Inventory; releases the reservations)
 *   complete  running → completed  (production_output: FG on-hand↑, Dr FG/Cr WIP) + onChange variance settle → 5910
 *
 * STOCK AUTHORITY (source-wins): the stock-movement ledger is authoritative; product on-hand/reserved/available
 * are MATERIALIZED by the reconciler (production_consumption = −on-hand, production_output = +on-hand,
 * reservation/release = ±reserved). Every operation asserts product == ledger derivation.
 *
 * THE ONE PRODUCTION CHANGE this session is F-S98-1: the production-order `status` is now MACHINE-OWNED
 * (readOnly + a validate hook refusing status edits) — mirroring the sales-order (S45) + stock-movement (S55)
 * guards. Before the fix, a hand-set status via the edit door moved NO material yet let `complete` yield
 * finished goods from nothing (Cr WIP with no Dr WIP → phantom FG + broken WIP), and a direct edit to
 * `completed` even fired the variance GL. Reproduce-first for F-S98-1 is included below.
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
  BOM_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
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
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createBomModule } from '../../enterprise/modules/manufacturing/bomModule';
import { createProductionOrderModule } from '../../enterprise/modules/manufacturing/productionOrderModule';
import { productionVarianceEntryNumber } from '../../enterprise/modules/manufacturing/productionVarianceSettlement';
import { STOCK_ACCOUNTS } from '../../erp/postingRules';

const MV = 'inventory-movements';
// A finished good FG-1 built from 2× RM-1 (std 5) and 3× RM-2 (std 4); yield 100%, no waste.
const RM1 = 'RM-1', RM1_COST = 5;
const RM2 = 'RM-2', RM2_COST = 4;
const FG = 'FG-1', FG_COST = 12;
const PLANNED_QTY = 5;

interface StorePaths { prod: string; mv: string; acct: string; jrnl: string; bom: string; po: string; }
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s98-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), mv: p('mv'), acct: p('acct'), jrnl: p('jrnl'), bom: p('bom'), po: p('po') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];
function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'operator@np.dev', now: () => '2026-09-04T12:00:00.000Z',
  };
}
function buildInstallation(paths: StorePaths, ctx: EnterpriseModuleContext) {
  const registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(paths.acct);
  for (const m of [
    createProductModule(paths.prod),
    createStockMovementModule(paths.mv),
    accounts,
    createJournalEntryModule(paths.jrnl, accounts.store),
    createBomModule(paths.bom),
    createProductionOrderModule(paths.po),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  const handlers = buildModuleHandlers(registry, ctx);
  return { registry, handlers };
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

const handler = (i: ReturnType<typeof buildInstallation>, ch: string) => { const d = i.handlers.find((x) => x.channel === ch); if (!d) throw new Error(`no handler ${ch}`); return d.handler as (p: unknown) => Promise<unknown>; };
const createIn = (m: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const actIn = (m: string, id: string, a: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const updateIn = (m: string, id: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleUpdate)({ moduleId: m, id, fields: f }) as Promise<{ ok: boolean; error?: string; errors?: Record<string, string> }>;
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
const orderStatus = (id: string, i = inst) => String(rec(PRODUCTION_ORDERS_MODULE_ID, id, i)!.fields.status);

/** THE STOCK-AUTHORITY INVARIANT. */
function assertAuthority(sku: string, i = inst) {
  const led = ledgerFor(sku, i);
  expect(onHand(sku, i)).toBe(calculateCurrentStock(led));
  expect(reserved(sku, i)).toBe(calculateReservedStock(led));
  expect(available(sku, i)).toBe(calculateCurrentStock(led) - calculateReservedStock(led));
}

function journalLines(i = inst): { account: string; debit: number; credit: number }[] {
  return listIn(JOURNAL_ENTRIES_MODULE_ID, i).flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit', i = inst): number =>
  journalLines(i).filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);

async function seedMasterData(i = inst) {
  await createIn(PRODUCTS_MODULE_ID, { sku: RM1, name: 'Raw 1', standardCost: RM1_COST }, i);
  await createIn(PRODUCTS_MODULE_ID, { sku: RM2, name: 'Raw 2', standardCost: RM2_COST }, i);
  await createIn(PRODUCTS_MODULE_ID, { sku: FG, name: 'Finished', standardCost: FG_COST }, i);
  // component stock on hand (a receive movement — the canonical inventory door)
  await createIn(MV, { movementNumber: 'MV-SEED-RM1', type: 'receive', product: RM1, warehouse: 'WH-1', quantity: 100 }, i);
  await createIn(MV, { movementNumber: 'MV-SEED-RM2', type: 'receive', product: RM2, warehouse: 'WH-1', quantity: 100 }, i);
  await createIn(BOM_MODULE_ID, {
    bomNumber: 'BOM-1', product: FG, outputQuantity: 1, yield: 100, waste: 0, revision: 'A', status: 'active',
    components: JSON.stringify([{ sku: RM1, quantity: 2, waste: 0 }, { sku: RM2, quantity: 3, waste: 0 }]),
  }, i);
}
async function newOrder(i = inst): Promise<string> {
  const o = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-1', bom: 'BOM-1', product: FG, warehouse: 'WH-1', productionQuantity: PLANNED_QTY }, i);
  expect(o.ok).toBe(true);
  return o.record!.id;
}

// ─────────────────────── 2 · MASTER DATA + BOM (the recipe) ───────────────────────
describe('S98 BOM — the recipe is a governed record; component quantities scale deterministically', () => {
  it('a BOM defines components; a fresh order is born draft; component consumption scales by planned qty', async () => {
    await seedMasterData();
    const bom = listIn(BOM_MODULE_ID)[0];
    expect(String(bom.fields.product)).toBe(FG);
    const orderId = await newOrder();
    expect(orderStatus(orderId)).toBe('draft'); // born draft, machine-owned
    // 2× RM-1 and 3× RM-2 for 5 units, no waste = 10 RM-1, 15 RM-2 (proven by the allocate reservations below)
    assertAuthority(RM1); assertAuthority(RM2);
  });
});

// ─────────────────────── 3 · LIFECYCLE + STATUS-GATING ───────────────────────
describe('S98 lifecycle — plan → allocate → start → complete; each transition is status-gated', () => {
  it('the happy path advances the machine and refuses every out-of-order transition', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    // out-of-order: cannot allocate/start/complete a draft
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate')).ok).toBe(false);
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start')).ok).toBe(false);
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete')).ok).toBe(false);
    // plan
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan')).ok).toBe(true);
    expect(orderStatus(orderId)).toBe('planned');
    // allocate
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate')).ok).toBe(true);
    expect(orderStatus(orderId)).toBe('released');
    // start
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start')).ok).toBe(true);
    expect(orderStatus(orderId)).toBe('running');
    // complete
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete')).ok).toBe(true);
    expect(orderStatus(orderId)).toBe('completed');
    // re-completing a completed order is refused (status-gated; no second output)
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete')).ok).toBe(false);
    expect(movesOfType('production_output').length).toBe(1);
  });
});

// ─────────────────────── 4 · MATERIAL FLOW (consumer of the ledger) ───────────────────────
describe('S98 material — allocate reserves (no phantom), start consumes, complete yields; product == ledger throughout', () => {
  it('reservation raises reserved without on-hand; consumption lowers component on-hand; output raises FG on-hand', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan');

    // allocate → reservation movements (10 RM-1, 15 RM-2); reserved↑, on-hand UNCHANGED (no phantom)
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate')).ok).toBe(true);
    expect(onHand(RM1)).toBe(100); expect(reserved(RM1)).toBe(10); expect(available(RM1)).toBe(90);
    expect(onHand(RM2)).toBe(100); expect(reserved(RM2)).toBe(15); expect(available(RM2)).toBe(85);
    assertAuthority(RM1); assertAuthority(RM2);

    // start → production_consumption (on-hand −10 / −15) + reservation release (reserved back to 0)
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start')).ok).toBe(true);
    expect(onHand(RM1)).toBe(90); expect(reserved(RM1)).toBe(0);
    expect(onHand(RM2)).toBe(85); expect(reserved(RM2)).toBe(0);
    expect(movesOfType('production_consumption').length).toBe(2); // one per component
    assertAuthority(RM1); assertAuthority(RM2);

    // complete → production_output: 5 finished units (yield 100%), FG on-hand 0 → 5
    expect(onHand(FG)).toBe(0);
    expect((await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete')).ok).toBe(true);
    expect(onHand(FG)).toBe(5);
    expect(movesOfType('production_output').length).toBe(1);
    assertAuthority(FG);
  });
});

// ─────────────────────── 5 · WIP + GL (producer into finance) ───────────────────────
describe('S98 WIP/GL — consumption Dr WIP/Cr Inventory, output Dr FG/Cr WIP, variance settles WIP to 5910', () => {
  it('the standard-cost bridge posts WIP correctly and WIP nets to zero after variance settlement', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start');
    // consumption: Dr WIP (10×5 + 15×4 = 110) / Cr Inventory 110
    expect(bal(STOCK_ACCOUNTS.wip, 'debit')).toBe(110);
    expect(bal(STOCK_ACCOUNTS.inventory, 'credit')).toBe(110);
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete');
    // The COMPLETE action's self-emit fires onChange FIRE-AND-FORGET (createLifecycleEmitter line ~384:
    // `void emitLifecycle(...)`), so variance settlement runs just after the action returns. Drive it
    // deterministically through the IPC update door, which AWAITS onChange (line ~391) — the same
    // technique productionCostingAndVariance.test.ts Part C uses; settlement is idempotent, so this
    // never double-posts. The `operator` edit is a non-status field (the F-S98-1 guard fences status only).
    await updateIn(PRODUCTION_ORDERS_MODULE_ID, orderId, { operator: 'settle' });
    // output: Dr FG (5×12 = 60) / Cr WIP 60
    expect(bal(STOCK_ACCOUNTS.finishedGoods, 'debit')).toBe(60);
    expect(bal(STOCK_ACCOUNTS.wip, 'credit') >= 60).toBe(true);
    // variance settlement (onChange): WIP 110 − standard output 60 = 50 unfavourable → Dr 5910 50 / Cr WIP 50
    expect(bal(STOCK_ACCOUNTS.productionVariance, 'debit')).toBe(50);
    // WIP nets to zero after settlement (110 in − 60 out − 50 variance)
    expect(bal(STOCK_ACCOUNTS.wip, 'debit') - bal(STOCK_ACCOUNTS.wip, 'credit')).toBe(0);
    // variance entry posted exactly once
    const varCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).filter((e) => String(e.fields.entryNumber) === productionVarianceEntryNumber(orderId)).length;
    expect(varCount()).toBe(1);
  });
});

// ─────────────────────── 6 · IMMUTABLE PRODUCTION LEDGER ───────────────────────
describe('S98 immutability — a posted production movement cannot be edited OR deleted (reuses the S97 guard)', () => {
  it('a production_consumption movement is immutable to edit and delete; on-hand stays truthful', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start');
    const mv = movesOfType('production_consumption')[0];
    const onHandBefore = onHand(RM1) + onHand(RM2);
    // edit refused (immutable ledger)
    expect((await updateIn(MV, mv.id, { quantity: 999 })).ok).toBe(false);
    // delete refused (S97 economic-delete guard covers inventory-movements)
    const del = await deleteIn(MV, mv.id);
    expect(del.ok).toBe(false);
    expect(String(Object.values(del.errors ?? {})[0] ?? '')).toMatch(/authoritative inventory ledger|cannot be deleted/i);
    expect(onHand(RM1) + onHand(RM2)).toBe(onHandBefore); // ledger unchanged
  });
});

// ─────────────────────── 7 · F-S98-1 REPRODUCE + FIX (machine-owned status) ───────────────────────
describe('S98 F-S98-1 — production status is machine-owned; the edit door cannot forge a lifecycle transition', () => {
  it('editing status to running/completed via the edit door is refused, so no phantom finished goods can be produced', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    // BEFORE the fix this succeeded and left the order "running" with NO material consumed, letting complete
    // yield finished goods from nothing. Now the machine-owned guard refuses the status edit.
    const toRunning = await updateIn(PRODUCTION_ORDERS_MODULE_ID, orderId, { status: 'running' });
    expect(toRunning.ok).toBe(false);
    expect(String(Object.values(toRunning.errors ?? {})[0] ?? '')).toMatch(/lifecycle actions/i);
    expect(orderStatus(orderId)).toBe('draft'); // unchanged

    // a direct edit to 'completed' (which BEFORE the fix even fired the variance GL) is likewise refused
    const toCompleted = await updateIn(PRODUCTION_ORDERS_MODULE_ID, orderId, { status: 'completed' });
    expect(toCompleted.ok).toBe(false);
    expect(orderStatus(orderId)).toBe('draft');

    // proof of the closed corruption: NO material moved and NO GL posted from the forged edits
    expect(movesOfType('production_consumption').length).toBe(0);
    expect(movesOfType('production_output').length).toBe(0);
    expect(onHand(FG)).toBe(0);
    expect(journalLines().length).toBe(0);

    // a non-status edit is still allowed (the guard only fences status)
    expect((await updateIn(PRODUCTION_ORDERS_MODULE_ID, orderId, { operator: 'jane' })).ok).toBe(true);
    expect(orderStatus(orderId)).toBe('draft');
  });
});

// ─────────────────────── 8 · SECURITY (tenant / RBAC / AI) ───────────────────────
describe('S98 security — manufacturing writes require authority; tenant isolation; advisory AI cannot produce', () => {
  it('an unauthorized principal cannot create an order; another tenant sees nothing; advisory AI cannot run the lifecycle', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan');

    // denied manufacturing:manage → create refused (fails closed by throwing the denial)
    const deny = makeCtx('manufacturing:manage');
    const denyHandlers = buildModuleHandlers(inst.registry, deny);
    const denyCreate = denyHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>;
    let deniedRefused = false;
    try {
      const r = (await denyCreate({ moduleId: PRODUCTION_ORDERS_MODULE_ID, fields: { orderNumber: 'MO-X', bom: 'BOM-1', warehouse: 'WH-1', productionQuantity: 1 } })) as { ok: boolean };
      deniedRefused = r.ok === false;
    } catch { deniedRefused = true; }
    expect(deniedRefused).toBe(true);

    // advisory principal (no manufacturing/inventory manage) cannot allocate material
    const advisory = makeCtx();
    advisory.authorize = (p: EnterprisePermission) => { authorized.push(p); if (['manufacturing:manage', 'inventory:manage'].includes(p)) throw new Error(`advisory has no ${p}`); };
    const advHandlers = buildModuleHandlers(inst.registry, advisory);
    const advAct = advHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleAction)!.handler as (p: unknown) => Promise<unknown>;
    let advRefused = false;
    try {
      const r = (await advAct({ moduleId: PRODUCTION_ORDERS_MODULE_ID, id: orderId, action: 'allocate' })) as { ok: boolean };
      advRefused = r.ok === false;
    } catch { advRefused = true; }
    expect(advRefused).toBe(true);
    expect(movesOfType('reservation').length).toBe(0); // nothing reserved by the advisory attempt

    // tenant-B cannot see tenant-A's order / BOM / product
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(listIn(PRODUCTION_ORDERS_MODULE_ID).length).toBe(0);
    expect(listIn(BOM_MODULE_ID).length).toBe(0);
    expect(listIn(PRODUCTS_MODULE_ID).length).toBe(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  });
});

// ─────────────────────── 9 · RESTART / DURABILITY ───────────────────────
describe('S98 durability — order, movements, stock and GL survive a restart; the completed order stays completed', () => {
  it('rebuild over the same stores preserves the full production run', async () => {
    await seedMasterData();
    const orderId = await newOrder();
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'plan');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'allocate');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'start');
    await actIn(PRODUCTION_ORDERS_MODULE_ID, orderId, 'complete');
    // deterministically settle variance (the action's onChange emit is fire-and-forget) — idempotent
    await updateIn(PRODUCTION_ORDERS_MODULE_ID, orderId, { operator: 'settle' });
    const snap = {
      fgOnHand: onHand(FG), rm1OnHand: onHand(RM1), rm2OnHand: onHand(RM2),
      consume: movesOfType('production_consumption').length, output: movesOfType('production_output').length,
      wipNet: bal(STOCK_ACCOUNTS.wip, 'debit') - bal(STOCK_ACCOUNTS.wip, 'credit'),
      variance: bal(STOCK_ACCOUNTS.productionVariance, 'debit'), ledger: alive(MV).length,
    };
    // flush in-flight background writes (the app's own shutdown flush) before the "restart"
    for (const m of [PRODUCTS_MODULE_ID, MV, JOURNAL_ENTRIES_MODULE_ID, BOM_MODULE_ID, PRODUCTION_ORDERS_MODULE_ID]) await inst.registry.get(m)!.store.flush();
    const inst2 = buildInstallation(paths, makeCtx());
    for (const m of [PRODUCTS_MODULE_ID, MV, JOURNAL_ENTRIES_MODULE_ID, BOM_MODULE_ID, PRODUCTION_ORDERS_MODULE_ID]) await inst2.registry.get(m)!.store.load();
    expect(orderStatus(orderId, inst2)).toBe('completed');
    expect(onHand(FG, inst2)).toBe(snap.fgOnHand);
    expect(onHand(RM1, inst2)).toBe(snap.rm1OnHand);
    expect(onHand(RM2, inst2)).toBe(snap.rm2OnHand);
    expect(movesOfType('production_consumption', inst2).length).toBe(snap.consume);
    expect(movesOfType('production_output', inst2).length).toBe(snap.output);
    expect(alive(MV, inst2).length).toBe(snap.ledger);
    expect(bal(STOCK_ACCOUNTS.wip, 'debit', inst2) - bal(STOCK_ACCOUNTS.wip, 'credit', inst2)).toBe(snap.wipNet);
    expect(bal(STOCK_ACCOUNTS.productionVariance, 'debit', inst2)).toBe(snap.variance);
    // stock recomputes identically from the persisted ledger
    expect(calculateCurrentStock(ledgerFor(FG, inst2))).toBe(snap.fgOnHand);
    assertAuthority(FG, inst2); assertAuthority(RM1, inst2); assertAuthority(RM2, inst2);
  });
});
