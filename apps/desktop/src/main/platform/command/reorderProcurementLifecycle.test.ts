/**
 * ERP Session 90 — the S89 reorder-created draft Purchase Request continues through the EXISTING
 * governed procurement lifecycle, reusing the EXISTING commands (no new approval engine, no second
 * workflow, no bypass):
 *
 *   S89 draft PR → SubmitPurchaseRequest → ApprovePurchaseRequest → ConvertPurchaseRequestToPO → PO
 *
 * The DEFINED procurement approval policy is exactly "a PR requires human approval before it becomes
 * a PO" (deny-by-default; NO threshold/hierarchy/SoD — undefined policy, absent by design; see
 * DECISION-MEMO-S90 and workflowRuntime). Every consequential transition runs through the durable
 * command journal. Reorder automation stops at the operator-created draft PR; each downstream step is
 * a separate explicit governed action here.
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
import { createProductModule } from '../../enterprise/modules/inventory/productModule';
import { createStockMovementModule } from '../../enterprise/modules/inventory/stockMovementModule';
import { createLedgerAccountModule } from '../../enterprise/modules/finance/ledgerAccountModule';
import { createJournalEntryModule } from '../../enterprise/modules/finance/journalEntryModule';
import { createPurchaseRequestModule } from '../../enterprise/modules/procurement/purchaseRequestModule';
import { createPurchaseOrderModule } from '../../enterprise/modules/procurement/purchaseOrderModule';
import { createShippingModule } from '../../enterprise/modules/warehouse/shippingModule';
import { createReorderDecisionModule, REORDER_DECISION_MODULE_ID } from '../../enterprise/modules/inventory/reorderDecisionModule';
import { dispatchCommand, type CommandDispatchDeps } from './commandBus';
import { DurableCommandJournal } from './durableCommandJournal';
import type { DomainCommand, DomainCommandType } from './domainCommand';

const paths: string[] = [];
const tmp = (t: string): string => { const p = join(tmpdir(), `np-s90-${t}-${randomUUID()}.json`); paths.push(p); return p; };

let scope: TenantScope | null;
let registry: EnterpriseModuleRegistry;
let journal: DurableCommandJournal;
let authorized: EnterprisePermission[];
let ctx: EnterpriseModuleContext;
let handlers: ReturnType<typeof buildModuleHandlers>;

function makeCtx(deny?: EnterprisePermission): EnterpriseModuleContext {
  return {
    authorize: (p: EnterprisePermission) => { authorized.push(p); if (deny && p === deny) throw new Error(`denied: ${p}`); },
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
    createReorderDecisionModule(tmp('dec'), products.store, pr.store, po.store, shipping.store),
  ]) registry.register(m);
  registry.bindScope(() => scope);
  ctx = makeCtx();
  handlers = buildModuleHandlers(registry, ctx);
  journal = new DurableCommandJournal(tmp('journal'));
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
const prRecord = (id: string) => registry.get(PURCHASE_REQUESTS_MODULE_ID)!.store.get(id);

function deps(ctxOverride?: EnterpriseModuleContext): CommandDispatchDeps {
  return { registry, ctx: ctxOverride ?? ctx, resolveScope: () => scope, journal };
}
let seq = 0;
function cmd(type: DomainCommandType, opts: { target?: string; payload?: Record<string, unknown>; idem?: string; tenantId?: string } = {}): DomainCommand {
  return {
    commandId: `cmd_${(seq += 1)}`,
    type,
    ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
    actor: 'operator@np.dev',
    ...(opts.target ? { target: { id: opts.target } } : {}),
    payload: opts.payload ?? {},
    correlationId: 'corr_s90',
    idempotencyKey: opts.idem ?? `${type}_${seq}`,
    timestamp: '2026-09-01T12:00:00.000Z',
    source: 'test',
  };
}

/** Seed a below-reorder product + S86 report, then create the S89 reorder DRAFT PR through its command. */
async function reorderDraftPr(): Promise<{ prId: string; requestNumber: string }> {
  await createIn(PRODUCTS_MODULE_ID, { sku: 'SKU-1', name: 'Widget', purchaseCost: 4, reorderLevel: 20, safetyStock: 10, maximumStock: 50 });
  const rep = await createIn(REORDER_DECISION_MODULE_ID, { asOfDate: '2026-07-31' });
  const res = await dispatchCommand(cmd('CreatePurchaseRequestFromReorderRecommendation', { target: rep.record!.id, payload: { sku: 'SKU-1' }, idem: 'reorder-exec:seed' }), deps());
  expect(res.ok).toBe(true);
  const prId = String(res.data!.id);
  const requestNumber = String(res.data!.requestNumber);
  expect(requestNumber).toMatch(/^PR-REORDER-/); // reorder-originated + identifiable
  expect(String(prRecord(prId)!.fields.status)).toBe('draft'); // automation stops at the draft
  return { prId, requestNumber };
}
const poList = () => listIn(PURCHASE_ORDERS_MODULE_ID).filter((r) => r.status !== 'deleted');
const journalCount = () => listIn(JOURNAL_ENTRIES_MODULE_ID).length;

