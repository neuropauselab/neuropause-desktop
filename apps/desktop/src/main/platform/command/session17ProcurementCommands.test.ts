/**
 * ERP Session 17 — Purchase Request → governed procurement commands + the
 * platform Domain Command seam.
 *
 * Track A (ERP): a multi-line Purchase Request with a governed lifecycle
 * (draft → pending → approved/rejected → ordered) that converts deterministically
 * to a multi-line Purchase Order, then flows through the Session 16 P2P chain.
 * Track B (Platform): the four commands run through `dispatchCommand`, which
 * derives tenancy from the principal, authorizes, enforces idempotency, delegates
 * the governed transaction, emits a domain event, and audits — reusable by any
 * non-Electron client (proven here by dispatching commands directly, not via IPC).
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
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createVendorPaymentModule } from '../../enterprise/modules/finance/vendorPaymentModule';
import { STOCK_ACCOUNTS } from '../../erp/postingRules';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DomainEventLog } from './domainEventLog';
import { CommandIdempotencyStore } from './commandIdempotency';
import type { CommandResult, DomainCommand, DomainCommandType } from './domainCommand';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s17-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

interface AuditEntry { action: string; target: string; summary: string }
let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let events: DomainEventLog;
let idempotency: CommandIdempotencyStore;
let audit: AuditEntry[];
let published: PlatformEventInput[];
let authorized: EnterprisePermission[];

/** The base platform context — identity / authz / audit primitives. */
function makeCtx(authorizeThrowsFor?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => {
      authorized.push(p);
      if (authorizeThrowsFor && p === authorizeThrowsFor) throw new Error(`denied: ${p}`);
    },
    audit: (e) => audit.push(e),
    publish: (i: PlatformEventInput) => published.push(i),
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}
let ctx: EnterpriseModuleContext;

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  published = [];
  authorized = [];
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  const billsM = createVendorBillModule(tmp('bill'), pos.store);
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseRequestModule(tmp('pr')),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    billsM,
    createVendorPaymentModule(tmp('vpay'), billsM.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  events = new DomainEventLog();
  idempotency = new CommandIdempotencyStore();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

// direct IPC handlers (for the downstream P2P chain, unchanged from Session 16)
const handler = (channel: string) => {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler as (p: unknown) => Promise<unknown>;
};
const createIn = (moduleId: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields }) as Promise<{ ok: boolean; record?: EnterpriseEntity }>;
const updateIn = (moduleId: string, id: string, fields: Record<string, unknown>) =>
  handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId, id, fields }) as Promise<{ ok: boolean }>;
const act = (moduleId: string, id: string, action: string) =>
  handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{ ok: boolean; message?: string }>;

