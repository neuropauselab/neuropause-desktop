import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  assessInvoiceRisk,
  calculateCollectionRisk,
  calculateDueDate,
  calculateInvoiceAmount,
  calculateOutstandingBalance,
  calculatePaymentStatus,
  calculateTaxAmount,
  deriveInvoiceInsights,
  formatInvoiceAmount,
  invoiceFromRecord,
  invoiceInsightsToKpis,
  invoiceSummaryFallback,
  type AiEngineRequest,
  type AiEngineResponse,
  type EnterpriseEntity,
  type EnterprisePermission,
  type EnterpriseRecordSummary,
  type FinanceInvoice,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createInvoiceModule, type InvoiceAiRunner } from './invoiceModule';
import { runInvoiceAi } from './invoiceAi';
import { createOrderModule } from '../sales/orderModule';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;
const day = (offset: number): string => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

function invoice(partial: Partial<FinanceInvoice> = {}): FinanceInvoice {
  return {
    id: 'i1',
    number: 'INV-1',
    customer: 'Acme',
    amount: 100,
    taxRate: 0,
    amountPaid: 0,
    currency: 'USD',
    status: 'issued',
    paymentTerms: 'net30',
    issueDate: null,
    dueDate: null,
    sourceOrder: '',
    notes: null,
    ...partial,
  };
}

/* ── deterministic business logic (AI never sets these) ── */

describe('calculateTaxAmount + calculateInvoiceAmount + calculateOutstandingBalance', () => {
  it('computes tax, total, and outstanding', () => {
    expect(calculateTaxAmount(invoice({ amount: 100, taxRate: 10 }))).toBe(10);
    expect(calculateInvoiceAmount(invoice({ amount: 100, taxRate: 10 }))).toBe(110);
    expect(calculateOutstandingBalance(invoice({ amount: 100, taxRate: 10, amountPaid: 40 }))).toBe(70);
    expect(calculateOutstandingBalance(invoice({ amount: 100, amountPaid: 150 }))).toBe(0);
  });
});

describe('calculateDueDate', () => {
  it('adds the term days to the issue date', () => {
    expect(calculateDueDate('2026-07-08', 'net30')).toBe('2026-08-07');
    expect(calculateDueDate('2026-07-08', 'prepaid')).toBe('2026-07-08');
    expect(calculateDueDate('', 'net30')).toBe('');
  });
});

describe('calculatePaymentStatus (deterministic, live)', () => {
  it('folds in payment and overdue', () => {
    expect(calculatePaymentStatus(invoice({ status: 'cancelled' }), NOW)).toBe('cancelled');
    expect(calculatePaymentStatus(invoice({ amount: 100, amountPaid: 100 }), NOW)).toBe('paid');
    expect(calculatePaymentStatus(invoice({ status: 'draft', amountPaid: 0 }), NOW)).toBe('draft');
    expect(
      calculatePaymentStatus(invoice({ status: 'issued', dueDate: day(-3) }), NOW),
    ).toBe('overdue');
    expect(
      calculatePaymentStatus(invoice({ status: 'issued', amountPaid: 40, dueDate: day(10) }), NOW),
    ).toBe('partially_paid');
    expect(calculatePaymentStatus(invoice({ status: 'issued' }), NOW)).toBe('issued');
  });
});

describe('calculateCollectionRisk (deterministic)', () => {
  it('is zero for paid/cancelled, rises with overdue days', () => {
    expect(calculateCollectionRisk(invoice({ amount: 100, amountPaid: 100 }), NOW)).toBe(0);
    expect(calculateCollectionRisk(invoice({ status: 'cancelled' }), NOW)).toBe(0);
    expect(
      calculateCollectionRisk(invoice({ status: 'issued', amount: 100, dueDate: day(-10) }), NOW),
    ).toBe(70); // 50 + 10*2, full outstanding
    expect(calculateCollectionRisk(invoice({ status: 'issued', amount: 100 }), NOW)).toBe(0); // no due date
  });
});

