/**
 * Phase 6 Stage 8 — the composition root: EXACTLY six read-only ap:* channels
 * (requireAuth + autonomousops:read — no mutation surface), the 3 s TTL cache,
 * the D-3 schedule tick (fires due rules ONCE per occurrence through the
 * injected existing-runner port; unparseable/inactive rules never fire), the
 * automation-watch delivery source (governed ITEMS from high findings, deduped),
 * the assistant port, and dispose() cancelling the tick.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, type AutomationRule } from '@neuropause/shared';
import { initAutomationPlatform, type AutomationPlatformDeps } from './index';

/**
 * P13C ROUND 5 — the composed cache is tenant-keyed, so these suites name a
 * tenant. Every existing TTL and memoization assertion keeps its meaning:
 * repeated reads under ONE tenant must still be a single composition.
 */
const PLATFORM_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof PLATFORM_SCOPE => PLATFORM_SCOPE;

const T0 = new Date(2026, 6, 15, 8, 59, 0, 0).getTime(); // local Wed 08:59

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'rule-1',
    name: 'Daily digest',
    trigger: { type: 'schedule', schedule: 'daily 9am' },
    conditions: [],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', config: {} }],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

interface Harness {
  deps: AutomationPlatformDeps;
  fired: { ruleId: string; at: string }[];
  scheduled: { id: string; ms: number }[];
  cancelled: string[];
  sources: string[];
  produceWatch: () => unknown;
  setNow: (ms: number) => void;
  ruleReads: () => number;
}

function mkDeps(over: Partial<AutomationPlatformDeps> = {}): Harness {
  let nowMs = T0;
  let ruleReads = 0;
  const fired: Harness['fired'] = [];
  const scheduled: Harness['scheduled'] = [];
  const cancelled: string[] = [];
  const sources: string[] = [];
  let produce: () => unknown = () => null;
  const deps: AutomationPlatformDeps = {
  scope,
    rules: () => {
      ruleReads += 1;
      return [rule()];
    },
    runRecords: () => [],
    workflowRuns: () => [],
    sessions: () => [],
    jobsAwaiting: () => [],
    chains: () => [],
    orgRoles: () => [],
    globalPolicies: () => [],
    knownWorkers: () => [{ id: 'worker:operations', skills: ['briefing', 'recommend', 'remind', 'note'] }],
    installedWorkers: () => [],
    deliverySources: () => [],
    scheduledValidations: () => null,
    autoOpsPlans: () => null,
    sandboxHistory: () => null,
    knowledgeMatch: (refs) => refs.map((ref) => ({ ref, matched: false })),
    fireScheduledRule: (ruleId, at) => {
      fired.push({ ruleId, at });
      return Promise.resolve({ ok: true });
    },
    schedule: {
      every: (id, ms) => {
        scheduled.push({ id, ms });
      },
      cancel: (id) => {
        cancelled.push(id);
      },
    },
    registerSource: (source) => {
      sources.push(source.key);
      produce = () => source.produce();
    },
    now: () => nowMs,
    ...over,
  };
  return {
    deps,
    fired,
    scheduled,
    cancelled,
    sources,
    produceWatch: () => produce(),
    setNow: (ms) => {
      nowMs = ms;
    },
    ruleReads: () => ruleReads,
  };
}

describe('the IPC surface (D-9) — six read-only channels, zero mutation', () => {
  it('registers EXACTLY the six ap:* channels, all requireAuth + autonomousops:read', () => {
    const h = mkDeps();
    const p = initAutomationPlatform(h.deps);
    expect(p.handlers.map((d) => d.channel).sort()).toEqual([
      IpcChannel.ApCatalog,
      IpcChannel.ApDashboard,
      IpcChannel.ApMonitor,
      IpcChannel.ApPlan,
      IpcChannel.ApPlaybooks,
      IpcChannel.ApPolicies,
    ].sort());
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('ap:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      expect(d.permission, String(d.channel)).toBe('autonomousops:read');
    }
  });

  it('no channel name implies mutation (no save/set/run/delete/execute verbs)', () => {
    const p = initAutomationPlatform(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel/);
    }
  });

  it('the playbooks handler returns the registry (all, or one by id) and plan handles unknown ids honestly', async () => {
    const p = initAutomationPlatform(mkDeps().deps);
    const playbooksHandler = p.handlers.find((d) => d.channel === IpcChannel.ApPlaybooks)!.handler;
    const all = (await playbooksHandler({})) as { playbooks: { id: string }[] };
    expect(all.playbooks).toHaveLength(4);
    const one = (await playbooksHandler({ id: 'daily-ops-review' })) as { playbooks: { id: string }[] };
    expect(one.playbooks.map((x) => x.id)).toEqual(['daily-ops-review']);
    const planHandler = p.handlers.find((d) => d.channel === IpcChannel.ApPlan)!.handler;
    expect(await planHandler({ playbookId: 'ghost' })).toEqual({ playbookId: 'ghost', found: false });
  });
});

