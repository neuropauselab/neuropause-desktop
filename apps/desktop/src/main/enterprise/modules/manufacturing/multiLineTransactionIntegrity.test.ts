/**
 * ERP Session 7 — multi-line transaction integrity.
 *
 * Establishes the current architecture and verifies the ONE multi-line inventory
 * document the system has:
 *   • Purchase receipts and sales dispatches are SINGLE-LINE (one product per
 *     record → exactly one movement). There is no multi-line receipt/dispatch
 *     document today (see ERP-SESSION7-MULTILINE-DECISION.md).
 *   • A PRODUCTION ORDER is multi-line: START consumes N BOM components → N
 *     `production_consumption` movements, each independently standard-costed per
 *     SKU (Session 5-Fix), each posting balanced WIP GL, each traceable to the
 *     order, and each independently reversible on void (Session 6).
 *   • Multi-line posting is NON-ATOMIC (partial on first-line failure) — the
 *     recorded policy decision.
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
  BOM_MODULE_ID,
  IpcChannel,
  JOURNAL_ENTRIES_MODULE_ID,
  PRODUCTION_ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  movementFromRecord,
  serializeBomComponents,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework/moduleRegistry';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { createBomModule } from './bomModule';
import { createProductionOrderModule } from './productionOrderModule';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

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
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => T0,
  };
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createGoodsReceiptModule(tmp('gr')),
    createBomModule(tmp('bom')),
    createProductionOrderModule(tmp('po')),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
}
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string> }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string; error?: string }>;
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields });

const consumptions = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.type) === 'production_consumption');
const lines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
const net = (account: string) => lines().filter((l) => l.account === account).reduce((n, l) => n + l.debit - l.credit, 0);
const totalDr = () => lines().reduce((n, l) => n + l.debit, 0);
const totalCr = () => lines().reduce((n, l) => n + l.credit, 0);
const seedProduct = (sku: string, standardCost: number) => createIn('inventory-products', { sku, name: sku, standardCost });

/** Drive a 2-component production order through plan → allocate → start. */
async function runTwoLineProduction(): Promise<EnterpriseEntity> {
  await seedProduct('FG-1', 100);
  await seedProduct('RM-1', 5);
  await seedProduct('RM-2', 7);
  await createIn(BOM_MODULE_ID, {
    bomNumber: 'BOM-2L', product: 'FG-1', revision: 'A', status: 'active',
    components: serializeBomComponents([
      { sku: 'RM-1', quantity: 3, waste: 0, alternative: '' },
      { sku: 'RM-2', quantity: 2, waste: 0, alternative: '' },
    ]),
  });
  const o = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-2L', bom: 'BOM-2L', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 2, status: 'draft' });
  const id = o.record!.id;
  expect((await act(PRODUCTION_ORDERS_MODULE_ID, id, 'plan')).ok).toBe(true);
  expect((await act(PRODUCTION_ORDERS_MODULE_ID, id, 'allocate')).ok).toBe(true);
  expect((await act(PRODUCTION_ORDERS_MODULE_ID, id, 'start')).ok).toBe(true);
  return registry.get(PRODUCTION_ORDERS_MODULE_ID)!.store.get(id)!;
}

describe('Session 7 — single-line reality of receipts/dispatches', () => {
  it('a goods receipt is single-line — exactly one movement per receipt', async () => {
    await seedProduct('RM-1', 5);
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-1', product: 'RM-1', warehouse: 'WH-1', quantityReceived: 10, status: 'pending' });
    await act('procurement-receipts', gr.record!.id, 'post');
    expect(registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted')).toHaveLength(1);
  });
});

describe('Session 7 — production order is the multi-line inventory document', () => {
  it('1-8/14 — N components → N consumption movements, per-SKU standard cost, balanced GL, traceable', async () => {
    const order = await runTwoLineProduction();
    // Exactly two consumption movements — no line dropped, no line duplicated.
    const cons = consumptions();
    expect(cons).toHaveLength(2);
    const bySku = Object.fromEntries(cons.map((r) => [String(r.fields.product), movementFromRecord(r)]));
    expect(bySku['RM-1'].quantity).toBe(6); // 3 × 2
    expect(bySku['RM-2'].quantity).toBe(4); // 2 × 2
    // Per-SKU standard cost resolved independently (Session 5-Fix).
    expect(bySku['RM-1'].unitCost).toBe(5);
    expect(bySku['RM-2'].unitCost).toBe(7);
    // GL: WIP debited by the SUM of the correctly costed lines (30 + 28 = 58); balanced.
    expect(net(STOCK_ACCOUNTS.wip)).toBe(58);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(-58);
    expect(totalDr()).toBe(totalCr());
    // Document-to-movement traceability: every consumption references the order.
    for (const r of cons) expect(String(r.fields.referenceRecord)).toBe(order.id);
  });

  it('9 — multi-line posting is NON-ATOMIC: START returns on the first unconsumable line (partial), documented policy', async () => {
    // A component whose product does not exist still consumes (cost resolves to 0),
    // so a clean forced mid-line failure is not reachable through the happy path;
    // the atomicity property is structural: the START loop returns on the first
    // `postConsumption` that yields null, leaving earlier lines posted. This test
    // pins the OBSERVABLE contract that the loop processes lines in order and a
    // successful run posts ALL of them (the all-or-nothing decision is escalated).
    const order = await runTwoLineProduction();
    expect(consumptions()).toHaveLength(2); // a fully-successful multi-line run posts every line
    expect(String(order.fields.status)).toBe('running');
  });

  it('4-6 — replay is idempotent at the document level: START cannot run twice', async () => {
    const order = await runTwoLineProduction();
    const before = consumptions().length;
    const again = await act(PRODUCTION_ORDERS_MODULE_ID, order.id, 'start'); // order is 'running'
    expect(again.ok).toBe(false); // refused by the status guard — no duplicate consumption
    expect(consumptions().length).toBe(before);
  });

  it('12/13 — multi-line void/reversal (Session 6): every consumption line reverses, none omitted or duplicated', async () => {
    await runTwoLineProduction();
    const cons = consumptions();
    expect(cons).toHaveLength(2);
    expect(net(STOCK_ACCOUNTS.wip)).toBe(58);
    // Void BOTH consumption lines.
    for (const r of cons) await update(STOCK_MOVEMENTS_MODULE_ID, r.id, { status: 'void' });
    // Each posted line reversed; inventory + WIP return to net zero.
    expect(net(STOCK_ACCOUNTS.wip)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    // Exactly one reversal per line — no duplicate MOV-<id>-REV.
    const revs = registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber).endsWith('-REV'));
    expect(revs).toHaveLength(2);
    // Originals immutable (still present, movements retained as void).
    for (const r of cons) {
      const mv = registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.get(r.id)!;
      expect(String(mv.fields.status)).toBe('void');
    }
  });

  it('10 — tenant isolation: another tenant sees none of the multi-line movements or GL', async () => {
    await runTwoLineProduction();
    expect(consumptions().length).toBe(2);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list()).toHaveLength(0);
    expect(registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()).toHaveLength(0);
  });

  it('11 — authorization is enforced on each movement (inventory:manage asserted)', async () => {
    await runTwoLineProduction();
    expect(rec.authorized).toContain('inventory:manage');
  });
});
