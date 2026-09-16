/**
 * ERP Session 99 — MAINTENANCE ECONOMIC CONTROL-PLANE CERTIFICATION.
 *
 * Certifies Maintenance as a SAFE, governed participant in the canonical Inventory + Finance control plane,
 * reusing ONLY the existing stock-movement ledger and the shared GL bridge — no new engine. Maintenance has
 * NO domain commands; it is driven through governed module ACTIONS (RBAC + tenant + audit).
 *
 * THE ONE ECONOMIC SEAM (source-wins): spare-part `consume` posts a REAL `production_consumption` movement
 * into the canonical `inventory-movements` ledger via postSparePartConsumption → postStockMovement, so a part
 * issued to a repair reduces on-hand exactly once and is idempotent (status-guarded). This is the ONLY
 * maintenance path that touches Inventory or the GL.
 *
 * POLICY-OPEN (NOT invented — see DECISION-MEMO-S99): maintenance cost → GL treatment is undefined. Two facts
 * are asserted here TRUTHFULLY, not "fixed":
 *   (1) Labor cost (Work Order `laborCost`/`partsCost`) posts NO journal at all — a non-posting field.
 *   (2) Spare-part material value posts INCIDENTALLY to Dr WIP (1350) / Cr Inventory (1300), because the seam
 *       reuses Manufacturing's `production_consumption` movement type, whose shared GL bridge is labelled
 *       "material issued to a production order". The Cr Inventory is correct (stock really left); the WIP DEBIT
 *       is a policy-open mis-attribution — the correct maintenance-expense account and repair-vs-capex rule are
 *       UNDEFINED and are deliberately NOT chosen here. Changing the debit account would be inventing policy.
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
  SPARE_PARTS_MODULE_ID,
  WORK_ORDERS_MODULE_ID,
  MAINTENANCE_HISTORY_MODULE_ID,
  JOURNAL_ENTRIES_MODULE_ID,
  calculateCurrentStock,
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
import { createSparePartModule } from '../../enterprise/modules/maintenance/sparePartModule';
import { createWorkOrderModule } from '../../enterprise/modules/maintenance/workOrderModule';
import { createMaintenanceHistoryModule } from '../../enterprise/modules/maintenance/maintenanceHistoryModule';
import { STOCK_ACCOUNTS } from '../../erp/postingRules';

const MV = 'inventory-movements';
const SKU = 'SP-SKU-1', STD_COST = 8;

interface StorePaths { prod: string; mv: string; acct: string; jrnl: string; sp: string; wo: string; hist: string; }
const allPaths: string[] = [];
function freshPaths(): StorePaths {
  const p = (t: string): string => { const f = join(tmpdir(), `np-s99m-${t}-${randomUUID()}.json`); allPaths.push(f); return f; };
  return { prod: p('prod'), mv: p('mv'), acct: p('acct'), jrnl: p('jrnl'), sp: p('sp'), wo: p('wo'), hist: p('hist') };
}

let scope: TenantScope | null;
let authorized: EnterprisePermission[];
function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
    audit: () => undefined, publish: (_i: PlatformEventInput) => undefined, broadcast: () => undefined, notify: () => undefined,
    actor: () => 'tech@np.dev', now: () => '2026-09-04T12:00:00.000Z',
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
    createSparePartModule(paths.sp),
    createWorkOrderModule(paths.wo),
    createMaintenanceHistoryModule(paths.hist),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  return { registry, handlers: buildModuleHandlers(registry, ctx) };
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
const createIn = (m: string, f: Record<string, unknown>, i = inst) => handler(i, IpcChannel.EnterpriseModuleCreate)({ moduleId: m, fields: f }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (m: string, id: string, a: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleAction)({ moduleId: m, id, action: a }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const deleteIn = (m: string, id: string, i = inst) => handler(i, IpcChannel.EnterpriseModuleDelete)({ moduleId: m, id }) as Promise<{ ok: boolean; errors?: Record<string, string> }>;
const listIn = (m: string, i = inst) => i.registry.get(m)!.store.list();
const rec = (m: string, id: string, i = inst) => i.registry.get(m)!.store.get(id);
const alive = (m: string, i = inst) => listIn(m, i).filter((r) => r.status !== 'deleted');
const prod = (i = inst) => listIn(PRODUCTS_MODULE_ID, i).find((r) => String(r.fields.sku) === SKU)!;
const ledger = (i = inst): StockMovement[] => listIn(MV, i).map(movementFromRecord).filter((m) => m.product === SKU);
const onHand = (i = inst) => Number(prod(i).fields.currentStock ?? 0);
const consumeMoves = (i = inst) => listIn(MV, i).filter((m) => m.status !== 'deleted' && String(m.fields.type) === 'production_consumption');
function journalLines(i = inst): { account: string; debit: number; credit: number }[] {
  return listIn(JOURNAL_ENTRIES_MODULE_ID, i).flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit', i = inst): number =>
  journalLines(i).filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);

async function seedStock(i = inst) {
  await createIn(PRODUCTS_MODULE_ID, { sku: SKU, name: 'Bearing', standardCost: STD_COST }, i);
  await createIn(MV, { movementNumber: 'MV-SEED', type: 'receive', product: SKU, warehouse: 'WH-1', quantity: 100 }, i);
}
async function newPart(qty = 5, i = inst): Promise<string> {
  const p = await createIn(SPARE_PARTS_MODULE_ID, { partNumber: 'SP-1', product: SKU, warehouse: 'WH-1', quantity: qty, unitCost: STD_COST, workOrder: 'WO-1' }, i);
  expect(p.ok).toBe(true);
  return p.record!.id;
}

// ─────────────────────── 1 · SPARE-PART CONSUMPTION → CANONICAL LEDGER ───────────────────────
describe('S99 maintenance — spare-part consume posts exactly one production_consumption; idempotent; on-hand truthful', () => {
  it('consuming a spare part reduces on-hand exactly once and a replay does not duplicate the movement', async () => {
    await seedStock();
    expect(onHand()).toBe(100);
    const partId = await newPart(5);
    const before = consumeMoves().length;
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume')).ok).toBe(true);
    expect(consumeMoves().length).toBe(before + 1); // exactly one movement
    expect(onHand()).toBe(95); // −5 on the canonical ledger
    expect(onHand()).toBe(calculateCurrentStock(ledger())); // product materializes the ledger
    // replay: consuming the same part again is refused (status-guarded) → NO second movement
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume')).ok).toBe(false);
    expect(consumeMoves().length).toBe(before + 1);
    expect(onHand()).toBe(95);
  });

  it('a cancelled part cannot be consumed (no inventory effect)', async () => {
    await seedStock();
    const partId = await newPart(5);
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'cancel')).ok).toBe(true);
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume')).ok).toBe(false);
    expect(consumeMoves().length).toBe(0);
    expect(onHand()).toBe(100);
  });

  it('the posted spare-part movement is an immutable ledger row — it cannot be deleted (S97 guard)', async () => {
    await seedStock();
    const partId = await newPart(5);
    await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume');
    const mv = consumeMoves()[0];
    const del = await deleteIn(MV, mv.id);
    expect(del.ok).toBe(false);
    expect(onHand()).toBe(95); // unchanged after the refused delete
  });
});

// ─────────────────────── 2 · GL BOUNDARY (policy-open, asserted truthfully) ───────────────────────
describe('S99 maintenance GL boundary — labor is non-posting; spare material posts incidentally to WIP (POLICY-OPEN)', () => {
  it('a Work Order carrying laborCost/partsCost posts NO journal — labor cost is a non-posting field', async () => {
    await seedStock();
    const wo = await createIn(WORK_ORDERS_MODULE_ID, { workOrderNumber: 'WO-1', type: 'corrective', laborCost: 500, partsCost: 200, status: 'scheduled' });
    expect(wo.ok).toBe(true);
    // creating/holding a work order with cost fields produces zero GL — maintenance labor never posts
    expect(journalLines().length).toBe(0);
  });

  it('spare-part material posts Dr WIP / Cr Inventory via the shared bridge — Cr Inventory correct; WIP debit is a POLICY-OPEN mis-attribution, not chosen here', async () => {
    await seedStock();
    const partId = await newPart(5);
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume')).ok).toBe(true);
    // The inventory CREDIT is correct — 5 × std 8 of stock really left the warehouse.
    expect(bal(STOCK_ACCOUNTS.inventory, 'credit')).toBe(40);
    // The DEBIT lands in WIP (1350) because the seam reuses the production_consumption type. This is the
    // incidental, policy-open effect DECISION-MEMO-S99 documents; it is asserted, NOT corrected (choosing a
    // maintenance-expense account / repair-vs-capex rule would be inventing accounting policy).
    expect(bal(STOCK_ACCOUNTS.wip, 'debit')).toBe(40);
    // NO maintenance-specific expense/repairs account is posted (none is defined).
  });
});

// ─────────────────────── 3 · WORK-ORDER LIFECYCLE (operational state) ───────────────────────
describe('S99 maintenance lifecycle — a work order runs assign → start → complete → verify and records history', () => {
  it('the work order advances through its lifecycle and verify creates a maintenance-history record', async () => {
    await seedStock();
    const wo = await createIn(WORK_ORDERS_MODULE_ID, { workOrderNumber: 'WO-1', type: 'corrective', technician: 'Sam', status: 'scheduled', laborCost: 100, partsCost: 0 });
    const id = wo.record!.id;
    expect((await actIn(WORK_ORDERS_MODULE_ID, id, 'assign')).ok).toBe(true);
    expect((await actIn(WORK_ORDERS_MODULE_ID, id, 'start')).ok).toBe(true);
    expect((await actIn(WORK_ORDERS_MODULE_ID, id, 'complete')).ok).toBe(true);
    expect((await actIn(WORK_ORDERS_MODULE_ID, id, 'verify')).ok).toBe(true);
    expect(String(rec(WORK_ORDERS_MODULE_ID, id)!.fields.status)).toBe('verified');
    expect(alive(MAINTENANCE_HISTORY_MODULE_ID).length).toBe(1); // history record created on verify
    // no journal from the lifecycle itself (labor/parts cost are non-posting fields)
    expect(journalLines().length).toBe(0);
  });
});

// ─────────────────────── 4 · SECURITY (tenant / RBAC / AI boundary) ───────────────────────
describe('S99 maintenance security — spare consume needs inventory authority; tenant isolation; advisory cannot mutate inventory', () => {
  it('an advisory principal with no inventory:manage cannot consume a spare part; another tenant sees nothing', async () => {
    await seedStock();
    const partId = await newPart(5);
    // advisory: has maintenance:manage (so the action door opens) but NOT inventory:manage → postStockMovement refuses
    const advisory = makeCtx();
    advisory.authorize = (p: EnterprisePermission) => { authorized.push(p); if (p === 'inventory:manage') throw new Error('advisory has no inventory:manage'); };
    const advHandlers = buildModuleHandlers(inst.registry, advisory);
    const advAct = advHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleAction)!.handler as (p: unknown) => Promise<unknown>;
    let refused = false;
    try {
      const r = (await advAct({ moduleId: SPARE_PARTS_MODULE_ID, id: partId, action: 'consume' })) as { ok: boolean };
      refused = r.ok === false;
    } catch { refused = true; }
    expect(refused).toBe(true);
    expect(consumeMoves().length).toBe(0); // no inventory effect from the advisory attempt
    expect(onHand()).toBe(100);

    // tenant-B cannot see tenant-A's spare part, product, or ledger
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(listIn(SPARE_PARTS_MODULE_ID).length).toBe(0);
    expect(listIn(PRODUCTS_MODULE_ID).length).toBe(0);
    expect(listIn(MV).length).toBe(0);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  });

  it('an unauthorized principal (no maintenance:manage) cannot create a spare part', async () => {
    await seedStock();
    const deny = makeCtx('maintenance:manage');
    const denyHandlers = buildModuleHandlers(inst.registry, deny);
    const denyCreate = denyHandlers.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>;
    let refused = false;
    try {
      const r = (await denyCreate({ moduleId: SPARE_PARTS_MODULE_ID, fields: { partNumber: 'SP-X', product: SKU, warehouse: 'WH-1', quantity: 1 } })) as { ok: boolean };
      refused = r.ok === false;
    } catch { refused = true; }
    expect(refused).toBe(true);
  });
});

// ─────────────────────── 5 · RESTART / DURABILITY ───────────────────────
describe('S99 maintenance durability — spare movement + work-order state + GL survive a restart; no duplicate', () => {
  it('rebuild over the same stores preserves the consumption, the on-hand, the WIP GL and the work-order state', async () => {
    await seedStock();
    const partId = await newPart(5);
    await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume');
    const wo = await createIn(WORK_ORDERS_MODULE_ID, { workOrderNumber: 'WO-1', type: 'corrective', status: 'scheduled' });
    await actIn(WORK_ORDERS_MODULE_ID, wo.record!.id, 'assign');
    const snap = { on: onHand(), consume: consumeMoves().length, wip: bal(STOCK_ACCOUNTS.wip, 'debit'), ledger: alive(MV).length, woStatus: String(rec(WORK_ORDERS_MODULE_ID, wo.record!.id)!.fields.status) };
    for (const m of [PRODUCTS_MODULE_ID, MV, JOURNAL_ENTRIES_MODULE_ID, SPARE_PARTS_MODULE_ID, WORK_ORDERS_MODULE_ID]) await inst.registry.get(m)!.store.flush();
    const inst2 = buildInstallation(paths, makeCtx());
    for (const m of [PRODUCTS_MODULE_ID, MV, JOURNAL_ENTRIES_MODULE_ID, SPARE_PARTS_MODULE_ID, WORK_ORDERS_MODULE_ID]) await inst2.registry.get(m)!.store.load();
    expect(onHand(inst2)).toBe(snap.on);
    expect(consumeMoves(inst2).length).toBe(snap.consume);
    expect(alive(MV, inst2).length).toBe(snap.ledger);
    expect(bal(STOCK_ACCOUNTS.wip, 'debit', inst2)).toBe(snap.wip);
    expect(String(rec(WORK_ORDERS_MODULE_ID, wo.record!.id, inst2)!.fields.status)).toBe(snap.woStatus);
    // replaying consume after restart is still refused (already consumed) → no duplicate movement
    expect((await actIn(SPARE_PARTS_MODULE_ID, partId, 'consume', inst2)).ok).toBe(false);
    expect(consumeMoves(inst2).length).toBe(snap.consume);
  });
});
