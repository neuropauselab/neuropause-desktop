/**
 * ERP Session 19 — governed application/API boundary (Track B) + RFQ → Quote →
 * award → PO reuse/traceability (Track A).
 *
 * The application boundary sits above the Session 18 command bus: it
 * authenticates, validates the tenant claim against the principal, dispatches a
 * canonical command through the SAME bus (durable idempotency/transaction/event/
 * outbox reused), and maps every outcome to a deterministic error contract with
 * no internal leakage. Proven callable by test-only Web and AI adapters with no
 * Electron and no store handle.
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
  PURCHASE_ORDERS_MODULE_ID,
  PURCHASE_REQUESTS_MODULE_ID,
  RFQS_MODULE_ID,
  SUPPLIERS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createSupplierModule } from '../../enterprise/modules/procurement/supplierModule';
import { createRfqModule } from '../../enterprise/modules/procurement/rfqModule';
import { DurableCommandJournal } from '../command/durableCommandJournal';
import { handleApplicationRequest, type ApplicationDeps } from './applicationService';
import type { RequestContext, Principal } from './requestContext';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s19-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

const FULL_PERMS: EnterprisePermission[] = ['procurement:read', 'procurement:manage', 'operations:read', 'operations:manage', 'inventory:read', 'inventory:manage'];
let scope: TenantScope;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let journal: DurableCommandJournal;
let audit: { action: string }[];

function moduleCtx(): EnterpriseModuleContext {
  return {
    authorize: () => undefined,
    audit: (e) => audit.push(e),
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'op@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const suppliers = createSupplierModule(tmp('supp'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseRequestModule(tmp('pr')),
    createPurchaseOrderModule(tmp('po')),
    createGoodsReceiptModule(tmp('gr')),
    suppliers,
    createRfqModule(tmp('rfq'), suppliers.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  handlers = buildModuleHandlers(registry, moduleCtx());
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const deps = (): ApplicationDeps => ({ registry, journal, audit: (e) => audit.push(e), now: () => '2026-09-01T12:00:00.000Z' });
const handler = (c: string) => (handlers.find((d) => d.channel === c)!.handler as (p: unknown) => Promise<unknown>);
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;
const journalEntries = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().length;
async function flushUntil(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

let reqSeq = 0;
const prLines = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);
function ctxFor(overrides: Partial<RequestContext> = {}, principalOverride?: Partial<Principal> | null): RequestContext {
  const principal: Principal | null =
    principalOverride === null
      ? null
      : { actor: 'op@np.dev', tenantId: scope.tenantId, workspaceId: scope.workspaceId, permissions: FULL_PERMS, ...principalOverride };
  return { principal, correlationId: 'corr-1', causationId: 'cause-1', requestId: `req_${(reqSeq += 1)}`, source: 'web', ...overrides };
}
type AppOpts = { target?: string; payload?: Record<string, unknown>; idem?: string; claimedTenantId?: string };
function app(operation: Parameters<typeof handleApplicationRequest>[0]['operation'], opts: AppOpts = {}, ctx?: RequestContext) {
  reqSeq += 0;
  return handleApplicationRequest(
    { operation, target: opts.target, payload: opts.payload ?? {}, idempotencyKey: opts.idem ?? `idem_${operation}_${reqSeq}`, claimedTenantId: opts.claimedTenantId },
    ctx ?? ctxFor(),
    deps(),
  );
}
async function createPR(idem = 'c1'): Promise<string> {
  const r = await app('CreatePurchaseRequest', { payload: { requestNumber: `PR-${idem}`, lines: prLines }, idem });
  return String(r.data!.id);
}

// ===========================================================================
// TRACK B — application boundary
// ===========================================================================

describe('S19 · application boundary → command → durable event/outbox', () => {
  it('an authenticated request runs the full governed flow and emits a durable event + outbox', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-1', lines: prLines }, idem: 'k1' });
    expect(r.ok).toBe(true);
    expect(r.event?.type).toBe('PurchaseRequestCreated');
    expect(journal.records(scope.tenantId)).toHaveLength(1);
    expect(journal.pendingOutbox(scope.tenantId)).toHaveLength(1); // outbox reused, not app-created
    expect(audit.some((a) => a.action === `module.${PURCHASE_REQUESTS_MODULE_ID}.created`)).toBe(true); // audit reused
  });

  it('preserves observability metadata (request/correlation/causation/tenant/actor/operation)', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-o', lines: prLines }, idem: 'ko' });
    expect(r.requestId).toBeTruthy();
    expect(r.correlationId).toBe('corr-1');
    expect(r.causationId).toBe('cause-1');
    expect(r.tenantId).toBe('tenant-A');
    expect(r.actor).toBe('op@np.dev');
    expect(r.operation).toBe('CreatePurchaseRequest');
  });
});

describe('S19 · deterministic error contract', () => {
  it('UNAUTHENTICATED when no principal is present', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-u', lines: prLines }, idem: 'ku' }, ctxFor({}, null));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHENTICATED');
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(0);
  });

  it('UNAUTHORIZED when the principal lacks the permission', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-z', lines: prLines }, idem: 'kz' }, ctxFor({}, { permissions: [] }));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('UNAUTHORIZED');
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(0); // no economic mutation
  });

  it('TENANT_SCOPE_VIOLATION when the client claims a different tenant than the principal', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-t', lines: prLines }, idem: 'kt', claimedTenantId: 'tenant-EVIL' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('VALIDATION_ERROR for an invalid payload', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { lines: prLines }, idem: 'kv' }); // no requestNumber
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('VALIDATION_ERROR');
  });

  it('CONFLICT when a state precondition is not met (convert an unapproved PR)', async () => {
    const prId = await createPR('kc');
    const r = await app('ConvertPurchaseRequestToPO', { target: prId, idem: 'kc-conv' });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe('CONFLICT');
  });

  it('errors never leak internal detail — only the fixed safe message', async () => {
    const r = await app('CreatePurchaseRequest', { payload: { lines: prLines }, idem: 'ksafe' });
    expect(r.error!.message).toBe('The request was not valid.');
    expect(JSON.stringify(r)).not.toMatch(/Error:|\.json|\/Users\/|stack/i);
  });
});

describe('S19 · idempotency reuse (Session 18)', () => {
  it('same tenant + key → same result (replayed); different tenant → independent', async () => {
    const a1 = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-i', lines: prLines }, idem: 'once' });
    const a2 = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-i', lines: prLines }, idem: 'once' });
    expect(a2.replayed).toBe(true);
    expect(a1.data!.id).toBe(a2.data!.id);
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(1);
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const b = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-iB', lines: prLines }, idem: 'once' });
    expect(b.replayed).toBeFalsy();
    expect(journal.records('tenant-B')).toHaveLength(1);
  });

  it('survives a restart: the outbox persists and the key still replays', async () => {
    await createPR('durable');
    await journal.reload();
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
    const replay = await app('CreatePurchaseRequest', { payload: { requestNumber: 'PR-durable', lines: prLines }, idem: 'durable' });
    expect(replay.replayed).toBe(true);
  });
});

describe('S19 · AI + Electron independence', () => {
  it('a test-only AI adapter reaches ERP only through a pre-bound application handle (no store/registry)', async () => {
    // The platform pre-binds deps; the adapter receives ONLY this function.
    const boundHandle = (req: Parameters<typeof handleApplicationRequest>[0], ctx: RequestContext) => handleApplicationRequest(req, ctx, deps());
    const aiAdapter = async (args: { requestNumber: string }) =>
      boundHandle({ operation: 'CreatePurchaseRequest', payload: { requestNumber: args.requestNumber, lines: prLines }, idempotencyKey: `ai-${args.requestNumber}` }, ctxFor({ source: 'agent' }));
    const r = await aiAdapter({ requestNumber: 'PR-ai' });
    expect(r.ok).toBe(true);
    expect(r.event?.type).toBe('PurchaseRequestCreated'); // governed durable path
  });

  it('the application + command + persistence layers import no Electron / React / IPC', async () => {
    const roots = [__dirname, join(__dirname, '../command'), join(__dirname, '../persistence')];
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const ent of await fs.readdir(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) await walk(p);
        else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) files.push(p);
      }
    };
    for (const r of roots) await walk(r);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = await fs.readFile(f, 'utf8');
      expect(src, `${f} must not import electron`).not.toMatch(/from ['"]electron['"]/);
      expect(src, `${f} must not import react`).not.toMatch(/from ['"]react['"]/);
      expect(src, `${f} must not import ipcMain/BrowserWindow`).not.toMatch(/ipcMain|BrowserWindow/);
    }
  });
});

// ===========================================================================
// TRACK A — RFQ → Quote → award → PO (reuse + traceability + no GL)
// ===========================================================================

describe('S19 · RFQ → Quote → governed award → PO', () => {
  async function rfqWithQuotes(): Promise<string> {
    await createIn(SUPPLIERS_MODULE_ID, { name: 'Acme', status: 'active' });
    await createIn(SUPPLIERS_MODULE_ID, { name: 'Globex', status: 'active' });
    const rfq = await createIn(RFQS_MODULE_ID, {
      rfqNumber: 'RFQ-1', product: 'SKU-A', quantity: 10, warehouse: 'WH-1', currency: 'USD',
      quotesJson: '{"supplier":"Acme","unitCost":5,"leadTimeDays":7}\n{"supplier":"Globex","unitCost":6,"leadTimeDays":5}',
    });
    expect(rfq.ok).toBe(true);
    return rfq.record!.id;
  }

  it('best-value award creates a PO carrying the RFQ ref + winning quote (traceability)', async () => {
    const rfqId = await rfqWithQuotes();
    expect((await act(RFQS_MODULE_ID, rfqId, 'award')).ok).toBe(true);
    const rfq = registry.get(RFQS_MODULE_ID)!.store.get(rfqId)!;
    expect(String(rfq.fields.status)).toBe('awarded');
    expect(String(rfq.fields.awardedSupplier)).toBe('Acme'); // best value (5 < 6)
    const poId = String(rfq.fields.awardedOrder);
    const po = registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.get(poId)!;
    expect(String(po.fields.sourceRfq)).toBe(rfqId); // RFQ → PO traceability
    expect(String(po.fields.supplier)).toBe('Acme'); // winning quote's supplier
    expect(Number(po.fields.unitCost)).toBe(5); // winning quote's price
  });

  it('a quote from a supplier NOT in the master is refused (no phantom vendors)', async () => {
    await createIn(SUPPLIERS_MODULE_ID, { name: 'Acme', status: 'active' });
    const rfq = await createIn(RFQS_MODULE_ID, {
      rfqNumber: 'RFQ-x', product: 'SKU-A', quantity: 10, currency: 'USD',
      quotesJson: '{"supplier":"GhostVendor","unitCost":1,"leadTimeDays":1}',
    });
    expect(rfq.ok).toBe(false); // GhostVendor is not in the Suppliers register
  });

  it('RFQ and award create NO GL; accounting starts only at the goods receipt', async () => {
    const rfqId = await rfqWithQuotes();
    expect((await act(RFQS_MODULE_ID, rfqId, 'award')).ok).toBe(true);
    expect(journalEntries()).toBe(0); // RFQ + quote + PO (commitment) → no accounting
    const rfq = registry.get(RFQS_MODULE_ID)!.store.get(rfqId)!;
    const poId = String(rfq.fields.awardedOrder);
    await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
    const gr = await createIn('procurement-receipts', { grNumber: 'GR-1', purchaseOrder: poId, supplier: 'Acme', product: 'SKU-A', warehouse: 'WH-1', quantityOrdered: 10, quantityReceived: 10 });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => journalEntries() > 0);
    expect(journalEntries()).toBeGreaterThan(0); // GL begins at GR (Inventory/GRNI)
  });
});
