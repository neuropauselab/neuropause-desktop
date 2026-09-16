/**
 * ERP Session 89 — governed REORDER EXECUTION command
 * (`CreatePurchaseRequestFromReorderRecommendation`) through the REAL command bus.
 *
 * Proves the smallest operator-initiated governed reorder path: from an S86 decision report row,
 * re-read the LIVE state, apply the S88 policy (fail closed), and create exactly ONE draft PR through
 * the EXISTING CreatePurchaseRequest create path — deterministic PR number, correct qty/SKU/tenant/
 * actor, lineage, draft status. Plus the full negative + security + idempotency + stale + side-effect
 * matrix. Never a PO, never inventory, never GL, never a supplier award.
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
  JOURNAL_ENTRIES_MODULE_ID,
  PRODUCTS_MODULE_ID,
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderRecommendationModule } from '../../enterprise/modules/inventory/demandReorderModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DomainEventLog } from './domainEventLog';
import { CommandIdempotencyStore } from './commandIdempotency';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand } from './domainCommand';

const paths: string[] = [];
const tmp = (tag: string): string => { const p = join(tmpdir(), `np-s89-${tag}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let events: DomainEventLog;
let idempotency: CommandIdempotencyStore;
let authorized: EnterprisePermission[];
let ctx: EnterpriseModuleContext;

function makeCtx(denyPermission?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (denyPermission && p === denyPermission) throw new Error(`denied: ${p}`); },
    audit: () => undefined,
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  authorized = [];
  registry = new EnterpriseModuleRegistry();
  const products = createProductModule(tmp('prod'));
  const pr = createPurchaseRequestModule(tmp('pr'));
  const po = createPurchaseOrderModule(tmp('po'));
  const shipping = createShippingModule(tmp('ship'));
  const accounts = createLedgerAccountModule(tmp('acct'));
  for (const m of [
    products, pr, po, shipping, accounts,
    createStockMovementModule(tmp('mv')),
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createReorderRecommendationModule(tmp('rec'), products.store, pr.store, po.store, shipping.store),
    createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  events = new DomainEventLog();
  idempotency = new CommandIdempotencyStore();
});
afterEach(async () => { vi.restoreAllMocks(); for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined); });

const handler = (channel: string) => {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const listIn = (moduleId: string) => registry.get(moduleId)!.store.list();

function baseDeps(ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps {
  return { registry, ctx: ctxOverride ?? ctx, resolveScope: () => scope, events, idempotency };
}
let cmdSeq = 0;
function mkCmd(opts: { reportId?: string; sku?: string; idem?: string; tenantId?: string; workspaceId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(cmdSeq += 1)}`,
    type: 'CreatePurchaseRequestFromReorderRecommendation',
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    actor: 'operator@np.dev',
    ...(opts.reportId ? { target: { id: opts.reportId } } : {}),
    payload: opts.sku ? { sku: opts.sku } : {},
    correlationId: 'corr_reorder',
    idempotencyKey: opts.idem ?? `reorder-exec:${opts.reportId}:${opts.sku}`,
    timestamp: '2026-09-01T12:00:00.000Z',
    source: 'test',
  };
}

/** Seed a below-reorder product (availableStock 0) with a purchase cost, then generate the S86 report. */
async function seedAndReport(sku = 'SKU-1'): Promise<{ reportId: string; reportNumber: string; suggested: number }> {
  await createIn(PRODUCTS_MODULE_ID, { sku, name: 'Widget', purchaseCost: 4, reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
  const rep = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
  const reportId = rep.record!.id;
  const reportNumber = String(rep.record!.fields.reportNumber);
  const rows = JSON.parse(String(rep.record!.fields.rows)) as Array<Record<string, unknown>>;
  const row = rows.find((r) => r.sku === sku)!;
  expect(row.readinessStatus).toBe('READY_FOR_OPERATOR_REVIEW');
  return { reportId, reportNumber, suggested: Number(row.suggestedQuantity) };
}
const prList = () => listIn(PURCHASE_REQUESTS_MODULE_ID).filter((r) => r.status !== 'deleted');
const journalCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).length;

// ─────────────────────────── POSITIVE ───────────────────────────
describe('S89 positive — one operator confirmation drafts exactly one PR through the governed spine', () => {
  it('creates ONE draft PR with the deterministic number, canonical qty, correct SKU, lineage, and event', async () => {
    const { reportId, reportNumber, suggested } = await seedAndReport();
    expect(suggested).toBe(50); // target 50 − position 0
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ requestNumber: `PR-REORDER-${reportNumber}-SKU-1`, sku: 'SKU-1', quantity: 50, reportNumber });
    expect(res.event?.type).toBe('PurchaseRequestCreated');
    expect(res.event?.correlationId).toBe('corr_reorder');
    expect(authorized).toContain('procurement:manage');
    const prs = prList();
    expect(prs).toHaveLength(1);
    expect(prs[0]!.fields).toMatchObject({ requestNumber: `PR-REORDER-${reportNumber}-SKU-1`, product: 'SKU-1', quantity: 50, status: 'draft', department: 'Inventory' });
    expect(String(prs[0]!.fields.reason)).toContain(reportNumber);
    // D5 — no supplier on the draft
    expect(prs[0]!.fields.supplier ?? '').toBe('');
  });
});

