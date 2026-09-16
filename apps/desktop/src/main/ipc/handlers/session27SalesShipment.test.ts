/**
 * ERP Session 27 — Order-to-Cash: ShipSalesOrder through the LIVE platform:command.dispatch path.
 * Reuses the existing sales-order `ship` action: `orderActionPatch` guards the status transition
 * (cancelled/already-shipped/closed → refused) and `shipOrderStock` issues on-hand + releases any
 * reservation via the shared movement seam. No new shipment/inventory store, no invented shipping/
 * partial-shipment policy (partial shipment is undefined → out of scope).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), getName: () => 'neuropause', isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') },
}));

import {
  IpcChannel,
  ORDERS_MODULE_ID,
  STOCK_MOVEMENTS_MODULE_ID,
  deriveStockLedger,
  movementFromRecord,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import { resolveTenantScope } from '../../tenancy/backgroundPrincipal';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createOrderModule } from '../../enterprise/modules/sales/orderModule';
import { DurableCommandJournal } from '../../platform/command/durableCommandJournal';
import { runSecureHandler } from '../secureBridge';
import type { Principal } from '../../platform/application/requestContext';
import { buildPlatformCommandDispatchDef } from './platformCommandIpc';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s27-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};
const PERMS: EnterprisePermission[] = ['sales:read', 'sales:manage', 'inventory:read', 'inventory:manage'];

let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: ReturnType<typeof buildModuleHandlers>;
let journal: DurableCommandJournal;
let audit: { action: string; target: string; summary: string }[];
let currentPrincipal: Principal | null;
let def: ReturnType<typeof buildPlatformCommandDispatchDef>;

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined, audit: (e) => audit.push(e), publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined, notify: () => undefined, actor: () => 'op@np.dev', now: () => '2026-09-01T12:00:00.000Z',
  };
}
const fullPrincipal = (over: Partial<Principal> = {}): Principal =>
  ({ actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: PERMS, ...over });

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = []; currentPrincipal = fullPrincipal();
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createOrderModule(tmp('so')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope));
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
  def = buildPlatformCommandDispatchDef({ registry, journal, audit: (e) => audit.push(e), resolvePrincipal: () => currentPrincipal });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const H = (c: string) => handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>;
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  H(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const actIn = (moduleId: string, id: string, action: string) =>
  H(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const so = (id: string) => registry.get(ORDERS_MODULE_ID)!.store.get(id)!;
const issueMovements = () => registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().filter((m) => String(m.fields.type) === 'issue' && m.status !== 'deleted');
function onHand(sku: string, warehouse = 'WH-1'): number {
  const cell = deriveStockLedger(registry.get(STOCK_MOVEMENTS_MODULE_ID)!.store.list().map(movementFromRecord)).find((c) => c.product === sku && c.warehouse === warehouse);
  return cell ? cell.onHand : 0;
}
async function flushUntil(pred: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

interface DispatchResult { ok: boolean; data?: { id?: string; status?: string }; replayed?: boolean; error?: { code: string; message: string } }
async function ship(orderId: string, idem: string, claimedTenantId?: string): Promise<DispatchResult> {
  return (await runSecureHandler(
    def,
    { operation: 'ShipSalesOrder', target: orderId, payload: {}, idempotencyKey: idem, ...(claimedTenantId ? { claimedTenantId } : {}) },
    { isAuthenticated: () => true },
  )) as DispatchResult;
}
// Seed on-hand via a posted receive movement, then create a pending sales order for `qty`.
async function orderWithStock(qty: number, onHandQty = 100, orderNumber = 'SO-1'): Promise<string> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn(STOCK_MOVEMENTS_MODULE_ID, { movementNumber: `MV-seed-${orderNumber}`, type: 'receive', product: 'SKU-A', warehouse: 'WH-1', quantity: onHandQty });
  const order = await createIn(ORDERS_MODULE_ID, {
    orderNumber, customer: 'Acme Inc.', product: 'SKU-A', warehouse: 'WH-1', orderedQty: qty, total: qty * 9,
  });
  expect(order.ok).toBe(true);
  return order.record!.id;
}

// ===========================================================================
// Governed shipment on the live path
// ===========================================================================

describe('S27 · ShipSalesOrder — governed shipment on the live path', () => {
  it('ships a pending order: status shipped + real issue movement + inventory deducted + event/audit', async () => {
    const id = await orderWithStock(40, 100);
    expect(onHand('SKU-A')).toBe(100);
    const r = await ship(id, 's1');
    expect(r.ok).toBe(true);
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.records(scope.tenantId)[0].event.type).toBe('SalesOrderShipped');
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1);
    expect(audit.length).toBeGreaterThan(0);
    expect(String(so(id).fields.status)).toBe('shipped');
    await flushUntil(() => issueMovements().length >= 1);
    expect(issueMovements().length).toBe(1);
    expect(onHand('SKU-A')).toBe(60); // 100 − 40 issued
  });

  it('cannot ship a CANCELLED order', async () => {
    const id = await orderWithStock(40, 100, 'SO-c');
    expect((await actIn(ORDERS_MODULE_ID, id, 'cancel')).ok).toBe(true);
    const r = await ship(id, 'c1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
    expect(issueMovements()).toHaveLength(0);
  });

  it('cannot RE-SHIP an already-shipped order (status guard), no second issue', async () => {
    const id = await orderWithStock(40, 100, 'SO-r');
    expect((await ship(id, 'r1')).ok).toBe(true);
    await flushUntil(() => issueMovements().length >= 1);
    const again = await ship(id, 'r2'); // different key → reaches the module, refused
    expect(again.ok).toBe(false);
    expect(again.error!.code).toBe('CONFLICT');
    expect(issueMovements().length).toBe(1);
    expect(onHand('SKU-A')).toBe(60);
  });

  it('UNAUTHORIZED without sales:manage — no shipment', async () => {
    const id = await orderWithStock(40, 100, 'SO-z');
    currentPrincipal = fullPrincipal({ permissions: ['sales:read', 'inventory:read'] });
    const r = await ship(id, 'z1');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(issueMovements()).toHaveLength(0);
    expect(String(so(id).fields.status)).toBe('pending');
  });

  it('TENANT_SCOPE_VIOLATION when the renderer claims a foreign tenant', async () => {
    const id = await orderWithStock(40, 100, 'SO-t');
    const r = await ship(id, 't1', 'tenant-EVIL');
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
    expect(issueMovements()).toHaveLength(0);
  });

  it('a foreign-tenant order is invisible → shipment refused', async () => {
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreign = await orderWithStock(40, 100, 'SO-B');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    currentPrincipal = fullPrincipal();
    const r = await ship(foreign, 'f1');
    expect(r.ok).toBe(false); // invisible in tenant-A scope → genuinely absent
    expect(r.error!.code).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// Idempotency + concurrency (reproduce-first)
// ===========================================================================

describe('S27 · idempotency + concurrency invariant', () => {
  it('100 concurrent SAME-key ships → ONE issue movement', async () => {
    const id = await orderWithStock(40, 100, 'SO-once');
    const results = await Promise.all(Array.from({ length: 100 }, () => ship(id, 'once')));
    expect(results.every((r) => r.ok)).toBe(true);
    await flushUntil(() => issueMovements().length >= 1);
    expect(issueMovements().length).toBe(1); // single-flight → one shipment
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(onHand('SKU-A')).toBe(60);
    const after = await ship(id, 'once');
    expect(after.replayed).toBe(true);
    expect(issueMovements().length).toBe(1);
  });

  it('two DIFFERENT-key ships of the same order → only ONE ships (one issue movement)', async () => {
    const id = await orderWithStock(40, 100, 'SO-conc');
    const [r1, r2] = await Promise.all([ship(id, 'k1'), ship(id, 'k2')]);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    expect(okCount).toBe(1); // the status machine admits exactly one ship
    await flushUntil(() => issueMovements().length >= 1);
    expect(issueMovements().length).toBe(1); // never two
    expect(onHand('SKU-A')).toBe(60);
  });

  it('survives restart: durable journal reloads and the key replays (no second shipment)', async () => {
    const id = await orderWithStock(40, 100, 'SO-durable');
    const first = await ship(id, 'durable');
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
    const replay = await ship(id, 'durable');
    expect(replay.replayed).toBe(true);
    expect(replay.data!.id).toBe(first.data!.id);
    await flushUntil(() => issueMovements().length >= 1);
    expect(issueMovements().length).toBe(1);
  });
});
