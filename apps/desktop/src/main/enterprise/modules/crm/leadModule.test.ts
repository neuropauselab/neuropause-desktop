import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  assessLeadHealth,
  calculateLeadScore,
  deriveLeadInsights,
  estimateConversionProbability,
  identifyStaleLeads,
  leadInsightsToKpis,
  validateModuleDescriptor,
  type AiEngineRequest,
  type AiEngineResponse,
  type CrmLead,
  type EnterprisePermission,
  type EnterpriseEntity,
  type EnterpriseRecordSummary,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { LEAD_DESCRIPTOR, createLeadModule, type LeadAiRunner } from './leadModule';
import { runLeadAi } from './leadAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;

function lead(partial: Partial<CrmLead> = {}): CrmLead {
  return {
    id: 'l1',
    name: 'Acme deal',
    company: 'Acme',
    contactPerson: '',
    email: '',
    stage: 'qualified',
    priority: 'high',
    source: 'referral',
    campaign: '',
    dealValue: 20000,
    expectedCloseDate: null,
    assignedTo: '',
    leadScore: 0,
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

describe('descriptor', () => {
  it('is consistent and uses crm scopes', () => {
    expect(validateModuleDescriptor(LEAD_DESCRIPTOR)).toEqual([]);
    expect(LEAD_DESCRIPTOR.permissions).toEqual({ read: 'crm:read', write: 'crm:manage' });
    expect(LEAD_DESCRIPTOR.fields.find((f) => f.key === 'leadScore')?.readOnly).toBe(true);
  });
});

describe('calculateLeadScore (deterministic)', () => {
  it('pins terminal stages', () => {
    expect(calculateLeadScore({ stage: 'won', dealValue: 0, priority: 'low', source: '' })).toBe(
      100,
    );
    expect(
      calculateLeadScore({
        stage: 'lost',
        dealValue: 999999,
        priority: 'high',
        source: 'referral',
      }),
    ).toBe(0);
    expect(
      calculateLeadScore({
        stage: 'archived',
        dealValue: 999999,
        priority: 'high',
        source: 'referral',
      }),
    ).toBe(0);
  });
  it('blends stage, value, priority and source', () => {
    // 0.5*45 + 0.2*60 + 0.2*100 + 0.1*100 = 64.5 → 65
    expect(
      calculateLeadScore({
        stage: 'qualified',
        dealValue: 20000,
        priority: 'high',
        source: 'referral',
      }),
    ).toBe(65);
  });
  it('is monotonic in stage', () => {
    const base = { dealValue: 10000, priority: 'medium' as const, source: 'website' };
    expect(calculateLeadScore({ ...base, stage: 'negotiation' })).toBeGreaterThan(
      calculateLeadScore({ ...base, stage: 'new' }),
    );
  });
});

describe('estimateConversionProbability', () => {
  it('pins won=1 and lost/archived=0', () => {
    expect(estimateConversionProbability(lead({ stage: 'won' }), NOW)).toBe(1);
    expect(estimateConversionProbability(lead({ stage: 'lost' }), NOW)).toBe(0);
  });
  it('rises with stage and drops when stale', () => {
    const neg = estimateConversionProbability(
      lead({ stage: 'negotiation', updatedAt: T0 }),
      Date.parse(T0),
    );
    const fresh = estimateConversionProbability(
      lead({ stage: 'new', updatedAt: T0 }),
      Date.parse(T0),
    );
    expect(neg).toBeGreaterThan(fresh);
    const stale = new Date(NOW - 40 * DAY).toISOString();
    const stalP = estimateConversionProbability(
      lead({ stage: 'negotiation', updatedAt: stale }),
      NOW,
    );
    const freshP = estimateConversionProbability(
      lead({ stage: 'negotiation', updatedAt: new Date(NOW).toISOString() }),
      NOW,
    );
    expect(stalP).toBeLessThan(freshP);
  });
});

describe('assessLeadHealth + identifyStaleLeads', () => {
  it('closed stages are low', () => {
    expect(assessLeadHealth(lead({ stage: 'won' }), NOW).level).toBe('low');
    expect(assessLeadHealth(lead({ stage: 'lost' }), NOW).level).toBe('low');
  });
  it('an open lead untouched > 21 days is high risk', () => {
    const stale = new Date(NOW - 30 * DAY).toISOString();
    expect(assessLeadHealth(lead({ stage: 'qualified', updatedAt: stale }), NOW).level).toBe(
      'high',
    );
  });
  it('past expected close is high risk', () => {
    const past = new Date(NOW - 5 * DAY).toISOString().slice(0, 10);
    expect(
      assessLeadHealth(
        lead({
          stage: 'proposal',
          expectedCloseDate: past,
          updatedAt: new Date(NOW).toISOString(),
        }),
        NOW,
      ).level,
    ).toBe('high');
  });
  it('identifyStaleLeads returns only stale open leads', () => {
    const stale = new Date(NOW - 30 * DAY).toISOString();
    const leads = [
      lead({ id: 'a', stage: 'qualified', updatedAt: stale }),
      lead({ id: 'b', stage: 'qualified', updatedAt: new Date(NOW).toISOString() }),
      lead({ id: 'c', stage: 'won', updatedAt: stale }),
    ];
    expect(identifyStaleLeads(leads, NOW).map((l) => l.id)).toEqual(['a']);
  });
});

describe('deriveLeadInsights + KPIs', () => {
  it('aggregates the pipeline', () => {
    const fresh = new Date(NOW).toISOString();
    const leads = [
      lead({ stage: 'new', dealValue: 1000, updatedAt: fresh }),
      lead({ stage: 'qualified', dealValue: 5000, updatedAt: fresh }),
      lead({ stage: 'negotiation', dealValue: 10000, updatedAt: fresh }),
      lead({ stage: 'won', dealValue: 8000, updatedAt: fresh }),
      lead({ stage: 'lost', dealValue: 3000, updatedAt: fresh }),
    ];
    const insights = deriveLeadInsights(leads, NOW);
    expect(insights).toMatchObject({
      totalLeads: 5,
      qualifiedLeads: 2, // qualified + negotiation
      conversionRate: 50, // 1 won / (1 won + 1 lost)
      pipelineValue: 16000, // new + qualified + negotiation
      highRiskLeads: 0,
    });
    expect(insights.averageLeadScore).toBeGreaterThan(0);
    const kpis = leadInsightsToKpis(insights);
    expect(kpis.map((k) => k.key)).toEqual([
      'lead-total',
      'lead-qualified',
      'lead-conversion',
      'lead-pipeline',
      'lead-high-risk',
      'lead-avg-score',
    ]);
  });
});

/* ── the module through the framework's generic handlers ── */

interface Recorded {
  publish: PlatformEventInput[];
  audit: { action: string }[];
  broadcast: { channel: string }[];
  authorized: EnterprisePermission[];
}

const paths: string[] = [];
let rec: Recorded;
let aiNarrative: Awaited<ReturnType<LeadAiRunner>>;
let registry: EnterpriseModuleRegistry;
let handlers: SecureHandlerDef[];

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

beforeEach(async () => {
  rec = { publish: [], audit: [], broadcast: [], authorized: [] };
  aiNarrative = null;
  const path = join(tmpdir(), `np-lead-${randomUUID()}.json`);
  paths.push(path);
  const module = createLeadModule(path, async () => aiNarrative);
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
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'crm-leads', fields })) as {
    ok: boolean;
    record?: EnterpriseEntity;
    errors?: Record<string, string>;
  };
}

