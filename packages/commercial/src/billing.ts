/**
 * Module 17 (billing surface) — Billing Runtime. Draft and issue invoices from real subscription /
 * usage line items. Invoices are REPRESENTED only: there is no charge, capture, settlement, payout,
 * or reconciliation here — those are regulated-external and routed to configured payment adapters.
 * Invoice amounts are summed from real line items; revenue stays business-data-pending. Starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';

export interface InvoiceLine { description: string; amountCents: number }
export interface Invoice {
  id: string;
  tenantId: string;
  currency: string;
  lines: InvoiceLine[];
  amountCents: number;
  status: 'draft' | 'issued';
  note: string;
  createdAt: number;
}

export class BillingRuntime {
  private readonly invoices = new Map<string, Invoice>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async draftInvoice(input: { tenantId: string; lines: InvoiceLine[]; currency?: string; org?: string }): Promise<Invoice> {
    const amountCents = input.lines.reduce((s, l) => s + l.amountCents, 0);
    const inv: Invoice = {
      id: randomId('inv'),
      tenantId: input.tenantId,
      currency: input.currency ?? 'USD',
      lines: input.lines,
      amountCents,
      status: 'draft',
      note: 'invoice represented — no payment processed; settlement is regulated-external and adapter-routed',
      createdAt: this.clock.now(),
    };
    this.invoices.set(inv.id, inv);
    // billing/revenue is business-data-pending until a real, configured payment settlement occurs
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: 'billing.draft-invoice', targetId: inv.id, evidence: 'business-data-pending', decision: `${amountCents} ${inv.currency} (represented)` });
    return inv;
  }

  async issueInvoice(id: string): Promise<Invoice> {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`no invoice ${id}`);
    inv.status = 'issued';
    await this.governance.record({ actor: 'system', org: '_ops', tenant: inv.tenantId, operation: 'billing.issue-invoice', targetId: inv.id, evidence: 'business-data-pending', decision: 'issued (no charge)' });
    return inv;
  }

  get(id: string): Invoice | undefined { return this.invoices.get(id); }
  list(tenantId?: string): Invoice[] {
    const all = [...this.invoices.values()];
    return tenantId ? all.filter((i) => i.tenantId === tenantId) : all;
  }
  count(): number { return this.invoices.size; }
}