// ─────────────────────────── HAPPY PATH ───────────────────────────
describe('S90 lifecycle — reorder draft PR → submit → approve → convert → PO (existing governed commands)', () => {
  it('walks the full governed lifecycle; the PO carries the reorder lineage', async () => {
    const { prId, requestNumber } = await reorderDraftPr();
    expect((await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's1' }), deps())).ok).toBe(true);
    expect(String(prRecord(prId)!.fields.status)).toBe('pending');
    expect((await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a1' }), deps())).ok).toBe(true);
    expect(String(prRecord(prId)!.fields.status)).toBe('approved');
    const conv = await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c1' }), deps());
    expect(conv.ok).toBe(true);
    // exactly one PO, approval enforced, lineage preserved to the PO
    expect(poList()).toHaveLength(1);
    const po = poList()[0]!;
    expect(String(po.fields.poNumber)).toBe(`PO-${requestNumber}`); // poNumber embeds PR-REORDER-…
    expect(String(po.fields.sourceRequest)).toBe(prId); // sourceRequest → the reorder PR
    expect(String(po.fields.status)).toBe('draft'); // PO created as draft — not auto-approved/sent
    expect(String(prRecord(prId)!.fields.status)).toBe('ordered');
    expect(String(prRecord(prId)!.fields.convertedOrder)).toBe(po.id);
    // authority: each consequential step required procurement:manage (conversion also asserts orders write)
    expect(authorized).toContain('procurement:manage');
  });

  it('automation stops at the draft — a freshly reorder-created PR has NOT been submitted/approved/converted', async () => {
    const { prId } = await reorderDraftPr();
    expect(String(prRecord(prId)!.fields.status)).toBe('draft');
    expect(poList()).toHaveLength(0);
  });
});

// ─────────────────────────── IDEMPOTENCY / REPLAY ───────────────────────────
describe('S90 idempotency — each transition is safe to repeat; one PO per approved PR', () => {
  it('duplicate submit/approve/convert (same key) replay; a fresh-key convert is refused after conversion', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    const s2 = await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    expect(s2.replayed).toBe(true);
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps());
    const a2 = await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps());
    expect(a2.replayed).toBe(true);
    await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c' }), deps());
    expect(poList()).toHaveLength(1);
    const cReplay = await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c' }), deps());
    expect(cReplay.replayed).toBe(true);
    // a DISTINCT-key re-convert is refused by the already-converted guard (no second PO)
    const cAgain = await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c2' }), deps());
    expect(cAgain.ok).toBe(false);
    expect(poList()).toHaveLength(1);
  });

  it('replay across a durable-journal RESTART creates no duplicate PO', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps());
    const file = tmp('journal-restart');
    const j1 = new DurableCommandJournal(file);
    await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'cc' }), { registry, ctx, resolveScope: () => scope, journal: j1 });
    expect(poList()).toHaveLength(1);
    const j2 = new DurableCommandJournal(file); // process restart
    const again = await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'cc' }), { registry, ctx, resolveScope: () => scope, journal: j2 });
    expect(again.replayed).toBe(true);
    expect(poList()).toHaveLength(1);
  });
});

