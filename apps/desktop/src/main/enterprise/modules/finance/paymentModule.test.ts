import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  calculateCashReceived,
  calculateInvoiceOutstanding,
  calculateLatePaymentRisk,
  calculatePaidAmount,
  calculatePaymentCompletion,
  calculatePaymentHealth,
  derivePaymentInsights,
  identifyCollectionProblems,
  isDuplicateTransaction,
  paymentInsightsToKpis,
  type AiEngineRequest,
  type AiEngineResponse,
  type EnterpriseEntity,
  type EnterprisePermission,
  type EnterpriseRecordSummary,
  type FinanceInvoice,
  type PlatformEventInput,
  type SalesPayment,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createInvoiceModule } from './invoiceModule';
import { createPaymentModule, type PaymentAiRunner } from './paymentModule';
import { runPaymentAi } from './paymentAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;
const day = (offset: number): string => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

function payment(partial: Partial<SalesPayment> = {}): SalesPayment {
  return {
    id: 'p1',
    paymentNumber: 'PAY-1',
    invoiceRef: 'inv1',
    customer: 'Acme',
    amount: 100,
    currency: 'USD',
    method: 'bank_transfer',
    transactionRef: '',
    receivedDate: '',
    bankAccount: '',
    status: 'cleared',
    notes: '',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function inv(partial: Partial<FinanceInvoice> = {}): FinanceInvoice {
  return {
    id: 'a',
    number: 'INV-A',
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

/* ── deterministic ledger logic (AI never sets these) ── */

describe('paid / cash / outstanding / completion', () => {
  it('sums applied and cleared payments, computes outstanding + completion', () => {
    const rows = [
      payment({ amount: 60, status: 'cleared' }),
      payment({ amount: 40, status: 'pending' }),
      payment({ amount: 100, status: 'void' }),
    ];
    expect(calculatePaidAmount(rows)).toBe(100); // 60 + 40 (void excluded)
    expect(calculateCashReceived(rows)).toBe(60); // cleared only
    expect(calculateInvoiceOutstanding(100, rows)).toBe(0); // 100 - 100
    expect(calculateInvoiceOutstanding(100, [payment({ amount: 60, status: 'cleared' })])).toBe(40);
    expect(calculatePaymentCompletion(100, [payment({ amount: 60 })])).toBe(60);
  });
});

describe('calculateLatePaymentRisk (deterministic)', () => {
  it('rises with overdue days scaled by outstanding share; zero once settled', () => {
    expect(calculateLatePaymentRisk(100, day(-10), [payment({ amount: 60 })], NOW)).toBe(28); // (50+20)*0.4
    expect(calculateLatePaymentRisk(100, day(-10), [payment({ amount: 100 })], NOW)).toBe(0); // settled
    expect(calculateLatePaymentRisk(100, day(30), [payment({ amount: 0, status: 'void' })], NOW)).toBe(0);
  });
});

describe('calculatePaymentHealth + isDuplicateTransaction + identifyCollectionProblems', () => {
  it('health reflects clearing status', () => {
    expect(calculatePaymentHealth(payment({ status: 'cleared' })).level).toBe('low');
    expect(calculatePaymentHealth(payment({ status: 'pending' })).level).toBe('medium');
    expect(calculatePaymentHealth(payment({ status: 'void' })).level).toBe('low');
  });
  it('detects a duplicate transaction ref (excluding self)', () => {
    const rows = [payment({ paymentNumber: 'PAY-1', transactionRef: 'TX1' })];
    expect(isDuplicateTransaction(rows, 'TX1', 'PAY-2')).toBe(true);
    expect(isDuplicateTransaction(rows, 'TX1', 'PAY-1')).toBe(false); // self
    expect(isDuplicateTransaction(rows, 'TX2', 'PAY-2')).toBe(false);
  });
  it('identifies overdue invoices with an outstanding balance', () => {
    const rows = [
      { invoiceId: 'a', invoiceNumber: 'INV-A', invoiceTotal: 100, dueDate: day(-5), payments: [payment({ amount: 60 })] },
      { invoiceId: 'b', invoiceNumber: 'INV-B', invoiceTotal: 100, dueDate: day(5), payments: [] as SalesPayment[] },
      { invoiceId: 'c', invoiceNumber: 'INV-C', invoiceTotal: 100, dueDate: day(-5), payments: [payment({ amount: 100 })] },
    ];
    expect(identifyCollectionProblems(rows, NOW).map((r) => r.invoiceId)).toEqual(['a']);
  });
});

describe('derivePaymentInsights + KPIs', () => {
  it('joins the ledger to invoices and emits the KPI tiles', () => {
    const invoices = [
      inv({ id: 'a', number: 'INV-A', amount: 100, status: 'issued', issueDate: day(-20), dueDate: day(-10) }),
      inv({ id: 'b', number: 'INV-B', amount: 200, status: 'issued', dueDate: day(10) }),
    ];
    const payments = [
      payment({ paymentNumber: 'PAY-A', invoiceRef: 'a', amount: 100, status: 'cleared', receivedDate: day(-5) }),
      payment({ paymentNumber: 'PAY-B', invoiceRef: 'b', amount: 50, status: 'cleared', receivedDate: day(0) }),
    ];
    const insights = derivePaymentInsights(payments, invoices, NOW);
    expect(insights).toMatchObject({
      totalPayments: 2,
      cashReceived: 150,
      collectionRate: 50, // 150 collected / 300 invoiced
      latePayments: 1, // PAY-A received after INV-A due date
      averageCollectionDays: 15, // INV-A: issue day(-20) → paid day(-5)
    });
    expect(paymentInsightsToKpis(insights).map((k) => k.key)).toEqual([
      'pay-cash-received',
      'pay-collection-rate',
      'pay-late',
      'pay-avg-collection',
      'pay-count',
    ]);
  });
});

/* ── the module + reconciliation through the framework's handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let aiNarrative: Awaited<ReturnType<PaymentAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let invoices: ReturnType<typeof createInvoiceModule>;
let payments: ReturnType<typeof createPaymentModule>;

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
  invoices = createInvoiceModule(tmp('inv'));
  payments = createPaymentModule(tmp('pay'), invoices.store, async () => aiNarrative);
  registry = new EnterpriseModuleRegistry();
  registry.register(invoices);
  registry.register(payments);
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

async function newInvoice(fields: Record<string, unknown> = {}) {
  const res = await createIn('finance', { number: 'INV-1', customer: 'Acme', amount: 100, ...fields });
  return res.record?.id as string;
}

describe('CRUD + guards', () => {
  it('records a payment referencing an existing invoice', async () => {
    const invoiceId = await newInvoice();
    const res = await createIn('finance-payments', {
      paymentNumber: 'PAY-1',
      invoiceRef: invoiceId,
      amount: 60,
    });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({ status: 'cleared', currency: 'USD' });
  });

  it('blocks a payment referencing no invoice', async () => {
    const res = await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: 'nope', amount: 10 });
    expect(res.ok).toBe(false);
    expect(res.errors?.invoiceRef).toMatch(/no matching invoice/i);
  });

  it('blocks overpayment beyond the invoice balance', async () => {
    const invoiceId = await newInvoice(); // total 100
    expect((await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 60 })).ok).toBe(true);
    const over = await createIn('finance-payments', { paymentNumber: 'PAY-2', invoiceRef: invoiceId, amount: 50 });
    expect(over.ok).toBe(false);
    expect(over.errors?.amount).toMatch(/exceeds the invoice balance/i);
    expect(payments.store.count()).toBe(1);
  });

  it('blocks a duplicate transaction reference', async () => {
    const invoiceId = await newInvoice();
    expect(
      (await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 10, transactionRef: 'TX9' })).ok,
    ).toBe(true);
    const dup = await createIn('finance-payments', { paymentNumber: 'PAY-2', invoiceRef: invoiceId, amount: 10, transactionRef: 'TX9' });
    expect(dup.ok).toBe(false);
    expect(dup.errors?.transactionRef).toMatch(/already recorded/i);
  });
});

describe('RBAC', () => {
  it('reads authorize operations:read, writes operations:manage', async () => {
    const invoiceId = await newInvoice();
    rec.authorized.length = 0;
    await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 10 });
    expect(rec.authorized).toContain('operations:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'finance-payments' });
    expect(rec.authorized).toEqual(['operations:read']);
  });
});

describe('invoice reconciliation (payments are the source of truth)', () => {
  it('partial then full payment drives the invoice status + timeline', async () => {
    const invoiceId = await newInvoice(); // total 100

    await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 60 });
    let invoice = invoices.store.get(invoiceId);
    expect(invoice?.fields).toMatchObject({
      amountPaid: 60,
      status: 'partially_paid',
      outstandingBalance: 40,
    });
    // Payment Received (payment created) + invoice reconciled (invoice updated)
    expect(rec.publish.some((e) => e.type === 'enterprise.record.created' && e.source === 'enterprise:finance-payments')).toBe(true);
    expect(rec.publish.some((e) => e.type === 'enterprise.record.updated' && e.source === 'enterprise:finance')).toBe(true);

    await createIn('finance-payments', { paymentNumber: 'PAY-2', invoiceRef: invoiceId, amount: 40 });
    invoice = invoices.store.get(invoiceId);
    expect(invoice?.fields).toMatchObject({ amountPaid: 100, status: 'paid', outstandingBalance: 0 });
  });

  it('voiding a payment releases the invoice balance', async () => {
    const invoiceId = await newInvoice(); // total 100
    const pay = await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 100 });
    expect(invoices.store.get(invoiceId)?.fields.status).toBe('paid');

    // void via a status edit — the reconciler excludes void payments
    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'finance-payments',
      id: pay.record?.id,
      fields: { status: 'void' },
    });
    const invoice = invoices.store.get(invoiceId);
    expect(invoice?.fields).toMatchObject({ amountPaid: 0, outstandingBalance: 100 });
    expect(invoice?.fields.status).not.toBe('paid');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true and exactly the S57 governed-clear action', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
      actions: unknown[];
    }>;
    const pay = summaries.find((s) => s.id === 'finance-payments');
    expect(pay).toMatchObject({ aiSummary: true });
    // S57 policy delta, deliberate: the module gained ONE action — `clear`, the governed
    // ClearCustomerPayment affordance (the S46 fence had left pending payments with no
    // clearing path). The pin stays exact so any FURTHER action addition fails here first.
    expect(pay?.actions).toEqual([{ key: 'clear', label: 'Clear', icon: 'check' }]);
  });

  it('falls back to a deterministic summary; health stays deterministic', async () => {
    aiNarrative = null;
    const invoiceId = await newInvoice();
    const created = await createIn('finance-payments', {
      paymentNumber: 'PAY-1',
      invoiceRef: invoiceId,
      amount: 10,
      status: 'pending',
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({ moduleId: 'finance-payments', id })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.risk).toBe('medium'); // pending → medium
    expect(summary.summary).toContain('PAY-1');
  });

  it('uses the AI narrative when grounded; health stays deterministic', async () => {
    aiNarrative = { summary: 'AI payment', executiveExplanation: 'AI exec', grounded: true, model: 'm' };
    const invoiceId = await newInvoice();
    const created = await createIn('finance-payments', { paymentNumber: 'PAY-1', invoiceRef: invoiceId, amount: 10, status: 'cleared' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({ moduleId: 'finance-payments', id })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI payment');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // cleared → low
  });
});

describe('runPaymentAi', () => {
  it('returns the narrative from a grounded response', async () => {
    const engine = {
      run: async (_r: AiEngineRequest): Promise<AiEngineResponse> =>
        ({
          text: '',
          data: { summary: 'hi', executiveExplanation: 'e' },
          grounded: true,
          model: 'm',
        }) as unknown as AiEngineResponse,
    };
    expect(await runPaymentAi(engine, payment())).toMatchObject({ summary: 'hi', grounded: true });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runPaymentAi(engine, payment())).toBeNull();
  });
});
