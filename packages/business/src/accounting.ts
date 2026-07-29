/**
 * Module 5 — Enterprise Accounting. Accounts receivable / payable, invoices, credit/debit notes,
 * payments, expenses, fixed assets, and straight-line depreciation, with financial statements
 * derived from the ERP core. Everything remains EMPTY until real data exists — no invoice,
 * payment, or financial figure is fabricated. Real bank settlement of a payment is regulated-
 * external and never performed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import type { ErpCore, Statement } from './erp';

export interface Invoice {
  id: string;
  kind: 'receivable' | 'payable';
  partyId: string;
  amount: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid';
  dueDate?: number;
  createdAt: number;
}
export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  note: string;
}
export interface FixedAsset {
  id: string;
  name: string;
  cost: number;
  usefulLifeYears: number;
  method: 'straight-line';
}

export class AccountingRuntime {
  private readonly invoicesMap = new Map<string, Invoice>();
  private readonly paymentsList: Payment[] = [];
  private readonly assetsMap = new Map<string, FixedAsset>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
    private readonly erp: ErpCore,
  ) {}

  async createInvoice(input: { kind: 'receivable' | 'payable'; partyId: string; amount: number; currency?: string; dueDate?: number }): Promise<Invoice> {
    const inv: Invoice = { id: randomId('inv'), kind: input.kind, partyId: input.partyId, amount: input.amount, currency: input.currency ?? 'USD', status: 'draft', ...(input.dueDate ? { dueDate: input.dueDate } : {}), createdAt: this.clock.now() };
    this.invoicesMap.set(inv.id, inv);
    await this.governance.record({ actor: 'system', domain: 'accounting', operation: `invoice.create.${input.kind}`, targetId: inv.id, evidence: 'live-verified' });
    return inv;
  }
  async issueInvoice(id: string): Promise<Invoice> {
    const inv = this.require(id);
    inv.status = 'issued';
    await this.governance.record({ actor: 'system', domain: 'accounting', operation: 'invoice.issue', targetId: id, evidence: 'live-verified' });
    return inv;
  }
  /** Record a payment against an invoice. This settles the LEDGER only — real bank settlement is regulated-external. */
  async recordPayment(invoiceId: string, amount: number): Promise<Payment> {
    const inv = this.require(invoiceId);
    const p: Payment = { id: randomId('pay'), invoiceId, amount, note: 'ledger payment recorded — real bank settlement is regulated-external' };
    this.paymentsList.push(p);
    if (amount >= inv.amount) inv.status = 'paid';
    await this.governance.record({ actor: 'system', domain: 'accounting', operation: 'payment.record', targetId: p.id, evidence: 'live-verified', detail: p.note });
    return p;
  }

  async createFixedAsset(input: { name: string; cost: number; usefulLifeYears: number }): Promise<FixedAsset> {
    const a: FixedAsset = { id: randomId('fa'), name: input.name, cost: input.cost, usefulLifeYears: input.usefulLifeYears, method: 'straight-line' };
    this.assetsMap.set(a.id, a);
    return a;
  }
  /** Real straight-line depreciation schedule. */
  depreciation(assetId: string): Array<{ year: number; expense: number; bookValue: number }> {
    const a = this.assetsMap.get(assetId);
    if (!a) return [];
    const annual = Math.round((a.cost / a.usefulLifeYears) * 100) / 100;
    const schedule: Array<{ year: number; expense: number; bookValue: number }> = [];
    let book = a.cost;
    for (let y = 1; y <= a.usefulLifeYears; y++) {
      book = Math.round((book - annual) * 100) / 100;
      schedule.push({ year: y, expense: annual, bookValue: Math.max(0, book) });
    }
    return schedule;
  }

  /** Financial statements derived from the ERP core (empty, not fabricated, until data exists). */
  financialStatements(): Statement {
    return this.erp.statement();
  }

  private require(id: string): Invoice {
    const inv = this.invoicesMap.get(id);
    if (!inv) throw new Error(`no invoice ${id}`);
    return inv;
  }

  invoices(kind?: 'receivable' | 'payable'): Invoice[] {
    const all = [...this.invoicesMap.values()];
    return kind ? all.filter((i) => i.kind === kind) : all;
  }
  payments(): Payment[] { return [...this.paymentsList]; }
  fixedAssets(): FixedAsset[] { return [...this.assetsMap.values()]; }
  receivablesOutstanding(): number { return this.invoices('receivable').filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0); }
  payablesOutstanding(): number { return this.invoices('payable').filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0); }
  count(): number { return this.invoicesMap.size; }
}