// command dispatch
const deps = (ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps => ({
  registry,
  ctx: ctxOverride ?? ctx,
  resolveScope: () => scope,
  events,
  idempotency,
});
let cmdSeq = 0;
function mkCmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string; workspaceId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(cmdSeq += 1)}`,
    type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: `corr_${type}`,
    idempotencyKey: opts.idem ?? `idem_${type}_${cmdSeq}`,
    timestamp: '2026-09-01T12:00:00.000Z',
    source: 'test',
  };
}
const dispatch = (cmd: DomainCommand, ctxOverride?: EnterpriseModuleContext) => dispatchCommand(cmd, deps(ctxOverride));

const prLines = JSON.stringify([
  { sku: 'SKU-A', quantity: 10, unitPrice: 5 },
  { sku: 'SKU-B', quantity: 20, unitPrice: 3 },
  { sku: 'SKU-C', quantity: 5, unitPrice: 8 },
]);
async function seedProducts(): Promise<void> {
  await createIn('inventory-products', { sku: 'SKU-A', name: 'A', standardCost: 5 });
  await createIn('inventory-products', { sku: 'SKU-B', name: 'B', standardCost: 3 });
  await createIn('inventory-products', { sku: 'SKU-C', name: 'C', standardCost: 8 });
}
const prRecord = (id: string) => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.get(id)!;
const journalCount = (): number => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().length;
function journalLines(): { account: string; debit: number; credit: number }[] {
  return registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list()
    .flatMap((e) => JSON.parse(String(e.fields.lines ?? '[]')) as { account: string; debit: number; credit: number }[]);
}
const net = (account: string): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l.credit - l.debit, 0);
const bal = (account: string, side: 'debit' | 'credit'): number =>
  journalLines().filter((l) => l.account === account).reduce((n, l) => n + l[side], 0);
async function flushUntil(pred: () => boolean, ms = 1200): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 5));
}

/** Create → Submit → Approve a multi-line PR; return its id. */
async function createSubmitApprove(idemPrefix = 'x'): Promise<string> {
  const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: `PR-${idemPrefix}`, department: 'Ops', lines: prLines }, idem: `create-${idemPrefix}` }));
  const prId = String(c.data!.id);
  expect((await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: `submit-${idemPrefix}` }))).ok).toBe(true);
  expect((await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: `approve-${idemPrefix}` }))).ok).toBe(true);
  return prId;
}

// ===========================================================================
// TRACK A — ERP: multi-line PR + governed lifecycle + PR→PO conversion
// ===========================================================================

describe('S17 · Track A — Purchase Request domain object + conversion', () => {
  it('a PR is a real multi-line object with a governed lifecycle draft→pending→approved→ordered', async () => {
    const prId = await createSubmitApprove('life');
    expect(String(prRecord(prId).fields.status)).toBe('approved');
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-life' }));
    expect(conv.ok).toBe(true);
    expect(String(prRecord(prId).fields.status)).toBe('ordered');
  });

  it('conversion is deterministic: PR line i → PO line i, traceable, no quantity inflation', async () => {
    const prId = await createSubmitApprove('det');
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-det' }));
    const poId = String(conv.data!.purchaseOrderId);
    const po = registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.get(poId)!;
    expect(String(po.fields.sourceRequest)).toBe(prId); // traceability
    expect(String(po.fields.lines)).toBe(prLines); // verbatim: same lines, same order, no inflation
    expect(Number(po.fields.subtotal)).toBe(10 * 5 + 20 * 3 + 5 * 8); // 150 derived from the carried lines
  });

  it('an unapproved (draft) PR cannot be converted (approval is required)', async () => {
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-draft', lines: prLines }, idem: 'create-draft' }));
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: String(c.data!.id), idem: 'conv-draft' }));
    expect(conv.ok).toBe(false);
    expect(registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list()).toHaveLength(0);
  });

  it('a rejected PR cannot be converted', async () => {
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-rej', lines: prLines }, idem: 'create-rej' }));
    const prId = String(c.data!.id);
    await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'submit-rej' }));
    expect((await dispatch(mkCmd('RejectPurchaseRequest', { target: prId, idem: 'reject-rej' }))).ok).toBe(true);
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-rej' }));
    expect(conv.ok).toBe(false); // only an approved PR converts
  });

  it('the full E2E: PR → PO → receipt → GRNI → bill → payment reconciles (GRNI=0, AP=0)', async () => {
    await seedProducts();
    const prId = await createSubmitApprove('e2e');
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-e2e' }));
    const poId = String(conv.data!.purchaseOrderId);
    // Supplier is assigned at the PO stage (the existing PO workflow) — the PR
    // does not select a supplier (that would be §17 undefined supplier policy).
    await updateIn(PURCHASE_ORDERS_MODULE_ID, poId, { supplier: 'Acme' });
    // receive all lines (Session 16 multi-line receipt)
    const gr = await createIn('procurement-receipts', {
      grNumber: 'GR-e2e', purchaseOrder: poId, supplier: 'Acme', warehouse: 'WH-1', product: 'MULTI', quantityReceived: 35,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 10 }, { sku: 'SKU-B', quantity: 20 }, { sku: 'SKU-C', quantity: 5 }]),
    });
    expect((await act('procurement-receipts', gr.record!.id, 'post')).ok).toBe(true);
    await flushUntil(() => bal(STOCK_ACCOUNTS.grni, 'credit') === 150);
    const bill = await createIn('finance-vendor-bills', {
      billNumber: 'VB-e2e', vendor: 'Acme', amount: 150, currency: 'USD', sourcePurchaseOrder: poId,
      lines: JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }, { sku: 'SKU-B', quantity: 20, unitPrice: 3 }, { sku: 'SKU-C', quantity: 5, unitPrice: 8 }]),
    });
    expect((await act('finance-vendor-bills', bill.record!.id, 'approve')).ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.grni) === 0);
    expect(net(STOCK_ACCOUNTS.grni)).toBe(0);
    const pay = await createIn('finance-vendor-payments', { paymentNumber: 'VP-e2e', billRef: 'VB-e2e', vendor: 'Acme', amount: 150, currency: 'USD' });
    expect(pay.ok).toBe(true);
    await flushUntil(() => net(STOCK_ACCOUNTS.accountsPayable) === 0);
    expect(net(STOCK_ACCOUNTS.accountsPayable)).toBe(0);
  });

  it('the Purchase Request itself creates NO GL entries', async () => {
    await seedProducts();
    const prId = await createSubmitApprove('nogl');
    await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-nogl' }));
    await new Promise((r) => setTimeout(r, 30)); // allow any (non-existent) posting to flush
    expect(journalCount()).toBe(0); // PR + PO are procurement state / commitment — no accounting
  });
});

// ===========================================================================
// TRACK B — Platform: command seam, authz, idempotency, tenant, events, audit
// ===========================================================================

describe('S17 · Track B — domain command seam', () => {
  it('routes all four commands through one governed seam and emits domain events', async () => {
    const prId = await createSubmitApprove('seam');
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-seam' }));
    expect(conv.ok).toBe(true);
    const types = events.list('tenant-A').map((e) => e.type);
    expect(types).toEqual(['PurchaseRequestCreated', 'PurchaseRequestSubmitted', 'PurchaseRequestApproved', 'PurchaseRequestConvertedToPO']);
    const converted = events.ofType('tenant-A', 'PurchaseRequestConvertedToPO')[0];
    expect(converted.aggregateId).toBe(prId); // attributable to the aggregate
    expect(converted.correlationId).toBe('corr_ConvertPurchaseRequestToPO'); // correlated
    expect(converted.actor).toBe('operator@np.dev'); // attributable to the actor
    expect(Object.isFrozen(converted)).toBe(true); // immutable
  });

  it('an invalid command payload is refused (domain validation)', async () => {
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { lines: prLines }, idem: 'create-invalid' })); // no requestNumber (required)
    expect(c.ok).toBe(false);
    expect(c.error).toBe('VALIDATION_FAILED');
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(0);
  });

  it('authorization is enforced at the domain boundary — an unauthorized principal is denied', async () => {
    const denyCtx = makeCtx('procurement:manage');
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-authz', lines: prLines }, idem: 'create-authz' }), denyCtx);
    expect(c.ok).toBe(false);
    expect(c.error).toBe('UNAUTHORIZED');
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(0); // nothing created
  });

  it('audit is generated for a governed command (reusing the framework audit trail)', async () => {
    await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-aud', lines: prLines }, idem: 'create-aud' }));
    expect(audit.some((a) => a.action === `module.${PURCHASE_REQUESTS_MODULE_ID}.created`)).toBe(true);
  });

  it('idempotency: each command dispatched twice yields one effect', async () => {
    // create twice → one PR
    const idem = 'create-once';
    const c1 = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-once', lines: prLines }, idem }));
    const c2 = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-once', lines: prLines }, idem }));
    expect(c2.replayed).toBe(true);
    expect(c1.data!.id).toBe(c2.data!.id);
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(1);
    const prId = String(c1.data!.id);
    // approve twice (same key) → one transition, one event
    await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'submit-once' }));
    await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: 'approve-once' }));
    await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: 'approve-once' }));
    expect(events.ofType('tenant-A', 'PurchaseRequestApproved')).toHaveLength(1);
    // convert twice (same key) → one PO
    await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-once' }));
    await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-once' }));
    expect(registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list()).toHaveLength(1);
  });

  it('concurrent duplicate create → still one PR (single-flight idempotency)', async () => {
    const idem = 'create-conc';
    const [a, b] = await Promise.all([
      dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-conc', lines: prLines }, idem })),
      dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-conc', lines: prLines }, idem })),
    ]);
    expect(a.data!.id).toBe(b.data!.id);
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list()).toHaveLength(1);
  });

  it('duplicate conversion via a NEW idempotency key is still refused by the domain guard', async () => {
    const prId = await createSubmitApprove('dupconv');
    expect((await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-dup-1' }))).ok).toBe(true);
    const second = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-dup-2' }));
    expect(second.ok).toBe(false); // convertedOrder already set — one PO only
    expect(registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list()).toHaveLength(1);
  });

  it('the convertedOrder guard alone blocks re-conversion even if status is forced back to approved', async () => {
    const prId = await createSubmitApprove('reconv');
    expect((await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'reconv-1' }))).ok).toBe(true);
    // Force the status back to approved (a stale/forged status) — the convertedOrder
    // guard must STILL block a second conversion (defense in depth, isolated here).
    await updateIn(PURCHASE_REQUESTS_MODULE_ID, prId, { status: 'approved' });
    const second = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'reconv-2' }));
    expect(second.ok).toBe(false);
    expect(registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list()).toHaveLength(1);
  });
});

// ===========================================================================
// Tenant isolation + tenant derived at the boundary
// ===========================================================================

describe('S17 · tenant isolation at the command boundary', () => {
  it('a command claiming a tenant different from the resolved principal is rejected', async () => {
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-x', lines: prLines }, tenantId: 'tenant-EVIL', idem: 'create-x' }));
    expect(c.ok).toBe(false);
    expect(c.error).toBe('CROSS_TENANT_CLAIM');
  });

  it('an unresolved principal scope denies (deny-by-default)', async () => {
    scope = null;
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-nul', lines: prLines }, idem: 'create-nul' }));
    expect(c.ok).toBe(false);
    expect(c.error).toBe('UNRESOLVED_TENANT');
  });

  it('Tenant A PR converts to a Tenant A PO; Tenant B cannot see or convert it', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const prId = await createSubmitApprove('iso');
    // switch principal to B: the same PR id is invisible → convert refused
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const conv = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-iso-b' }));
    expect(conv.ok).toBe(false); // A's PR is not in B's scope
    // B sees none of A's domain events
    expect(events.list('tenant-B')).toHaveLength(0);
    expect(events.list('tenant-A').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AI-governance compatibility + event→workflow compatibility
// ===========================================================================

describe('S17 · AI + workflow compatibility', () => {
  it('a test-only AI tool adapter reaches the domain only through the governed command seam', async () => {
    // The adapter models: AI Agent → Tool Request → Policy Gateway → Domain Command.
    // It has NO store handle — its ONLY capability is to dispatch a command, which
    // is authorized/validated/audited exactly like any other client.
    const aiToolAdapter = async (tool: { name: string; args: Record<string, unknown> }): Promise<CommandResult> => {
      if (tool.name !== 'create_purchase_request') throw new Error('unsupported tool');
      return dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: String(tool.args.requestNumber), lines: prLines }, idem: `ai-${tool.args.requestNumber}` }));
    };
    const result = await aiToolAdapter({ name: 'create_purchase_request', args: { requestNumber: 'PR-ai' } });
    expect(result.ok).toBe(true);
    expect(result.event?.type).toBe('PurchaseRequestCreated');
    // The adapter never had DB authority — it produced a governed event, not a raw write.
    expect(audit.some((a) => a.action === `module.${PURCHASE_REQUESTS_MODULE_ID}.created`)).toBe(true);
  });

  it('PurchaseRequestSubmitted is available for a workflow/policy consumer to evaluate approval', async () => {
    const c = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-wf', lines: prLines }, idem: 'create-wf' }));
    const prId = String(c.data!.id);
    await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'submit-wf' }));
    // A consumer (a future workflow engine) reads the event to decide whether
    // approval is required. The safe default is "required" — no auto-approval
    // threshold is invented here (that would be §17 undefined policy).
    const submitted = events.ofType('tenant-A', 'PurchaseRequestSubmitted');
    expect(submitted).toHaveLength(1);
    const approvalRequired = (e: { type: string }): boolean => e.type === 'PurchaseRequestSubmitted';
    expect(approvalRequired(submitted[0])).toBe(true);
  });
});
