/**
 * ERP Session 7-Fix — multi-line documents + compensating atomicity + QA scrap.
 *
 * Covers the 30-point matrix: multi-line Purchase Receipts and Sales Dispatches
 * (header → N lines → N standard-costed movements → GL), compensating all-or-
 * nothing on failure (Session 6 reversal), production-order multi-line hardening,
 * final-stage QA fail → scrap, and the security/integrity invariants.
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
  QUALITY_INSPECTIONS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  serializeBomComponents,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createBomModule } from '../manufacturing/bomModule';
import { createProductionOrderModule } from '../manufacturing/productionOrderModule';
import { createQualityModule, POST_DISPOSITION_ACTION } from '../manufacturing/qualityModule';
import { createMultiLineReceiptModule, MULTILINE_RECEIPTS_MODULE_ID, RECEIVE_LINES_ACTION } from '../procurement/multiLineReceiptModule';
import { createMultiLineDispatchModule, MULTILINE_DISPATCHES_MODULE_ID, DISPATCH_LINES_ACTION } from '../sales/multiLineDispatchModule';
import { postMovementLinesAtomic } from './multiLineMovements';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

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
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => T0,
  };
}

beforeEach(() => {
  rec = { authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  denyAuth = null;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createMultiLineReceiptModule(tmp('rcpt')),
    createMultiLineDispatchModule(tmp('disp')),
    createBomModule(tmp('bom')),
    createProductionOrderModule(tmp('po')),
    createQualityModule(tmp('qa')),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, spyCtx());
  ctx = createLifecycleEmitter(registry, spyCtx()).actionCtx;
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

const allLines = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
const net = (account: string) => allLines().filter((l) => l.account === account).reduce((n, l) => n + l.debit - l.credit, 0);
const totalDr = () => allLines().reduce((n, l) => n + l.debit, 0);
const totalCr = () => allLines().reduce((n, l) => n + l.credit, 0);
const postedMovements = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'posted');
const voidMovements = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted' && String(r.fields.status) === 'void');
const seed = (sku: string, cost: number) => createIn('inventory-products', { sku, name: sku, standardCost: cost });
const J = (lines: { sku: string; quantity: number }[]) => JSON.stringify(lines);

// ── PURCHASE RECEIPT (1-8) ────────────────────────────────────────────────────
describe('Session 7-Fix — multi-line Purchase Receipt', () => {
  async function receipt(lines: { sku: string; quantity: number }[], number = 'GRN-1') {
    const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: number, warehouse: 'WH-1', lines: J(lines), status: 'draft' });
    return r.record!.id;
  }

  it('1/2/3 — single-line, two-line, and different-SKU-cost receipts post one valued movement per line', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    const single = await receipt([{ sku: 'RM-1', quantity: 10 }], 'GRN-S');
    expect((await act(MULTILINE_RECEIPTS_MODULE_ID, single, RECEIVE_LINES_ACTION)).ok).toBe(true);
    expect(postedMovements()).toHaveLength(1);

    const id = await receipt([{ sku: 'RM-1', quantity: 10 }, { sku: 'RM-2', quantity: 4 }], 'GRN-2');
    expect((await act(MULTILINE_RECEIPTS_MODULE_ID, id, RECEIVE_LINES_ACTION)).ok).toBe(true);
    expect(postedMovements()).toHaveLength(3); // 1 (single) + 2 (two-line)
    // single receipt 50 (10×5) + two-line receipt 78 (10×5 + 4×7) = 128; each SKU costed independently.
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(128);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(-128);
    expect(totalDr()).toBe(totalCr());
  });

  it('4/5 — replay is guarded: a received receipt cannot re-post (no duplicate movement/GL)', async () => {
    await seed('RM-1', 5);
    const id = await receipt([{ sku: 'RM-1', quantity: 10 }]);
    await act(MULTILINE_RECEIPTS_MODULE_ID, id, RECEIVE_LINES_ACTION);
    const again = await act(MULTILINE_RECEIPTS_MODULE_ID, id, RECEIVE_LINES_ACTION);
    expect(again.ok).toBe(false);
    expect(postedMovements()).toHaveLength(1);
  });

  it('6/7 — mid-document failure compensates every posted line (all-or-nothing; no net effect)', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    // Line 3 has a blank SKU → fails; lines 1 & 2 must be compensated.
    const id = await receipt([{ sku: 'RM-1', quantity: 10 }, { sku: 'RM-2', quantity: 4 }, { sku: '', quantity: 1 }], 'GRN-F');
    const res = await act(MULTILINE_RECEIPTS_MODULE_ID, id, RECEIVE_LINES_ACTION);
    expect(res.ok).toBe(false);
    // Two movements posted then voided (compensated); GL nets to zero.
    expect(voidMovements()).toHaveLength(2);
    expect(postedMovements()).toHaveLength(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    const rr = registry.get(MULTILINE_RECEIPTS_MODULE_ID)!.store.get(id)!;
    expect(String(rr.fields.status)).toBe('failed');
  });

  it('8 — a received line reverses on void (Session 6 interaction)', async () => {
    await seed('RM-1', 5);
    const id = await receipt([{ sku: 'RM-1', quantity: 10 }]);
    await act(MULTILINE_RECEIPTS_MODULE_ID, id, RECEIVE_LINES_ACTION);
    const mv = postedMovements()[0];
    await update(STOCK_MOVEMENTS_MODULE_ID, mv.id, { status: 'void' });
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
  });
});

// ── SALES DISPATCH (9-15) ─────────────────────────────────────────────────────
describe('Session 7-Fix — multi-line Sales Dispatch', () => {
  async function dispatch(lines: { sku: string; quantity: number }[], number = 'DSP-1') {
    const r = await createIn(MULTILINE_DISPATCHES_MODULE_ID, { dispatchNumber: number, warehouse: 'WH-1', lines: J(lines), status: 'draft' });
    return r.record!.id;
  }

  it('9/10/11 — single/two-line/different-cost dispatch issues at STANDARD cost → Dr COGS / Cr Inventory', async () => {
    await seed('FG-1', 12); await seed('FG-2', 8);
    const id = await dispatch([{ sku: 'FG-1', quantity: 3 }, { sku: 'FG-2', quantity: 2 }]);
    expect((await act(MULTILINE_DISPATCHES_MODULE_ID, id, DISPATCH_LINES_ACTION)).ok).toBe(true);
    expect(postedMovements()).toHaveLength(2);
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(3 * 12 + 2 * 8); // 52 — standard cost, never sales price
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(-(3 * 12 + 2 * 8));
    expect(totalDr()).toBe(totalCr());
  });

  it('12 — replay guarded', async () => {
    await seed('FG-1', 12);
    const id = await dispatch([{ sku: 'FG-1', quantity: 3 }]);
    await act(MULTILINE_DISPATCHES_MODULE_ID, id, DISPATCH_LINES_ACTION);
    expect((await act(MULTILINE_DISPATCHES_MODULE_ID, id, DISPATCH_LINES_ACTION)).ok).toBe(false);
    expect(postedMovements()).toHaveLength(1);
  });

  it('13/14 — mid-document failure compensates (no net effect)', async () => {
    await seed('FG-1', 12);
    const id = await dispatch([{ sku: 'FG-1', quantity: 3 }, { sku: '', quantity: 1 }], 'DSP-F');
    expect((await act(MULTILINE_DISPATCHES_MODULE_ID, id, DISPATCH_LINES_ACTION)).ok).toBe(false);
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
  });

  it('15 — a dispatched line reverses on void', async () => {
    await seed('FG-1', 12);
    const id = await dispatch([{ sku: 'FG-1', quantity: 3 }]);
    await act(MULTILINE_DISPATCHES_MODULE_ID, id, DISPATCH_LINES_ACTION);
    await update(STOCK_MOVEMENTS_MODULE_ID, postedMovements()[0].id, { status: 'void' });
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
  });
});

// ── PRODUCTION (16-21) ────────────────────────────────────────────────────────
describe('Session 7-Fix — production multi-line consumption + compensation', () => {
  async function startTwoLineOrder() {
    await seed('FG-1', 100); await seed('RM-1', 5); await seed('RM-2', 7);
    await createIn(BOM_MODULE_ID, { bomNumber: 'BOM-2L', product: 'FG-1', revision: 'A', status: 'active', components: serializeBomComponents([{ sku: 'RM-1', quantity: 3, waste: 0, alternative: '' }, { sku: 'RM-2', quantity: 2, waste: 0, alternative: '' }]) });
    const o = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-2L', bom: 'BOM-2L', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 2, status: 'draft' });
    const id = o.record!.id;
    await act(PRODUCTION_ORDERS_MODULE_ID, id, 'plan');
    await act(PRODUCTION_ORDERS_MODULE_ID, id, 'allocate');
    return id;
  }

  it('16/21 — START consumes N lines atomically; existing variance/costing behavior preserved', async () => {
    const id = await startTwoLineOrder();
    expect((await act(PRODUCTION_ORDERS_MODULE_ID, id, 'start')).ok).toBe(true);
    const cons = postedMovements().filter((r) => String(r.fields.type) === 'production_consumption');
    expect(cons).toHaveLength(2);
    expect(net(STOCK_ACCOUNTS.wip)).toBe(6 * 5 + 4 * 7); // 30 + 28 = 58, standard cost per SKU
  });

  it('17/18/19/20 — production consumption compensates a failure at first / middle / final line', async () => {
    await seed('RM-1', 5);
    for (const [name, lines] of [
      ['first', [{ sku: '', quantity: 3, warehouse: 'WH-1' }, { sku: 'RM-1', quantity: 2, warehouse: 'WH-1' }]],
      ['middle', [{ sku: 'RM-1', quantity: 3, warehouse: 'WH-1' }, { sku: '', quantity: 2, warehouse: 'WH-1' }, { sku: 'RM-1', quantity: 1, warehouse: 'WH-1' }]],
      ['final', [{ sku: 'RM-1', quantity: 3, warehouse: 'WH-1' }, { sku: '', quantity: 1, warehouse: 'WH-1' }]],
    ] as const) {
      const before = net(STOCK_ACCOUNTS.wip);
      const res = await postMovementLinesAtomic(ctx, { module: PRODUCTION_ORDERS_MODULE_ID, recordId: `ord-${name}`, number: `MO-${name}`, type: 'production_consumption' }, lines);
      expect(res.ok, name).toBe(false);
      expect(res.compensated || res.failedIndex === 0, name).toBe(true);
      // Net WIP unchanged after compensation (every prior line reversed).
      expect(net(STOCK_ACCOUNTS.wip), name).toBe(before);
    }
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
  });
});

// ── QA (22-25) ────────────────────────────────────────────────────────────────
describe('Session 7-Fix — final-stage QA fail → scrap (#99 Option 1a)', () => {
  async function order() {
    await seed('FG-1', 20);
    await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-QA', bom: 'BOM-QA', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 10, status: 'running' });
  }
  const inspect = (fields: Record<string, unknown>) => createIn(QUALITY_INSPECTIONS_MODULE_ID, { inspectionNumber: 'QC-1', productionOrder: 'MO-QA', inspectedQuantity: 10, passedQuantity: 7, failedQuantity: 3, status: 'inspected', ...fields });

  it('22 — final-stage PASS posts no scrap', async () => {
    await order();
    const i = await inspect({ stage: 'final', result: 'pass', failedQuantity: 0 });
    const res = await act(QUALITY_INSPECTIONS_MODULE_ID, i.record!.id, POST_DISPOSITION_ACTION);
    expect(res.ok).toBe(true);
    expect(postedMovements()).toHaveLength(0);
  });

  it('23 — final-stage FAIL scraps the failed quantity: Dr 5010 / Cr 1300 at standard cost', async () => {
    await order();
    const i = await inspect({ stage: 'final', result: 'fail' });
    expect((await act(QUALITY_INSPECTIONS_MODULE_ID, i.record!.id, POST_DISPOSITION_ACTION)).ok).toBe(true);
    // 3 failed × standard cost 20 = 60 written down.
    expect(net(STOCK_ACCOUNTS.inventoryAdjustment)).toBe(60); // Dr 5010
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(-60); // Cr 1300
    const mv = postedMovements()[0];
    expect(String(mv.fields.type)).toBe('adjustment');
    expect(Number(mv.fields.quantity)).toBe(-3);
    expect(String(mv.fields.referenceRecord)).toBe(i.record!.id); // traceable to the inspection
  });

  it('24 — scrap is idempotent: a second disposition does not double-scrap', async () => {
    await order();
    const i = await inspect({ stage: 'final', result: 'fail' });
    await act(QUALITY_INSPECTIONS_MODULE_ID, i.record!.id, POST_DISPOSITION_ACTION);
    const again = await act(QUALITY_INSPECTIONS_MODULE_ID, i.record!.id, POST_DISPOSITION_ACTION);
    expect(again.ok).toBe(false);
    expect(postedMovements()).toHaveLength(1);
  });

  it('25 — intermediate-stage FAIL does not scrap (unchanged behavior)', async () => {
    await order();
    const i = await inspect({ stage: 'in_process', result: 'fail' });
    const res = await act(QUALITY_INSPECTIONS_MODULE_ID, i.record!.id, POST_DISPOSITION_ACTION);
    expect(res.ok).toBe(true);
    expect(postedMovements()).toHaveLength(0);
  });
});

// ── SECURITY / INTEGRITY (26-30) ──────────────────────────────────────────────
describe('Session 7-Fix — security + integrity invariants', () => {
  it('26 — tenant isolation across a multi-line receipt', async () => {
    await seed('RM-1', 5);
    const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: 'GRN-T', warehouse: 'WH-1', lines: J([{ sku: 'RM-1', quantity: 10 }]), status: 'draft' });
    await act(MULTILINE_RECEIPTS_MODULE_ID, r.record!.id, RECEIVE_LINES_ACTION);
    expect(postedMovements().length).toBe(1);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list()).toHaveLength(0);
    expect(registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()).toHaveLength(0);
  });

  it('27 — authorization is enforced on the movement writes', async () => {
    await seed('RM-1', 5);
    const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: 'GRN-A', warehouse: 'WH-1', lines: J([{ sku: 'RM-1', quantity: 10 }]), status: 'draft' });
    await act(MULTILINE_RECEIPTS_MODULE_ID, r.record!.id, RECEIVE_LINES_ACTION);
    expect(rec.authorized).toContain('inventory:manage');
  });

  it('28/29 — GL and inventory balance across a full multi-line receipt', async () => {
    await seed('RM-1', 5); await seed('RM-2', 7);
    const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: 'GRN-B', warehouse: 'WH-1', lines: J([{ sku: 'RM-1', quantity: 10 }, { sku: 'RM-2', quantity: 4 }]), status: 'draft' });
    await act(MULTILINE_RECEIPTS_MODULE_ID, r.record!.id, RECEIVE_LINES_ACTION);
    expect(totalDr()).toBe(totalCr());
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(78);
  });

  it('30 — duplicate prevention: replay + duplicate void produce no duplicate GL', async () => {
    await seed('RM-1', 5);
    const r = await createIn(MULTILINE_RECEIPTS_MODULE_ID, { receiptNumber: 'GRN-D', warehouse: 'WH-1', lines: J([{ sku: 'RM-1', quantity: 10 }]), status: 'draft' });
    await act(MULTILINE_RECEIPTS_MODULE_ID, r.record!.id, RECEIVE_LINES_ACTION);
    await act(MULTILINE_RECEIPTS_MODULE_ID, r.record!.id, RECEIVE_LINES_ACTION); // replay (guarded)
    const mv = postedMovements()[0];
    await update(STOCK_MOVEMENTS_MODULE_ID, mv.id, { status: 'void' });
    await update(STOCK_MOVEMENTS_MODULE_ID, mv.id, { status: 'void' }); // duplicate void
    const revs = registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber).endsWith('-REV'));
    expect(revs).toHaveLength(1); // exactly one reversal, no duplicate
  });
});
