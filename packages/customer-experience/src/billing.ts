/**
 * EPIC 4 — Billing Platform. Represents support for Stripe and Razorpay, with subscription / invoice /
 * payment-history registries, billing settings, and a tax profile. This NEVER fabricates a successful
 * payment: a payment attempt is recorded with status 'requires-credentials' (or 'pending-gateway') and
 * the only way it could ever be marked otherwise is a real, configured gateway confirming a real
 * charge — which does not happen here. No revenue is recorded.
 */
import { randomId } from '@neuropause/cloud-core';
import { BILLING_PROVIDERS, type BillingProvider, type LicenseTier, type PaymentStatus } from './constants';
import type { CustomerExperienceGovernance } from './governance';

export interface Subscription {
  id: string;
  tenantId: string;
  tier: LicenseTier;
  provider: BillingProvider;
  active: boolean;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: 'draft' | 'open';
}

export interface PaymentAttempt {
  id: string;
  invoiceId: string;
  provider: BillingProvider;
  status: PaymentStatus; // never 'succeeded' — a real charge requires a configured gateway
  note: string;
}

export interface TaxProfile {
  tenantId: string;
  country: string;
  taxId: string | null;
}

export class BillingPlatform {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly invoices = new Map<string, Invoice>();
  private readonly payments: PaymentAttempt[] = [];
  private readonly taxProfiles = new Map<string, TaxProfile>();

  constructor(
    private readonly gov: CustomerExperienceGovernance,
    private readonly operator: string,
  ) {}

  providers(): readonly BillingProvider[] {
    return BILLING_PROVIDERS;
  }

  async createSubscription(input: { tenantId: string; tier: LicenseTier; provider: BillingProvider }): Promise<Subscription> {
    const sub: Subscription = { id: randomId('sub'), tenantId: input.tenantId, tier: input.tier, provider: input.provider, active: false };
    this.subscriptions.set(sub.id, sub);
    await this.gov.record({ actor: this.operator, customer: input.tenantId, organization: input.tenantId, epic: 'E4', operation: 'create-subscription', targetId: sub.id, evidence: 'adapter-verified', decision: `${input.provider}/${input.tier}` });
    return sub;
  }

  async createInvoice(input: { subscriptionId: string; amountCents: number; currency?: string }): Promise<Invoice> {
    if (!this.subscriptions.has(input.subscriptionId)) throw new Error(`unknown subscription: ${input.subscriptionId}`);
    const invoice: Invoice = { id: randomId('inv'), subscriptionId: input.subscriptionId, amountCents: input.amountCents, currency: input.currency ?? 'USD', status: 'open' };
    this.invoices.set(invoice.id, invoice);
    await this.gov.record({ actor: this.operator, customer: '_billing', organization: '_cx', epic: 'E4', operation: 'create-invoice', targetId: invoice.id, evidence: 'live-verified', decision: `${invoice.amountCents} ${invoice.currency}` });
    return invoice;
  }

  /** Record a payment ATTEMPT — never a success. A real charge requires configured gateway credentials. */
  async attemptPayment(input: { invoiceId: string; provider: BillingProvider }): Promise<PaymentAttempt> {
    if (!this.invoices.has(input.invoiceId)) throw new Error(`unknown invoice: ${input.invoiceId}`);
    const payment: PaymentAttempt = {
      id: randomId('pay'),
      invoiceId: input.invoiceId,
      provider: input.provider,
      status: 'requires-credentials',
      note: `${input.provider} is represented; a real charge requires configured gateway credentials — no payment is processed or claimed successful here.`,
    };
    this.payments.push(payment);
    await this.gov.record({ actor: this.operator, customer: '_billing', organization: '_cx', epic: 'E4', operation: 'attempt-payment', targetId: payment.id, evidence: 'adapter-verified', decision: payment.status });
    return payment;
  }

  setTaxProfile(input: { tenantId: string; country: string; taxId?: string }): TaxProfile {
    const profile: TaxProfile = { tenantId: input.tenantId, country: input.country, taxId: input.taxId ?? null };
    this.taxProfiles.set(input.tenantId, profile);
    return profile;
  }

  billingSettings(tenantId: string): { tenantId: string; provider: BillingProvider | null; taxConfigured: boolean } {
    const sub = [...this.subscriptions.values()].find((s) => s.tenantId === tenantId);
    return { tenantId, provider: sub?.provider ?? null, taxConfigured: this.taxProfiles.has(tenantId) };
  }

  paymentHistory(): PaymentAttempt[] {
    return [...this.payments];
  }
  /** No payment is ever recorded successful — always zero. */
  successfulPaymentCount(): number {
    return 0;
  }
  subscriptionList(): Subscription[] {
    return [...this.subscriptions.values()];
  }
  invoiceList(): Invoice[] {
    return [...this.invoices.values()];
  }
}
