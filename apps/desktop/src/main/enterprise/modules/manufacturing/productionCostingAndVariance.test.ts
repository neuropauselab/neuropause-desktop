/**
 * ERP Session 5-Fix — standard-cost ledger + production variance settlement.
 *
 * Proves the fixed behavior end to end under the standard-cost model:
 *   • every movement is valued at product.standardCost, resolved centrally in the
 *     postStockMovement seam (goods receipt, production consumption/output, sales
 *     issue) — the GL bridge is no longer starved of cost;
 *   • goods-receipt GRNI has ONE accounting owner (the movement ledger);
 *   • a completed order settles its residual WIP to 5910 (variance-only), never
 *     double-posting finished goods;
 *   • zero-value, idempotency (movement + settlement replay), and tenant
 *     isolation all hold.
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
  STOCK_MOVEMENTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, createLifecycleEmitter } from '../../framework/moduleRegistry';
import type { EnterpriseModuleActionContext } from '../../framework';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createStockMovementModule } from '../inventory/stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { createProductionOrderModule } from './productionOrderModule';
import { postConsumption, postOutput, postReservation } from './manufacturingMovements';
import { postStockMovement } from '../inventory/postMovement';
import { settleProductionVariance, productionVarianceEntryNumber } from './productionVarianceSettlement';
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
let ctx: EnterpriseModuleActionContext;

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
    createProductionOrderModule(tmp('po')),
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

function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store
    .list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
const seedProduct = (sku: string, standardCost: number) => createIn('inventory-products', { sku, name: sku, standardCost });

// ── Part A: standard-cost resolution at the postStockMovement seam ────────────
describe('Session 5-Fix A — every movement is valued at standard cost centrally', () => {
  it('goods receipt values the receive movement at standard cost — Dr Inventory / Cr GRNI, ONE GRNI owner', async () => {
    await seedProduct('RM-1', 5);
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-1', product: 'RM-1', warehouse: 'WH-1', quantityReceived: 10, status: 'pending' });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    expect(bal(STOCK_ACCOUNTS.inventory, 'debit')).toBe(50); // 10 × std 5
    expect(bal(STOCK_ACCOUNTS.grni, 'credit')).toBe(50);
    // GRNI has exactly one accounting owner (the movement ledger): one 2150 credit line.
    expect(journalLines().filter((l) => l.account === STOCK_ACCOUNTS.grni && l.credit > 0)).toHaveLength(1);
  });

  it('production consumption posts WIP at standard (Dr 1350 / Cr 1300), with no caller-supplied cost', async () => {
    await seedProduct('RM-1', 5);
    await postConsumption(ctx, { movementNumber: 'C1', product: 'RM-1', warehouse: 'WH-1', quantity: 6, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-1', reason: 'MO-1' });
    expect(bal(STOCK_ACCOUNTS.wip, 'debit')).toBe(30); // 6 × std 5
    expect(bal(STOCK_ACCOUNTS.inventory, 'credit')).toBe(30);
  });

  it('production output posts finished goods at standard (Dr 1360 / Cr 1350)', async () => {
    await seedProduct('FG-1', 12);
    await postOutput(ctx, { movementNumber: 'O1', product: 'FG-1', warehouse: 'WH-1', quantity: 2, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-1', reason: 'MO-1' });
    expect(bal(STOCK_ACCOUNTS.finishedGoods, 'debit')).toBe(24); // 2 × std 12
    expect(bal(STOCK_ACCOUNTS.wip, 'credit')).toBe(24);
  });

  it('sales issue uses the same standard-cost basis (Dr COGS / Cr Inventory)', async () => {
    await seedProduct('FG-1', 12);
    await postStockMovement(ctx, { movementNumber: 'ISS1', type: 'issue', product: 'FG-1', warehouse: 'WH-1', quantity: 3, referenceModule: 'sales-orders', referenceRecord: 'so-1', reason: 'ship' });
    expect(bal(STOCK_ACCOUNTS.cogs, 'debit')).toBe(36); // 3 × std 12
    expect(bal(STOCK_ACCOUNTS.inventory, 'credit')).toBe(36);
  });

  it('zero-value: a product with no standard cost posts the movement but NO GL entry (honest, never guessed)', async () => {
    await seedProduct('RM-0', 0);
    const m = await postStockMovement(ctx, { movementNumber: 'Z1', type: 'receive', product: 'RM-0', warehouse: 'WH-1', quantity: 10, referenceModule: 'procurement-receipts', referenceRecord: 'gr-0', reason: 'zero' });
    expect(m, 'the physical movement still records').not.toBeNull();
    expect(journalLines()).toHaveLength(0); // nothing posted at zero value
  });

  it('idempotency — re-firing a movement (update) never double-posts its GL entry', async () => {
    await seedProduct('RM-1', 5);
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-2', product: 'RM-1', warehouse: 'WH-1', quantityReceived: 10, status: 'pending' });
    await act('procurement-receipts', gr.record!.id, 'post');
    const mv = registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list()[0];
    await update(STOCK_MOVEMENTS_MODULE_ID, mv.id, { reason: 'touch' }); // re-fires onChange
    expect(bal(STOCK_ACCOUNTS.inventory, 'debit')).toBe(50); // still 50, not 100
  });
});

// ── Part B: production variance settlement (variance-only, 5910) ──────────────
async function runProduction(orderId: string, opts: { consume: number; consumeStd: number; output: number; outputStd: number }) {
  await seedProduct('RM-1', opts.consumeStd);
  await seedProduct('FG-1', opts.outputStd);
  await postConsumption(ctx, { movementNumber: `C-${orderId}`, product: 'RM-1', warehouse: 'WH-1', quantity: opts.consume, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: orderId, reason: 'consume' });
  await postOutput(ctx, { movementNumber: `O-${orderId}`, product: 'FG-1', warehouse: 'WH-1', quantity: opts.output, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: orderId, reason: 'output' });
}
const orderRecord = (id: string): EnterpriseEntity =>
  ({ id, moduleId: PRODUCTION_ORDERS_MODULE_ID, kind: 'k', title: id, status: 'active', fields: { orderNumber: `MO-${id}`, status: 'completed' }, tags: [], rev: 1, createdAt: T0, updatedAt: T0, createdBy: null, updatedBy: null, metadata: {} });

describe('Session 5-Fix B — per-order variance settlement to 5910 (variance-only)', () => {
  it('unfavourable: WIP 30 − standard output 24 → Dr 5910 6 / Cr WIP 6, and WIP nets to zero', async () => {
    await runProduction('u1', { consume: 6, consumeStd: 5, output: 2, outputStd: 12 }); // WIP 30, FG/WIP 24
    const out = await settleProductionVariance(orderRecord('u1'), ctx);
    expect(out.posted).toBe(true);
    expect(out.variance).toBe(6);
    expect(bal(STOCK_ACCOUNTS.productionVariance, 'debit')).toBe(6);
    // WIP: Dr 30 (consumption) − Cr 24 (output) − Cr 6 (settlement) = 0.
    expect(bal(STOCK_ACCOUNTS.wip, 'debit') - bal(STOCK_ACCOUNTS.wip, 'credit')).toBe(0);
    // Variance-only: finished goods posted ONCE (by the output movement), not re-posted.
    expect(journalLines().filter((l) => l.account === STOCK_ACCOUNTS.finishedGoods && l.debit > 0)).toHaveLength(1);
  });

  it('favourable: WIP 20 − standard output 24 → Dr WIP 4 / Cr 5910 4', async () => {
    await runProduction('f1', { consume: 4, consumeStd: 5, output: 2, outputStd: 12 }); // WIP 20, FG/WIP 24
    const out = await settleProductionVariance(orderRecord('f1'), ctx);
    expect(out.variance).toBe(-4);
    expect(bal(STOCK_ACCOUNTS.productionVariance, 'credit')).toBe(4);
    expect(bal(STOCK_ACCOUNTS.wip, 'debit') - bal(STOCK_ACCOUNTS.wip, 'credit')).toBe(0);
  });

  it('zero variance: WIP == standard output → no settlement entry', async () => {
    await runProduction('z1', { consume: 4, consumeStd: 6, output: 2, outputStd: 12 }); // WIP 24, output 24
    const out = await settleProductionVariance(orderRecord('z1'), ctx);
    expect(out.posted).toBe(false);
    expect(out.variance).toBe(0);
    expect(journalLines().filter((l) => l.account === STOCK_ACCOUNTS.productionVariance)).toHaveLength(0);
  });

  it('idempotent — replaying the settlement never posts a second variance', async () => {
    await runProduction('i1', { consume: 6, consumeStd: 5, output: 2, outputStd: 12 });
    await settleProductionVariance(orderRecord('i1'), ctx);
    await settleProductionVariance(orderRecord('i1'), ctx); // replay
    const varEntries = registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber) === productionVarianceEntryNumber('i1'));
    expect(varEntries).toHaveLength(1);
  });

  it('tenant isolation — settling under another tenant sees no movements, posts nothing', async () => {
    await runProduction('t1', { consume: 6, consumeStd: 5, output: 2, outputStd: 12 });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const out = await settleProductionVariance(orderRecord('t1'), ctx);
    expect(out.posted).toBe(false);
    expect(out.wipAccumulated).toBe(0);
  });
});

// ── Part C: end-to-end through the real order onChange hook ───────────────────
describe('Session 5-Fix C — completing an order settles variance via onChange', () => {
  it('marking an order completed posts the 5910 variance once; re-updating does not duplicate it', async () => {
    await seedProduct('RM-1', 5);
    await seedProduct('FG-1', 12);
    const order = await createIn(PRODUCTION_ORDERS_MODULE_ID, { orderNumber: 'MO-E1', bom: 'BOM-E1', product: 'FG-1', warehouse: 'WH-1', productionQuantity: 2, status: 'running' });
    const orderId = order.record!.id;
    await postConsumption(ctx, { movementNumber: 'C-E1', product: 'RM-1', warehouse: 'WH-1', quantity: 6, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: orderId, reason: 'consume' });
    await postOutput(ctx, { movementNumber: 'O-E1', product: 'FG-1', warehouse: 'WH-1', quantity: 2, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: orderId, reason: 'output' });

    // Completing the order fires onChange → settlement.
    await update(PRODUCTION_ORDERS_MODULE_ID, orderId, { status: 'completed' });
    expect(bal(STOCK_ACCOUNTS.productionVariance, 'debit')).toBe(6);
    const varCount = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => String(e.fields.entryNumber) === productionVarianceEntryNumber(orderId)).length;
    expect(varCount()).toBe(1);

    // A later benign update must not settle a second time.
    await update(PRODUCTION_ORDERS_MODULE_ID, orderId, { status: 'completed' });
    expect(varCount()).toBe(1);
  });
});

// keep the reservation import used (manufacturing reserves reuse the seam) — a
// reservation is net-zero and posts no GL, a useful control that costing did not
// accidentally give internal moves a GL effect.
describe('Session 5-Fix — internal moves stay GL-neutral even when costed', () => {
  it('a reservation posts no GL despite standard-cost resolution', async () => {
    await seedProduct('RM-1', 5);
    await postReservation(ctx, { movementNumber: 'RES1', product: 'RM-1', warehouse: 'WH-1', quantity: 4, referenceModule: PRODUCTION_ORDERS_MODULE_ID, referenceRecord: 'ord-r', reason: 'reserve' });
    expect(journalLines()).toHaveLength(0);
  });
});