describe('CRUD + computed score', () => {
  it('stamps a deterministic leadScore and applies stage/priority defaults', async () => {
    const res = await create({
      name: 'Acme deal',
      dealValue: 20000,
      priority: 'high',
      source: 'referral',
      stage: 'qualified',
    });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({ stage: 'qualified', priority: 'high' });
    expect(res.record?.fields.leadScore).toBe(
      calculateLeadScore({
        stage: 'qualified',
        dealValue: 20000,
        priority: 'high',
        source: 'referral',
      }),
    );
  });

  it('defaults stage=new, priority=medium and scores accordingly', async () => {
    const res = await create({ name: 'Bare lead' });
    expect(res.record?.fields).toMatchObject({ stage: 'new', priority: 'medium' });
    expect(typeof res.record?.fields.leadScore).toBe('number');
  });

  it('requires a lead name', async () => {
    expect((await create({ company: 'Acme' })).ok).toBe(false);
  });
});

describe('RBAC', () => {
  it('reads authorize crm:read, writes crm:manage', async () => {
    await create({ name: 'Acme deal' });
    expect(rec.authorized).toContain('crm:manage');
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'crm-leads' });
    expect(rec.authorized).toEqual(['crm:read']);
  });
});

describe('timeline events', () => {
  it('emits created / updated (qualify/convert) / status_changed / deleted', async () => {
    const created = await create({ name: 'Acme deal' });
    const id = created.record?.id as string;
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.created',
      source: 'enterprise:crm-leads',
    });

    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'crm-leads',
      id,
      fields: { stage: 'won' },
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.updated');

    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: 'crm-leads',
      id,
      status: 'archived',
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.status_changed');

    await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: 'crm-leads', id });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.deleted');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
    }>;
    expect(summaries[0]).toMatchObject({ id: 'crm-leads', aiSummary: true });
  });

  it('falls back to a deterministic summary with score + risk', async () => {
    aiNarrative = null;
    const created = await create({ name: 'Acme deal', dealValue: 20000, stage: 'qualified' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'crm-leads',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.summary).toMatch(/\/100/); // score explanation present
    expect(['low', 'medium', 'high']).toContain(summary.risk);
  });

  it('uses the AI narrative; score/health stay deterministic', async () => {
    aiNarrative = {
      summary: 'AI lead',
      executiveExplanation: 'AI exec',
      grounded: true,
      model: 'm',
    };
    const created = await create({ name: 'Acme deal', stage: 'won' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'crm-leads',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI lead');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // won → deterministic low
  });
});

describe('runLeadAi', () => {
  const l = lead();
  const signals = {
    score: 65,
    probability: 0.4,
    health: { level: 'medium' as const, reason: 'ok' },
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
    expect(await runLeadAi(engine, l, signals)).toMatchObject({ summary: 'hi', grounded: true });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runLeadAi(engine, l, signals)).toBeNull();
  });
});
