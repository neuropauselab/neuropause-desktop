/**
 * Phase 6 Stage 13 (D-8) — the assistant's digital-twin flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), NINE-WAY service-level disjointness
 * (productivity / S6 / S7 / S8 / S9 / S10 / S11 / S12 / S13), the five
 * routed-around overlaps proven at the SERVICE level rather than only at the
 * resolver level, and the invariant that twin turns never execute.
 *
 * The resolver-level nine-way lock lives in
 * `digitalTwinPlatform/twinPlatformModel.stage13.test.ts`. This file is NOT a
 * second copy of it, and the difference was measured rather than assumed —
 * four negative controls, each applied to the sandbox and re-run:
 *
 *   - Widen `resolveTwinQuestion` to swallow a Stage 12 phrasing: the resolver
 *     lock fails, this file stays 16/16 GREEN. While the Stage 13 branch is
 *     the LAST of the platform branches, an earlier branch answers first and
 *     the service never reaches the widened resolver — so a widening on its
 *     own is invisible here. That direction belongs to the resolver lock, and
 *     this file does not pretend to cover it.
 *   - Widen `resolveAnalyticsQuestion` to swallow a twin phrasing: both fail.
 *   - Disable the Stage 13 branch: seven tests here fail; the resolver lock
 *     stays green, because a resolver that matches nothing it dispatches to is
 *     still a perfectly disjoint resolver.
 *   - Widen `resolveTwinQuestion` AND hoist the Stage 13 branch above Stage
 *     12's: OVERLAP 2 below fails. This is the case the overlap block exists
 *     for — a widened resolver becomes reachable the moment the branch moves,
 *     and branch ORDER is something no resolver test can see.
 *
 * So the two files divide as: the resolver lock owns disjointness, this one
 * owns dispatch, port isolation, the honesty contract, and order-dependence.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveTwinQuestion } from './assistantModel';
import { AssistantService, type AssistantServiceDeps } from './assistantService';

const NOW = '2026-08-01T09:00:00.000Z';

function fakeStore(): AssistantServiceDeps['store'] {
  const map = new Map<string, AssistantConversation>();
  return {
    get: (id) => map.get(id) ?? null,
    upsert: (c) => {
      map.set(c.id, c);
      return Promise.resolve();
    },
    list: () => [],
    delete: (id) => Promise.resolve(map.delete(id)),
  };
}

function aiResponse(): AiEngineResponse {
  return {
    responseId: 'resp_1',
    worker: 'assistant',
    promptId: 'brief.executive-summary',
    promptVersion: 1,
    model: 'claude-test',
    text: '{}',
    data: { executiveSummary: 'Narrative.', recommendations: [], confidence: 0.7 },
    evidence: [],
    confidence: 0.7,
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    latencyMs: 1,
    contextSources: [],
    grounded: true,
  };
}

function twinReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: twin answers ride the existing report kind
    title: 'Digital twin platform status (composed over the authoritative P15 twin)',
    sections: [
      { title: 'Answer', lines: ['Platform twins: 7 composed (5 steady · 1 attention · 1 unknown).'] },
      { title: 'Declared unavailability', lines: ['Execution: unreadable — one of the four engine reads failed.'] },
    ],
    grounded: true,
  };
}

type Harness = {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  twinCalls: string[];
  analyticsCalls: string[];
  federationCalls: string[];
  strategyCalls: string[];
  operationsCalls: string[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
};

function mkService(opts: { port?: boolean; throws?: boolean } = {}): Harness {
  const execRequests: ExecutionRequest[] = [];
  const twinCalls: string[] = [];
  const analyticsCalls: string[] = [];
  const federationCalls: string[] = [];
  const strategyCalls: string[] = [];
  const operationsCalls: string[] = [];
  const automationCalls: string[] = [];
  const knowledgeCalls: string[] = [];
  const intelligenceCalls: string[] = [];
  let seq = 0;
  const deps: AssistantServiceDeps = {
    store: fakeStore(),
    context: {},
    buildContext: () => [],
    runAi: () => Promise.resolve(aiResponse()),
    screen: () => ({ allowed: true, rejections: [] }),
    execute: (req) => {
      execRequests.push(req);
      throw new Error('twin turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Every Stage 6–12 port stays wired — precedence isolation is asserted below.
    intelligence: (text) => {
      intelligenceCalls.push(text);
      return null;
    },
    knowledge: (text) => {
      knowledgeCalls.push(text);
      return null;
    },
    automation: (text) => {
      automationCalls.push(text);
      return null;
    },
    operations: (text) => {
      operationsCalls.push(text);
      return null;
    },
    strategy: (text) => {
      strategyCalls.push(text);
      return null;
    },
    federation: (text) => {
      federationCalls.push(text);
      return null;
    },
    analytics: (text) => {
      analyticsCalls.push(text);
      return null;
    },
    ...(opts.port === false
      ? {}
      : {
          twin: (text) => {
            if (opts.throws) throw new Error('twin platform offline');
            twinCalls.push(text);
            return twinReport();
          },
        }),
  };
  return {
    service: new AssistantService(deps),
    execRequests,
    twinCalls,
    analyticsCalls,
    federationCalls,
    strategyCalls,
    operationsCalls,
    automationCalls,
    knowledgeCalls,
    intelligenceCalls,
  };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

/** Every earlier port on the harness, for the "nobody else fired" assertion. */
function earlierCalls(h: Harness): Record<string, string[]> {
  return {
    intelligence: h.intelligenceCalls,
    knowledge: h.knowledgeCalls,
    automation: h.automationCalls,
    operations: h.operationsCalls,
    strategy: h.strategyCalls,
    federation: h.federationCalls,
    analytics: h.analyticsCalls,
  };
}

