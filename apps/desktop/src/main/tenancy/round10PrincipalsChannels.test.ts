/**
 * P13C ROUND 10 — FIVE MEDIUMS THAT SHARE ONE MISTAKE.
 *
 * NEW-M9  the schedule tick ran with NO principal, so `automationStore.all()`
 *         fell through to the SESSION and every tenant except the signed-in one
 *         silently never had its scheduled automations run;
 * NEW-M10 the memory and graph reprojections resolved their principal at DRAIN
 *         time while the file next door states the opposite contract — and the
 *         comment above the code asserted the opposite of the code;
 * NEW-M2  `release:diagnostics.*` and `system:health` served the same
 *         install-wide `bus.metrics()` payload `diagnostics:get` was gated for;
 * NEW-M8  seven channels were on `PUBLIC_CHANNELS` **and** gated by a family
 *         gate, which made the startup invariant blind to a regression on them;
 * NEW-M5  the API gateway stamped every request with the SEEDED developer
 *         account's organization instead of the credential's own;
 * NEW-M11 the event bus replay ring was one install-wide buffer.
 *
 * The mistake underneath all six: an owner was AVAILABLE — on the rule, on the
 * queue item, on the API key row, on the event — and something asked a different
 * question instead ("who is signed in?", "what is the channel called?").
 *
 * HOW THIS SUITE IS WRITTEN
 *
 * Positive fixtures with named counts. Never `A !== B` alone: a test that only
 * asserts two things differ passes when BOTH are wrong, and passes when neither
 * ran. Every case here says what SHOULD have happened, counts it, and then says
 * what must not have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * The userData directory, decided INSIDE `vi.hoisted`.
 *
 * It has to be: the singleton stores this suite drives (`developerStore`,
 * `gatewayStore`, `memoryAuditLog`) resolve their file path by calling
 * `app.getPath('userData')` AT MODULE EVALUATION, which happens while imports
 * are being hoisted — before any top-level statement in this file runs. Setting
 * it afterwards produced an empty base path, so those stores wrote into the
 * repository and carried state between test RUNS.
 */
