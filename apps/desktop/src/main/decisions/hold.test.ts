/**
 * NeuroPause HOLD — the third terminal state, end to end.
 *
 * These tests drive the REAL delete handler through the REAL registry with the
 * REAL hold + decision stores wired exactly as `enterprise/index.ts` wires
 * them, because the interesting failures live in the seams, not the units:
 *
 *  - a refusal must OPEN a durable hold, not just return a dialog payload;
 *  - the hold must survive a restart (a hold you lose on quit is not a hold);
 *  - resolving must be idempotent and must not resurrect;
 *  - forcing through must CLOSE the hold it overrode, or the list fills with
 *    resolved-in-reality-but-open-on-screen items and stops being read;
 *  - the paired Decision Record must reconstruct the moment from real data.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EnterpriseModuleMutationResult, IpcChannelName } from '@neuropause/shared';
import { IpcChannel, holdFromAssessment } from '@neuropause/shared';
import {
  EnterpriseModuleRegistry,
  buildModuleHandlers,
  defineEnterpriseModule,
  EnterpriseRecordStore,
} from '../enterprise/framework';
import { assessDeleteAgainstLinks, DecisionRecordStore, type IncomingLink } from './decisionService';
import { HoldStore } from './holdStore';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const T0 = '2026-08-09T12:00:00.000Z';

describe('holdFromAssessment', () => {
  const assessment = assessDeleteAgainstLinks('Acme Ltd', [
    { relationshipKey: 'invoice.customer', label: 'Customer', sourceModuleId: 'finance' },
    { relationshipKey: 'order.customer', label: 'Customer', sourceModuleId: 'sales-orders' },
  ])!;

  it('answers all five questions a person needs to clear a hold', () => {
    const hold = holdFromAssessment(assessment, 'customer "Acme Ltd"');
    expect(hold.reason).toBe('high_risk');
    expect(hold.why).toContain('2 live dependencies');
    expect(hold.why.startsWith('Customer')).toBe(true); // sentence-cased, not 'customer …'
    expect(hold.known.length).toBeGreaterThan(0);
    expect(hold.unknown.length).toBeGreaterThan(0);
    expect(hold.resolution).toContain('Archive');
    expect(hold.ifProceeding).toContain('stops resolving');
  });

  it('carries the assessment’s OWN counted evidence, not a restatement', () => {
    const hold = holdFromAssessment(assessment, 'x');
    expect(hold.known).toEqual(assessment.evidence.map((e) => e.detail));
  });

  it('an insufficient-evidence assessment offers no "proceed anyway" story', () => {
    const hold = holdFromAssessment(
      { risk: 'insufficient_evidence', recommendation: 'r', evidence: [], alternative: null },
      'x',
    );
    expect(hold.reason).toBe('insufficient_evidence');
    expect(hold.ifProceeding).toBe('');
  });
});

describe('HoldStore', () => {
  let dir: string;
  let holds: HoldStore;
  const base = {
    title: 'Delete customer "Acme Ltd"',
    subject: 'crm-customers/rec_1 (Acme Ltd)',
    reason: 'high_risk' as const,
    why: 'why',
    known: ['k'],
    unknown: ['u'],
    resolution: 'Archive instead.',
    ifProceeding: 'links break',
  };

  beforeEach(async () => {
    dir = join(tmpdir(), `np-hold-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    holds = new HoldStore(join(dir, 'holds.json'), () => T0);
    await holds.load();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('re-raising the same subject reuses the open hold — one situation, one item', () => {
    const a = holds.open(base);
    const b = holds.open(base);
    expect(b.id).toBe(a.id);
    expect(holds.openCount()).toBe(1);
  });

  it('a resolved hold does not block a genuinely new one for the same subject', () => {
    const first = holds.open(base);
    holds.resolve(first.id, 'took_alternative', 'archived');
    const second = holds.open(base);
    expect(second.id).not.toBe(first.id);
    expect(holds.openCount()).toBe(1);
  });

  it('resolving twice is a no-op, not a second resolution', () => {
    const hold = holds.open(base);
    expect(holds.resolve(hold.id, 'cancelled', 'no')).not.toBeNull();
    expect(holds.resolve(hold.id, 'proceeded', 'yes')).toBeNull();
    expect(holds.get(hold.id)?.resolvedOutcome).toBe('cancelled');
  });

  it('survives a restart — a hold lost on quit is not a hold', async () => {
    holds.open(base);
    await holds.flush();
    const reopened = new HoldStore(join(dir, 'holds.json'));
    await reopened.load();
    expect(reopened.openCount()).toBe(1);
    expect(reopened.openHolds()[0]!.resolution).toBe('Archive instead.');
  });
});

/**
 * The composition-root policy, reproduced EXACTLY as `enterprise/index.ts`
 * wires it. If that wiring and this diverge the test is worthless, so the
 * recordDecision body below is deliberately a copy of the real one.
 */