describe('resolveTwinQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical twin questions', () => {
    expect(resolveTwinQuestion('Twin status, please')).toBe('twin-status');
    expect(resolveTwinQuestion('Show me the runtime twin')).toBe('runtime-twin');
    expect(resolveTwinQuestion('Prepare the twin report')).toBe('twin-report');
    expect(resolveTwinQuestion('draft an email')).toBeNull();
  });

  it('is the SAME function the platform module exports — not a second copy', async () => {
    const own = await import('../digitalTwinPlatform/twinPlatformModel');
    expect(resolveTwinQuestion).toBe(own.resolveTwinQuestion);
  });
});

describe('the twin turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Show me the platform twins');
    expect(h.twinCalls).toEqual(['Show me the platform twins']);
    for (const [name, calls] of Object.entries(earlierCalls(h))) {
      expect(calls, `${name} must not fire on a twin question`).toEqual([]);
    }
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the digital twin platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('2 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'twin overview');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'What is not modelled?');
    expect(env.unavailable).toContainEqual({ system: 'twin', reason: 'twin platform port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing twin subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'Twin status, please');
    expect(env.unavailable.some((u) => u.system === 'twin' && u.reason.includes('offline'))).toBe(true);
    expect(env.structured ?? null).toBeNull();
  });

  it('a port that resolves but returns nothing is unavailable, not an empty twin', async () => {
    const h = mkService({ port: false });
    // The `twin` port is re-supplied here returning null — the resolver matched,
    // so silence has to be REPORTED rather than rendered as a twin with no data.
    const svc = new AssistantService({
      store: fakeStore(),
      context: {},
      buildContext: () => [],
      runAi: () => Promise.resolve(aiResponse()),
      screen: () => ({ allowed: true, rejections: [] }),
      execute: () => {
        throw new Error('twin turns must never execute');
      },
      now: () => NOW,
      twin: () => null,
    });
    const env = await askEnvelope(svc, 'twin drift, please');
    expect(env.unavailable).toContainEqual({ system: 'twin', reason: 'resolver matched but produced no report' });
    expect(env.structured ?? null).toBeNull();
    expect(h.twinCalls).toEqual([]);
  });
});

/* ── NINE-WAY service-level disjointness ──────────────────────────────────── */

