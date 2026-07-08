import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  QUOTES_MODULE_ID,
  calculateDiscountRisk,
  calculateQuoteHealth,
  calculateQuoteMargin,
  calculateQuoteTotal,
  deriveQuoteInsights,
  estimateWinProbability,
  identifyApprovalNeeds,
  quoteInsightsToKpis,
  recommendPricing,
  validateModuleDescriptor,
  type AiEngineRequest,
  type AiEngineResponse,
  type EnterprisePermission,
  type EnterpriseEntity,
  type EnterpriseRecordSummary,
  type PlatformEventInput,
  type SalesQuote,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { QUOTE_DESCRIPTOR, createQuoteModule, type QuoteAiRunner } from './quoteModule';
import { createOrderModule } from './orderModule';
import { runQuoteAi } from './quoteAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;

function quote(partial: Partial<SalesQuote> = {}): SalesQuote {
  return {
    id: 'q1',
    quoteNumber: 'Q-0001',
    customer: 'Acme Inc.',
    contact: 'Ada',
    opportunity: '',
    status: 'draft',
    issueDate: '',
    expiryDate: '',
    currency: 'USD',
    subtotal: 10000,
    discount: 1000,
    tax: 0,
    cost: 6000,
    total: 0,
    salesRep: '',
    paymentTerms: 'net30',
    version: 1,
    convertedOrder: '',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

/* ── deterministic business logic (AI never sets these) ── */

describe('descriptor', () => {
  it('is consistent, uses sales scopes, computes read-only fields, exposes the convert action', () => {
    expect(validateModuleDescriptor(QUOTE_DESCRIPTOR)).toEqual([]);
    expect(QUOTE_DESCRIPTOR.permissions).toEqual({ read: 'sales:read', write: 'sales:manage' });
    for (const key of ['total', 'marginPct', 'discountRisk', 'approvalStatus']) {
      expect(QUOTE_DESCRIPTOR.fields.find((f) => f.key === key)?.readOnly).toBe(true);
    }
    expect(QUOTE_DESCRIPTOR.actions).toEqual([
      { key: 'convertToOrder', label: 'Convert to Sales Order', icon: 'arrow-right' },
    ]);
  });
});

describe('calculateQuoteTotal + calculateQuoteMargin', () => {
  it('total is subtotal − discount + tax, never negative', () => {
    expect(calculateQuoteTotal(quote({ subtotal: 10000, discount: 1000, tax: 500 }))).toBe(9500);
    expect(calculateQuoteTotal(quote({ subtotal: 0, discount: 100, tax: 0 }))).toBe(0);
  });
  it('margin is net revenue minus cost', () => {
    expect(calculateQuoteMargin(quote({ subtotal: 10000, discount: 1000, cost: 6000 }))).toEqual({
      amount: 3000,
      percent: 33,
    });
    expect(calculateQuoteMargin(quote({ subtotal: 10000, discount: 0, cost: 12000 }))).toEqual({
      amount: -2000,
      percent: -20,
    });
  });
});

describe('calculateDiscountRisk (deterministic)', () => {
  it('rises with discount depth', () => {
    expect(calculateDiscountRisk(quote({ subtotal: 10000, discount: 1000, cost: 4000 }))).toBe(20);
    expect(calculateDiscountRisk(quote({ subtotal: 10000, discount: 3000, cost: 4000 }))).toBe(60);
  });
  it('penalizes loss-making quotes and clamps to 100', () => {
    expect(calculateDiscountRisk(quote({ subtotal: 10000, discount: 0, cost: 12000 }))).toBe(40);
    expect(calculateDiscountRisk(quote({ subtotal: 10000, discount: 5000, cost: 2000 }))).toBe(100);
  });
});

describe('estimateWinProbability (deterministic)', () => {
  it('pins terminal states', () => {
    expect(estimateWinProbability(quote({ status: 'accepted' }), NOW)).toBe(1);
    expect(estimateWinProbability(quote({ status: 'converted' }), NOW)).toBe(1);
    expect(estimateWinProbability(quote({ status: 'rejected' }), NOW)).toBe(0);
    expect(estimateWinProbability(quote({ status: 'expired' }), NOW)).toBe(0);
  });
  it('rises with stage and decays past expiry', () => {
    expect(estimateWinProbability(quote({ status: 'sent', discount: 0 }), NOW)).toBe(0.65);
    const past = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
    expect(
      estimateWinProbability(quote({ status: 'sent', discount: 0, expiryDate: past }), NOW),
    ).toBe(0.5);
  });
});

describe('calculateQuoteHealth (deterministic)', () => {
  it('closed/won states are low', () => {
    expect(calculateQuoteHealth(quote({ status: 'rejected' }), NOW).level).toBe('low');
    expect(calculateQuoteHealth(quote({ status: 'accepted' }), NOW).level).toBe('low');
  });
  it('loss-making and high-discount quotes are high risk', () => {
    expect(calculateQuoteHealth(quote({ subtotal: 10000, discount: 0, cost: 12000 }), NOW).level).toBe(
      'high',
    );
    expect(calculateQuoteHealth(quote({ subtotal: 10000, discount: 5000, cost: 2000 }), NOW).level).toBe(
      'high',
    );
  });
  it('thin margin is medium; a healthy quote is low', () => {
    expect(calculateQuoteHealth(quote({ subtotal: 10000, discount: 0, cost: 9000 }), NOW).level).toBe(
      'medium',
    );
    expect(calculateQuoteHealth(quote({ subtotal: 10000, discount: 1000, cost: 6000 }), NOW).level).toBe(
      'low',
    );
  });
});

describe('recommendPricing + identifyApprovalNeeds', () => {
  it('recommends trimming a deep discount', () => {
    expect(recommendPricing(quote({ subtotal: 10000, discount: 3000, cost: 4000 }))).toMatch(
      /discount/i,
    );
  });
  it('flags approval for deep discount / thin margin / high value', () => {
    expect(identifyApprovalNeeds(quote({ subtotal: 10000, discount: 1000, cost: 6000 })).needsApproval).toBe(
      false,
    );
    expect(identifyApprovalNeeds(quote({ subtotal: 10000, discount: 2500, cost: 4000 })).needsApproval).toBe(
      true,
    );
    expect(
      identifyApprovalNeeds(quote({ subtotal: 100000, discount: 0, cost: 50000 })).reasons,
    ).toContain('Contract value ≥ 100,000.');
  });
});

describe('deriveQuoteInsights + KPIs', () => {
  it('aggregates the pipeline and emits the KPI tiles', () => {
    const quotes = [
      quote({ id: 'a', status: 'draft', subtotal: 10000, discount: 0, cost: 6000 }),
      quote({ id: 'b', status: 'pending_approval', subtotal: 20000, discount: 5000, cost: 8000 }),
      quote({ id: 'c', status: 'accepted', subtotal: 30000, discount: 0, cost: 10000 }),
      quote({ id: 'd', status: 'rejected', subtotal: 5000, discount: 0, cost: 0 }),
    ];
    const insights = deriveQuoteInsights(quotes, NOW);
    expect(insights).toMatchObject({
      totalQuotes: 4,
      pipelineValue: 25000, // draft 10000 + pending 15000
      averageQuoteValue: 15000, // (10000+15000+30000+5000)/4
      approvalQueue: 1, // the pending_approval quote
      highDiscountRisk: 0,
      conversionRate: 50, // 1 won / (1 accepted + 1 rejected)
    });
    const kpis = quoteInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'quote-total',
      'quote-pipeline',
      'quote-avg-value',
      'quote-approval-queue',
      'quote-win-prob',
      'quote-discount-risk',
      'quote-conversion',
    ]);
  });
});

