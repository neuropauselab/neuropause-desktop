/**
 * PROGRAM 13C ROUND 2 — the five legacy subsystems, two tenants.
 *
 * Each of these predates tenancy: no owner on the record, no seam on the store,
 * and a channel that checked capability rather than ownership. Four of the five
 * were reachable through the PUBLIC allowlist or an `EmptyRequest` schema, and
 * two of them let one tenant EXECUTE work inside another's context.
 *
 * The tests are written against the stores rather than the IPC handlers because
 * that is where the boundary now lives — a handler test would prove the wiring
 * and miss the next handler somebody adds over the same store.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutomationRule, ExecutiveDecision, TenantScope } from '@neuropause/shared';
import { AutomationStore } from '../../enterprise/automationStore';
import { DecisionStore } from '../../enterprise/decisionStore';
import { ExecuteEngine } from '../../executeEngine';
import { MARKER_A, MARKER_B, TENANT_A, TENANT_B } from './twoTenantFixture';

let scope: TenantScope | null = TENANT_A;
let dir: string;
let automations: AutomationStore;
let decisions: DecisionStore;

beforeEach(async () => {
  dir = join(tmpdir(), `np-legacy-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  automations = new AutomationStore(join(dir, 'automations.json')).bindScope(() => scope);
  decisions = new DecisionStore(join(dir, 'decisions.json')).bindScope(() => scope);
  scope = TENANT_A;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

function rule(id: string, marker: string): AutomationRule {
  return {
    id,
    name: `Rule ${marker}`,
    description: marker,
    status: 'active',
    trigger: { type: 'connector-event', connectorId: 'gmail', event: 'message.received' },
    conditions: [{ field: 'from', operator: 'contains', value: marker }],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'ai-summarize', label: 'Summarize with AI' }],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  } as unknown as AutomationRule;
}

function decision(id: string, marker: string): ExecutiveDecision {
  return {
    id,
    title: `Decision ${marker}`,
    category: 'operational',
    description: `Confidential rationale. ${marker}`,
    reasoning: marker,
    evidence: [marker],
    businessImpact: marker,
    owner: marker,
    status: 'proposed',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    history: [],
  } as unknown as ExecutiveDecision;
}

/* ── H1: automation rules ───────────────────────────────────────────────── */

describe('H1 — automation rules', () => {
  async function seedBoth(): Promise<void> {
    scope = TENANT_A;
    await automations.save(rule('rule-a', MARKER_A));
    scope = TENANT_B;
    await automations.save(rule('rule-b', MARKER_B));
  }

  it('A lists only A’s rules; B only B’s', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(automations.all().map((r) => r.id)).toEqual(['rule-a']);
    expect(JSON.stringify(automations.all())).not.toContain(MARKER_B);
    scope = TENANT_B;
    expect(automations.all().map((r) => r.id)).toEqual(['rule-b']);
  });

  it('A cannot GET B’s rule by id', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(automations.get('rule-b')).toBeNull();
    scope = TENANT_B;
    expect(automations.get('rule-a')).toBeNull();
  });

  /** The write-side IDOR: `save` is keyed by id, so an unchecked replace is a hijack. */
  it('A cannot OVERWRITE B’s rule by re-using its id', async () => {
    await seedBoth();
    scope = TENANT_A;
    const res = await automations.save(rule('rule-b', 'HIJACKED'));
    expect(res.ok).toBe(false);

    scope = TENANT_B;
    expect(automations.get('rule-b')?.description).toBe(MARKER_B);
  });

  it('A cannot change B’s status, record a run on it, or delete it', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(await automations.setStatus('rule-b', 'paused', '2026-08-11T01:00:00.000Z')).toBeNull();
    expect(
      await automations.recordRun('rule-b', { at: '2026-08-11T01:00:00.000Z', ok: false }),
    ).toBeNull();
    expect(await automations.remove('rule-b')).toBe(false);

    scope = TENANT_B;
    expect(automations.get('rule-b')?.status).toBe('active');
  });

  /**
   * The producer defect: every install rule was dispatched against every
   * tenant's events, so another tenant's record data could leave the machine
   * through a rule its owner never wrote.
   */
  it('the producer selects rules by the EVENT’s tenant, not the install', async () => {
    await seedBoth();
    expect(automations.activeRulesForTenant(TENANT_A.tenantId).map((r) => r.id)).toEqual(['rule-a']);
    expect(automations.activeRulesForTenant(TENANT_B.tenantId).map((r) => r.id)).toEqual(['rule-b']);
    // An unowned or unknown event tenant selects nothing.
    expect(automations.activeRulesForTenant('')).toEqual([]);
    expect(automations.activeRulesForTenant('org-ghost')).toEqual([]);
  });

  it('the summary counts only the caller’s rules', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(automations.summary().total).toBe(1);
  });

  it('an unresolved caller reads nothing and cannot write', async () => {
    await seedBoth();
    scope = null;
    expect(automations.all()).toEqual([]);
    expect(automations.get('rule-a')).toBeNull();
    await expect(automations.save(rule('orphan', 'X'))).rejects.toThrow(/no owner/i);
  });
});