// ─────────────────────────── IDEMPOTENCY ───────────────────────────
describe('S89 idempotency — one recommendation → at most one PR', () => {
  it('a second confirmation with the SAME key replays; no duplicate PR', async () => {
    const { reportId } = await seedAndReport();
    const cmd = mkCmd({ reportId, sku: 'SKU-1', idem: 'reorder-exec:fixed' });
    const a = await dispatchCommand(cmd, baseDeps());
    const b = await dispatchCommand({ ...cmd, commandId: 'cmd_replay' }, baseDeps());
    expect(a.ok && b.ok).toBe(true);
    expect(b.replayed).toBe(true);
    expect(prList()).toHaveLength(1);
  });

  it('a second confirmation with a DIFFERENT key is refused (the first PR restored the position — stale)', async () => {
    const { reportId } = await seedAndReport();
    const first = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1', idem: 'k1' }), baseDeps());
    expect(first.ok).toBe(true);
    const second = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1', idem: 'k2' }), baseDeps());
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/REORDER_NOT_EXECUTABLE:(stale-not-triggered|already-drafted)/);
    expect(prList()).toHaveLength(1);
  });

  it('a DIFFERENT-key re-execution of the same recommendation is refused through the DURABLE journal (already-drafted); one PR', async () => {
    // The real runtime uses the durable command journal (not the in-memory backend). A second
    // execution of the SAME recommendation under a DIFFERENT idempotency key does not replay — it
    // executes fresh, re-reads the store, and is refused by the S88 deterministic-number guard.
    const { reportId } = await seedAndReport();
    const journal = new DurableCommandJournal(tmp('journal'));
    const deps = { registry, ctx, resolveScope: () => scope, journal };
    const a = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1', idem: 'dk1' }), deps);
    expect(a.ok).toBe(true);
    const b = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1', idem: 'dk2' }), deps);
    expect(b.ok).toBe(false);
    expect(b.error).toBe('REORDER_NOT_EXECUTABLE:already-drafted');
    expect(prList()).toHaveLength(1);
  });

  it('replay across a durable-journal RESTART creates no duplicate', async () => {
    const { reportId } = await seedAndReport();
    const file = tmp('journal');
    const cmd = mkCmd({ reportId, sku: 'SKU-1', idem: 'reorder-exec:durable' });
    const j1 = new DurableCommandJournal(file);
    const a = await dispatchCommand(cmd, { registry, ctx, resolveScope: () => scope, journal: j1 });
    expect(a.ok).toBe(true);
    expect(prList()).toHaveLength(1);
    // Fresh journal over the SAME file = a process restart.
    const j2 = new DurableCommandJournal(file);
    const b = await dispatchCommand({ ...cmd, commandId: 'cmd_after_restart' }, { registry, ctx, resolveScope: () => scope, journal: j2 });
    expect(b.ok).toBe(true);
    expect(b.replayed).toBe(true);
    expect(prList()).toHaveLength(1);
  });
});