/* ── the module + conversion through the framework's generic handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let aiNarrative: Awaited<ReturnType<QuoteAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let quotes: ReturnType<typeof createQuoteModule>;
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
  quotes = createQuoteModule(tmp('quote'), async () => aiNarrative);
  orders = createOrderModule(tmp('order'));
  registry = new EnterpriseModuleRegistry();
  registry.register(quotes);
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

describe('CRUD + computed stamps', () => {
  it('stamps total, marginPct, discountRisk, approvalStatus and applies defaults', async () => {
    const res = await createIn(QUOTES_MODULE_ID, {
      quoteNumber: 'Q-0001',
      customer: 'Acme Inc.',
      subtotal: 10000,
      discount: 1000,
      cost: 6000,
    });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({
      status: 'draft',
      currency: 'USD',
      paymentTerms: 'net30',
      total: 9000,
      marginPct: 33,
      discountRisk: 20,
      approvalStatus: 'not_required',
    });
  });

  it('stamps approvalStatus=required for a deep discount', async () => {
    const res = await createIn(QUOTES_MODULE_ID, {
      quoteNumber: 'Q-0002',
      customer: 'Acme Inc.',
      subtotal: 10000,
      discount: 3000,
      cost: 4000,
    });
    expect(res.record?.fields.approvalStatus).toBe('required');
  });

  it('requires a quote number and a customer', async () => {
    expect((await createIn(QUOTES_MODULE_ID, { customer: 'Acme' })).ok).toBe(false);
    expect((await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-9' })).ok).toBe(false);
  });
});

describe('RBAC', () => {
  it('reads authorize sales:read, writes sales:manage', async () => {
    await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-1', customer: 'Acme' });
    expect(rec.authorized).toContain('sales:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: QUOTES_MODULE_ID });
    expect(rec.authorized).toEqual(['sales:read']);
  });
});

describe('timeline events', () => {
  it('emits created / updated / status_changed / deleted', async () => {
    const created = await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-1', customer: 'Acme' });
    const id = created.record?.id as string;
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.created',
      source: 'enterprise:sales-quotes',
    });

    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: QUOTES_MODULE_ID,
      id,
      fields: { status: 'sent' },
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.updated');

    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: QUOTES_MODULE_ID,
      id,
      status: 'archived',
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.status_changed');

    await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: QUOTES_MODULE_ID, id });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.deleted');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true and the convert action', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
      actions: { key: string }[];
    }>;
    const q = summaries.find((s) => s.id === QUOTES_MODULE_ID);
    expect(q).toMatchObject({ aiSummary: true });
    expect(q?.actions.map((a) => a.key)).toEqual(['convertToOrder']);
  });

  it('falls back to a deterministic summary; health stays deterministic', async () => {
    aiNarrative = null;
    const created = await createIn(QUOTES_MODULE_ID, {
      quoteNumber: 'Q-1',
      customer: 'Acme',
      subtotal: 10000,
      discount: 0,
      cost: 12000,
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: QUOTES_MODULE_ID,
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.risk).toBe('high'); // loss-making → high
    expect(summary.summary).toMatch(/win probability/i);
  });

  it('uses the AI narrative when grounded; health stays deterministic', async () => {
    aiNarrative = { summary: 'AI quote', executiveExplanation: 'AI exec', grounded: true, model: 'm' };
    const created = await createIn(QUOTES_MODULE_ID, {
      quoteNumber: 'Q-1',
      customer: 'Acme',
      subtotal: 10000,
      discount: 1000,
      cost: 6000,
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: QUOTES_MODULE_ID,
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI quote');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low');
  });
});

describe('Quote Conversion (Quote → Sales Order)', () => {
  function convert(id: string) {
    return handler(IpcChannel.EnterpriseModuleAction)({
      moduleId: QUOTES_MODULE_ID,
      id,
      action: 'convertToOrder',
    }) as Promise<{ ok: boolean; message?: string; error?: string }>;
  }

  async function acceptedQuote() {
    return createIn(QUOTES_MODULE_ID, {
      quoteNumber: 'Q-0001',
      customer: 'Acme Inc.',
      contact: 'Ada',
      salesRep: 'rep@np.dev',
      status: 'accepted',
      subtotal: 20000,
      discount: 2000,
      cost: 10000,
    });
  }

  it('raises a linked sales order, cross-links, and audits the quote as converted', async () => {
    const created = await acceptedQuote();
    const quoteId = created.record?.id as string;

    const res = await convert(quoteId);
    expect(res.ok).toBe(true);

    // one order, cross-linked to the quote, carrying the authoritative total
    const orderRecs = orders.store.list();
    expect(orderRecs).toHaveLength(1);
    expect(orderRecs[0].fields).toMatchObject({
      orderNumber: 'SO-Q-0001',
      customer: 'Acme Inc.',
      status: 'pending',
      sourceQuote: quoteId,
      total: 18000, // 20000 - 2000
    });

    // the quote is RETAINED (not deleted), moved to converted, and cross-linked
    const quoteRec = quotes.store.get(quoteId);
    expect(quoteRec?.status).toBe('active');
    expect(quoteRec?.fields).toMatchObject({
      status: 'converted',
      convertedOrder: orderRecs[0].id,
    });

    // the conversion is audited + lands on the Timeline
    expect(
      rec.publish.some(
        (e) => e.type === 'enterprise.record.converted' && e.source === 'enterprise:sales-quotes',
      ),
    ).toBe(true);
  });

  it('only converts an accepted quote', async () => {
    const draft = await createIn(QUOTES_MODULE_ID, { quoteNumber: 'Q-9', customer: 'Acme' });
    const res = await convert(draft.record?.id as string);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/accepted/i);
    expect(orders.store.list()).toHaveLength(0);
  });

  it('is idempotent — a second convert creates no new order', async () => {
    const created = await acceptedQuote();
    const quoteId = created.record?.id as string;
    expect((await convert(quoteId)).ok).toBe(true);

    const again = await convert(quoteId);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been converted/i);
    expect(orders.store.list()).toHaveLength(1);
  });

  it('rejects an unknown action', async () => {
    const created = await acceptedQuote();
    const res = (await handler(IpcChannel.EnterpriseModuleAction)({
      moduleId: QUOTES_MODULE_ID,
      id: created.record?.id,
      action: 'nope',
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/i);
  });
});

describe('runQuoteAi', () => {
  const q = quote();
  const signals = {
    health: { level: 'low' as const, reason: 'ok' },
    winProbability: 0.5,
    margin: { amount: 3000, percent: 33 },
    discountRisk: 20,
    approval: { needsApproval: false, reasons: [] },
  };
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
    expect(await runQuoteAi(engine, q, signals)).toMatchObject({ summary: 'hi', grounded: true });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runQuoteAi(engine, q, signals)).toBeNull();
  });
});
