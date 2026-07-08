import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  assessInvoiceRisk,
  formatInvoiceAmount,
  invoiceFromRecord,
  invoiceSummaryFallback,
  type AiEngineRequest,
  type AiEngineResponse,
  type EnterpriseEntity,
  type EnterprisePermission,
  type EnterpriseRecordSummary,
  type FinanceInvoice,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { createInvoiceModule, type InvoiceAiRunner } from './invoiceModule';
import { runInvoiceAi } from './invoiceAi';

const T0 = '2026-07-08T00:00:00.000Z';
const PAST = '2020-01-01';
const FUTURE = '2099-01-01';

function invoice(partial: Partial<FinanceInvoice> = {}): FinanceInvoice {
  return {
    id: 'i1',
    number: 'INV-1',
    customer: 'Acme',
    amount: 100,
    currency: 'USD',
    status: 'sent',
    issueDate: null,
    dueDate: null,
    notes: null,
    ...partial,
  };
}

describe('assessInvoiceRisk', () => {
  const now = Date.parse('2026-07-08');
  it('paid and cancelled are low', () => {
    expect(assessInvoiceRisk(invoice({ status: 'paid' }), now).level).toBe('low');
    expect(assessInvoiceRisk(invoice({ status: 'cancelled' }), now).level).toBe('low');
  });
  it('overdue unpaid is high', () => {
    expect(assessInvoiceRisk(invoice({ status: 'sent', dueDate: PAST }), now).level).toBe('high');
  });
  it('due within a week is medium', () => {
    const soon = new Date(now + 3 * 86400000).toISOString().slice(0, 10);
    expect(assessInvoiceRisk(invoice({ status: 'sent', dueDate: soon }), now).level).toBe('medium');
  });
  it('comfortably future is low', () => {
    expect(assessInvoiceRisk(invoice({ status: 'sent', dueDate: FUTURE }), now).level).toBe('low');
  });
});

describe('invoiceFromRecord + formatters', () => {
  it('projects a flat record into a typed invoice', () => {
    const record: EnterpriseEntity = {
      id: 'r1',
      moduleId: 'finance',
      kind: 'invoice',
      title: 'INV-9',
      status: 'active',
      fields: { number: 'INV-9', customer: 'Beta', amount: 250, currency: 'EUR', status: 'paid' },
      tags: [],
      rev: 1,
      createdAt: T0,
      updatedAt: T0,
      createdBy: null,
      updatedBy: null,
      metadata: {},
    };
    const inv = invoiceFromRecord(record);
    expect(inv).toMatchObject({
      number: 'INV-9',
      customer: 'Beta',
      amount: 250,
      currency: 'EUR',
      status: 'paid',
    });
    expect(formatInvoiceAmount(inv.amount, inv.currency)).toBe('EUR 250.00');
  });

  it('deterministic fallback describes outstanding cash', () => {
    const inv = invoice({ status: 'sent', amount: 500 });
    const risk = assessInvoiceRisk(inv, Date.parse('2026-07-08'));
    const fb = invoiceSummaryFallback(inv, risk);
    expect(fb.summary).toContain('INV-1');
    expect(fb.executiveExplanation.toLowerCase()).toContain('outstanding');
  });
});

/* ── the module through the framework's generic handlers ── */

const paths: string[] = [];
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];
let aiNarrative: Awaited<ReturnType<InvoiceAiRunner>>;
const authorized: EnterprisePermission[] = [];

function spyCtx() {
  return {
    authorize: (p: EnterprisePermission) => authorized.push(p),
    audit: () => undefined,
    publish: () => undefined,
    broadcast: () => undefined,
    notify: () => undefined,
    actor: () => 'tester@np.dev',
    now: () => T0,
  };
}

beforeEach(async () => {
  authorized.length = 0;
  aiNarrative = null;
  const path = join(tmpdir(), `np-inv-${randomUUID()}.json`);
  paths.push(path);
  const module = createInvoiceModule(path, async () => aiNarrative);
  registry = new EnterpriseModuleRegistry();
  registry.register(module);
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

async function create(fields: Record<string, unknown>) {
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'finance', fields })) as {
    ok: boolean;
    record?: EnterpriseEntity;
    errors?: Record<string, string>;
  };
}

describe('invoice module — via framework', () => {
  it('applies status=draft and currency=USD defaults on create', async () => {
    const res = await create({ number: 'INV-1', customer: 'Acme', amount: 100 });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({ status: 'draft', currency: 'USD' });
    expect(res.record?.title).toBe('INV-1');
  });

  it('rejects a missing required field (invoice number)', async () => {
    const res = await create({ customer: 'Acme', amount: 100 });
    expect(res.ok).toBe(false);
    expect(res.errors?.number).toMatch(/required/i);
  });

  it('exposes aiSummary=true in the registry summary', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
    }>;
    expect(summaries[0]).toMatchObject({ id: 'finance', aiSummary: true });
  });

  it('summarize returns a deterministic risk + fallback when no AI narrative', async () => {
    aiNarrative = null; // no model
    const created = await create({
      number: 'INV-1',
      customer: 'Acme',
      amount: 100,
      status: 'sent',
      dueDate: PAST,
    });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'finance',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.risk).toBe('high'); // overdue
    expect(summary.grounded).toBe(false);
    expect(summary.model).toBe('none');
    expect(summary.summary).toContain('INV-1');
    expect(summary.headline).toContain('INV-1');
    // read authorized (create used write; summarize used read)
    expect(authorized).toContain('operations:read');
  });

  it('summarize uses the AI narrative when the runner returns one', async () => {
    aiNarrative = {
      summary: 'Model summary.',
      executiveExplanation: 'Model exec.',
      grounded: true,
      model: 'claude-test',
    };
    const created = await create({ number: 'INV-2', customer: 'Beta', amount: 10, status: 'paid' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'finance',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('Model summary.');
    expect(summary.executiveExplanation).toBe('Model exec.');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // paid, deterministic — model never sets this
  });
});

describe('runInvoiceAi', () => {
  const inv = invoice({ status: 'sent' });
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
    const out = await runInvoiceAi(engine, inv, risk);
    expect(out).toMatchObject({
      summary: 'AI says hi',
      executiveExplanation: 'exec',
      grounded: true,
      model: 'claude-x',
    });
  });

  it('returns null when the response is ungrounded (no model)', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runInvoiceAi(engine, inv, risk)).toBeNull();
  });
});