describe('Governed delete raises and clears a real hold', () => {
  let dir: string;
  let registry: EnterpriseModuleRegistry;
  let call: (channel: IpcChannelName, payload: unknown) => Promise<unknown>;
  let decisions: DecisionRecordStore;
  let holds: HoldStore;
  let links: IncomingLink[];
  let recordId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-hold-e2e-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    links = [{ relationshipKey: 'invoice.customer', label: 'Customer', sourceModuleId: 'finance' }];
    decisions = new DecisionRecordStore(join(dir, 'decisions.json'), () => T0);
    holds = new HoldStore(join(dir, 'holds.json'), () => T0);
    await Promise.all([decisions.load(), holds.load()]);

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
      recordDecision: (entry) => {
        let holdId: string | null = null;
        if (entry.outcome === 'cancelled') {
          holdId = holds.open({
            ...holdFromAssessment(entry.assessment, entry.requestedAction.replace(/^Delete /, '')),
            title: entry.requestedAction,
            subject: entry.subject,
            actor: 'tester',
          }).id;
        } else {
          holdId = holds.resolveSubject(entry.subject, entry.outcome, entry.executed)?.id ?? null;
        }
        const record = decisions.record({ ...entry, actor: 'tester', holdId });
        return { decisionId: record.id, holdId };
      },
    });
    const byChannel = new Map(handlers.map((h) => [h.channel as string, h]));
    call = async (channel, payload) => {
      const handler = byChannel.get(channel);
      if (!handler) throw new Error(`no handler ${channel}`);
      return handler.handler(handler.schema.parse(payload));
    };
  });

  afterEach(async () => {
    // Drain every in-flight atomic write before the directory disappears —
    // otherwise the store's tmp+rename races the cleanup and surfaces as an
    // unhandled ENOENT that has nothing to do with the behaviour under test.
    await Promise.all([
      registry.get('crm-customers')!.store.flush(),
      holds.flush(),
      decisions.flush(),
    ]);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  const del = (force?: boolean): Promise<EnterpriseModuleMutationResult> =>
    call(IpcChannel.EnterpriseModuleDelete, {
      moduleId: 'crm-customers',
      id: recordId,
      ...(force === undefined ? {} : { force }),
    }) as Promise<EnterpriseModuleMutationResult>;

  it('a refused delete opens a durable hold and hands its id to the caller', async () => {
    const result = await del();
    expect(result.ok).toBe(false);
    expect(result.holdId).toBeTruthy();
    const hold = holds.get(result.holdId!)!;
    expect(hold.status).toBe('open');
    expect(hold.title).toBe('Delete customer "Acme Ltd"');
    expect(hold.known[0]).toContain('Acme Ltd');
    // The record itself is untouched — a hold mutates nothing.
    expect(registry.get('crm-customers')!.store.get(recordId)?.status).toBe('active');
  });

  it('clicking Delete three times is ONE hold, not a pile', async () => {
    await del();
    await del();
    await del();
    expect(holds.openCount()).toBe(1);
    // But every attempt is still recorded — the hold dedupes, the trail does not.
    expect(decisions.count()).toBe(3);
  });

  it('forcing through CLOSES the hold it overrode and records why', async () => {
    const refused = await del();
    const forced = await del(true);
    expect(forced.ok).toBe(true);
    expect(holds.get(refused.holdId!)?.status).toBe('resolved');
    expect(holds.get(refused.holdId!)?.resolvedOutcome).toBe('proceeded');
    expect(holds.openCount()).toBe(0);
    const latest = decisions.list()[0]!;
    expect(latest.outcome).toBe('proceeded');
    expect(latest.holdId).toBe(refused.holdId);
    expect(latest.executed).toContain('force acknowledged');
  });

  it('the hold and its decision survive a restart, still paired', async () => {
    const refused = await del();
    await Promise.all([holds.flush(), decisions.flush()]);

    const holds2 = new HoldStore(join(dir, 'holds.json'));
    const decisions2 = new DecisionRecordStore(join(dir, 'decisions.json'));
    await Promise.all([holds2.load(), decisions2.load()]);

    expect(holds2.openCount()).toBe(1);
    const decision = decisions2.list()[0]!;
    expect(decision.holdId).toBe(refused.holdId);
    expect(holds2.get(decision.holdId!)!.status).toBe('open');
  });

  it('the Decision Record reconstructs the moment from real data', async () => {
    await del();
    const record = decisions.list()[0]!;
    expect(record.actor).toBe('tester');
    expect(record.requestedAction).toBe('Delete customer "Acme Ltd"');
    expect(record.subject).toContain('crm-customers/');
    expect(record.assessment.risk).toBe('high_risk');
    expect(record.assessment.evidence[0]!.count).toBe(1);
    expect(record.assessment.alternative).toContain('Archive');
    expect(record.outcome).toBe('cancelled');
    expect(record.executed).toContain('Nothing');
    // …and the subject history is the full sequence, oldest first.
    await del(true);
    const history = decisions.forSubject(record.subject);
    expect(history.map((r) => r.outcome)).toEqual(['cancelled', 'proceeded']);
  });

  it('an UNLINKED record still deletes with no hold and no friction', async () => {
    links = [];
    const result = await del();
    expect(result.ok).toBe(true);
    expect(result.holdId).toBeUndefined();
    expect(holds.count()).toBe(0);
    expect(decisions.count()).toBe(0);
  });
});