describe('assessInvoiceRisk (backward-compatible band)', () => {
  it('paid low, overdue high, due-soon medium, future low', () => {
    expect(assessInvoiceRisk(invoice({ amount: 100, amountPaid: 100 }), NOW).level).toBe('low');
    expect(assessInvoiceRisk(invoice({ status: 'issued', dueDate: day(-2) }), NOW).level).toBe('high');
    expect(assessInvoiceRisk(invoice({ status: 'issued', dueDate: day(3) }), NOW).level).toBe('medium');
    expect(assessInvoiceRisk(invoice({ status: 'issued', dueDate: day(90) }), NOW).level).toBe('low');
  });
});

describe('invoiceFromRecord + fallback', () => {
  it('projects a flat record and formats money', () => {
    const record: EnterpriseEntity = {
      id: 'r1',
      moduleId: 'finance',
      kind: 'invoice',
      title: 'INV-9',
      status: 'active',
      fields: { number: 'INV-9', customer: 'Beta', amount: 250, currency: 'EUR', status: 'sent' },
      tags: [],
      rev: 1,
      createdAt: T0,
      updatedAt: T0,
      createdBy: null,
      updatedBy: null,
      metadata: {},
    };
    const inv = invoiceFromRecord(record);
    // legacy 'sent' projects to 'issued' (backward compatibility)
    expect(inv).toMatchObject({ number: 'INV-9', customer: 'Beta', amount: 250, status: 'issued' });
    expect(formatInvoiceAmount(inv.amount, inv.currency)).toBe('EUR 250.00');
  });

  it('deterministic fallback describes outstanding cash', () => {
    const inv = invoice({ status: 'issued', amount: 500 });
    const fb = invoiceSummaryFallback(inv, assessInvoiceRisk(inv, NOW));
    expect(fb.summary).toContain('INV-1');
    expect(fb.executiveExplanation.toLowerCase()).toContain('outstanding');
  });
});

describe('deriveInvoiceInsights + KPIs', () => {
  it('aggregates receivables and emits the KPI tiles', () => {
    const rows = [
      invoice({ id: 'a', status: 'issued', amount: 100, dueDate: day(90) }),
      invoice({ id: 'b', status: 'issued', amount: 200, dueDate: day(-20) }),
      invoice({ id: 'c', status: 'paid', amount: 300, amountPaid: 300, issueDate: day(-30), dueDate: day(0) }),
      invoice({ id: 'd', status: 'cancelled', amount: 50 }),
    ];
    const insights = deriveInvoiceInsights(rows, NOW);
    expect(insights).toMatchObject({
      totalInvoices: 4,
      totalInvoiced: 600, // cancelled excluded
      outstandingReceivables: 300, // 100 + 200
      overdueAmount: 200, // the past-due issued invoice
      paidAmount: 300,
      highCollectionRisk: 1, // the 20-day-overdue invoice
      averagePaymentDays: 30,
    });
    const kpis = invoiceInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'inv-total',
      'inv-outstanding',
      'inv-overdue',
      'inv-paid',
      'inv-collection-risk',
      'inv-payment-time',
    ]);
  });
});