// ─────────────────────────── STATUS MACHINE NEGATIVES ───────────────────────────
describe('S90 status machine — illegal transitions refused', () => {
  it('an UNAPPROVED PR cannot convert to a PO (approval gate)', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps()); // pending, not approved
    const conv = await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c' }), deps());
    expect(conv.ok).toBe(false);
    expect(poList()).toHaveLength(0);
  });

  it('an already-ORDERED PR cannot be approved again', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps());
    await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c' }), deps());
    const a = await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a2' }), deps());
    expect(a.ok).toBe(false);
  });

  it('the approved/ordered boundary cannot be hand-set through the edit door (bypass refused)', async () => {
    const { prId } = await reorderDraftPr();
    const edit = (await handler(IpcChannel.EnterpriseModuleUpdate)({ moduleId: PURCHASE_REQUESTS_MODULE_ID, id: prId, fields: { status: 'approved' } })) as { ok: boolean };
    expect(edit.ok).toBe(false); // approval happens only through the governed Approve action
    expect(String(prRecord(prId)!.fields.status)).toBe('draft');
  });
});

// ─────────────────────────── SECURITY / TENANT ───────────────────────────
describe('S90 security — approval authority + tenancy fail closed', () => {
  it('approve requires procurement:manage — denied actor cannot approve', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    const denied = await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps(makeCtx('procurement:manage')));
    expect(denied.ok).toBe(false);
    expect(denied.error).toBe('UNAUTHORIZED');
    expect(String(prRecord(prId)!.fields.status)).toBe('pending');
  });

  it('NO_TENANT and forged/cross-tenant approvals fail closed', async () => {
    const { prId } = await reorderDraftPr();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    scope = null;
    expect((await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps())).error).toBe('UNRESOLVED_TENANT');
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect((await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a2', tenantId: 'tenant-EVIL' }), deps())).error).toBe('CROSS_TENANT_CLAIM');
    // a foreign-tenant actor cannot see the PR (tenant-scoped store) → refused, still pending
    scope = { tenantId: 'tenant-B', workspaceId: 'ws-B' };
    const foreign = await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a3' }), deps());
    expect(foreign.ok).toBe(false);
    scope = { tenantId: 'tenant-A', workspaceId: 'ws-A' };
    expect(String(prRecord(prId)!.fields.status)).toBe('pending');
  });
});

// ─────────────────────────── SIDE EFFECTS ───────────────────────────
describe('S90 side effects — approval + conversion touch only procurement documents', () => {
  it('conversion creates exactly one PO and posts NO GL / moves NO inventory', async () => {
    const { prId } = await reorderDraftPr();
    const productsBefore = JSON.stringify(listIn(PRODUCTS_MODULE_ID));
    const journalBefore = journalCount();
    await dispatchCommand(cmd('SubmitPurchaseRequest', { target: prId, idem: 's' }), deps());
    await dispatchCommand(cmd('ApprovePurchaseRequest', { target: prId, idem: 'a' }), deps());
    await dispatchCommand(cmd('ConvertPurchaseRequestToPO', { target: prId, idem: 'c' }), deps());
    expect(poList()).toHaveLength(1);
    expect(JSON.stringify(listIn(PRODUCTS_MODULE_ID))).toBe(productsBefore); // no inventory mutation
    expect(journalCount()).toBe(journalBefore); // no GL (a draft PO is a document, not an economic event)
  });
});
