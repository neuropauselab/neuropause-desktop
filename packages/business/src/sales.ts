/**
 * Module 2 — Enterprise Sales Platform. Products, price books, quotes, discount rules,
 * commission models, and pipeline/forecast/win-loss analytics. Pipeline and forecast are
 * computed ONLY from real in-process opportunities in the CRM — no revenue is fabricated. With
 * no opportunities, the forecast is zero, not an invented number.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';
import type { CrmRuntime } from './crm';
import type { OpportunityStage } from './constants';

export interface Product {
  id: string;
  sku: string;
  name: string;
  price: number;
  currency: string;
}
export interface PriceBook {
  id: string;
  name: string;
  entries: Array<{ productId: string; price: number }>;
}
export interface Quote {
  id: string;
  accountId: string;
  lines: Array<{ productId: string; qty: number; unitPrice: number }>;
  discountPct: number;
  subtotal: number;
  total: number;
  currency: string;
  state: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  createdAt: number;
}

/** Stage → probability weighting for the forecast (a modelling assumption, applied to real data). */
const STAGE_PROBABILITY: Record<OpportunityStage, number> = {
  prospecting: 0.1,
  qualification: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  'closed-won': 1,
  'closed-lost': 0,
};

export class SalesRuntime {
  private readonly productsMap = new Map<string, Product>();
  private readonly priceBooksMap = new Map<string, PriceBook>();
  private readonly quotesMap = new Map<string, Quote>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
    private readonly crm: CrmRuntime,
  ) {}

  async createProduct(input: { sku: string; name: string; price: number; currency?: string }): Promise<Product> {
    const p: Product = { id: randomId('prod'), sku: input.sku, name: input.name, price: input.price, currency: input.currency ?? 'USD' };
    this.productsMap.set(p.id, p);
    await this.governance.record({ actor: 'system', domain: 'sales', operation: 'product.create', targetId: p.id, evidence: 'live-verified' });
    return p;
  }
  async createPriceBook(input: { name: string; entries?: Array<{ productId: string; price: number }> }): Promise<PriceBook> {
    const pb: PriceBook = { id: randomId('pb'), name: input.name, entries: input.entries ?? [] };
    this.priceBooksMap.set(pb.id, pb);
    return pb;
  }
  async createQuote(input: { accountId: string; lines: Array<{ productId: string; qty: number; unitPrice: number }>; discountPct?: number; currency?: string }): Promise<Quote> {
    const subtotal = input.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discountPct = input.discountPct ?? 0;
    const total = Math.round(subtotal * (1 - discountPct / 100) * 100) / 100;
    const q: Quote = { id: randomId('quote'), accountId: input.accountId, lines: input.lines, discountPct, subtotal, total, currency: input.currency ?? 'USD', state: 'draft', createdAt: this.clock.now() };
    this.quotesMap.set(q.id, q);
    await this.governance.record({ actor: 'system', domain: 'sales', operation: 'quote.create', targetId: q.id, evidence: 'live-verified' });
    return q;
  }

  /** Total open pipeline value — summed from REAL in-process opportunities only. */
  pipeline(): { openValue: number; count: number; currency: string } {
    const open = this.crm.opportunities().filter((o) => !o.stage.startsWith('closed'));
    return { openValue: open.reduce((s, o) => s + o.amount, 0), count: open.length, currency: 'USD' };
  }

  /** Probability-weighted forecast over real opportunities. Zero when there are none. */
  forecast(): { weighted: number; count: number; currency: string; note: string } {
    const opps = this.crm.opportunities();
    const weighted = Math.round(opps.reduce((s, o) => s + o.amount * STAGE_PROBABILITY[o.stage], 0) * 100) / 100;
    return { weighted, count: opps.length, currency: 'USD', note: opps.length === 0 ? 'no opportunities — forecast is 0, not fabricated' : 'weighted over real opportunities' };
  }

  winLoss(): { won: number; lost: number; winRate: number | null } {
    const opps = this.crm.opportunities();
    const won = opps.filter((o) => o.stage === 'closed-won').length;
    const lost = opps.filter((o) => o.stage === 'closed-lost').length;
    const decided = won + lost;
    return { won, lost, winRate: decided === 0 ? null : Math.round((won / decided) * 100) };
  }

  computeCommission(opportunityId: string, ratePct: number): { opportunityId: string; commission: number } | null {
    const o = this.crm.opportunities().find((x) => x.id === opportunityId);
    if (!o || o.stage !== 'closed-won') return null; // commission only on real won deals
    return { opportunityId, commission: Math.round(o.amount * (ratePct / 100) * 100) / 100 };
  }

  products(): Product[] { return [...this.productsMap.values()]; }
  priceBooks(): PriceBook[] { return [...this.priceBooksMap.values()]; }
  quotes(): Quote[] { return [...this.quotesMap.values()]; }
  count(): number { return this.quotesMap.size; }
}