/* ── H2: executive decisions ────────────────────────────────────────────── */

describe('H2 — executive decisions', () => {
  async function seedBoth(): Promise<void> {
    scope = TENANT_A;
    await decisions.create(decision('dec-a', MARKER_A));
    scope = TENANT_B;
    await decisions.create(decision('dec-b', MARKER_B));
  }

  it('A lists only A’s decisions, and B’s reasoning never appears', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(decisions.all().map((d) => d.id)).toEqual(['dec-a']);
    expect(JSON.stringify(decisions.all())).not.toContain(MARKER_B);
  });

  it('A cannot GET or TRANSITION B’s decision', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(decisions.get('dec-b')).toBeNull();
    expect(
      await decisions.setStatus('dec-b', 'approved', '2026-08-11T01:00:00.000Z'),
    ).toBeNull();
    scope = TENANT_B;
    expect(decisions.get('dec-b')?.status).toBe('proposed');
  });

  it('A cannot OVERWRITE B’s decision by re-using its id', async () => {
    await seedBoth();
    scope = TENANT_A;
    await decisions.create(decision('dec-b', 'HIJACKED'));
    scope = TENANT_B;
    expect(decisions.get('dec-b')?.description).toContain(MARKER_B);
  });

  it('the summary describes only the caller’s decisions', async () => {
    await seedBoth();
    scope = TENANT_A;
    expect(JSON.stringify(decisions.summary())).not.toContain(MARKER_B);
  });
});

/* ── H5: ExecuteEngine sessions and history ─────────────────────────────── */

describe('H5 — execution sessions and history', () => {
  /**
   * `ExecutionSession.result` is the full structured output of every executed
   * action — infrastructure changes, sends, approved worker actions — and both
   * accessors were served by channels with no permission at all.
   */
  function engineFor(): ExecuteEngine {
    return new ExecuteEngine({ tenantId: () => scope?.tenantId ?? null });
  }

  it('history and active sessions are scoped to the caller', async () => {
    const engine = engineFor();
    engine.register('task', async () => ({ ok: true, summary: 'done', result: null }));

    scope = TENANT_A;
    await engine.execute({ kind: 'task', input: MARKER_A } as never);
    scope = TENANT_B;
    await engine.execute({ kind: 'task', input: MARKER_B } as never);

    scope = TENANT_A;
    const aHistory = engine.getHistory();
    expect(aHistory).toHaveLength(1);
    expect(JSON.stringify(aHistory)).not.toContain(MARKER_B);

    scope = TENANT_B;
    expect(engine.getHistory()).toHaveLength(1);
  });

  it('stats never aggregate across tenants', async () => {
    const engine = engineFor();
    engine.register('task', async () => ({ ok: true, summary: 'done', result: null }));
    scope = TENANT_A;
    await engine.execute({ kind: 'task', input: 'a' } as never);
    await engine.execute({ kind: 'task', input: 'a2' } as never);
    scope = TENANT_B;
    await engine.execute({ kind: 'task', input: 'b' } as never);

    scope = TENANT_A;
    const a = engine.stats();
    scope = TENANT_B;
    const b = engine.stats();
    expect(a).not.toEqual(b);
  });

  it('an unresolved caller sees NO execution history', async () => {
    const engine = engineFor();
    engine.register('task', async () => ({ ok: true, summary: 'done', result: null }));
    scope = TENANT_A;
    await engine.execute({ kind: 'task', input: MARKER_A } as never);
    scope = null;
    expect(engine.getHistory()).toEqual([]);
    expect(engine.activeSessions()).toEqual([]);
  });

  it('A cannot CANCEL a session it does not own', () => {
    const engine = engineFor();
    scope = TENANT_A;
    // A session id that does not belong to A resolves to nothing.
    expect(engine.cancel('exec-belonging-to-b')).toBeNull();
  });
});
