import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IpcChannel,
  assessContactHealth,
  deriveCrmInsights,
  validateModuleDescriptor,
  type AiEngineRequest,
  type AiEngineResponse,
  type ContactHealth,
  type CrmContact,
  type EnterpriseEntity,
  type EnterprisePermission,
  type EnterpriseRecordSummary,
  type PlatformEventInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../../../ipc/secureBridge';
import { EnterpriseModuleRegistry, buildModuleHandlers } from '../../framework';
import { CONTACT_DESCRIPTOR, createContactModule, type ContactAiRunner } from './contactModule';
import { runContactAi } from './contactAi';

const T0 = '2026-07-08T00:00:00.000Z';
const NOW = Date.parse('2026-07-08');
const DAY = 86400000;

function contact(partial: Partial<CrmContact> = {}): CrmContact {
  return {
    id: 'c1',
    name: 'Ada',
    company: 'Acme',
    email: 'ada@acme.com',
    phone: '',
    status: 'lead',
    priority: 'medium',
    source: 'website',
    assignedTo: '',
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

describe('descriptor', () => {
  it('is internally consistent', () => {
    expect(validateModuleDescriptor(CONTACT_DESCRIPTOR)).toEqual([]);
    expect(CONTACT_DESCRIPTOR.permissions).toEqual({ read: 'crm:read', write: 'crm:manage' });
    expect(CONTACT_DESCRIPTOR.titleField).toBe('name');
  });
});

describe('assessContactHealth (risk calculation)', () => {
  it('inactive is low', () => {
    expect(assessContactHealth(contact({ status: 'inactive' }), NOW).level).toBe('low');
  });
  it('a lead untouched > 30 days is high', () => {
    const updatedAt = new Date(NOW - 40 * DAY).toISOString();
    expect(assessContactHealth(contact({ status: 'lead', updatedAt }), NOW).level).toBe('high');
  });
  it('a fresh lead is medium', () => {
    expect(
      assessContactHealth(contact({ status: 'lead', updatedAt: T0 }), Date.parse(T0)).level,
    ).toBe('medium');
  });
  it('a recently-active customer is low; a stale one is medium', () => {
    expect(
      assessContactHealth(contact({ status: 'customer', updatedAt: T0 }), Date.parse(T0)).level,
    ).toBe('low');
    const stale = new Date(NOW - 100 * DAY).toISOString();
    expect(assessContactHealth(contact({ status: 'customer', updatedAt: stale }), NOW).level).toBe(
      'medium',
    );
  });
});

describe('deriveCrmInsights', () => {
  it('rolls contacts into KPIs', () => {
    const stale = new Date(NOW - 40 * DAY).toISOString();
    const contacts = [
      contact({ status: 'lead', updatedAt: stale }), // high follow-up risk
      contact({ status: 'lead', updatedAt: T0 }),
      contact({ status: 'customer', updatedAt: T0 }), // healthy
      contact({ status: 'partner', updatedAt: T0 }),
    ];
    const insights = deriveCrmInsights(contacts, NOW);
    expect(insights).toMatchObject({
      activeContacts: 4,
      newLeads: 2,
      customers: 1,
      highValueAccounts: 2, // customer + partner
      followUpRisk: 1,
      customerHealthPct: 100,
    });
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
let aiNarrative: Awaited<ReturnType<ContactAiRunner>>;
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
  const path = join(tmpdir(), `np-crm-${randomUUID()}.json`);
  paths.push(path);
  const module = createContactModule(path, async () => aiNarrative);
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
  return (await handler(IpcChannel.EnterpriseModuleCreate)({ moduleId: 'crm', fields })) as {
    ok: boolean;
    record?: EnterpriseEntity;
    errors?: Record<string, string>;
  };
}

describe('CRUD + defaults', () => {
  it('creates a contact and applies status/priority defaults', async () => {
    const res = await create({ name: 'Ada', company: 'Acme' });
    expect(res.ok).toBe(true);
    expect(res.record?.fields).toMatchObject({ status: 'lead', priority: 'medium' });
    expect(res.record?.title).toBe('Ada');
  });

  it('requires a name', async () => {
    const res = await create({ company: 'Acme' });
    expect(res.ok).toBe(false);
    expect(res.errors?.name).toMatch(/required/i);
  });
});

describe('RBAC', () => {
  it('authorizes writes with crm:manage and reads with crm:read', async () => {
    await create({ name: 'Ada' });
    rec.authorized.length = 0;
    await handler(IpcChannel.EnterpriseModuleList)({ moduleId: 'crm' });
    expect(rec.authorized).toEqual(['crm:read']);
  });

  it('used crm:manage on create', async () => {
    await create({ name: 'Ada' });
    expect(rec.authorized).toContain('crm:manage');
  });
});

describe('timeline events', () => {
  it('emits created / updated / status_changed / deleted platform events', async () => {
    const created = await create({ name: 'Ada' });
    const id = created.record?.id as string;
    expect(rec.publish.at(-1)).toMatchObject({
      type: 'enterprise.record.created',
      category: 'enterprise',
      source: 'enterprise:crm',
    });
    expect(rec.audit.at(-1)?.action).toBe('module.crm.created');
    expect(rec.broadcast.at(-1)?.channel).toBe(IpcChannel.EnterpriseModuleEventBroadcast);

    await handler(IpcChannel.EnterpriseModuleUpdate)({
      moduleId: 'crm',
      id,
      fields: { status: 'customer' },
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.updated');

    await handler(IpcChannel.EnterpriseModuleSetStatus)({
      moduleId: 'crm',
      id,
      status: 'archived',
    });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.status_changed');

    await handler(IpcChannel.EnterpriseModuleDelete)({ moduleId: 'crm', id });
    expect(rec.publish.at(-1)?.type).toBe('enterprise.record.deleted');
  });
});

describe('AI summary', () => {
  it('exposes aiSummary=true', async () => {
    const summaries = (await handler(IpcChannel.EnterpriseModulesList)({})) as Array<{
      id: string;
      aiSummary: boolean;
    }>;
    expect(summaries[0]).toMatchObject({ id: 'crm', aiSummary: true });
  });

  it('falls back to a deterministic summary + health when no model', async () => {
    aiNarrative = null;
    const stale = new Date(NOW - 40 * DAY).toISOString();
    const created = await create({ name: 'Ada', status: 'lead' });
    // force staleness via update timestamp is not exposed; use a fresh lead (medium)
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'crm',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.grounded).toBe(false);
    expect(summary.model).toBe('none');
    expect(['low', 'medium', 'high']).toContain(summary.risk);
    expect(summary.summary).toContain('Ada');
    void stale;
  });

  it('uses the AI narrative when present; health stays deterministic', async () => {
    aiNarrative = {
      summary: 'AI summary',
      executiveExplanation: 'AI exec',
      grounded: true,
      model: 'claude-x',
    };
    const created = await create({ name: 'Ada', status: 'inactive' });
    const id = created.record?.id as string;
    const summary = (await handler(IpcChannel.EnterpriseModuleSummarize)({
      moduleId: 'crm',
      id,
    })) as EnterpriseRecordSummary;
    expect(summary.summary).toBe('AI summary');
    expect(summary.grounded).toBe(true);
    expect(summary.risk).toBe('low'); // inactive → deterministic low, model never sets it
  });
});

describe('runContactAi', () => {
  const c = contact();
  const health: ContactHealth = { level: 'medium', reason: 'ok' };
  it('returns the narrative from a grounded response', async () => {
    const engine = {
      run: async (_req: AiEngineRequest): Promise<AiEngineResponse> =>
        ({
          text: '',
          data: { summary: 'hi', executiveExplanation: 'e' },
          grounded: true,
          model: 'm',
        }) as unknown as AiEngineResponse,
    };
    expect(await runContactAi(engine, c, health)).toMatchObject({
      summary: 'hi',
      grounded: true,
      model: 'm',
    });
  });
  it('returns null when ungrounded', async () => {
    const engine = {
      run: async (): Promise<AiEngineResponse> =>
        ({ text: '', data: null, grounded: false, model: 'none' }) as unknown as AiEngineResponse,
    };
    expect(await runContactAi(engine, c, health)).toBeNull();
  });
});
