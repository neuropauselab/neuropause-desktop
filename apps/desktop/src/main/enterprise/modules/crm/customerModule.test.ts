import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CUSTOMERS_MODULE_ID,
  IpcChannel,
  LEADS_MODULE_ID,
  calculateCustomerHealth,
  calculateCustomerTier,
  calculateLifetimeValue,
  calculatePaymentRisk,
  customerInsightsToKpis,
  deriveCustomerInsights,
  identifyAtRiskCustomers,
  recommendNextEngagement,
  validateModuleDescriptor,
  type AiEngineRequest,
  type AiEngineResponse,
  type CrmCustomer,
  type EnterprisePermission,
  type EnterpriseEntity,
  type EnterpriseRecordSummary,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { CUSTOMER_DESCRIPTOR, createCustomerModule, type CustomerAiRunner } from './customerModule';
import { createContactModule } from './contactModule';
import { createLeadModule } from './leadModule';
import { runCustomerAi } from './customerAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');

function customer(partial: Partial<CrmCustomer> = {}): CrmCustomer {
  return {
    id: 'c1',
    name: 'Acme Inc.',
    customerCode: '',
    company: 'Acme',
    primaryContact: 'Ada',
    email: '',
    status: 'active',
    tier: 'standard',
    accountManager: '',
    creditLimit: 0,
    outstandingBalance: 0,
    lifetimeRevenue: 0,
    paymentTerms: 'net30',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

/* ── deterministic business logic (AI never sets these) ── */

describe('descriptor', () => {
  it('is consistent, uses crm scopes, and computes riskScore read-only', () => {
    expect(validateModuleDescriptor(CUSTOMER_DESCRIPTOR)).toEqual([]);
    expect(CUSTOMER_DESCRIPTOR.permissions).toEqual({ read: 'crm:read', write: 'crm:manage' });
    expect(CUSTOMER_DESCRIPTOR.fields.find((f) => f.key === 'riskScore')?.readOnly).toBe(true);
    // Customers carries no custom record actions (conversion lives on Leads).
    expect(CUSTOMER_DESCRIPTOR.actions ?? []).toEqual([]);
  });
});

describe('calculateLifetimeValue + calculateCustomerTier', () => {
  it('normalizes lifetime value to a non-negative rounded number', () => {
    expect(calculateLifetimeValue(customer({ lifetimeRevenue: 12345.6 }))).toBe(12346);
    expect(calculateLifetimeValue(customer({ lifetimeRevenue: -5 }))).toBe(0);
  });
  it('maps revenue to a tier at deterministic thresholds', () => {
    expect(calculateCustomerTier(0)).toBe('standard');
    expect(calculateCustomerTier(10_000)).toBe('silver');
    expect(calculateCustomerTier(50_000)).toBe('gold');
    expect(calculateCustomerTier(250_000)).toBe('platinum');
    expect(calculateCustomerTier(1_000_000)).toBe('enterprise');
  });
});

describe('calculatePaymentRisk (deterministic)', () => {
  it('rises with credit utilization', () => {
    expect(
      calculatePaymentRisk(customer({ creditLimit: 100_000, outstandingBalance: 50_000 })),
    ).toBe(30);
    expect(
      calculatePaymentRisk(customer({ creditLimit: 100_000, outstandingBalance: 60_000 })),
    ).toBe(36);
  });
  it('adds penalties for blocked status + long terms, clamped to 100', () => {
    expect(
      calculatePaymentRisk(
        customer({
          creditLimit: 100_000,
          outstandingBalance: 100_000,
          status: 'blocked',
          paymentTerms: 'net60',
        }),
      ),
    ).toBe(100);
  });
  it('treats any balance with no credit limit as fully utilized', () => {
    expect(calculatePaymentRisk(customer({ creditLimit: 0, outstandingBalance: 0 }))).toBe(0);
    expect(calculatePaymentRisk(customer({ creditLimit: 0, outstandingBalance: 1 }))).toBe(60);
  });
});

describe('calculateCustomerHealth (deterministic)', () => {
  it('blocked is high, archived is low', () => {
    expect(calculateCustomerHealth(customer({ status: 'blocked' }), NOW).level).toBe('high');
    expect(calculateCustomerHealth(customer({ status: 'archived' }), NOW).level).toBe('low');
  });
  it('high payment risk is high risk', () => {
    // utilization 1.2 → 72/100 → high
    expect(
      calculateCustomerHealth(
        customer({ creditLimit: 100_000, outstandingBalance: 120_000 }),
        NOW,
      ).level,
    ).toBe('high');
  });
  it('inactive is medium; a healthy active account is low', () => {
    expect(calculateCustomerHealth(customer({ status: 'inactive' }), NOW).level).toBe('medium');
    expect(calculateCustomerHealth(customer({ status: 'active' }), NOW).level).toBe('low');
  });
});

describe('at-risk + next engagement', () => {
  it('identifyAtRiskCustomers returns only high-risk accounts', () => {
    const rows = [customer({ id: 'a', status: 'blocked' }), customer({ id: 'b', status: 'active' })];
    expect(identifyAtRiskCustomers(rows, NOW).map((c) => c.id)).toEqual(['a']);
  });
  it('recommends resolving a block first', () => {
    const c = customer({ status: 'blocked' });
    expect(recommendNextEngagement(c, calculateCustomerHealth(c, NOW))).toMatch(/block/i);
  });
});

describe('deriveCustomerInsights + KPIs', () => {
  it('aggregates accounts and emits the KPI tiles', () => {
    const rows = [
      customer({
        id: 'a',
        status: 'active',
        tier: 'gold',
        lifetimeRevenue: 60_000,
        outstandingBalance: 1000,
      }),
      customer({ id: 'b', status: 'preferred', tier: 'platinum', lifetimeRevenue: 300_000 }),
      customer({ id: 'c', status: 'blocked', tier: 'standard', lifetimeRevenue: 5000 }),
    ];
    const insights = deriveCustomerInsights(rows, NOW);
    expect(insights).toMatchObject({
      totalCustomers: 3,
      activeCustomers: 2, // active + preferred
      highRiskCustomers: 1, // blocked
      totalRevenue: 365_000,
    });
    expect(insights.revenueByTier.gold).toBe(60_000);
    expect(insights.topCustomers[0]?.id).toBe('b'); // highest lifetime revenue
    const kpis = customerInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'cust-total',
      'cust-active',
      'cust-receivables',
      'cust-high-risk',
      'cust-health',
      'cust-revenue',
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
let aiNarrative: Awaited<ReturnType<CustomerAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let customers: ReturnType<typeof createCustomerModule>;
let contacts: ReturnType<typeof createContactModule>;
let leads: ReturnType<typeof createLeadModule>;

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
  customers = createCustomerModule(tmp('cust'), async () => aiNarrative);
  contacts = createContactModule(tmp('contact'));
  leads = createLeadModule(tmp('lead'));
  registry = new EnterpriseModuleRegistry();
  registry.register(contacts);
  registry.register(leads);
  registry.register(customers);
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

describe('CRUD + computed riskScore', () => {
  it('stamps a deterministic riskScore and applies status/tier/terms defaults', async () => {
    const res = await createIn(CUSTOMERS_MODULE_ID, {
      name: 'Acme Inc.',
      creditLimit: 100_000,
      outstandingBalance: 60_000,
    });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({
      status: 'onboarding',
      customerTier: 'standard',
      paymentTerms: 'net30',
    });
    expect(res.record?.fields.riskScore).toBe(36); // utilization 0.6 → 36, no penalties
  });

  it('requires a customer name', async () => {
    expect((await createIn(CUSTOMERS_MODULE_ID, { company: 'Acme' })).ok).toBe(false);
  });
});

describe('RBAC', () => {
  it('reads authorize crm:read, writes crm:manage', async () => {
    await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme Inc.' });
    expect(rec.authorized).toContain('crm:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: CUSTOMERS_MODULE_ID });
    expect(rec.authorized).toEqual(['crm:read']);
  });
});

describe('timeline events', () => {
  it('emits created / updated / status_changed / deleted', async () => {
    const created = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme Inc.' });
    const id = created.record?.id as string;
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.created',
      source: 'enterprise:crm-customers',
    });

    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: CUSTOMERS_MODULE_ID,
      id,
      fields: { status: 'active' },
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.updated');

    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: CUSTOMERS_MODULE_ID,
      id,
      status: 'archived',
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.status_changed');

    await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: CUSTOMERS_MODULE_ID, id });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.deleted');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true and no custom actions', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
      actions: unknown[];
    }>;
    const cust = summaries.find((s) => s.id === CUSTOMERS_MODULE_ID);
    expect(cust).toMatchObject({ aiSummary: true });
    expect(cust?.actions).toEqual([]);
  });

  it('falls back to a deterministic summary; health stays deterministic', async () => {
    aiNarrative = null;
    const created = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme Inc.', status: 'blocked' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: CUSTOMERS_MODULE_ID,
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.risk).toBe('high'); // blocked → high
  });

  it('uses the AI narrative when grounded; health stays deterministic', async () => {
    aiNarrative = { summary: 'AI cust', executiveExplanation: 'AI exec', grounded: true, model: 'm' };
    const created = await createIn(CUSTOMERS_MODULE_ID, { name: 'Acme Inc.', status: 'active' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: CUSTOMERS_MODULE_ID,
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI cust');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low');
  });
});

describe('Lead Conversion (Lead → Contact → Customer)', () => {
  function convert(id: string) {
    return handler(IpcChannel.EnterpriseModuleAction)({
      moduleId: LEADS_MODULE_ID,
      id,
      action: 'convert',
    }) as Promise<{ ok: boolean; message?: string; error?: string }>;
  }

  it('creates a linked contact + customer, cross-links, and audits the lead as converted', async () => {
    const lead = await createIn(LEADS_MODULE_ID, {
      name: 'Acme renewal',
      company: 'Acme',
      contactPerson: 'Ada Lovelace',
      email: 'ada@acme.com',
      phone: '555-0100',
      assignedTo: 'rep@np.dev',
      source: 'referral',
      industry: 'SaaS',
    });
    const leadId = lead.record?.id as string;

    const res = await convert(leadId);
    expect(res.ok).toBe(true);

    // one contact, cross-linked back to the lead
    const contactRecs = contacts.store.list();
    expect(contactRecs).toHaveLength(1);
    expect(contactRecs[0].fields).toMatchObject({
      name: 'Ada Lovelace',
      company: 'Acme',
      status: 'customer',
      sourceLead: leadId,
    });

    // one customer, cross-linked to both the lead and the new contact
    const customerRecs = customers.store.list();
    expect(customerRecs).toHaveLength(1);
    expect(customerRecs[0].fields).toMatchObject({
      name: 'Acme',
      primaryContact: 'Ada Lovelace',
      status: 'onboarding',
      customerTier: 'standard',
      sourceLead: leadId,
      sourceContact: contactRecs[0].id,
    });
    // the customer's deterministic riskScore is stamped on conversion too
    expect(customerRecs[0].fields.riskScore).toBe(0);

    // the lead is RETAINED (not deleted) and cross-linked
    const leadRec = leads.store.get(leadId);
    expect(leadRec?.status).toBe('active');
    expect(leadRec?.fields).toMatchObject({
      convertedContact: contactRecs[0].id,
      convertedCustomer: customerRecs[0].id,
    });

    // the conversion is audited + lands on the Timeline
    expect(
      rec.publish.some(
        (e) => e.type === 'enterprise.record.converted' && e.source === 'enterprise:crm-leads',
      ),
    ).toBe(true);
  });

  it('is idempotent — a second convert creates no new records', async () => {
    const lead = await createIn(LEADS_MODULE_ID, { name: 'Acme renewal', company: 'Acme' });
    const leadId = lead.record?.id as string;
    expect((await convert(leadId)).ok).toBe(true);

    const again = await convert(leadId);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already been converted/i);
    expect(contacts.store.list()).toHaveLength(1);
    expect(customers.store.list()).toHaveLength(1);
  });

  it('authorizes crm:manage before converting', async () => {
    const lead = await createIn(LEADS_MODULE_ID, { name: 'Acme renewal' });
    rec.authorized.length = 0;
    await convert(lead.record?.id as string);
    // the action + both cross-module writes all assert crm:manage
    expect(rec.authorized.every((p) => p === 'crm:manage')).toBe(true);
    expect(rec.authorized).toContain('crm:manage');
  });

  it('rejects an unknown action', async () => {
    const lead = await createIn(LEADS_MODULE_ID, { name: 'Acme renewal' });
    const res = (await handler(IpcChannel.EnterpriseModuleAction)({
      moduleId: LEADS_MODULE_ID,
      id: lead.record?.id,
      action: 'nope',
    })) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown action/i);
  });
});

describe('runCustomerAi', () => {
  const c = customer();
  const signals = {
    health: { level: 'low' as const, reason: 'ok' },
    paymentRisk: 10,
    lifetimeValue: 5000,
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
    expect(await runCustomerAi(engine, c, signals)).toMatchObject({ summary: 'hi', grounded: true });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runCustomerAi(engine, c, signals)).toBeNull();
  });
});