describe('the 3 s TTL cache', () => {
  it('reuses the computed catalog within the TTL and recomputes after it', () => {
    const h = mkDeps();
    const p = initAutomationPlatform(h.deps);
    const a = p.catalog();
    const b = p.catalog();
    expect(b).toBe(a); // same object within TTL
    const readsBefore = h.ruleReads();
    h.setNow(T0 + 3_100);
    const c = p.catalog();
    expect(c).not.toBe(a);
    expect(h.ruleReads()).toBeGreaterThan(readsBefore);
  });

  it('plans are TTL-cached per playbook', () => {
    const h = mkDeps();
    const p = initAutomationPlatform(h.deps);
    const a = p.plan('daily-ops-review');
    expect(p.plan('daily-ops-review')).toBe(a);
    h.setNow(T0 + 3_100);
    expect(p.plan('daily-ops-review')).not.toBe(a);
    expect(p.plan('ghost')).toBeNull();
  });
});

describe('D-3 — the schedule tick (the first-ever schedule emitter)', () => {
  it('registers a 60 s cadence on the EXISTING scheduler seam and dispose() cancels it', () => {
    const h = mkDeps();
    const p = initAutomationPlatform(h.deps);
    expect(h.scheduled).toEqual([{ id: 'automation-platform:schedule-tick', ms: 60_000 }]);
    p.dispose();
    expect(h.cancelled).toEqual(['automation-platform:schedule-tick']);
  });

  it('fires a due rule ONCE per occurrence through the injected runner port', async () => {
    const h = mkDeps();
    const p = initAutomationPlatform(h.deps);
    const at9 = new Date(2026, 6, 15, 9, 0, 5, 0).getTime();
    expect((await p.tick(at9)).fired).toEqual(['rule-1']);
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0].ruleId).toBe('rule-1');
    // The same occurrence never re-fires (in-memory dedupe)…
    expect((await p.tick(at9 + 20_000)).fired).toEqual([]);
    // …but the next day's occurrence does.
    const nextDay = new Date(2026, 6, 16, 9, 0, 0, 0).getTime();
    expect((await p.tick(nextDay)).fired).toEqual(['rule-1']);
  });

  it('not-due, inactive, unparseable, and non-schedule rules never fire', async () => {
    const h = mkDeps({
      rules: () => [
        rule(), // due only at 9:00
        rule({ id: 'r-paused', status: 'paused' }),
        rule({ id: 'r-bad', trigger: { type: 'schedule', schedule: 'someday' } }),
        rule({ id: 'r-manual', trigger: { type: 'manual' } }),
      ],
    });
    const p = initAutomationPlatform(h.deps);
    expect((await p.tick(new Date(2026, 6, 15, 8, 30, 0, 0).getTime())).fired).toEqual([]);
    expect(h.fired).toEqual([]);
  });

  it('a throwing runner port is contained (logged), never crashing the tick', async () => {
    const h = mkDeps({ fireScheduledRule: () => Promise.reject(new Error('runner offline')) });
    const p = initAutomationPlatform(h.deps);
    const r = await p.tick(new Date(2026, 6, 15, 9, 0, 0, 0).getTime());
    expect(r.fired).toEqual([]);
  });
});

describe('the automation-watch delivery source (items, never actions)', () => {
  it('registers exactly one source and produces governed items for critical/high findings, deduped', () => {
    const h = mkDeps({
      sessions: () => [
        { id: 's-stuck', kind: 'worker', label: 'Stuck sync', state: 'running', startedAt: new Date(T0 - 5 * 3_600_000).toISOString() },
      ],
    });
    initAutomationPlatform(h.deps);
    expect(h.sources).toEqual(['automation-watch']);
    const items = h.produceWatch() as { id: string; governance?: { evidence: string[]; recommendedAction: string } }[];
    expect(items.length).toBe(1);
    expect(items[0].id).toContain('af:stuck-execution');
    expect(items[0].governance?.evidence).toContain('s-stuck');
    expect(items[0].governance?.recommendedAction.length).toBeGreaterThan(0);
    // Dedupe: the same finding is not re-delivered on the next cadence fire.
    expect((h.produceWatch() as unknown[]).length).toBe(0);
  });

  it('medium/low findings do not page anyone', () => {
    const h = mkDeps({
      rules: () => [rule({ id: 'r-bad', trigger: { type: 'schedule', schedule: 'someday' } })], // medium finding
    });
    initAutomationPlatform(h.deps);
    expect((h.produceWatch() as unknown[]).length).toBe(0);
  });
});

describe('the assistant port', () => {
  it('answers the six questions and returns null for everything else', () => {
    const p = initAutomationPlatform(mkDeps().deps);
    const r = p.answerQuestion('what is the status of my automations?', new Date(T0).toISOString());
    expect(r?.kind).toBe('intelligence');
    expect(p.answerQuestion('draft an email', new Date(T0).toISOString())).toBeNull();
  });
});

describe('failure isolation (honesty)', () => {
  it('a throwing read becomes an explicit unavailable entry — never a fabricated value', () => {
    const h = mkDeps({
      runRecords: () => {
        throw new Error('run store offline');
      },
    });
    const p = initAutomationPlatform(h.deps);
    const c = p.catalog();
    expect(c.unavailable).toContainEqual({ system: 'automation-runs', reason: 'run store offline' });
    const d = p.dashboard();
    expect(d.unavailable.some((u) => u.system === 'automation-runs')).toBe(true);
  });
});