const mockState = vi.hoisted(() => ({
  userDataDir: `${process.env.TMPDIR ?? '/tmp'}/np-r10-pc-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`.replace(/\/{2,}/g, '/'),
}));
vi.mock('electron', () => ({
  app: {
    getPath: () => mockState.userDataDir,
    getAppPath: () => mockState.userDataDir,
    getVersion: () => '0.0.0-test',
    getName: () => 'neuropause-test',
    isPackaged: false,
    on: () => undefined,
    once: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

/**
 * THE SIGNED-IN SESSION, as a variable a test can change mid-flight.
 *
 * This is the ONE thing mocked about the enterprise root, and it stands in for
 * exactly one real act: the user switching organizations. Everything else —
 * `resolveTenantScope`'s precedence, `runAsPrincipal`, the stores, the gates —
 * is the production code. `resolveTenantScope` is still what decides, so a
 * principal in scope still wins over the session here exactly as it does live.
 */
const session = vi.hoisted(() => ({
  value: null as { tenantId: string; workspaceId: string } | null,
}));

vi.mock('../enterprise', async (importOriginal) => {
  const actual = await importOriginal<EnterpriseModule>();
  const { resolveTenantScope } = await import('./backgroundPrincipal');
  return {
    ...actual,
    activeTenantScope: () => resolveTenantScope(() => session.value),
    activeMemoryViewer: () => {
      const s = resolveTenantScope(() => session.value);
      return s === null
        ? null
        : { tenantId: s.tenantId, workspaceId: s.workspaceId, userId: 'tester@example.com' };
    },
  };
});

/** The UDM the reprojections read. Real emitter, trivial contents. */
vi.mock('../unified/storeInstance', async () => {
  const { EventEmitter: E } = await import('node:events');
  class FakeUnifiedStore extends E {
    query(): { items: unknown[] } {
      return { items: [] };
    }
    counts(): { total: number } {
      return { total: 0 };
    }
  }
  return { unifiedStore: new FakeUnifiedStore() };
});

/**
 * The two projection destinations, replaced by recorders.
 *
 * The question these tests ask is "WHICH PRINCIPAL did the queued work execute
 * under?", so the store is the right thing to stand in for: it is the first
 * thing downstream of the decision, and `currentPrincipal()` read there is the
 * unfaked answer.
 */
vi.mock('../graph/graphInstance', async () => {
  const { EventEmitter: E } = await import('node:events');
  const { currentPrincipal } = await import('./backgroundPrincipal');
  const applies: { tenantId: string | null; jobId: string | null }[] = [];
  const emitter = new E();
  return {
    graphStore: Object.assign(emitter, {
      __applies: applies,
      load: () => Promise.resolve(),
      apply: () => {
        const p = currentPrincipal();
        applies.push({ tenantId: p?.tenantId ?? null, jobId: p?.jobId ?? null });
        return { added: 0, updated: 0, removed: 0 };
      },
      counts: () => ({ nodes: 0, edges: 0 }),
      getNode: () => null,
      listNodes: () => ({ nodes: [], total: 0 }),
      neighbors: () => ({ nodes: [], edges: [] }),
      subgraph: () => ({ nodes: [], edges: [] }),
      path: () => null,
      historyFor: () => [],
    }),
  };
});

vi.mock('../memory/memoryInstance', async () => {
  const { EventEmitter: E } = await import('node:events');
  const { currentPrincipal } = await import('./backgroundPrincipal');
  const applies: { tenantId: string | null; jobId: string | null }[] = [];
  const emitter = new E();
  return {
    memoryStore: Object.assign(emitter, {
      __applies: applies,
      load: () => Promise.resolve(),
      configureSemantic: () => undefined,
      applyProjected: () => {
        const p = currentPrincipal();
        applies.push({ tenantId: p?.tenantId ?? null, jobId: p?.jobId ?? null });
        return { added: 0, updated: 0, removed: 0 };
      },
      counts: () => ({ total: 0 }),
      recall: () => ({ items: [] }),
      recallSemantic: () => ({ items: [] }),
      get: () => null,
      remember: () => null,
      forget: () => 0,
      update: () => null,
      allItems: () => [],
    }),
  };
});

import type {
  AutomationRule,
  EnterprisePermission,
  IpcChannelName,
  PlatformEventInput,
  TenantScope,
} from '@neuropause/shared';
import { EmptyRequest, IpcChannel, RUNTIME_INVOKABLE_CHANNELS } from '@neuropause/shared';
import {
  initAutomationPlatform,
  type AutomationPlatformDeps,
} from '../automationPlatform';
import { forEachTenant } from './backgroundFanOut';
import {
  currentPrincipal,
  resolveTenantScope,
  runAsPrincipal,
  tenantPrincipal,
} from './backgroundPrincipal';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE, TWO_TENANT_FAN_OUT } from './testScope';
import { taskScheduler } from '../services/taskScheduler';
import { EventBus } from '../platform/eventBus';
import { PlatformEventApi } from '../platform/eventApi';
import { TimelineService } from '../platform/timelineService';
import {
  PUBLIC_CHANNELS,
  RUNTIME_CHANNEL_PERMISSIONS,
  assertAllChannelsClassified,
  channelsBothPublicAndGated,
  withRuntimeAuthz,
} from '../ipc/runtimeAuthz';
import { MEMORY_CHANNEL_AUTHORITY } from '../memory/memoryAuthzGate';
import { AI_CHANNEL_AUTHORITY } from '../ai/aiAuthzGate';
import { runSecureHandler } from '../ipc/secureBridge';
import type { AnySecureHandlerDef, SecureHandlerDef } from '../ipc/secureBridge';
import { initGraph } from '../graph';
import { initMemory } from '../memory';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { runGateway } from '../ecosystem';
import { developerStore } from '../ecosystem/developer/developerInstance';
import { gatewayStore } from '../ecosystem/gateway/gatewayInstance';

/** The mocked UDM emitter and the two recorders, under readable names. */
const fakeUnified = unifiedStore as unknown as EventEmitter;
interface RanAs {
  tenantId: string | null;
  jobId: string | null;
}
const graphApplies = (graphStore as unknown as { __applies: RanAs[] }).__applies;
const memoryApplies = (memoryStore as unknown as { __applies: RanAs[] }).__applies;

const A = TEST_TENANT_SCOPE; // org-test
const B = OTHER_TENANT_SCOPE; // org-other
const C: TenantScope = { tenantId: 'org-charlie', workspaceId: 'workspace-charlie' };

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M9 — a scheduled rule runs as ITS OWNER, and every tenant gets its tick
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Local Wed 2026-07-15 09:00 — the occurrence `daily 9am` is due at. */
const AT_9 = new Date(2026, 6, 15, 9, 0, 0, 0).getTime();
const NEXT_DAY_9 = new Date(2026, 6, 16, 9, 0, 0, 0).getTime();

function scheduleRule(id: string, tenantId: string): AutomationRule {
  return {
    tenantId,
    id,
    name: `${id} digest`,
    trigger: { type: 'schedule', schedule: 'daily 9am' },
    conditions: [],
    conditionLogic: 'all',
    actions: [{ id: 'a1', type: 'notify', label: 'Notify', config: {} }],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

interface FireRecord {
  ruleId: string;
  /** The principal the runner port actually saw. */
  principalTenant: string | null;
  /** What a SCOPED STORE would have resolved at that instant. */
  storeScope: string | null;
}

interface TickHarness {
  platform: ReturnType<typeof initAutomationPlatform>;
  fires: FireRecord[];
  /** Invoke whatever callback the platform registered on the scheduler. */
  runRegisteredTick: () => void;
  ruleReadScopes: string[];
}

function mkTickHarness(
  rules: AutomationRule[],
  over: Partial<AutomationPlatformDeps> = {},
): TickHarness {
  const fires: FireRecord[] = [];
  const ruleReadScopes: string[] = [];
  let registered: (() => void) | null = null;
  const scope = (): TenantScope | null => resolveTenantScope(() => session.value);
  const deps: AutomationPlatformDeps = {
    scope,
    /**
     * The REAL shape of `automationStore.all()`: owner-filtered against the
     * resolved scope, which is the principal's when one is running and the
     * session's otherwise. This is why the tick fell through to the session —
     * the store was always right, and nobody told it whose side it was on.
     */
    rules: () => {
      const t = scope()?.tenantId ?? null;
      ruleReadScopes.push(t ?? '<none>');
      return rules.filter((r) => r.tenantId === t);
    },
    runRecords: () => [],
    workflowRuns: () => [],
    sessions: () => [],
    jobsAwaiting: () => [],
    chains: () => [],
    orgRoles: () => [],
    globalPolicies: () => [],
    knownWorkers: () => [],
    installedWorkers: () => [],
    deliverySources: () => [],
    scheduledValidations: () => null,
    autoOpsPlans: () => null,
    sandboxHistory: () => null,
    knowledgeMatch: null,
    fireScheduledRule: (ruleId) => {
      fires.push({
        ruleId,
        principalTenant: currentPrincipal()?.tenantId ?? null,
        storeScope: scope()?.tenantId ?? null,
      });
      return Promise.resolve({ ok: true });
    },
    schedule: {
      every: (_id, _ms, fn) => {
        registered = fn;
      },
      cancel: () => undefined,
    },
    // The REAL fan-out over two operable organizations.
    forEachTenant: (jobId, fn) => forEachTenant(jobId, TWO_TENANT_FAN_OUT, (run) => fn(run)),
    registerSource: () => undefined,
    now: () => AT_9,
    ...over,
  };
  const platform = initAutomationPlatform(deps);
  return {
    platform,
    fires,
    ruleReadScopes,
    runRegisteredTick: () => {
      if (registered === null) throw new Error('no tick was registered on the scheduler');
      (registered as () => void)();
    },
  };
}

describe('NEW-M9 — the schedule tick belongs to the rule’s owner, not to the session', () => {
  beforeEach(() => {
    session.value = B; // B is the organization on screen throughout this suite.
  });

  it('A’s scheduled rule RUNS, and runs AS A, while B is the signed-in session', async () => {
    const h = mkTickHarness([scheduleRule('rule-a', A.tenantId)]);
    const result = await h.platform.tickAllTenants(AT_9);

    // It ran. The positive fact first: this is the half that was broken.
    expect(result.fired, 'A’s rule did not fire at all').toEqual(['rule-a']);
    expect(h.fires).toHaveLength(1);
    // …and it ran as A, both to the principal and to any store it touches.
    expect(h.fires[0].principalTenant).toBe(A.tenantId);
    expect(h.fires[0].storeScope).toBe(A.tenantId);
    // The session never became the answer, at any point in the chain.
    expect(h.fires.map((f) => f.principalTenant)).not.toContain(B.tenantId);
    // Both tenants were served a tick; A having a rule and B not is a fact
    // about the rules, not about who was signed in.
    expect(result.tenants.slice().sort()).toEqual([A.tenantId, B.tenantId].sort());
    // The rule store was read once per tenant, each time under that tenant.
    expect(h.ruleReadScopes.slice().sort()).toEqual([A.tenantId, B.tenantId].sort());
  });

  it('A and B fire in the SAME tick, each as itself — 1 rule each, 2 fires total', async () => {
    const h = mkTickHarness([
      scheduleRule('rule-a', A.tenantId),
      scheduleRule('rule-b', B.tenantId),
    ]);
    const result = await h.platform.tickAllTenants(AT_9);

    expect(result.fired.sort()).toEqual(['rule-a', 'rule-b']);
    expect(h.fires).toHaveLength(2);

    const byRule = new Map(h.fires.map((f) => [f.ruleId, f]));
    expect(byRule.get('rule-a')?.principalTenant).toBe(A.tenantId);
    expect(byRule.get('rule-b')?.principalTenant).toBe(B.tenantId);
    // Exactly one fire per tenant — not two under whichever ran last.
    expect(h.fires.filter((f) => f.principalTenant === A.tenantId)).toHaveLength(1);
    expect(h.fires.filter((f) => f.principalTenant === B.tenantId)).toHaveLength(1);
    // B never saw A's rule, in either direction.
    expect(
      h.fires.filter((f) => f.ruleId === 'rule-a' && f.principalTenant === B.tenantId),
    ).toHaveLength(0);
    expect(
      h.fires.filter((f) => f.ruleId === 'rule-b' && f.principalTenant === A.tenantId),
    ).toHaveLength(0);
  });

  it('three tenants, three rules: every owner is served exactly once', async () => {
    const three = {
      organizations: () => [
        { ...orgRow(A.tenantId) },
        { ...orgRow(B.tenantId) },
        { ...orgRow(C.tenantId) },
      ],
      workspaces: () => [],
    };
    const h = mkTickHarness(
      [
        scheduleRule('rule-a', A.tenantId),
        scheduleRule('rule-b', B.tenantId),
        scheduleRule('rule-c', C.tenantId),
      ],
      { forEachTenant: (jobId, fn) => forEachTenant(jobId, three, (run) => fn(run)) },
    );
    const result = await h.platform.tickAllTenants(AT_9);
    expect(result.fired.sort()).toEqual(['rule-a', 'rule-b', 'rule-c']);
    expect(h.fires).toHaveLength(3);
    expect(h.fires.map((f) => f.principalTenant).sort()).toEqual(
      [A.tenantId, B.tenantId, C.tenantId].sort(),
    );
  });

  it('the callback the platform REGISTERS on the scheduler is the fanned-out one', async () => {
    const h = mkTickHarness([
      scheduleRule('rule-a', A.tenantId),
      scheduleRule('rule-b', B.tenantId),
    ]);
    h.runRegisteredTick();
    // The registered tick is fire-and-forget; let its promise chain settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.fires).toHaveLength(2);
    expect(h.fires.map((f) => f.principalTenant).sort()).toEqual(
      [A.tenantId, B.tenantId].sort(),
    );
  });

  it('a rule with NO stored owner is skipped, not run as the reader', async () => {
    const orphan = scheduleRule('rule-orphan', A.tenantId);
    delete (orphan as { tenantId?: string | null }).tenantId;
    const h = mkTickHarness([orphan, scheduleRule('rule-a', A.tenantId)], {
      // A store that hands back everything, so the skip is the tick's decision
      // rather than the store's filtering.
      rules: () => [orphan, scheduleRule('rule-a', A.tenantId)],
    });
    const result = await h.platform.tickAllTenants(AT_9);
    expect(result.fired).not.toContain('rule-orphan');
    expect(h.fires.filter((f) => f.ruleId === 'rule-orphan')).toHaveLength(0);
    // …and the owned rule beside it still fired, so this is a skip and not a halt.
    expect(h.fires.filter((f) => f.ruleId === 'rule-a').length).toBeGreaterThanOrEqual(1);
  });

  it('a workspace switch DURING the tick cannot move a later rule’s occurrence key into another tenant’s bucket', async () => {
    /**
     * THE POST-AWAIT DRIFT, REPRODUCED PRECISELY.
     *
     * `occurrenceBucket()` used to take no argument and re-read `deps.scope()`
     * once per loop iteration — which is AFTER the PREVIOUS rule's
     * `await fireScheduledRule`. So with two due rules belonging to A, a
     * workspace switch during the first rule's await filed the SECOND rule's
     * "already fired for this occurrence" marker under whichever tenant was now
     * on screen. Two failures follow from one line: A's second rule re-fires on
     * the next tick because its own bucket never recorded it, and the other
     * tenant's identically-keyed rule is suppressed because its bucket now has
     * a marker it never wrote.
     *
     * The bucket is now derived from `rule.tenantId` before any await, so there
     * is no read left in the loop for a switch to change.
     */
    session.value = A;
    const h = mkTickHarness(
      [scheduleRule('rule-a1', A.tenantId), scheduleRule('rule-a2', A.tenantId)],
      {
        fireScheduledRule: (ruleId) => {
          // The first fire is when the user switches organizations.
          if (ruleId === 'rule-a1') session.value = C;
          return Promise.resolve({ ok: true });
        },
      },
    );

    const first = await h.platform.tick(AT_9);
    expect(first.fired.sort()).toEqual(['rule-a1', 'rule-a2']);

    session.value = A; // back where we started
    const second = await h.platform.tick(AT_9);
    expect(
      second.fired,
      'a rule re-fired: its occurrence key was filed under the wrong tenant',
    ).toEqual([]);

    // …and the NEXT occurrence still fires both, so this is dedupe, not a stall.
    session.value = A;
    const nextDay = await h.platform.tick(NEXT_DAY_9);
    expect(nextDay.fired.sort()).toEqual(['rule-a1', 'rule-a2']);
  });

  it('the marker A writes cannot suppress B’s identically-timed rule', async () => {
    const h = mkTickHarness([
      scheduleRule('shared-id', A.tenantId),
      scheduleRule('shared-id', B.tenantId),
    ]);
    // Both rules carry the SAME id, which is what an install-wide bucket would
    // collide on. Two owners, two buckets, two fires.
    const result = await h.platform.tickAllTenants(AT_9);
    expect(result.fired).toEqual(['shared-id', 'shared-id']);
    expect(h.fires).toHaveLength(2);
    expect(h.fires.map((f) => f.principalTenant).sort()).toEqual(
      [A.tenantId, B.tenantId].sort(),
    );
  });
});

function orgRow(id: string): {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: 'business';
  status: 'active';
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, never>;
} {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    type: 'business',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M9 (root cause) — the ONLY recurring scheduler now carries a principal
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('NEW-M9 — taskScheduler: a recurring job names its owners or names none', () => {
  afterEach(() => {
    taskScheduler.stop();
    vi.useRealTimers();
  });

  it('runs the job ONCE PER PRINCIPAL, each under its own', () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const pa = tenantPrincipal({ jobId: 'j', scope: A })!;
    const pb = tenantPrincipal({ jobId: 'j', scope: B })!;
    taskScheduler.every(
      't',
      1000,
      () => {
        seen.push(currentPrincipal()?.tenantId ?? null);
      },
      { principals: () => [pa, pb] },
    );
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([A.tenantId, B.tenantId]);
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveLength(4); // two tenants, two fires
    expect(seen.filter((t) => t === A.tenantId)).toHaveLength(2);
    expect(seen.filter((t) => t === B.tenantId)).toHaveLength(2);
  });

  it('one principal’s failure does not cancel the next principal’s run', () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const pa = tenantPrincipal({ jobId: 'j', scope: A })!;
    const pb = tenantPrincipal({ jobId: 'j', scope: B })!;
    taskScheduler.every(
      't',
      1000,
      () => {
        const t = currentPrincipal()?.tenantId ?? null;
        seen.push(t);
        if (t === A.tenantId) throw new Error('A is broken');
      },
      { principals: () => [pa, pb] },
    );
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([A.tenantId, B.tenantId]);
  });

  it('an empty principal list means the job does not run — never "run as somebody"', () => {
    vi.useFakeTimers();
    let runs = 0;
    session.value = A;
    taskScheduler.every(
      't',
      1000,
      () => {
        runs += 1;
      },
      { principals: () => [] },
    );
    vi.advanceTimersByTime(3000);
    expect(runs).toBe(0);
  });

  it('with NO principals declared the job runs OUTSIDE any principal, even when registered inside one', async () => {
    /**
     * REAL TIMERS, deliberately. `AsyncLocalStorage` propagates into a real
     * `setInterval` callback — so a recurring job registered inside tenant A's
     * principal used to INHERIT it, silently and permanently, from wherever the
     * registration happened to be called. A fake timer fires the callback from
     * the test's own context and would hide exactly that.
     */
    const seen: (string | null)[] = [];
    const pa = tenantPrincipal({ jobId: 'j', scope: A })!;
    await new Promise<void>((resolve) => {
      runAsPrincipal(pa, () => {
        taskScheduler.every('t', 5, () => {
          seen.push(currentPrincipal()?.tenantId ?? null);
          resolve();
        });
      });
    });
    taskScheduler.cancel('t');
    expect(seen[0], 'the job inherited a principal nobody declared').toBe(null);
  });

  it('at(): a one-shot fires under the principal that SCHEDULED it', () => {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const pa = tenantPrincipal({ jobId: 'reminder', scope: A })!;
    runAsPrincipal(pa, () => {
      taskScheduler.at('one', new Date(Date.now() + 500), () => {
        seen.push(currentPrincipal()?.tenantId ?? null);
      });
    });
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([A.tenantId]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M10 — the principal is captured at ENQUEUE, not resolved at DRAIN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('NEW-M10 — a queued reprojection carries its own principal', () => {
  const disposers: Array<() => void> = [];

  beforeEach(async () => {
    await fs.mkdir(mockState.userDataDir, { recursive: true });
    graphApplies.length = 0;
    memoryApplies.length = 0;
    session.value = A;
  });

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    vi.useRealTimers();
    fakeUnified.removeAllListeners();
  });

  it('GRAPH: enqueue as A, switch the session to B, drain — the work executed as A', async () => {
    vi.useFakeTimers();
    const g = await initGraph({ broadcast: () => undefined });
    disposers.push(g.dispose);
    graphApplies.length = 0;

    session.value = A;
    fakeUnified.emit('changed'); // ENQUEUE — A's records changed
    session.value = B; // the user switches organizations inside the debounce window
    vi.advanceTimersByTime(1000); // DRAIN

    expect(graphApplies, 'the queued reprojection did not run').toHaveLength(1);
    expect(graphApplies[0].tenantId).toBe(A.tenantId);
    expect(graphApplies[0].jobId).toBe('graph-reprojection');
    expect(graphApplies.map((r) => r.tenantId)).not.toContain(B.tenantId);
  });

  it('GRAPH: A and B both change inside one debounce window — BOTH reproject, each as itself', async () => {
    vi.useFakeTimers();
    const g = await initGraph({ broadcast: () => undefined });
    disposers.push(g.dispose);
    graphApplies.length = 0;

    session.value = A;
    fakeUnified.emit('changed');
    session.value = B;
    fakeUnified.emit('changed');
    session.value = C; // and by drain time neither of them is on screen
    vi.advanceTimersByTime(1000);

    expect(graphApplies).toHaveLength(2);
    expect(graphApplies.map((r) => r.tenantId)).toEqual([A.tenantId, B.tenantId]);
    expect(graphApplies.map((r) => r.tenantId)).not.toContain(C.tenantId);
  });

  it('GRAPH: repeated changes from ONE tenant still coalesce into one rebuild', async () => {
    vi.useFakeTimers();
    const g = await initGraph({ broadcast: () => undefined });
    disposers.push(g.dispose);
    graphApplies.length = 0;

    session.value = A;
    for (let i = 0; i < 5; i += 1) fakeUnified.emit('changed');
    vi.advanceTimersByTime(1000);
    expect(graphApplies).toHaveLength(1);
    expect(graphApplies[0].tenantId).toBe(A.tenantId);
  });

  it('GRAPH: a change with no organization active is DROPPED, not run as the next tenant', async () => {
    vi.useFakeTimers();
    const g = await initGraph({ broadcast: () => undefined });
    disposers.push(g.dispose);
    graphApplies.length = 0;

    session.value = null;
    fakeUnified.emit('changed');
    session.value = B;
    vi.advanceTimersByTime(1000);
    expect(graphApplies).toHaveLength(0);
  });

  it('MEMORY: enqueue as A, switch the session to B, drain — the work executed as A', async () => {
    vi.useFakeTimers();
    const m = await initMemory({ broadcast: () => undefined, scope: () => session.value });
    disposers.push(m.dispose);
    memoryApplies.length = 0;

    session.value = A;
    fakeUnified.emit('changed');
    session.value = B;
    vi.advanceTimersByTime(1000);

    expect(memoryApplies, 'the queued reprojection did not run').toHaveLength(1);
    expect(memoryApplies[0].tenantId).toBe(A.tenantId);
    expect(memoryApplies[0].jobId).toBe('memory-reprojection');
    expect(memoryApplies.map((r) => r.tenantId)).not.toContain(B.tenantId);
  });

  it('MEMORY: A and B both change inside one debounce window — BOTH reproject, each as itself', async () => {
    vi.useFakeTimers();
    const m = await initMemory({ broadcast: () => undefined, scope: () => session.value });
    disposers.push(m.dispose);
    memoryApplies.length = 0;

    session.value = A;
    fakeUnified.emit('changed');
    session.value = B;
    fakeUnified.emit('changed');
    session.value = C;
    vi.advanceTimersByTime(1000);

    expect(memoryApplies).toHaveLength(2);
    expect(memoryApplies.map((r) => r.tenantId)).toEqual([A.tenantId, B.tenantId]);
    expect(memoryApplies.map((r) => r.tenantId)).not.toContain(C.tenantId);
  });

  it('MEMORY: a platform record event enqueues under the PUBLISHING principal', async () => {
    vi.useFakeTimers();
    let onEvents: (() => void) | null = null;
    const m = await initMemory({
      broadcast: () => undefined,
      scope: () => session.value,
      on: (_types, handler) => {
        onEvents = handler;
      },
    });
    disposers.push(m.dispose);
    memoryApplies.length = 0;

    session.value = C;
    const pa = tenantPrincipal({ jobId: 'connector-sync', scope: A })!;
    // An ERP/connector event arrives inside A's background pass while C is on screen.
    runAsPrincipal(pa, () => (onEvents as unknown as () => void)());
    vi.advanceTimersByTime(1000);

    expect(memoryApplies).toHaveLength(1);
    expect(memoryApplies[0].tenantId).toBe(A.tenantId);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M2 / NEW-M8 — the classification belongs to the DATA, and the invariant
 * can now see a channel that claims to be both open and guarded
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The channels that serve the install-wide `bus.metrics()` payload. */
const BUS_METRICS_CHANNELS: readonly IpcChannelName[] = [
  IpcChannel.DiagnosticsGet,
  IpcChannel.ReleaseDiagnosticsGet,
  IpcChannel.ReleaseDiagnosticsExport,
  IpcChannel.SystemHealthSnapshot,
];

/** The seven that were public AND gated by a family gate. */
const FORMERLY_PUBLIC_AND_GATED: readonly IpcChannelName[] = [
  IpcChannel.AiConfigMigrate,
  IpcChannel.FounderAskV2,
  IpcChannel.MemoryGet,
  IpcChannel.ExecMemorySearch,
  IpcChannel.ExecMemoryForget,
  IpcChannel.ExecMemoryPin,
  IpcChannel.ExecMemoryResolve,
];

function runtimeProbe(channel: IpcChannelName): { def: AnySecureHandlerDef; ran: () => number } {
  let ran = 0;
  const raw = {
    channel,
    schema: EmptyRequest,
    handler: () => {
      ran += 1;
      return { ok: true };
    },
  } as unknown as SecureHandlerDef;
  const [stamped] = withRuntimeAuthz([raw]);
  return { def: stamped as unknown as AnySecureHandlerDef, ran: () => ran };
}

describe('NEW-M2 — the diagnostics payload is unreachable unauthenticated on EVERY door onto it', () => {
  it('all four channels that serve bus.metrics() are gated, and gated the same', () => {
    expect(BUS_METRICS_CHANNELS).toHaveLength(4);
    for (const channel of BUS_METRICS_CHANNELS) {
      expect(
        RUNTIME_CHANNEL_PERMISSIONS[channel],
        `${channel} serves install-wide bus metrics and must be gated`,
      ).toBe('operations:read');
      expect(PUBLIC_CHANNELS.has(channel), `${channel} is still on the public allowlist`).toBe(
        false,
      );
    }
  });

  it('an unauthenticated caller is refused on every one of them, and no handler runs', async () => {
    let refused = 0;
    for (const channel of BUS_METRICS_CHANNELS) {
      const p = runtimeProbe(channel);
      expect(p.def.requireAuth).toBe(true);
      await expect(
        runSecureHandler(p.def, {}, { isAuthenticated: () => false }),
        `${channel}`,
      ).rejects.toThrow(/sign in/i);
      expect(p.ran(), `${channel} ran for an unauthenticated caller`).toBe(0);
      refused += 1;
    }
    expect(refused).toBe(4);
  });

  it('a signed-in member holding operations:read IS served — the gate did not break the product', async () => {
    let served = 0;
    for (const channel of BUS_METRICS_CHANNELS) {
      const p = runtimeProbe(channel);
      await expect(
        runSecureHandler(
          p.def,
          {},
          {
            isAuthenticated: () => true,
            authorize: (permission: EnterprisePermission) => {
              if (permission !== 'operations:read') throw new Error('not authorized');
            },
          },
        ),
      ).resolves.toEqual({ ok: true });
      served += 1;
    }
    expect(served).toBe(4);
  });
});

describe('NEW-M8 — no channel is both public and gated, and the invariant enforces it', () => {
  it('the seven stale allowlist rows are gone, and each channel still carries its family lock', () => {
    expect(FORMERLY_PUBLIC_AND_GATED).toHaveLength(7);
    for (const channel of FORMERLY_PUBLIC_AND_GATED) {
      expect(PUBLIC_CHANNELS.has(channel), `${channel} is still on PUBLIC_CHANNELS`).toBe(false);
      const family = MEMORY_CHANNEL_AUTHORITY[channel] ?? AI_CHANNEL_AUTHORITY[channel];
      expect(family, `${channel} lost its family classification`).toBeDefined();
      expect(family).not.toBe('PUBLIC');
      // The central register agrees with the family gate — one channel, one lock.
      expect(RUNTIME_CHANNEL_PERMISSIONS[channel]).toBe(family);
    }
  });

  it('NOTHING on the public allowlist is classified anywhere — the two sets are disjoint, both ways', () => {
    const familyGated = [
      ...Object.entries(MEMORY_CHANNEL_AUTHORITY),
      ...Object.entries(AI_CHANNEL_AUTHORITY),
    ]
      .filter(([, authority]) => authority !== 'PUBLIC')
      .map(([channel]) => channel as IpcChannelName);
    expect(familyGated.length).toBeGreaterThanOrEqual(15);

    const everyGate = new Set<IpcChannelName>([
      ...(Object.keys(RUNTIME_CHANNEL_PERMISSIONS) as IpcChannelName[]),
      ...familyGated,
    ]);
    const overlap = [...everyGate].filter((c) => PUBLIC_CHANNELS.has(c));
    expect(overlap, `both public and gated: ${overlap.join(', ')}`).toEqual([]);
  });

  it('the strengthened invariant THROWS on a contrived violation, naming the channel', () => {
    const gated = RUNTIME_INVOKABLE_CHANNELS.filter((c) => !PUBLIC_CHANNELS.has(c));
    // Baseline: the real surface is clean and the check returns "nothing unclassified".
    expect(assertAllChannelsClassified(gated, PUBLIC_CHANNELS)).toEqual([]);

    // Now contrive the exact regression the seven stale rows were: a channel
    // that is gated at its handler AND left on the allowlist.
    const violated = new Set<IpcChannelName>([...PUBLIC_CHANNELS, IpcChannel.ExecuteRun]);
    expect(() => assertAllChannelsClassified(gated, violated)).toThrow(
      /BOTH gated and on PUBLIC_CHANNELS/,
    );
    expect(() => assertAllChannelsClassified(gated, violated)).toThrow(/execute:run/);
    expect(channelsBothPublicAndGated(gated, violated)).toEqual([IpcChannel.ExecuteRun]);
  });

  it('the invariant still catches an OMISSION, and reports exactly the offender', () => {
    const gated = RUNTIME_INVOKABLE_CHANNELS.filter(
      (c) => !PUBLIC_CHANNELS.has(c) && c !== IpcChannel.ExecuteRun,
    );
    const offenders = assertAllChannelsClassified(gated, PUBLIC_CHANNELS);
    expect(offenders).toEqual([IpcChannel.ExecuteRun]);
  });

  it('with every gate removed the check reports the WHOLE surface, not 613 of 718', () => {
    /**
     * The measurement that made NEW-M8 concrete. With no gates at all, the old
     * check exonerated every channel on the allowlist — so the size of that
     * allowlist was the size of the blind spot. It is now the size of the
     * DELIBERATE open surface, and every channel on it is one nobody gates.
     */
    const unclassified = assertAllChannelsClassified([], PUBLIC_CHANNELS);
    expect(unclassified).toHaveLength(RUNTIME_INVOKABLE_CHANNELS.length - PUBLIC_CHANNELS.size);
    for (const channel of FORMERLY_PUBLIC_AND_GATED) expect(unclassified).toContain(channel);
    for (const channel of BUS_METRICS_CHANNELS) expect(unclassified).toContain(channel);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M5 — the gateway files its rows under the CREDENTIAL's tenant
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('NEW-M5 — usage, audit and quota belong to the key’s organization', () => {
  const DEV = 'dev-owner';
  let gwScope: TenantScope | null = null;
  /**
   * `developerStore` and `gatewayStore` are the production SINGLETONS, backed by
   * one file, so rows survive between cases. Each case therefore names its own
   * pair of organizations — which is also the honest reading of "these rows are
   * partitioned": a fresh tenant starts empty no matter what the install already
   * holds.
   */
  let caseNo = 0;
  let TA: TenantScope;
  let TB: TenantScope;
  let TC: TenantScope;

  beforeEach(async () => {
    await fs.mkdir(mockState.userDataDir, { recursive: true });
    caseNo += 1;
    TA = { tenantId: `org-alpha-${caseNo}`, workspaceId: '' };
    TB = { tenantId: `org-bravo-${caseNo}`, workspaceId: '' };
    TC = { tenantId: `org-onscreen-${caseNo}`, workspaceId: '' };
    gwScope = TA;
    developerStore.bindScope(() => gwScope);
    gatewayStore.bindScope(() => gwScope);
    await developerStore.load();
    await gatewayStore.load();
  });

  function keyFor(scope: TenantScope): string {
    gwScope = scope;
    return developerStore.createKey(DEV, `key-${scope.tenantId}`, ['marketplace:read']).secret;
  }

  function call(secret: string): void {
    runGateway({
      apiKey: secret,
      method: 'GET',
      path: '/v1/marketplace/listings',
      version: 'v1',
      scope: null,
    });
  }

  it('A’s request creates A rows and B’s creates B rows — 2 and 3, with no leakage either way', () => {
    const aKey = keyFor(TA);
    const bKey = keyFor(TB);

    // Both callers arrive while a THIRD organization is the one on screen.
    session.value = TC;
    gwScope = TC;
    call(aKey);
    call(aKey);
    call(bKey);
    call(bKey);
    call(bKey);

    gwScope = TA;
    const aAudit = gatewayStore.auditEntries(100);
    expect(aAudit, 'A’s audit rows were filed elsewhere').toHaveLength(2);
    expect(aAudit.every((e) => e.tenantId === TA.tenantId)).toBe(true);
    expect(developerStore.usageFor(DEV, 0)).toHaveLength(2);

    gwScope = TB;
    const bAudit = gatewayStore.auditEntries(100);
    expect(bAudit).toHaveLength(3);
    expect(bAudit.every((e) => e.tenantId === TB.tenantId)).toBe(true);
    expect(developerStore.usageFor(DEV, 0)).toHaveLength(3);
  });

  it('nothing is filed under the SEEDED organization, and nothing under the session', () => {
    const aKey = keyFor(TA);
    session.value = TC;
    gwScope = TC;
    call(aKey);

    // `org-default` is the seeded developer account's organization — the value
    // `developerOrg` used to return for every key on the install.
    for (const wrongOwner of ['org-default', TC.tenantId, TB.tenantId]) {
      gwScope = { tenantId: wrongOwner, workspaceId: '' };
      expect(
        gatewayStore.auditEntries(100),
        `a row was filed under ${wrongOwner}`,
      ).toHaveLength(0);
      expect(developerStore.usageFor(DEV, 0), `usage filed under ${wrongOwner}`).toHaveLength(0);
    }

    gwScope = TA;
    expect(gatewayStore.auditEntries(100)).toHaveLength(1);
  });

  it('the quota counter is per tenant: A’s traffic does not consume B’s budget', () => {
    const aKey = keyFor(TA);
    const bKey = keyFor(TB);
    session.value = null;
    gwScope = null;

    for (let i = 0; i < 4; i += 1) call(aKey);
    call(bKey);

    // `peek` reports the quota already consumed in the named tenant's partition.
    const plan = { max: 1_000_000, windowMs: 60_000 };
    const quota = { limit: 1_000_000, period: 'month' as const };
    const aUsed = gatewayStore.peek(null, DEV, plan, quota, Date.now(), TA.tenantId).quotaUsed;
    const bUsed = gatewayStore.peek(null, DEV, plan, quota, Date.now(), TB.tenantId).quotaUsed;
    expect(aUsed).toBe(4);
    expect(bUsed).toBe(1);
    // …and neither of them landed in the seeded partition.
    expect(
      gatewayStore.peek(null, DEV, plan, quota, Date.now(), 'org-default').quotaUsed,
    ).toBe(0);
  });

  it('an unresolvable credential is refused an owner, never given the session’s', () => {
    session.value = TC;
    gwScope = TC;
    runGateway({ apiKey: 'npk_live_nonsense.not-a-key', method: 'GET', path: '/v1/x', version: 'v1', scope: null });
    for (const owner of [TC.tenantId, TA.tenantId, 'org-default']) {
      gwScope = { tenantId: owner, workspaceId: '' };
      expect(gatewayStore.auditEntries(100), `filed under ${owner}`).toHaveLength(0);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NEW-M11 — the replay ring is partitioned and authorized
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('NEW-M11 — each tenant replays its own events, exactly', () => {
  let owner: string | null = null;

  function busFor(size = 500): EventBus {
    const bus = new EventBus({ replayBufferSize: size });
    bus.bindTenant(() => owner);
    return bus;
  }

  const evt = (over: Partial<PlatformEventInput> = {}): PlatformEventInput => ({
    type: 'system.ready',
    category: 'system',
    source: 'test',
    ...over,
  });

  function publishAs(bus: EventBus, tenantId: string, n: number): void {
    owner = tenantId;
    for (let i = 0; i < n; i += 1) bus.publish(evt());
  }

  it('A publishes 3, B 7, C 11 — each replay returns its OWN count, exactly', () => {
    const bus = busFor();
    publishAs(bus, A.tenantId, 3);
    publishAs(bus, B.tenantId, 7);
    publishAs(bus, C.tenantId, 11);

    owner = A.tenantId;
    expect(bus.replay()).toHaveLength(3);
    expect(bus.replay().every((e) => e.tenantId === A.tenantId)).toBe(true);

    owner = B.tenantId;
    expect(bus.replay()).toHaveLength(7);
    expect(bus.replay().every((e) => e.tenantId === B.tenantId)).toBe(true);

    owner = C.tenantId;
    expect(bus.replay()).toHaveLength(11);
    expect(bus.replay().every((e) => e.tenantId === C.tenantId)).toBe(true);

    // The ring still holds all 21 — partitioned, not discarded.
    expect(bus.metrics().bufferedEvents).toBe(21);
  });

  it('a late subscriber with replay:true receives only its own — 7 of the 21', () => {
    const bus = busFor();
    publishAs(bus, A.tenantId, 3);
    publishAs(bus, B.tenantId, 7);
    publishAs(bus, C.tenantId, 11);

    owner = B.tenantId;
    const got: (string | null | undefined)[] = [];
    bus.subscribe((e) => {
      got.push(e.tenantId);
    }, { replay: true });
    expect(got).toHaveLength(7);
    expect(got.every((t) => t === B.tenantId)).toBe(true);
  });

  it('a tenant that has published nothing replays nothing — not everybody’s', () => {
    const bus = busFor();
    publishAs(bus, A.tenantId, 3);
    owner = B.tenantId;
    expect(bus.replay()).toEqual([]);
  });

  it('no resolved tenant replays nothing at all', () => {
    const bus = busFor();
    publishAs(bus, A.tenantId, 3);
    owner = null;
    expect(bus.replay()).toEqual([]);
    const got: unknown[] = [];
    bus.subscribe((e) => {
      got.push(e);
    }, { replay: true });
    expect(got).toEqual([]);
  });

  it('eviction is per owner: A’s flood cannot push B’s events out of the ring', () => {
    const bus = busFor(5);
    publishAs(bus, B.tenantId, 4);
    publishAs(bus, A.tenantId, 50);

    owner = B.tenantId;
    expect(bus.replay(), 'B’s events were evicted by A’s traffic').toHaveLength(4);
    owner = A.tenantId;
    expect(bus.replay()).toHaveLength(5); // A's own cap bit, on A's own bucket
  });

  it('a SYSTEM event is readable by every resolved tenant, and by no unresolved one', () => {
    const bus = busFor();
    const systemPrincipal = {
      principalId: 'job:health',
      principalType: 'system' as const,
      tenantId: null,
      workspaceId: null,
      permissions: [],
      jobId: 'health',
      requestId: 'run_1',
    };
    owner = null;
    runAsPrincipal(systemPrincipal, () => bus.publish(evt({ type: 'runtime.crashed', category: 'runtime' })));
    publishAs(bus, A.tenantId, 2);

    owner = A.tenantId;
    expect(bus.replay()).toHaveLength(3); // 2 of A's + the system event
    owner = B.tenantId;
    expect(bus.replay()).toHaveLength(1); // just the system event
    owner = null;
    expect(bus.replay()).toEqual([]);
  });

  it('PlatformEventApi.replay — the re-export — is authorized identically', async () => {
    const dir = join(mockState.userDataDir, `tl-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const bus = busFor();
    const timeline = new TimelineService({ dir });
    const api = new PlatformEventApi(bus, timeline);

    publishAs(bus, A.tenantId, 3);
    publishAs(bus, B.tenantId, 7);

    owner = A.tenantId;
    expect(api.replay()).toHaveLength(3);
    owner = B.tenantId;
    expect(api.replay()).toHaveLength(7);
    owner = null;
    expect(api.replay()).toEqual([]);
    timeline.dispose();
  });

  it('a workspace switch needs nothing cleared: the READ is the boundary', () => {
    const bus = busFor();
    publishAs(bus, A.tenantId, 3);
    publishAs(bus, B.tenantId, 7);
    // The switch is exactly this: the resolver starts answering B.
    owner = A.tenantId;
    expect(bus.replay()).toHaveLength(3);
    owner = B.tenantId;
    expect(bus.replay()).toHaveLength(7);
    owner = A.tenantId;
    expect(bus.replay()).toHaveLength(3);
  });
});
