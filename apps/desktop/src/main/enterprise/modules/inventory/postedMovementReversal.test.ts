/**
 * ERP Session 6 — posted-movement void → GL reversal.
 *
 * A movement's `status` field (posted|void) is the sanctioned void mechanism: the
 * inventory reconciler excludes void movements from every balance. But the GL did
 * NOT follow — a voided posted movement left its `MOV-<id>` entry in the ledger,
 * so inventory reversed while the GL did not (drift). This suite proves the fixed
 * behavior: voiding a posted movement posts an explicit, idempotent `MOV-<id>-REV`
 * reversal that negates the original, under the standard-cost valuation, with the
 * original entry immutable, audit linkage, authorization, and tenant isolation.
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
  PRODUCTS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  productFromRecord,
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
import { createGoodsReceiptModule } from '../procurement/goodsReceiptModule';
import { postStockMovement } from './postMovement';
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
let denyAuth: EnterprisePermission | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let ctx: EnterpriseModuleActionContext;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => {
      if (denyAuth && p === denyAuth) throw new Error(`Not authorized: ${p}`);
      rec.authorized.push(p);
    },
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
  denyAuth = null;
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createGoodsReceiptModule(tmp('gr')),
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
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean }>;
const update = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<unknown>;
const voidMovement = (id: string) => update(STOCK_MOVEMENTS_MODULE_ID, id, { status: 'void' });

function journalEntries(): EnterpriseEntity[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().filter((e) => e.status !== 'deleted');
}
function lines(): { account: string; debit: number; credit: number }[] {
  return journalEntries().flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const net = (account: string): number => lines().filter((l) => l.account === account).reduce((n, l) => n + l.debit - l.credit, 0);
const entryByNumber = (n: string) => journalEntries().find((e) => String(e.fields.entryNumber) === n);
const seedProduct = (sku: string, standardCost: number) => createIn(PRODUCTS_MODULE_ID, { sku, name: sku, standardCost });
const productStock = (id: string) => productFromRecord(registry.get(PRODUCTS_MODULE_ID)!.store.get(id) as EnterpriseEntity).currentStock;

async function postReceive(sku: string, qty: number): Promise<EnterpriseEntity> {
  const m = await postStockMovement(ctx, { movementNumber: `RCV-${sku}-${qty}`, type: 'receive', product: sku, warehouse: 'WH-1', quantity: qty, referenceModule: 'procurement-receipts', referenceRecord: `gr-${sku}`, reason: 'receive' });
  if (!m) throw new Error('receive failed');
  return m;
}

describe('Session 6 — posted-movement void reverses inventory AND the GL', () => {
  it('1/2/3 — voiding a receive reverses inventory and posts a MOV-<id>-REV that nets the GL to zero', async () => {
    const p = await seedProduct('RM-1', 5);
    const m = await postReceive('RM-1', 10);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(50); // Dr Inventory 50
    expect(net(STOCK_ACCOUNTS.grni)).toBe(-50); // Cr GRNI 50
    expect(productStock(p.record!.id)).toBe(10);

    await voidMovement(m.id);
    // Inventory quantity restored, and the GL nets to zero (reversal posted).
    expect(productStock(p.record!.id)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    // The reversal is an explicit entry that swaps the original's debits/credits.
    const revLines = JSON.parse(String(entryByNumber(`MOV-${m.id}-REV`)!.fields.lines)) as { account: string; debit: number; credit: number }[];
    expect(revLines.find((l) => l.account === STOCK_ACCOUNTS.inventory)?.credit).toBe(50);
    expect(revLines.find((l) => l.account === STOCK_ACCOUNTS.grni)?.debit).toBe(50);
  });

  it('4/5/14 — the original entry is immutable, the reversal links to it, and no third entry appears', async () => {
    await seedProduct('RM-1', 5); // standard cost must exist before posting (resolved at post time)
    const m = await postReceive('RM-1', 10);
    const originalBefore = JSON.stringify(entryByNumber(`MOV-${m.id}`)!.fields.lines);
    await voidMovement(m.id);
    // Original MOV entry unchanged.
    expect(JSON.stringify(entryByNumber(`MOV-${m.id}`)!.fields.lines)).toBe(originalBefore);
    // Reversal references the source movement + names the base entry.
    const revEntry = entryByNumber(`MOV-${m.id}-REV`)!;
    expect(String(revEntry.fields.sourceRef)).toBe(m.id);
    expect(String(revEntry.fields.entryNumber)).toBe(`MOV-${m.id}-REV`);
    // Exactly two entries for this movement: the original and its reversal.
    expect(journalEntries().filter((e) => String(e.fields.entryNumber).startsWith(`MOV-${m.id}`))).toHaveLength(2);
    // The physical movement is retained (marked void), never deleted.
    const mv = registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.get(m.id)!;
    expect(mv.status).not.toBe('deleted');
    expect(String(mv.fields.status)).toBe('void');
    expect(Number(mv.fields.quantity)).toBe(10); // economic fields untouched
  });

  it('6/7 — duplicate/replayed void never posts a second reversal', async () => {
    await seedProduct('RM-1', 5);
    const m = await postReceive('RM-1', 10);
    await voidMovement(m.id);
    await voidMovement(m.id); // duplicate void
    await update(STOCK_MOVEMENTS_MODULE_ID, m.id, { reason: 'touch' }); // replayed onChange on a void movement
    expect(journalEntries().filter((e) => String(e.fields.entryNumber) === `MOV-${m.id}-REV`)).toHaveLength(1);
  });

  it('8 — an unauthorized void is rejected and posts no reversal', async () => {
    await seedProduct('RM-1', 5);
    const m = await postReceive('RM-1', 10);
    denyAuth = 'inventory:manage';
    await expect(voidMovement(m.id)).rejects.toThrow(/not authorized/i);
    expect(entryByNumber(`MOV-${m.id}-REV`)).toBeUndefined();
  });

  it('9 — tenant isolation: the reversal lands only in the owning tenant', async () => {
    await seedProduct('RM-1', 5);
    const m = await postReceive('RM-1', 10);
    await voidMovement(m.id);
    expect(entryByNumber(`MOV-${m.id}-REV`)).toBeDefined(); // visible in tenant A
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(journalEntries()).toHaveLength(0); // tenant B sees none of A's entries
  });

  it('10 — goods-receipt reversal (via the receipt post then void of its movement)', async () => {
    await seedProduct('RM-1', 5);
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-1', product: 'RM-1', warehouse: 'WH-1', quantityReceived: 10, status: 'pending' });
    await act('procurement-receipts', gr.record!.id, 'post');
    const mv = registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list()[0];
    await voidMovement(mv.id);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
  });

  it('11 — sales-issue reversal restores COGS and inventory', async () => {
    await seedProduct('FG-1', 12);
    const m = await postStockMovement(ctx, { movementNumber: 'ISS-1', type: 'issue', product: 'FG-1', warehouse: 'WH-1', quantity: 3, referenceModule: 'sales-orders', referenceRecord: 'so-1', reason: 'ship' });
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(36); // Dr COGS 36
    await voidMovement(m!.id);
    expect(net(STOCK_ACCOUNTS.cogs)).toBe(0);
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
  });

  it('12/13 — production consumption reversal (standard-costed) restores WIP', async () => {
    await seedProduct('RM-1', 5);
    const m = await postStockMovement(ctx, { movementNumber: 'CON-1', type: 'production_consumption', product: 'RM-1', warehouse: 'WH-1', quantity: 6, referenceModule: 'manufacturing-orders', referenceRecord: 'ord-1', reason: 'consume' });
    expect(net(STOCK_ACCOUNTS.wip)).toBe(30); // Dr WIP 30 at std 5
    await voidMovement(m!.id);
    expect(net(STOCK_ACCOUNTS.wip)).toBe(0); // reversal Cr WIP 30
    expect(net(STOCK_ACCOUNTS.inventory)).toBe(0);
  });
});
