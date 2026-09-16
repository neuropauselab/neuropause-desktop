/**
 * MRP → planned orders seam (ERP Session 3).
 *
 * Pure decision pins (idempotency + filtering) plus a REAL end-to-end run: a BOM
 * explosion, created through the real module, drafts a purchase request per
 * purchased requirement through the real Purchase Requests module — read back
 * from the PR store, correlated to the explosion, and idempotent on re-run.
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
  BOM_EXPLOSIONS_MODULE_ID,
  BOM_MODULE_ID,
  IpcChannel,
  PRODUCTS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  serializeBomComponents,
  type EnterpriseEntity,
  type EnterprisePermission,
  type ExplosionRequirement,
  type PlatformEventInput,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework/moduleRegistry';
import { globalRef, readCorrelation } from '../../framework/transactionGraph';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { createProductModule } from '../inventory/productModule';
import { createBomModule } from './bomModule';
import { createBomExplosionModule } from './bomExplosionModule';
import { createPurchaseRequestModule } from '../procurement/purchaseRequestModule';
import {
  GENERATE_PLANNED_ORDERS_ACTION,
  deriveMrpDraftRequests,
  mrpPurchaseRequestNumber,
} from './plannedOrdersSeam';

const T0 = '2026-08-31T12:00:00.000Z';

const req = (sku: string, totalQuantity: number, over: Partial<ExplosionRequirement> = {}): ExplosionRequirement =>
  ({ sku, totalQuantity, standardCost: 1, cost: totalQuantity, unvalued: false, ...over });

// ── PURE decision ────────────────────────────────────────────────────────────
describe('deriveMrpDraftRequests — deterministic + idempotent', () => {
  it('drafts a request per purchased requirement with a deterministic number', () => {
    const drafts = deriveMrpDraftRequests('BX-FG-1', [req('RM-1', 15), req('RM-2', 4)], new Set());
    expect(drafts).toEqual([
      { requestNumber: 'PR-MRP-BX-FG-1-RM-1', sku: 'RM-1', quantity: 15 },
      { requestNumber: 'PR-MRP-BX-FG-1-RM-2', sku: 'RM-2', quantity: 4 },
    ]);
  });
  it('skips a requirement that already has a request (idempotency key)', () => {
    const existing = new Set([mrpPurchaseRequestNumber('BX-FG-1', 'RM-1')]);
    const drafts = deriveMrpDraftRequests('BX-FG-1', [req('RM-1', 15), req('RM-2', 4)], existing);
    expect(drafts.map((d) => d.sku)).toEqual(['RM-2']);
  });
  it('skips zero-quantity and blank-sku lines, and rounds quantities', () => {
    const drafts = deriveMrpDraftRequests('BX', [req('RM-1', 0), req('', 5), req('RM-2', 2.6)], new Set());
    expect(drafts).toEqual([{ requestNumber: 'PR-MRP-BX-RM-2', sku: 'RM-2', quantity: 3 }]);
  });
});

// ── INTEGRATION: explosion → action → real PR store ──────────────────────────
interface Rec { publish: PlatformEventInput[]; audit: { action: string }[]; broadcast: { channel: string }[]; authorized: EnterprisePermission[] }
let rec: Rec;
let scope: { tenantId: string; workspaceId: string } | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => rec.authorized.push(p),
    audit: (e: { action: string; target: string; summary: string }) => rec.audit.push(e),
    publish: (i: PlatformEventInput) => rec.publish.push(i),
    broadcast: (channel: string) => rec.broadcast.push({ channel }),
    notify: () => undefined,
    actor: () => 'planner@np.dev',
    now: () => T0,
  };
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  const products = createProductModule(tmp('prod'));
  const boms = createBomModule(tmp('bom'));
  const explosions = createBomExplosionModule(tmp('bx'), boms.store, products.store);
  const requests = createPurchaseRequestModule(tmp('pr'));
  registry = new EnterpriseModuleRegistry();
  for (const m of [products, boms, explosions, requests]) registry.register(m);
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
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const prList = () => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list().filter((r) => r.status !== 'deleted');

async function seedExplosion(): Promise<EnterpriseEntity> {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'FG-1', name: 'Finished', standardCost: 100 });
  await createIn(PRODUCTS_MODULE_ID, { sku: 'RM-1', name: 'Raw', standardCost: 5 });
  await createIn(BOM_MODULE_ID, {
    bomNumber: 'BOM-1', product: 'FG-1', revision: 'A', status: 'active',
    components: serializeBomComponents([{ sku: 'RM-1', quantity: 3, waste: 0, alternative: '' }]),
  });
  const x = await createIn(BOM_EXPLOSIONS_MODULE_ID, { rootProduct: 'FG-1', quantity: 5 });
  if (!x.ok || !x.record) throw new Error(`explosion failed: ${JSON.stringify(x.errors)}`);
  return x.record;
}

describe('generatePlannedOrders — explosion drafts real purchase requests', () => {
  it('drafts a correlated draft PR for each purchased requirement, read back from the PR store', async () => {
    const explosion = await seedExplosion();
    const res = await act(BOM_EXPLOSIONS_MODULE_ID, explosion.id, GENERATE_PLANNED_ORDERS_ACTION);
    expect(res.ok).toBe(true);

    const prs = prList();
    expect(prs).toHaveLength(1);
    const pr = prs[0];
    expect(pr.fields).toMatchObject({
      requestNumber: `PR-MRP-${explosion.fields.reportNumber}-RM-1`,
      product: 'RM-1',
      quantity: 15, // 5 builds × 3 per build
      status: 'draft',
    });
    // The planned order joins the explosion's transaction (Session 1 spine).
    expect(readCorrelation(pr)).toMatchObject({
      correlationId: globalRef(BOM_EXPLOSIONS_MODULE_ID, explosion.id),
      causationId: explosion.id,
      causedByModule: BOM_EXPLOSIONS_MODULE_ID,
    });
    // Authorized against the Purchase Requests write scope, not manufacturing.
    expect(rec.authorized).toContain('procurement:manage');
  });

  it('is idempotent — a second run drafts nothing new', async () => {
    const explosion = await seedExplosion();
    await act(BOM_EXPLOSIONS_MODULE_ID, explosion.id, GENERATE_PLANNED_ORDERS_ACTION);
    const afterFirst = prList().length;
    const second = await act(BOM_EXPLOSIONS_MODULE_ID, explosion.id, GENERATE_PLANNED_ORDERS_ACTION);
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/already have a draft/i);
    expect(prList().length).toBe(afterFirst); // no duplicate
  });

  it('degrades honestly when Procurement is not wired (no throw, no draft)', async () => {
    const explosion = await seedExplosion();
    // Rebuild a registry WITHOUT the Purchase Requests module.
    const products = createProductModule(tmp('prod2'));
    const boms = createBomModule(tmp('bom2'));
    const explosions = createBomExplosionModule(tmp('bx2'), boms.store, products.store);
    const reg2 = new EnterpriseModuleRegistry();
    for (const m of [products, boms, explosions]) reg2.register(m);
    reg2.bindScope(() => scope);
    const h2 = buildModuleHandlers(reg2, spyCtx());
    // Recreate the explosion in this registry so the action has a record to run on.
    await (h2.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>)({ moduleId: PRODUCTS_MODULE_ID, fields: { sku: 'FG-1', name: 'F', standardCost: 1 } });
    await (h2.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>)({ moduleId: BOM_MODULE_ID, fields: { bomNumber: 'BOM-1', product: 'FG-1', revision: 'A', status: 'active', components: serializeBomComponents([{ sku: 'RM-1', quantity: 3, waste: 0, alternative: '' }]) } });
    const x = (await (h2.find((d) => d.channel === IpcChannel.EnterpriseModuleCreate)!.handler as (p: unknown) => Promise<unknown>)({ moduleId: BOM_EXPLOSIONS_MODULE_ID, fields: { rootProduct: 'FG-1', quantity: 2 } })) as { record: EnterpriseEntity };
    const res = (await (h2.find((d) => d.channel === IpcChannel.EnterpriseModuleAction)!.handler as (p: unknown) => Promise<unknown>)({ moduleId: BOM_EXPLOSIONS_MODULE_ID, id: x.record.id, action: GENERATE_PLANNED_ORDERS_ACTION })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Purchase Requests module is not available/i);
    void explosion;
  });
});