/* ── the module + lifecycle + conversion through the framework's handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let aiNarrative: Awaited<ReturnType<InvoiceAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let invoices: ReturnType<typeof createInvoiceModule>;
let orders: ReturnType<typeof createOrderModule>;

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

function tmp(tag: string): string {
  const p = join(tmpdir(), `np-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

beforeEach(() => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  aiNarrative = null;
  invoices = createInvoiceModule(tmp('inv'), async () => aiNarrative);
  orders = createOrderModule(tmp('order'));
  registry = new EnterpriseModuleRegistry();
  registry.register(invoices);
  registry.register(orders);
  handlers = buildModuleHandlers(registry, spyCtx());
});

afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

function handler(channel: string): (p: unknown) => unknown | Promise<unknown> {
  const def = handlers.find((d) => d.channel === channel);
  if (!def) throw new Error(`no handler for ${channel}`);
  return def.handler;
}

async function createIn(moduleId: string, fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId, fields })) as {
    ok: boolean;
    record?: EnterpriseEntity;
    errors?: Record<string, string>;
  };
}

function act(moduleId: string, id: string, action: string) {
  return handler(IpcChannel.EnterpriseModuleAction)({ moduleId, id, action }) as Promise<{
    ok: boolean;
    message?: string;
    error?: string;
  }>;
}

describe('CRUD + computed stamps', () => {
  it('applies defaults and stamps taxAmount/total/outstanding', async () => {
    const res = await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100, taxRate: 10 });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({
      status: 'draft',
      currency: 'USD',
      taxAmount: 10,
      total: 110,
      outstandingBalance: 110,
    });
    expect(res.record?.title).toBe('INV-1');
  });

  it('derives partially_paid / paid from recorded payment on edit', async () => {
    const created = await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100 });
    const id = created.record?.id as string;

    let upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'finance',
      id,
      fields: { amountPaid: 40 },
    })) as { record?: EnterpriseEntity };
    expect(upd.record?.fields).toMatchObject({ status: 'partially_paid', outstandingBalance: 60 });

    upd = (await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'finance',
      id,
      fields: { amountPaid: 100 },
    })) as { record?: EnterpriseEntity };
    expect(upd.record?.fields).toMatchObject({ status: 'paid', outstandingBalance: 0 });
  });

  it('rejects a missing required field (invoice number)', async () => {
    const res = await createIn('finance', { customer: 'Acme', amount: 100 });
    expect(res.ok).toBe(false);
    expect(res.errors?.number).toMatch(/required/i);
  });
});

describe('RBAC', () => {
  it('reads authorize operations:read, writes operations:manage', async () => {
    await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100 });
    expect(rec.authorized).toContain('operations:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'finance' });
    expect(rec.authorized).toEqual(['operations:read']);
  });
});

describe('lifecycle actions', () => {
  it('issue → markPaid, stamping dates + amounts, with timeline', async () => {
    const created = await createIn('finance', {
      number: 'INV-1',
      customer: 'Acme',
      amount: 100,
      paymentTerms: 'net30',
    });
    const id = created.record?.id as string;

    expect((await act('finance', id, 'issue')).ok).toBe(true);
    let inv = invoices.store.get(id);
    expect(inv?.fields).toMatchObject({ status: 'issued', issueDate: '2026-07-08', dueDate: '2026-08-07' });
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.updated',
      source: 'enterprise:finance',
    });

    expect((await act('finance', id, 'markPaid')).ok).toBe(true);
    inv = invoices.store.get(id);
    expect(inv?.fields).toMatchObject({ status: 'paid', amountPaid: 100, outstandingBalance: 0 });
  });

  it('rejects illegal transitions with a deterministic message', async () => {
    const created = await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100 });
    const id = created.record?.id as string;
    const res = await act('finance', id, 'markPaid'); // draft → markPaid illegal
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/cannot mark paid an invoice that is draft/i);
    expect(invoices.store.get(id)?.fields.status).toBe('draft');
  });

  it('cancels a draft and rejects an unknown action', async () => {
    const created = await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100 });
    const id = created.record?.id as string;
    expect((await act('finance', id, 'cancel')).ok).toBe(true);
    expect(invoices.store.get(id)?.fields.status).toBe('cancelled');
    const res = await act('finance', id, 'nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/i);
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true and the lifecycle actions', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
      actions: { key: string }[];
    }>;
    const fin = summaries.find((s) => s.id === 'finance');
    expect(fin).toMatchObject({ aiSummary: true });
    expect(fin?.actions.map((a) => a.key)).toEqual(['issue', 'markPaid', 'cancel']);
  });

  it('falls back to a deterministic risk when no AI narrative (overdue → high)', async () => {
    aiNarrative = null;
    const created = await createIn('finance', {
      number: 'INV-1',
      customer: 'Acme',
      amount: 100,
      status: 'issued',
      dueDate: day(-5),
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({ moduleId: 'finance', id })) as EnterpriseRecordSummary;
    expect(summary.risk).toBe('high');
    expect(summary.grounded).toBe(false);
    expect(summary.model).toBe('none');
    expect(summary.summary).toContain('INV-1');
  });

  it('uses the AI narrative; risk stays deterministic (paid → low)', async () => {
    aiNarrative = { summary: 'Model summary.', executiveExplanation: 'Model exec.', grounded: true, model: 'claude-test' };
    const created = await createIn('finance', { number: 'INV-2', customer: 'Beta', amount: 10, amountPaid: 10 });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({ moduleId: 'finance', id })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('Model summary.');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // paid, deterministic — model never sets this
  });
});

describe('Order → Invoice conversion', () => {
  async function fulfilledOrder() {
    return createIn('sales-orders', {
      orderNumber: 'SO-1',
      customer: 'Acme Inc.',
      contact: 'Ada',
      status: 'fulfilled',
      total: 500,
      paymentTerms: 'net30',
    });
  }
  function convert(id: string) {
    return act('sales-orders', id, 'convertToInvoice');
  }

  it('raises a linked draft invoice in Finance, cross-links, audits the order', async () => {
    const order = await fulfilledOrder();
    const orderId = order.record?.id as string;

    const res = await convert(orderId);
    expect(res.ok).toBe(true);

    // one invoice in Finance, cross-linked to the order, subtotal = order total
    const invRecs = invoices.store.list();
    expect(invRecs).toHaveLength(1);
    expect(invRecs[0].fields).toMatchObject({
      number: 'INV-SO-1',
      customer: 'Acme Inc.',
      status: 'draft',
      amount: 500,
      total: 500,
      sourceOrder: orderId,
    });

    // the order is RETAINED and cross-linked to the invoice
    const orderRec = orders.store.get(orderId);
    expect(orderRec?.status).toBe('active');
    expect(orderRec?.fields.convertedInvoice).toBe(invRecs[0].id);

    // the invoicing is audited (converted event on the order, created on the invoice)
    expect(
      rec.publish.some((e) => e.type === 'enterprise.record.converted' && e.source === 'enterprise:sales-orders'),
    ).toBe(true);
    expect(
      rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:finance'),
    ).toBe(true);
  });

  it('authorizes operations:manage (the Finance write scope) for the invoice', async () => {
    const order = await fulfilledOrder();
    rec.authorized.length = 0;
    await convert(order.record?.id as string);
    expect(rec.authorized).toContain('operations:manage');
  });

  it('only invoices eligible (shipped/fulfilled/closed) orders', async () => {
    const pending = await createIn('sales-orders', { orderNumber: 'SO-9', customer: 'Acme' });
    const res = await convert(pending.record?.id as string);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/shipped, fulfilled, or closed/i);
    expect(invoices.store.list()).toHaveLength(0);
  });

  it('is idempotent — a second convert creates no new invoice', async () => {
    const order = await fulfilledOrder();
    const orderId = order.record?.id as string;
    expect((await convert(orderId)).ok).toBe(true);
    const again = await convert(orderId);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been invoiced/i);
    expect(invoices.store.list()).toHaveLength(1);
  });
});

describe('runInvoiceAi', () => {
  const inv = invoice({ status: 'issued' });
  const risk = { level: 'low' as const, reason: 'ok' };
  it('returns the narrative from a grounded response', async () => {
    const engine = {
      run: async (_req: AiEngineRequest): Promise<AiEngineResponse> =>
        ({
          text: '',
          data: { summary: 'AI says hi', executiveExplanation: 'exec' },
          grounded: true,
          model: 'claude-x',
        }) as unknown as AiEngineResponse,
    };
    expect(await runInvoiceAi(engine, inv, risk)).toMatchObject({ summary: 'AI says hi', grounded: true });
  });
  it('returns null when the response is ungrounded (no model)', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runInvoiceAi(engine, inv, risk)).toBeNull();
  });
});