// ─────────────────────────── STALE ───────────────────────────
describe('S89 stale — a recommendation that is no longer valid is refused', () => {
  it('stale-not-triggered: the live position was restored above the reorder level', async () => {
    const { reportId } = await seedAndReport();
    // Receive 100 → availableStock 100 > reorderLevel 20 → no longer triggered.
    await createIn('inventory-movements', { movementNumber: 'MV-1', type: 'receive', product: 'SKU-1', warehouse: 'WH-1', quantity: 100 });
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('REORDER_NOT_EXECUTABLE:stale-not-triggered');
    expect(prList()).toHaveLength(0);
  });

  it('stale-quantity-changed: the live recommended quantity differs from the report', async () => {
    const { reportId } = await seedAndReport();
    // Raise maximumStock so assessReorder now suggests a larger quantity than the report captured.
    const product = listIn(PRODUCTS_MODULE_ID).find((r) => String(r.fields.sku) === 'SKU-1')!;
    await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: PRODUCTS_MODULE_ID, id: product.id, fields: { maximumStock: 80 } });
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('REORDER_NOT_EXECUTABLE:stale-quantity-changed');
    expect(prList()).toHaveLength(0);
  });
});

// ─────────────────────────── NEGATIVE / VALIDATION ───────────────────────────
describe('S89 negative — invalid / missing inputs fail closed', () => {
  it('missing recommendation id → MISSING_RECOMMENDATION (envelope requires the target)', async () => {
    await seedAndReport();
    const res = await dispatchCommand(mkCmd({ sku: 'SKU-1', idem: 'x' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('MISSING_TARGET');
  });
  it('missing sku → MISSING_SKU', async () => {
    const { reportId } = await seedAndReport();
    const res = await dispatchCommand(mkCmd({ reportId, idem: 'y' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('MISSING_SKU');
  });
  it('unknown recommendation id → RECOMMENDATION_NOT_FOUND', async () => {
    await seedAndReport();
    const res = await dispatchCommand(mkCmd({ reportId: 'nope', sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('RECOMMENDATION_NOT_FOUND');
  });
  it('a SKU not in the report → RECOMMENDATION_ROW_NOT_FOUND', async () => {
    const { reportId } = await seedAndReport();
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-ABSENT' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('RECOMMENDATION_ROW_NOT_FOUND');
  });
});

// ─────────────────────────── SECURITY / TENANT / RBAC ───────────────────────────
describe('S89 security — tenant + RBAC fail closed', () => {
  it('NO_TENANT → UNRESOLVED_TENANT, no PR', async () => {
    const { reportId } = await seedAndReport();
    scope = null;
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('UNRESOLVED_TENANT');
  });
  it('forged tenant on the envelope → CROSS_TENANT_CLAIM', async () => {
    const { reportId } = await seedAndReport();
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1', tenantId: 'tenant-EVIL' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('CROSS_TENANT_CLAIM');
  });
  it('a recommendation from ANOTHER tenant is invisible → RECOMMENDATION_NOT_FOUND', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const { reportId } = await seedAndReport();
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(false);
    expect(res.error).toBe('RECOMMENDATION_NOT_FOUND');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(prList()).toHaveLength(0);
  });
  it('unauthorized actor (procurement:manage denied) → UNAUTHORIZED, no PR', async () => {
    const { reportId } = await seedAndReport();
    const denyCtx = makeCtx('procurement:manage');
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps(denyCtx));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('UNAUTHORIZED');
    expect(prList()).toHaveLength(0);
  });
});

// ─────────────────────────── SIDE-EFFECT BOUNDARY ───────────────────────────
describe('S89 side-effect boundary — draft PR only, nothing else', () => {
  it('exactly one PR; zero PO; zero inventory mutation; zero GL; no supplier award', async () => {
    const { reportId } = await seedAndReport();
    const productsBefore = JSON.stringify(listIn(PRODUCTS_MODULE_ID));
    const poBefore = listIn(PURCHASE_ORDERS_MODULE_ID).length;
    const journalBefore = journalCount();
    const res = await dispatchCommand(mkCmd({ reportId, sku: 'SKU-1' }), baseDeps());
    expect(res.ok).toBe(true);
    expect(prList()).toHaveLength(1);
    expect(listIn(PURCHASE_ORDERS_MODULE_ID).length).toBe(poBefore); // no PO
    expect(JSON.stringify(listIn(PRODUCTS_MODULE_ID))).toBe(productsBefore); // no inventory mutation
    expect(journalCount()).toBe(journalBefore); // no GL
    expect(prList()[0]!.fields.supplier ?? '').toBe(''); // no supplier award
  });
});
