/**
 * Governed delete + Decision Records — evidence before mutation.
 *
 * The property under test: a record with REAL incoming relationship links is
 * never deleted on the first click. The assessment (counted evidence, the
 * archive alternative) comes back instead; only an explicit force proceeds;
 * and both paths land a Decision Record that reconstructs the moment.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ActionAssessment,
  EnterpriseModuleMutationResult,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import {
  EnterpriseModuleRegistry,
  buildModuleHandlers,
  defineEnterpriseModule,
  EnterpriseRecordStore,
} from '../enterprise/framework';
import { assessDeleteAgainstLinks, DecisionRecordStore, type IncomingLink } from './decisionService';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-09T12:00:00.000Z';

describe('assessDeleteAgainstLinks', () => {
  const link = (label: string, sourceModuleId = 'finance'): IncomingLink => ({
    relationshipKey: 'x',
    label,
    sourceModuleId,
  });

  it('no links → null — the delete proceeds exactly as before this feature', () => {
    expect(assessDeleteAgainstLinks('Acme', [])).toBeNull();
  });

  it('links → HIGH RISK with per-relationship counts and the archive alternative', () => {
    const assessment = assessDeleteAgainstLinks('Acme Ltd', [
      link('Customer'),
      link('Customer'),
      link('Customer', 'sales-orders'),
      link('Contact', 'crm'),
    ]);
    expect(assessment?.risk).toBe('high_risk');
    expect(assessment?.recommendation).toContain('Do not delete');
    expect(assessment?.recommendation).toContain('Archive instead');
    const customer = assessment?.evidence.find((e) => e.label.includes('Customer'));
    expect(customer?.count).toBe(3);
    expect(customer?.detail).toContain('Acme Ltd');
    expect(assessment?.alternative).toContain('Every link keeps resolving');
  });
});

describe('The delete handler, governed', () => {
  let dir: string;
  let registry: EnterpriseModuleRegistry;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;
  let decisions: DecisionRecordStore;
  let links: IncomingLink[];
  let recordId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-govdel-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    links = [];
    decisions = new DecisionRecordStore(join(dir, 'decisions.json'), () => T0);
    await decisions.load();

    registry = new EnterpriseModuleRegistry();
    const module = defineEnterpriseModule({
      descriptor: {
        id: 'crm-customers',
        title: 'Customers',
        singular: 'Customer',
        plural: 'Customers',
        icon: 'user',
        description: 'test',
        titleField: 'name',
        permissions: { read: 'crm:read', write: 'crm:manage' },
        fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
      },
      store: new EnterpriseRecordStore(join(dir, 'customers.json'), 'crm-customers', 'customer').bindScope(() => TEST_TENANT_SCOPE),
    });
    registry.register(module);
    await module.store.load();
    recordId = module.store.create({ title: 'Acme Ltd', fields: { name: 'Acme Ltd' }, now: T0 }).id;

    const handlers = buildModuleHandlers(registry, {
      authorize: () => undefined,
      audit: () => undefined,
      broadcast: () => undefined,
      actor: () => 'tester',
      now: () => T0,
      assessDelete: (_moduleId, record) => assessDeleteAgainstLinks(record.title, links),
      recordDecision: (entry) => decisions.record({ ...entry, actor: 'tester' }),
    });
    const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('an unlinked record deletes exactly as before — no assessment, no friction', async () => {
    const result = (await call(IpcChannel.EnterpriseModuleDelete, {
      moduleId: 'crm-customers',
      id: recordId,
    })) as EnterpriseModuleMutationResult;
    expect(result.ok).toBe(true);
    expect(result.assessment).toBeUndefined();
    expect(decisions.count()).toBe(0);
  });

  it('a LINKED record is refused with the evidence — nothing mutates', async () => {
    links = [
      { relationshipKey: 'invoice.customer', label: 'Customer', sourceModuleId: 'finance' },
      { relationshipKey: 'order.customer', label: 'Customer', sourceModuleId: 'sales-orders' },
    ];
    const result = (await call(IpcChannel.EnterpriseModuleDelete, {
      moduleId: 'crm-customers',
      id: recordId,
    })) as EnterpriseModuleMutationResult;
    expect(result.ok).toBe(false);
    expect(result.assessment?.risk).toBe('high_risk');
    // The record is untouched.
    const store = registry.get('crm-customers')!.store;
    expect(store.get(recordId)?.status).toBe('active');
    // The refusal itself is a recorded decision.
    const record = decisions.list()[0]!;
    expect(record.outcome).toBe('cancelled');
    expect(record.subject).toContain('Acme Ltd');
    expect(record.executed).toContain('Nothing');
  });

  it('force acknowledges the assessment: deletes, and records "proceeded"', async () => {
    links = [{ relationshipKey: 'invoice.customer', label: 'Customer', sourceModuleId: 'finance' }];
    const result = (await call(IpcChannel.EnterpriseModuleDelete, {
      moduleId: 'crm-customers',
      id: recordId,
      force: true,
    })) as EnterpriseModuleMutationResult;
    expect(result.ok).toBe(true);
    expect(registry.get('crm-customers')!.store.get(recordId)?.status).toBe('deleted');
    const record = decisions.list()[0]!;
    expect(record.outcome).toBe('proceeded');
    expect(record.assessment.risk).toBe('high_risk');
    expect(record.executed).toContain('force acknowledged');
  });

  it('decision records survive a reload — organizational memory, not session state', async () => {
    links = [{ relationshipKey: 'k', label: 'Customer', sourceModuleId: 'finance' }];
    await call(IpcChannel.EnterpriseModuleDelete, { moduleId: 'crm-customers', id: recordId });
    await decisions.flush();
    const again = new DecisionRecordStore(join(dir, 'decisions.json'));
    await again.load();
    expect(again.count()).toBe(1);
    expect(again.list()[0]!.requestedAction).toContain('Delete customer');
  });

  it('the assessment shape carries everything the dialog renders', () => {
    const assessment: ActionAssessment | null = assessDeleteAgainstLinks('X', [
      { relationshipKey: 'k', label: 'Customer', sourceModuleId: 'finance' },
    ]);
    expect(assessment).toMatchObject({
      risk: 'high_risk',
      alternative: expect.stringContaining('Archive'),
    });
    expect(assessment?.evidence.length).toBeGreaterThan(0);
  });
});
