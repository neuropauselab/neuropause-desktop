/**
 * Phase 6 Stage 12 (D-8) — the assistant's analytics flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), EIGHT-WAY service-level disjointness
 * (productivity / S6 / S7 / S8 / S9 / S10 / S11 / S12), and the invariant
 * that analytics turns never execute.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveAnalyticsQuestion } from './assistantModel';
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

function analyticsReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: analytics answers ride the existing report kind
    title: 'Enterprise analytics status (composed from the platform’s own producers)',
    sections: [
      { title: 'Answer', lines: ['KPIs: 3 catalogued (2 healthy · 1 attention · 0 unattributed).'] },
      { title: 'Uncertainty', lines: ['Producers stay authoritative; nothing is recomputed.'] },
    ],
    grounded: true,
  };
}

function mkService(opts: { port?: boolean; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  analyticsCalls: string[];
  federationCalls: string[];
  strategyCalls: string[];
  operationsCalls: string[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('analytics turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Stage 6/7/8/9/10/11 ports stay wired — precedence isolation is asserted below.
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
    ...(opts.port === false
      ? {}
      : {
          analytics: (text) => {
            if (opts.throws) throw new Error('analytics platform offline');
            analyticsCalls.push(text);
            return analyticsReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, analyticsCalls, federationCalls, strategyCalls, operationsCalls, automationCalls, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveAnalyticsQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical analytics questions', () => {
    expect(resolveAnalyticsQuestion('Show me the KPI catalog')).toBe('kpi-catalog');
    expect(resolveAnalyticsQuestion('Analytics status, please')).toBe('analytics-status');
    expect(resolveAnalyticsQuestion('draft an email')).toBeNull();
  });
});

describe('the analytics turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Show me the KPI catalog');
    expect(h.analyticsCalls).toEqual(['Show me the KPI catalog']);
    expect(h.intelligenceCalls).toEqual([]);
    expect(h.knowledgeCalls).toEqual([]);
    expect(h.automationCalls).toEqual([]);
    expect(h.operationsCalls).toEqual([]);
    expect(h.strategyCalls).toEqual([]);
    expect(h.federationCalls).toEqual([]); // disjoint: the Stage 11 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the analytics platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('2 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'analytics status');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'Which KPIs are regressing?');
    expect(env.unavailable).toContainEqual({ system: 'analytics', reason: 'analytics port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing analytics subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'Analytics status, please');
    expect(env.unavailable.some((u) => u.system === 'analytics' && u.reason.includes('offline'))).toBe(true);
  });

  it('Stage 6–11 questions still route to their own branches, untouched', async () => {
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
    expect(h.analyticsCalls).toEqual([]);
  });
});
