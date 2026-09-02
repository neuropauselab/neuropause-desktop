/**
 * ERP Session 18 — durable transaction seam + event outbox (Track B) + governed
 * PO-stage supplier assignment (Track A).
 *
 * Proves the platform upgrade: command idempotency + domain event + outbox are
 * DURABLE (survive restart) and committed ATOMICALLY (one file write); the outbox
 * is retryable with idempotent delivery; events are immutable; tenancy is
 * enforced on every durable record; and the AI/Electron-independence guarantees
 * hold. The whole thing runs on the real file-backed durable store, not mocks.
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
  SUPPLIERS_MODULE_ID,
  type EnterpriseEntity,
  type EnterprisePermission,
  type PlatformEventInput,
  type TenantScope,
} from '@neuropause/shared';
import { EnterpriseModuleRegistry, buildModuleHandlers, type EnterpriseModuleContext } from '../../enterprise/framework/moduleRegistry';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { resolveTenantScope, runAsPrincipal, tenantPrincipal } from '../../tenancy/backgroundPrincipal';
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createGoodsReceiptModule } from '../../enterprise/modules/procurement/goodsReceiptModule';
import { createVendorBillModule } from '../../enterprise/modules/finance/vendorBillModule';
import { createSupplierModule } from '../../enterprise/modules/procurement/supplierModule';
import { dispatchCommand } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import { DurableJsonStore } from '../persistence/durableJsonStore';
import { dispatchOutbox } from './outboxDispatcher';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const paths: string[] = [];
const tmp = (tag: string): string => {
  const p = join(tmpdir(), `np-s18-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let ctx: EnterpriseModuleContext;
let journal: DurableCommandJournal;
let audit: { action: string }[];

function makeCtx(denyPerm?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { if (denyPerm && p === denyPerm) throw new Error(`denied ${p}`); },
    audit: (e) => audit.push(e),
    publish: (_i: PlatformEventInput) => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'operator@np.dev',
    now: () => '2026-09-01T12:00:00.000Z',
  };
}

beforeEach(() => {
  scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
  audit = [];
  registry = new EnterpriseModuleRegistry();
  const accounts = createLedgerAccountModule(tmp('acct'));
  const pos = createPurchaseOrderModule(tmp('po'));
  for (const m of [
    createProductModule(tmp('prod')),
    createStockMovementModule(tmp('mv')),
    accounts,
    createJournalEntryModule(tmp('jrnl'), accounts.store),
    createPurchaseRequestModule(tmp('pr')),
    pos,
    createGoodsReceiptModule(tmp('gr')),
    createVendorBillModule(tmp('bill'), pos.store),
    createSupplierModule(tmp('supp')),
  ]) registry.register(m);
  registry.bindScope(() => resolveTenantScope(() => scope)); // principal-aware (like Session 15)
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(tmp('journal'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await journal.destroy().catch(() => undefined);
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

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

let cmdSeq = 0;
function mkCmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(cmdSeq += 1)}`,
    type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: `corr_${type}`,
    idempotencyKey: opts.idem ?? `idem_${type}_${cmdSeq}`,
    timestamp: '2026-09-01T12:00:00.000Z',
    source: 'test',
  };
}
const dispatch = (cmd: DomainCommand, ctxOverride?: EnterpriseModuleContext) =>
  dispatchCommand(cmd, { registry, ctx: ctxOverride ?? ctx, resolveScope: () => resolveTenantScope(() => scope), journal });

const prLines = JSON.stringify([{ sku: 'SKU-A', quantity: 10, unitPrice: 5 }]);
const prCount = () => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list().length;
const poCount = () => registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.list().length;
const journalEntries = () => registry.get(JOURNAL_ENTRIES_MODULE_ID)!.store.list().length;

async function createPR(idem = 'c1', payload: Record<string, unknown> = { requestNumber: 'PR-1', lines: prLines }): Promise<string> {
  const r = await dispatch(mkCmd('CreatePurchaseRequest', { payload, idem }));
  return String(r.data!.id);
}

// ===========================================================================
// COMMAND → DURABLE EVENT chain
// ===========================================================================

describe('S18 · command → durable event + outbox', () => {
  it('the full PR lifecycle produces four immutable, correlated, tenant-scoped durable events + outbox', async () => {
    const prId = await createPR('life');
    expect((await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'sub-life' }))).ok).toBe(true);
    expect((await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: 'app-life' }))).ok).toBe(true);
    expect((await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'con-life' }))).ok).toBe(true);

    const events = journal.events('tenant-A');
    expect(events.map((e) => e.type)).toEqual(['PurchaseRequestCreated', 'PurchaseRequestSubmitted', 'PurchaseRequestApproved', 'PurchaseRequestConvertedToPO']);
    const conv = events[3];
    expect(conv.aggregateId).toBe(prId);
    expect(conv.aggregateType).toBe('PurchaseRequest');
    expect(conv.correlationId).toBe('corr_ConvertPurchaseRequestToPO');
    expect(conv.causationId).toBeTruthy();
    expect(conv.schemaVersion).toBe(1);
    expect(Object.isFrozen(conv)).toBe(true);
    // Every committed record carries a PENDING outbox entry.
    expect(journal.records('tenant-A')).toHaveLength(4);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(4);
  });
});

// ===========================================================================
// ATOMICITY  (cases A–E)
// ===========================================================================

describe('S18 · atomicity of state + event + outbox', () => {
  it('A · success → state + event + outbox all exist', async () => {
    const prId = await createPR('okA');
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.get(prId)).toBeTruthy(); // state
    expect(journal.ofType('tenant-A', 'PurchaseRequestCreated')).toHaveLength(1); // event
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1); // outbox
  });

  it('B · state mutation fails → no committed event, no committed outbox', async () => {
    const r = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { lines: prLines }, idem: 'badB' })); // no requestNumber
    expect(r.ok).toBe(false);
    expect(prCount()).toBe(0);
    expect(journal.records('tenant-A')).toHaveLength(0); // nothing durable
  });

  it('C · durable commit fails → state is compensated (rolled back); no event, no outbox', async () => {
    // ERP Session 40 — intent-first recovery adds an intent `put` BEFORE the journal commit, so a
    // blanket `mockRejectedValueOnce` would now fire on the intent reserve. Target the durable COMMIT
    // this test is named for: a CommittedCommand carries an `event`; the intent record does not.
    const origPut = DurableJsonStore.prototype.put;
    const spy = vi
      .spyOn(DurableJsonStore.prototype, 'put')
      .mockImplementation(async function (this: DurableJsonStore<{ id: string }>, rec: { id: string }) {
        if (rec && typeof rec === 'object' && 'event' in rec) throw new Error('disk full');
        return origPut.call(this, rec);
      } as typeof DurableJsonStore.prototype.put);
    const r = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-C', lines: prLines }, idem: 'failC' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('COMMIT_FAILED');
    spy.mockRestore();
    expect(journal.records('tenant-A')).toHaveLength(0); // no durable event/outbox
    // the created PR was compensated (soft-deleted) → invisible
    expect(registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.list().filter((r2) => r2.status !== 'deleted')).toHaveLength(0);
  });

  it('D · a failure before commit leaves no partial committed transaction', async () => {
    // Authorization fails inside the transaction → execute returns not-ok → no commit.
    const r = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-D', lines: prLines }, idem: 'authD' }), makeCtx('procurement:manage'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('UNAUTHORIZED'); // the command-boundary verdict (fail-closed)
    expect(journal.records('tenant-A')).toHaveLength(0);
    expect(prCount()).toBe(0);
  });

  it('E · a committed outbox survives a process restart and remains deliverable', async () => {
    await createPR('durE');
    await journal.reload(); // simulate a fresh process reading the durable file
    const pending = journal.pendingOutbox('tenant-A');
    expect(pending).toHaveLength(1); // durable outbox survived
    const delivered: string[] = [];
    const result = await dispatchOutbox(journal, (e) => { delivered.push(e.type); }, { tenantId: 'tenant-A' });
    expect(result.delivered).toBe(1);
    expect(delivered).toEqual(['PurchaseRequestCreated']);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(0); // now DELIVERED
  });
});

// ===========================================================================
// DURABLE IDEMPOTENCY (incl. across restart)
// ===========================================================================

describe('S18 · durable idempotency', () => {
  it('same tenant + key → one economic effect, replayed thereafter and across restart', async () => {
    const first = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-i', lines: prLines }, idem: 'once' }));
    await journal.reload(); // restart
    const replay = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-i', lines: prLines }, idem: 'once' }));
    expect(replay.replayed).toBe(true);
    expect(replay.data!.id).toBe(first.data!.id);
    expect(prCount()).toBe(1);
    expect(journal.records('tenant-A')).toHaveLength(1);
  });

  it('different tenant + same key → independent execution (no global key)', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const a = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-A', lines: prLines }, idem: 'shared' }));
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const b = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-B', lines: prLines }, idem: 'shared' }));
    expect(b.replayed).toBeFalsy();
    expect(a.data!.id).not.toBe(b.data!.id);
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.records('tenant-B')).toHaveLength(1);
  });
});

// ===========================================================================
// CONCURRENCY
// ===========================================================================

describe('S18 · concurrency', () => {
  it('100 concurrent identical commands → one effect, one record, one event, one outbox', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-hc', lines: prLines }, idem: 'hc' }))),
    );
    const ids = new Set(results.map((r) => String(r.data?.id)));
    expect(ids.size).toBe(1); // one canonical PR
    expect(prCount()).toBe(1);
    expect(journal.records('tenant-A')).toHaveLength(1);
    expect(journal.ofType('tenant-A', 'PurchaseRequestCreated')).toHaveLength(1);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1);
  });

  it('100 concurrent commands across 10 tenants → each tenant isolated with exactly one record', async () => {
    const tenants = Array.from({ length: 10 }, (_, i) => `t-${i}`);
    const asTenant = <T>(t: string, fn: () => T): T => runAsPrincipal(tenantPrincipal({ jobId: 's18', scope: { tenantId: t, workspaceId: '' } })!, fn);
    await Promise.all(
      tenants.flatMap((t) =>
        Array.from({ length: 10 }, () => asTenant(t, () => dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: `PR-${t}`, lines: prLines }, idem: `k-${t}` })))),
      ),
    );
    for (const t of tenants) {
      expect(journal.records(t)).toHaveLength(1); // one per tenant
      expect(journal.events(t).map((e) => e.tenantId)).toEqual([t]); // only its own
    }
  });
});

// ===========================================================================
// OUTBOX DELIVERY (retryable + idempotent)
// ===========================================================================

describe('S18 · outbox delivery', () => {
  it('delivery is retryable and idempotent (re-dispatch never re-delivers a DELIVERED event)', async () => {
    await createPR('d1');
    let calls = 0;
    let failNext = true;
    const consumer = () => { calls += 1; if (failNext) { failNext = false; throw new Error('downstream down'); } };
    // first attempt fails → RETRYABLE
    let res = await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(res.retryable).toBe(1);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1); // still awaiting
    // retry → delivered
    res = await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(res.delivered).toBe(1);
    // re-dispatch → idempotent, nothing re-delivered
    const again = await dispatchOutbox(journal, consumer, { tenantId: 'tenant-A' });
    expect(again.attempted).toBe(0);
    expect(calls).toBe(2); // one failed attempt + one success; never delivered twice
  });
});

// ===========================================================================
// TENANT ISOLATION on the durable records
// ===========================================================================

describe('S18 · tenant isolation of durable records', () => {
  it('tenant B cannot read A’s events, reuse A’s result, or deliver A’s outbox', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    await createPR('isoA', { requestNumber: 'PR-isoA', lines: prLines });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    expect(journal.events('tenant-B')).toHaveLength(0); // B sees no events
    expect(journal.records('tenant-B')).toHaveLength(0);
    // B dispatching its outbox drains nothing of A's
    const res = await dispatchOutbox(journal, () => undefined, { tenantId: 'tenant-B' });
    expect(res.attempted).toBe(0);
    expect(journal.pendingOutbox('tenant-A')).toHaveLength(1); // A's still pending
  });

  it('a command claiming a different tenant than the principal is rejected', async () => {
    const r = await dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: 'PR-x', lines: prLines }, tenantId: 'tenant-EVIL', idem: 'x' }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('CROSS_TENANT_CLAIM');
  });
});

// ===========================================================================
// EVENT IMMUTABILITY + AUDIT SEPARATION + NO GL
// ===========================================================================

describe('S18 · event immutability, audit separation, accounting isolation', () => {
  it('a committed domain event cannot be mutated by a consumer', async () => {
    await createPR('imm');
    const [event] = journal.events('tenant-A');
    expect(() => { (event as { type: string }).type = 'Hacked'; }).toThrow();
    expect(journal.events('tenant-A')[0].type).toBe('PurchaseRequestCreated');
  });

  it('audit (the framework trail) is produced and is separate from the domain event', async () => {
    await createPR('aud');
    expect(audit.some((a) => a.action === `module.${PURCHASE_REQUESTS_MODULE_ID}.created`)).toBe(true); // audit
    expect(journal.ofType('tenant-A', 'PurchaseRequestCreated')).toHaveLength(1); // domain event — distinct mechanism
  });

  it('PR + sourcing create NO GL entries', async () => {
    const prId = await createPR('nogl');
    await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'sub-nogl' }));
    await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: 'app-nogl' }));
    await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'con-nogl' }));
    expect(journalEntries()).toBe(0);
  });
});

// ===========================================================================
// AI + ELECTRON INDEPENDENCE
// ===========================================================================

describe('S18 · AI + client independence', () => {
  it('a test-only AI tool reaches ERP only through the governed command bus (no DB handle)', async () => {
    const aiTool = async (args: { requestNumber: string }) =>
      dispatch(mkCmd('CreatePurchaseRequest', { payload: { requestNumber: args.requestNumber, lines: prLines }, idem: `ai-${args.requestNumber}` }));
    const r = await aiTool({ requestNumber: 'PR-ai' });
    expect(r.ok).toBe(true);
    expect(r.event?.type).toBe('PurchaseRequestCreated'); // went through the governed durable seam
    expect(journal.records('tenant-A')).toHaveLength(1);
  });

  it('the command + persistence layers import no Electron / React / IPC runtime', async () => {
    // Exactly the reusable seam this session builds — platform/command (the
    // command bus + durable journal + outbox) and platform/persistence (the
    // durable store). Other platform/* subsystems are Electron-coupled by design
    // and are out of scope for the client-independence guarantee.
    const roots = [__dirname, join(__dirname, '../persistence')]; // command + persistence
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
      expect(src, `${f} must not import ipcMain`).not.toMatch(/ipcMain|BrowserWindow/);
    }
  });
});

// ===========================================================================
// TRACK A — governed PO-stage supplier assignment
// ===========================================================================

describe('S18 · governed supplier assignment (PO stage)', () => {
  async function poWithSupplier(status: string): Promise<{ poId: string; supplierId: string }> {
    const s = await createIn(SUPPLIERS_MODULE_ID, { name: 'Acme', status });
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-s', currency: 'USD', supplierRef: s.record!.id, lines: prLines });
    return { poId: po.record!.id, supplierId: s.record!.id };
  }

  it('an active supplier is assigned to the PO (governed, validated against the master)', async () => {
    const { poId } = await poWithSupplier('active');
    expect((await act(PURCHASE_ORDERS_MODULE_ID, poId, 'assignSupplier')).ok).toBe(true);
    expect(String(registry.get(PURCHASE_ORDERS_MODULE_ID)!.store.get(poId)!.fields.supplier)).toBe('Acme');
  });

  it('a suspended supplier cannot be assigned', async () => {
    const { poId } = await poWithSupplier('suspended');
    const r = await act(PURCHASE_ORDERS_MODULE_ID, poId, 'assignSupplier');
    expect(r.ok).toBe(false);
    expect(String(r.message)).toContain('suspended');
  });

  it('duplicate PR→PO conversion is refused (the convertedOrder guard, isolated)', async () => {
    const prId = await createPR('dupconv', { requestNumber: 'PR-dupconv', lines: prLines });
    await dispatch(mkCmd('SubmitPurchaseRequest', { target: prId, idem: 'sub-dupconv' }));
    await dispatch(mkCmd('ApprovePurchaseRequest', { target: prId, idem: 'app-dupconv' }));
    expect((await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-dc-1' }))).ok).toBe(true);
    // Force status back to approved so ONLY the convertedOrder guard can block the re-conversion.
    await updateIn(PURCHASE_REQUESTS_MODULE_ID, prId, { status: 'approved' });
    const second = await dispatch(mkCmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'conv-dc-2' }));
    expect(second.ok).toBe(false);
    expect(poCount()).toBe(1);
  });

  it('a supplier from another tenant cannot be assigned (invisible in scope)', async () => {
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    const s = await createIn(SUPPLIERS_MODULE_ID, { name: 'AcmeA', status: 'active' });
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const po = await createIn(PURCHASE_ORDERS_MODULE_ID, { poNumber: 'PO-b', currency: 'USD', supplierRef: s.record!.id, lines: prLines });
    const r = await act(PURCHASE_ORDERS_MODULE_ID, po.record!.id, 'assignSupplier');
    expect(r.ok).toBe(false); // A's supplier is invisible in B
  });
});
