/**
 * ERP seam #1 — inventory ledger → General Ledger bridge.
 *
 * Proves the transaction-graph tail end to end at the code layer: a REAL stock
 * movement, created through the framework's real create handler, fires the real
 * onChange reconciler, which posts a balanced entry through the REAL double-entry
 * journal — and the posted entry + account balances read back. Also pins the
 * disciplines the bridge must keep: idempotency, no-op when the GL is not wired,
 * no GL effect for internal moves, and tenant isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// The journal post path may touch electron safeStorage in some builds; a minimal
// mock keeps this an offline unit/integration test (unused where not needed).
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

import { IpcChannel, STOCK_MOVEMENTS_MODULE_ID, type EnterpriseEntity, type EnterprisePermission, type PlatformEventInput, type StockMovement } from '@neuropause/shared';
import { EnterpriseModuleRegistry } from '../../framework/moduleRegistry';
import { buildModuleHandlers } from '../../framework/moduleRegistry';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from './productModule';
import { createStockMovementModule } from './stockMovementModule';
import { createJournalEntryModule } from '../finance/journalEntryModule';
import { createLedgerAccountModule } from '../finance/ledgerAccountModule';
import { STOCK_ACCOUNTS } from '../../../erp/postingRules';
import { deriveMovementGlPostings } from './inventoryGlBridge';

const T0 = '2026-08-31T12:00:00.000Z';
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

const mv = (over: Partial<StockMovement> = {}): StockMovement =>
  ({ id: 'm1', movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5, status: 'posted', ...over } as StockMovement);

const lineFor = (entries: ReturnType<typeof deriveMovementGlPostings>, account: string) =>
  entries[0]?.lines.find((l) => l.account === account);

// ── PURE derivation ────────────────────────────────────────────────────────
describe('deriveMovementGlPostings — one balanced entry per valued movement type', () => {
  it('receive → Dr Inventory / Cr GRNI at qty × unit cost, keyed on the movement', () => {
    const e = deriveMovementGlPostings(mv({ type: 'receive', quantity: 10, unitCost: 5 }), 'REC1');
    expect(e).toHaveLength(1);
    expect(e[0].entryNumber).toBe('MOV-REC1');
    expect(lineFor(e, STOCK_ACCOUNTS.inventory)?.debit).toBe(50);
    expect(lineFor(e, STOCK_ACCOUNTS.grni)?.credit).toBe(50);
  });
  it('issue → Dr COGS / Cr Inventory', () => {
    const e = deriveMovementGlPostings(mv({ type: 'issue', quantity: 4, unitCost: 5 }), 'ISS1');
    expect(lineFor(e, STOCK_ACCOUNTS.cogs)?.debit).toBe(20);
    expect(lineFor(e, STOCK_ACCOUNTS.inventory)?.credit).toBe(20);
  });
  it('production_consumption → Dr WIP / Cr Inventory', () => {
    const e = deriveMovementGlPostings(mv({ type: 'production_consumption', quantity: 3, unitCost: 7 }), 'PC1');
    expect(lineFor(e, STOCK_ACCOUNTS.wip)?.debit).toBe(21);
    expect(lineFor(e, STOCK_ACCOUNTS.inventory)?.credit).toBe(21);
  });
  it('production_output → Dr Finished Goods / Cr WIP', () => {
    const e = deriveMovementGlPostings(mv({ type: 'production_output', quantity: 2, unitCost: 30 }), 'PO1');
    expect(lineFor(e, STOCK_ACCOUNTS.finishedGoods)?.debit).toBe(60);
    expect(lineFor(e, STOCK_ACCOUNTS.wip)?.credit).toBe(60);
  });
  it('return → Dr Inventory / Cr COGS (reverses cost of sale)', () => {
    const e = deriveMovementGlPostings(mv({ type: 'return', quantity: 1, unitCost: 5 }), 'RET1');
    expect(lineFor(e, STOCK_ACCOUNTS.inventory)?.debit).toBe(5);
    expect(lineFor(e, STOCK_ACCOUNTS.cogs)?.credit).toBe(5);
  });
  it('adjustment sign follows the movement quantity (write-up vs write-down)', () => {
    const up = deriveMovementGlPostings(mv({ type: 'adjustment', quantity: 2, unitCost: 5 }), 'ADJ+');
    expect(lineFor(up, STOCK_ACCOUNTS.inventory)?.debit).toBe(10);
    const down = deriveMovementGlPostings(mv({ type: 'adjustment', quantity: -2, unitCost: 5 }), 'ADJ-');
    expect(lineFor(down, STOCK_ACCOUNTS.inventory)?.credit).toBe(10);
    expect(lineFor(down, STOCK_ACCOUNTS.inventoryAdjustment)?.debit).toBe(10);
  });
  it('every derived entry balances (debits === credits)', () => {
    for (const type of ['receive', 'issue', 'production_consumption', 'production_output', 'return', 'adjustment'] as const) {
      const e = deriveMovementGlPostings(mv({ type, quantity: 3, unitCost: 4 }), `B-${type}`);
      const d = e[0].lines.reduce((n, l) => n + l.debit, 0);
      const c = e[0].lines.reduce((n, l) => n + l.credit, 0);
      expect(d, type).toBe(c);
      expect(d, type).toBeGreaterThan(0);
    }
  });
  it('internal moves have NO GL effect (transfer / reservation / reservation_release)', () => {
    for (const type of ['transfer', 'reservation', 'reservation_release'] as const) {
      expect(deriveMovementGlPostings(mv({ type }), 'X'), type).toEqual([]);
    }
  });
  it('an issue with no resolvable unit cost produces NO entry (never a partial cost of sale)', () => {
    expect(deriveMovementGlPostings(mv({ type: 'issue', quantity: 5, unitCost: 0 }), 'ISS0')).toEqual([]);
  });
  it('a zero-quantity movement produces NO entry', () => {
    expect(deriveMovementGlPostings(mv({ type: 'receive', quantity: 0, unitCost: 5 }), 'Z')).toEqual([]);
  });
});

// ── INTEGRATION: movement create → onChange → real GL post → readback ─────────
interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}

function buildRegistry(opts: { withGl: boolean }) {
  const products = createProductModule(tmp('prod'));
  const movements = createStockMovementModule(tmp('mov'));
  const registry = new EnterpriseModuleRegistry();
  registry.register(products);
  registry.register(movements);
  let journal: ReturnType<typeof createJournalEntryModule> | null = null;
  if (opts.withGl) {
    const accounts = createLedgerAccountModule(tmp('acct'));
    journal = createJournalEntryModule(tmp('jrnl'), accounts.store);
    registry.register(accounts);
    registry.register(journal);
  }
  registry.bindScope(() => scope);
  const handlers = buildModuleHandlers(registry, spyCtx());
  return { registry, handlers, products, movements, journal };
}

function handlerFor(handlers: SecureHandlerDef[], channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => unknown;
}

async function createMovement(handlers: SecureHandlerDef[], fields: Record<string, unknown>): Promise<EnterpriseEntity> {
  const res = (await handlerFor(handlers, IpcChannel.EnterpriseModuleCreate)({ moduleId: STOCK_MOVEMENTS_MODULE_ID, fields })) as {
    ok: boolean; record?: EnterpriseEntity; errors?: Record<string, string>;
  };
  if (!res.ok || !res.record) throw new Error(`movement create failed: ${JSON.stringify(res.errors)}`);
  return res.record;
}

/** Read the posted journal entry the bridge produced for a movement. */
function postedEntryFor(journal: ReturnType<typeof createJournalEntryModule>, movementId: string) {
  const r = journal.store.list().find((e) => String(e.fields.entryNumber) === `MOV-${movementId}`);
  if (!r) return null;
  const lines = JSON.parse(String(r.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[];
  return { status: String(r.fields.status), lines, sourceRef: String(r.fields.sourceRef ?? '') };
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
});
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

describe('inventory → GL bridge (real movement → real journal)', () => {
  it('a receive movement posts a balanced Dr Inventory / Cr GRNI entry into the GL', async () => {
    const { handlers, journal } = buildRegistry({ withGl: true });
    const m = await createMovement(handlers, { movementNumber: 'MV-100', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5 });

    const entry = postedEntryFor(journal!, m.id);
    expect(entry, 'a journal entry MOV-<id> must exist').not.toBeNull();
    expect(entry!.status).toBe('posted'); // it went through the real governed post
    expect(entry!.sourceRef).toBe(m.id);
    expect(entry!.lines.find((l) => l.account === STOCK_ACCOUNTS.inventory)?.debit).toBe(50);
    expect(entry!.lines.find((l) => l.account === STOCK_ACCOUNTS.grni)?.credit).toBe(50);

    // Balance readback: sum posted lines per account across the ledger.
    const posted = journal!.store.list().filter((e) => String(e.fields.status) === 'posted');
    const balance = (acct: string, side: 'debit' | 'credit'): number =>
      posted.reduce((n, e) => n + (JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[])
        .filter((l) => l.account === acct).reduce((s, l) => s + l[side], 0), 0);
    expect(balance(STOCK_ACCOUNTS.inventory, 'debit')).toBe(50);
    expect(balance(STOCK_ACCOUNTS.grni, 'credit')).toBe(50);
  });

  it('a sales issue posts Dr COGS / Cr Inventory', async () => {
    const { handlers, journal } = buildRegistry({ withGl: true });
    const m = await createMovement(handlers, { movementNumber: 'MV-200', type: 'issue', product: 'SKU-1', warehouse: 'WH-1', quantity: 4, unitCost: 5 });
    const entry = postedEntryFor(journal!, m.id);
    expect(entry?.status).toBe('posted');
    expect(entry!.lines.find((l) => l.account === STOCK_ACCOUNTS.cogs)?.debit).toBe(20);
    expect(entry!.lines.find((l) => l.account === STOCK_ACCOUNTS.inventory)?.credit).toBe(20);
  });

  it('is idempotent — re-firing onChange (an update) never double-posts', async () => {
    const { handlers, journal } = buildRegistry({ withGl: true });
    const m = await createMovement(handlers, { movementNumber: 'MV-300', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5 });
    // Re-fire the reconciler by updating the movement (a benign metadata edit).
    await handlerFor(handlers, IpcChannel.EnterpriseModuleUpdate)({ moduleId: STOCK_MOVEMENTS_MODULE_ID, id: m.id, fields: { warehouse: 'WH-1' } });
    const count = journal!.store.list().filter((e) => String(e.fields.entryNumber) === `MOV-${m.id}`).length;
    expect(count).toBe(1);
  });

  it('a transfer produces NO journal entry (internal move, no GL effect)', async () => {
    const { handlers, journal } = buildRegistry({ withGl: true });
    const m = await createMovement(handlers, { movementNumber: 'MV-400', type: 'transfer', product: 'SKU-1', warehouse: 'WH-2', fromWarehouse: 'WH-1', quantity: 3, unitCost: 5 });
    expect(postedEntryFor(journal!, m.id)).toBeNull();
    expect(journal!.store.list().filter((e) => String(e.fields.status) === 'posted')).toHaveLength(0);
  });

  it('when the GL module is NOT wired, the movement still records — no throw, no GL', async () => {
    const { handlers, movements } = buildRegistry({ withGl: false });
    const m = await createMovement(handlers, { movementNumber: 'MV-500', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5 });
    // The physical movement stands (the bridge no-ops without a journal module).
    expect(movements.store.get(m.id)?.fields.type).toBe('receive');
  });

  it('tenant isolation — a movement in tenant A posts only into tenant A’s ledger', async () => {
    const { handlers, journal } = buildRegistry({ withGl: true });
    const m = await createMovement(handlers, { movementNumber: 'MV-600', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 10, unitCost: 5 });
    expect(postedEntryFor(journal!, m.id)).not.toBeNull(); // visible under tenant A

    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' }; // switch the resolved scope
    expect(journal!.store.list()).toHaveLength(0); // tenant B sees none of A’s entries
    expect(postedEntryFor(journal!, m.id)).toBeNull();
  });
});
