/**
 * Phase 6 Stage 11 (D-8) — the assistant's federation flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), SEVEN-WAY service-level disjointness
 * (productivity / S6 / S7 / S8 / S9 / S10 / S11 — including the two Stage 10
 * exclusion handoffs), and the invariant that federation turns never execute.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveFederationQuestion } from './assistantModel';
import { AssistantService, type AssistantServiceDeps } from './assistantService';

const NOW = '2026-07-31T09:00:00.000Z';

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

function federationReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: federation answers ride the existing report kind
    title: 'Enterprise federation status (records, not live connectivity)',
    sections: [
      { title: 'Answer', lines: ['Partners: 1 recorded (1 active · 1 trusted · 0 invitation(s) pending).'] },
      { title: 'Uncertainty', lines: ['Everything cross-org is a record in local stores.'] },
    ],
    grounded: true,
  };
}

function mkService(opts: { port?: boolean; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  federationCalls: string[];
  strategyCalls: string[];
  operationsCalls: string[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('federation turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Stage 6/7/8/9/10 ports stay wired — precedence isolation is asserted below.
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
    ...(opts.port === false
      ? {}
      : {
          federation: (text) => {
            if (opts.throws) throw new Error('federation platform offline');
            federationCalls.push(text);
            return federationReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, federationCalls, strategyCalls, operationsCalls, automationCalls, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveFederationQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical federation questions', () => {
    expect(resolveFederationQuestion('Which partners do we trust?')).toBe('partner-trust');
    expect(resolveFederationQuestion('Federation status, please')).toBe('federation-status');
    expect(resolveFederationQuestion('draft an email')).toBeNull();
  });
});

describe('the federation turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Which partners do we trust?');
    expect(h.federationCalls).toEqual(['Which partners do we trust?']);
    expect(h.intelligenceCalls).toEqual([]);
    expect(h.knowledgeCalls).toEqual([]);
    expect(h.automationCalls).toEqual([]);
    expect(h.operationsCalls).toEqual([]);
    expect(h.strategyCalls).toEqual([]); // disjoint: the Stage 10 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the federation platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('2 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'federation status');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('the Stage 10 exclusion handoffs land in the FEDERATION branch at the service level', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Which joint initiatives do we run with partners?');
    expect(h.federationCalls).toEqual(['Which joint initiatives do we run with partners?']);
    expect(h.strategyCalls).toEqual([]);
    await askEnvelope(h.service, 'Prepare the federation board brief');
    expect(h.federationCalls).toContain('Prepare the federation board brief');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'What is in the exchange?');
    expect(env.unavailable).toContainEqual({ system: 'federation', reason: 'federation port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing federation subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'Federation status, please');
    expect(env.unavailable.some((u) => u.system === 'federation' && u.reason.includes('offline'))).toBe(true);
  });

  it('Stage 6–10 questions still route to their own branches, untouched', async () => {
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
    expect(h.federationCalls).toEqual([]);
  });
});
