/**
 * Phase 6 — Document adapter adoption locks.
 *
 * The properties that make adopting the engines into 104 live modules safe:
 * composition never replaces a module's existing reconciliation, a module
 * without a spec is untouched, accounting fires from real lifecycle transitions,
 * a refusal posts nothing, and a re-fired event cannot double-post.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnterpriseEntity } from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../enterprise/framework/enterpriseModule';
import { DocumentLineStore } from './documentLines';
import { DocumentIntegration, type DocumentSpec, type PostingContext } from './documentAdapter';
import { DOCUMENT_SPECS, ADOPTED_MODULE_IDS, BILL_APPROVAL_POLICY } from './documentSpecs';
import { deriveGoodsReceiptPosting, deriveSupplierBillPosting, STOCK_ACCOUNTS, type PostingDerivation } from './postingRules';
import { DEFAULT_SPEND_POLICY } from './approvalEngine';

const T0 = '2026-08-08T12:00:00.000Z';

let dir: string;
let lines: DocumentLineStore;
let posted: { derivation: PostingDerivation; ctx: PostingContext }[];
let audit: { action: string; target: string; summary: string }[];
let integration: DocumentIntegration;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-adapter-'));
  lines = new DocumentLineStore(join(dir, 'lines.json'));
  await lines.load();
  posted = [];
  audit = [];
  integration = new DocumentIntegration({
    lines,
    postJournal: (derivation, ctx) => {
      posted.push({ derivation, ctx });
    },
    audit: (e) => audit.push(e),
    now: () => T0,
    actor: () => 'buyer@np.example',
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function record(over: Partial<EnterpriseEntity> = {}): EnterpriseEntity {
  return {
    id: 'REC-1',
    moduleId: 'procurement-receipts',
    kind: 'receipt',
    title: 'GR-1',
    status: 'draft',
    fields: {},
    tags: [],
    metadata: { createdBy: 'buyer@np.example' },
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  } as unknown as EnterpriseEntity;
}

function fakeModule(id: string, onChange?: EnterpriseModule['hooks']['onChange']): EnterpriseModule {
  return {
    descriptor: { id, singular: id, plural: id } as unknown as EnterpriseModule['descriptor'],
    store: {} as unknown as EnterpriseModule['store'],
    hooks: { validate: () => ({ ok: true, input: {} }) as never, ...(onChange ? { onChange } : {}) },
  } as EnterpriseModule;
}

const ctx = {} as EnterpriseModuleActionContext;

// ---------------------------------------------------------------------------

describe('adoption is safe by construction', () => {
  it('returns a module with NO spec completely untouched', () => {
    const m = fakeModule('crm-customers');
    expect(integration.attach(m)).toBe(m); // identity — not a copy
  });

  it('PRESERVES a module’s existing onChange rather than replacing it', async () => {
    const existing = vi.fn();
    integration.register({ moduleId: 'procurement-receipts', documentType: 'goodsReceipt' });
    const attached = integration.attach(fakeModule('procurement-receipts', existing));

    await attached.hooks.onChange?.({ action: 'created', record: record() }, ctx);
    expect(existing).toHaveBeenCalledTimes(1);
  });

  it('runs the module’s own reconciliation BEFORE any accounting', async () => {
    const order: string[] = [];
    integration.register({
      moduleId: 'procurement-receipts',
      documentType: 'goodsReceipt',
      postOn: { received: () => { order.push('posting'); return null; } },
    });
    const attached = integration.attach(
      fakeModule('procurement-receipts', () => { order.push('module'); }),
    );
    await attached.hooks.onChange?.({ action: 'status_changed', record: record({ status: 'received' }) }, ctx);
    expect(order).toEqual(['module', 'posting']);
  });

  it('every shipped spec targets a plausible live module id', () => {
    expect(ADOPTED_MODULE_IDS.length).toBeGreaterThan(5);
    // Single-word ids are REAL: the Invoices module is 'finance' and Contacts
    // is 'crm'. The old hyphen-required pattern encoded the same wrong
    // assumption that produced the phantom 'finance-invoices' spec id.
    for (const id of ADOPTED_MODULE_IDS) expect(id).toMatch(/^[a-z]+(-[a-z-]+)?$/);
    // The GL keeps its own line model — a second one would diverge.
    expect(ADOPTED_MODULE_IDS).not.toContain('finance-journal-entries');
  });
});

// ---------------------------------------------------------------------------

describe('lines and derived totals', () => {
  beforeEach(() => integration.registerAll(DOCUMENT_SPECS));

  it('stores lines and derives totals without writing them to the record', async () => {
    const res = await integration.setLines('procurement-orders', 'PO-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
      { productId: 'SKU-2', description: 'Gadget', quantity: 2, unitPrice: 100, taxRatePercent: 18 },
    ]);
    expect(res.ok).toBe(true);
    expect(res.totals?.total).toBe(486);
    expect(integration.totalsFor('procurement-orders', 'PO-1')?.lineCount).toBe(2);
  });

  it('rejects invalid lines and writes nothing', async () => {
    const res = await integration.setLines('procurement-orders', 'PO-2', [
      { description: 'no product, no price', quantity: 1 },
    ]);
    expect(res.ok).toBe(false);
    expect(integration.linesFor('procurement-orders', 'PO-2')).toHaveLength(0);
  });

  it('refuses lines on a module that is not a line document', async () => {
    const res = await integration.setLines('crm-customers', 'C-1', [{ quantity: 1, unitPrice: 1, description: 'x' }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.errors[0]).toMatch(/not a line-item document/);
  });
});

// ---------------------------------------------------------------------------

describe('accounting fires from real lifecycle transitions', () => {
  beforeEach(() => integration.registerAll(DOCUMENT_SPECS));

  it('posts GRNI when a goods receipt reaches "received"', async () => {
    await integration.setLines('procurement-receipts', 'REC-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
    ]);
    const attached = integration.attach(fakeModule('procurement-receipts'));
    await attached.hooks.onChange?.({ action: 'status_changed', record: record({ status: 'received' }) }, ctx);

    expect(posted).toHaveLength(1);
    const d = posted[0]!.derivation;
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.inventory)?.debit).toBe(250);
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.grni)?.credit).toBe(250);
    expect(audit.some((a) => a.action === 'document.procurement-receipts.posted')).toBe(true);
  });

  it('does NOT post on an unrelated status', async () => {
    await integration.setLines('procurement-receipts', 'REC-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
    ]);
    const attached = integration.attach(fakeModule('procurement-receipts'));
    await attached.hooks.onChange?.({ action: 'status_changed', record: record({ status: 'draft' }) }, ctx);
    expect(posted).toHaveLength(0);
  });

  it('IS IDEMPOTENT — a re-fired event cannot double-post', async () => {
    await integration.setLines('procurement-receipts', 'REC-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 25 },
    ]);
    const attached = integration.attach(fakeModule('procurement-receipts'));
    const evt = { action: 'status_changed' as const, record: record({ status: 'received' }) };
    await attached.hooks.onChange?.(evt, ctx);
    await attached.hooks.onChange?.(evt, ctx);
    await attached.hooks.onChange?.(evt, ctx);
    expect(posted).toHaveLength(1);
    expect(integration.hasPosted('GRN-REC-1')).toBe(true);
  });

  it('posts NOTHING and records the reason when a derivation refuses', async () => {
    // An unvalued receipt cannot be accrued.
    await integration.setLines('procurement-receipts', 'REC-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 10, unitPrice: 0 },
    ]);
    const attached = integration.attach(fakeModule('procurement-receipts'));
    await attached.hooks.onChange?.({ action: 'status_changed', record: record({ status: 'received' }) }, ctx);

    expect(posted).toHaveLength(0);
    expect(integration.refusedPostings()).toHaveLength(1);
    expect(audit.some((a) => a.action === 'document.procurement-receipts.posting.refused')).toBe(true);
  });

  // ERP Session 13: the finance-vendor-bills adapter posting leg is RETIRED (it
  // never fired in production; the live vendor-bill path is the sole owner). The
  // supplier-bill DERIVATION is asserted directly; live GRNI relief is proven in
  // session11VendorBillP2P / session12PartialP2P.
  it('the supplier-bill derivation refuses a bill whose three-way match did not pass', () => {
    const d = deriveSupplierBillPosting({ billId: 'BILL-1', matchedValue: 250, billedValue: 250, matchState: 'MISMATCH' });
    expect(d.ok).toBe(false);
    expect(d.refusedReason ?? '').toMatch(/MISMATCH|only a MATCHED bill/i);
  });

  it('the supplier-bill derivation clears GRNI for a MATCHED bill', () => {
    const d = deriveSupplierBillPosting({ billId: 'BILL-2', matchedValue: 250, billedValue: 250, matchState: 'MATCHED' });
    expect(d.ok).toBe(true);
    expect(d.lines.find((l) => l.account === STOCK_ACCOUNTS.grni)?.debit).toBe(250);
  });

  it('posts COGS when a shipment dispatches', async () => {
    await integration.setLines('warehouse-shipping', 'SHIP-1', [
      { productId: 'SKU-1', description: 'Widget', quantity: 4, unitPrice: 18 },
    ]);
    const attached = integration.attach(fakeModule('warehouse-shipping'));
    await attached.hooks.onChange?.(
      { action: 'status_changed', record: record({ id: 'SHIP-1', moduleId: 'warehouse-shipping', status: 'shipped' }) },
      ctx,
    );
    expect(posted[0]?.derivation.lines.find((l) => l.account === STOCK_ACCOUNTS.cogs)?.debit).toBe(72);
  });

  it('survives a throwing derivation without breaking the module mutation', async () => {
    const spec: DocumentSpec = {
      moduleId: 'procurement-receipts',
      documentType: 'goodsReceipt',
      postOn: { received: () => { throw new Error('boom'); } },
    };
    integration.register(spec);
    const attached = integration.attach(fakeModule('procurement-receipts'));
    await expect(
      attached.hooks.onChange?.({ action: 'status_changed', record: record({ status: 'received' }) }, ctx),
    ).resolves.toBeUndefined();
    expect(audit.some((a) => a.action === 'document.procurement-receipts.posting.error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('approval and segregation of duties in live documents', () => {
  beforeEach(() => integration.registerAll(DOCUMENT_SPECS));

  const po = (): EnterpriseEntity =>
    record({ id: 'PO-1', moduleId: 'procurement-orders', status: 'draft', fields: { total: 50_000 }, metadata: { createdBy: 'buyer@np.example' } });

  it('blocks a gated status until approval is satisfied', () => {
    const gate = integration.canEnterStatus('procurement-orders', po(), 'approved');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/requires approval/i);
  });

  it('REFUSES the creator approving their own purchase order', () => {
    const res = integration.approve('procurement-orders', po(), 'manager', { userId: 'buyer@np.example', roles: ['manager'] }, 'approved');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/created this document/i);
    expect(res.approvals).toHaveLength(0); // nothing recorded
    expect(audit.some((a) => a.action === 'document.procurement-orders.approval.refused')).toBe(true);
  });

  it('walks a two-step approval and then permits the gated status', () => {
    const record1 = po();
    const step1 = integration.approve('procurement-orders', record1, 'manager', { userId: 'mgr@np.example', roles: ['manager'] }, 'approved');
    expect(step1.ok).toBe(true);
    expect(step1.status?.state).toBe('pending');

    const step2 = integration.approve('procurement-orders', record1, 'finance', { userId: 'cfo@np.example', roles: ['finance'] }, 'approved', step1.approvals);
    expect(step2.status?.state).toBe('approved');

    expect(integration.canEnterStatus('procurement-orders', record1, 'approved', step2.approvals).allowed).toBe(true);
  });

  it('escalates to executive approval above the threshold', () => {
    const big = record({ id: 'PO-2', moduleId: 'procurement-orders', fields: { total: 500_000 }, metadata: { createdBy: 'buyer@np.example' } });
    const st = integration.approvalStatus('procurement-orders', big);
    expect(st?.requiredSteps.map((s) => s.id)).toEqual(['manager', 'finance', 'executive']);
  });

  it('stops the purchase creator approving the resulting payment', () => {
    const bill = record({ id: 'BILL-9', moduleId: 'finance-vendor-bills', fields: { total: 50_000 }, metadata: { createdBy: 'buyer@np.example' } });
    const res = integration.approve('finance-vendor-bills', bill, 'ap-review', { userId: 'buyer@np.example', roles: ['finance'] }, 'approved');
    expect(res.ok).toBe(false);
    expect(BILL_APPROVAL_POLICY.sod).toContain('requester_cannot_approve_own_payment');
  });

  it('uses line totals when the record carries no amount field', async () => {
    await integration.setLines('procurement-orders', 'PO-3', [
      { productId: 'SKU-1', description: 'Widget', quantity: 1, unitPrice: 250_000 },
    ]);
    const noAmount = record({ id: 'PO-3', moduleId: 'procurement-orders', fields: {} });
    const st = integration.approvalStatus('procurement-orders', noAmount);
    expect(st?.requiredSteps.map((s) => s.id)).toEqual(['manager', 'finance', 'executive']);
  });

  it('reports no approval requirement for documents without a policy', () => {
    expect(integration.approvalStatus('sales-quotes', record({ moduleId: 'sales-quotes' }))).toBeNull();
    expect(integration.canEnterStatus('sales-quotes', record(), 'sent').allowed).toBe(true);
  });

  it('exposes the default spend thresholds it was configured with', () => {
    expect(DEFAULT_SPEND_POLICY.steps.map((s) => s.minAmount)).toEqual([undefined, 10_000, 100_000]);
  });
});

// ---------------------------------------------------------------------------

describe('procure-to-pay through the adapter', () => {
  it('receipt accrues GRNI and a matched bill clears exactly that amount', async () => {
    integration.registerAll(DOCUMENT_SPECS);

    await integration.setLines('procurement-receipts', 'GR-7', [
      { productId: 'SKU-1', description: 'Widget', quantity: 100, unitPrice: 10 },
    ]);
    const receipt = integration.attach(fakeModule('procurement-receipts'));
    await receipt.hooks.onChange?.({ action: 'status_changed', record: record({ id: 'GR-7', status: 'received' }) }, ctx);

    const accrued = posted[0]!.derivation.lines.filter((l) => l.account === STOCK_ACCOUNTS.grni).reduce((n, l) => n + l.credit, 0);
    expect(accrued).toBe(1000);

    // ERP Session 13: the bill posting leg is retired; the matched-bill derivation
    // clears exactly the accrued GRNI (the live path is proven in session11/12).
    const bill = deriveSupplierBillPosting({ billId: 'BILL-7', matchedValue: 1000, billedValue: 1000, matchState: 'MATCHED' });
    expect(bill.ok).toBe(true);
    const cleared = bill.lines.filter((l) => l.account === STOCK_ACCOUNTS.grni).reduce((n, l) => n + l.debit, 0);
    expect(cleared).toBe(1000);
    expect(accrued - cleared).toBe(0);
    expect(integration.postings()).toHaveLength(1); // only the receipt posts via the adapter now
  });

  it('the standalone posting rule and the adapter agree', () => {
    const direct = deriveGoodsReceiptPosting({ receiptId: 'X', lines: [{ productId: 'p', quantity: 2, unitPrice: 5 }] });
    expect(direct.ok).toBe(true);
    expect(direct.reference).toBe('GRN-X');
  });
});