describe('NINE-WAY service-level disjointness', () => {
  it('Stage 6–12 questions still route to their own branches, untouched', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    await askEnvelope(h.service, 'What is our deployment policy?');
    expect(h.knowledgeCalls).toEqual(['What is our deployment policy?']);
    await askEnvelope(h.service, 'What is the status of my automations?');
    expect(h.automationCalls).toEqual(['What is the status of my automations?']);
    await askEnvelope(h.service, 'Are we meeting our SLAs?');
    expect(h.operationsCalls).toEqual(['Are we meeting our SLAs?']);
    await askEnvelope(h.service, 'Prepare the board brief');
    expect(h.strategyCalls).toEqual(['Prepare the board brief']);
    await askEnvelope(h.service, 'Federation status, please');
    expect(h.federationCalls).toEqual(['Federation status, please']);
    await askEnvelope(h.service, 'Show me the KPI catalog');
    expect(h.analyticsCalls).toEqual(['Show me the KPI catalog']);
    // …and across all seven, the Stage 13 branch never fired once.
    expect(h.twinCalls).toEqual([]);
  });

  it('the S5 productivity turns are unaffected — the twin branch never swallows them', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'morning brief');
    await askEnvelope(h.service, "summarize today's work");
    expect(h.twinCalls).toEqual([]);
  });

  it('every canonical twin phrasing reaches the twin branch and nothing else', async () => {
    const CASES = [
      'Twin status, please',
      'How is the digital twin?',
      'Show me the runtime twin',
      'Show the execution twin',
      'Show me the platform twins',
      'State coverage, please',
      'What is not modelled?',
      'What can we simulate?',
      'Show me the twin history',
      'twin drift, please',
      'Prepare the twin report',
    ];
    for (const text of CASES) {
      const h = mkService();
      await askEnvelope(h.service, text);
      expect(h.twinCalls, text).toEqual([text]);
      for (const [name, calls] of Object.entries(earlierCalls(h))) {
        expect(calls, `${name} fired on "${text}"`).toEqual([]);
      }
      expect(h.execRequests, text).toEqual([]);
    }
  });
});

/* ── the five routed-around overlaps, at the SERVICE level ────────────────── */

describe('the routed-around overlaps route around at the service too', () => {
  /**
   * Each of these phrasings reads like a twin question and belongs to an
   * earlier stage. The resolver lock proves `resolveTwinQuestion` declines
   * them; this proves the SERVICE hands them to the branch that owns them —
   * the failure the resolver lock cannot see.
   */
  const OVERLAPS: [string, string, keyof ReturnType<typeof earlierCalls>][] = [
    ['OVERLAP 1', 'How is the enterprise twin?', 'intelligence'],
    ['OVERLAP 2', 'data coverage map', 'analytics'],
    ['OVERLAP 3', 'Simulate the incident playbook', 'automation'],
    ['OVERLAP 4', 'What is our disaster recovery policy?', 'operations'],
    ['OVERLAP 5', 'simulation capability', 'strategy'],
  ];

  for (const [label, text, owner] of OVERLAPS) {
    it(`${label} — "${text}" reaches ${owner}, never the twin branch`, async () => {
      const h = mkService();
      await askEnvelope(h.service, text);
      expect(earlierCalls(h)[owner], `${owner} must own "${text}"`).toEqual([text]);
      expect(h.twinCalls, `twin must decline "${text}"`).toEqual([]);
    });
  }

  it('the near-miss twin phrasings are still Stage 13 — the guards narrowed nothing else', async () => {
    const NEAR: [string, string][] = [
      ['How is the digital twin?', 'the enterprise-twin guard is scoped to `enterprise`'],
      ['Show me the coverage map', 'the data-coverage guard is scoped to `data`'],
      ['What can we simulate?', 'the playbook guard is scoped to a named playbook'],
      ['What is our recovery policy?', 'the DR guard is scoped to `disaster`'],
    ];
    for (const [text, why] of NEAR) {
      const h = mkService();
      await askEnvelope(h.service, text);
      expect(h.twinCalls, `${text} — ${why}`).toEqual([text]);
    }
  });
});
