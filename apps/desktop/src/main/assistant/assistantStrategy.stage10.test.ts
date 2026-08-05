/**
 * Phase 6 Stage 10 (D-8) — the assistant's strategy flow: the eleven-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), SIX-WAY service-level disjointness
 * (productivity / S6 insight / S7 knowledge / S8 automation / S9 operations /
 * S10 strategy), and the invariant that strategy turns never execute anything.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveStrategyQuestion } from './assistantModel';
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

function strategyReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: strategy answers ride the existing report kind
    title: 'Enterprise strategy status',
    sections: [
      { title: 'Answer', lines: ['Objectives: 9 on-track · 1 at-risk · 1 off-track · 0 unknown (5 company + 6 department).'] },
      { title: 'Themes', lines: ['Reliable autonomous operations: off-track — 2 objective(s)'] },
      { title: 'Uncertainty', lines: ['decisions: store unreadable this pass'] },
    ],
    grounded: true,
  };
}

function mkService(opts: { port?: boolean; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  strategyCalls: string[];
  operationsCalls: string[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('strategy turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Stage 6/7/8/9 ports stay wired — precedence isolation is asserted below.
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
    ...(opts.port === false
      ? {}
      : {
          strategy: (text) => {
            if (opts.throws) throw new Error('strategy platform offline');
            strategyCalls.push(text);
            return strategyReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, strategyCalls, operationsCalls, automationCalls, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveStrategyQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical strategy questions', () => {
    expect(resolveStrategyQuestion('What is the state of our strategy?')).toBe('strategy-status');
    expect(resolveStrategyQuestion('Which business capability is weakest?')).toBe('capability-analysis');
    expect(resolveStrategyQuestion('draft an email')).toBeNull();
  });
});

describe('the strategy turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Which objectives are at risk?');
    expect(h.strategyCalls).toEqual(['Which objectives are at risk?']);
    expect(h.intelligenceCalls).toEqual([]); // disjoint: the Stage 6 branch never fired
    expect(h.knowledgeCalls).toEqual([]); // disjoint: the Stage 7 branch never fired
    expect(h.automationCalls).toEqual([]); // disjoint: the Stage 8 branch never fired
    expect(h.operationsCalls).toEqual([]); // disjoint: the Stage 9 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the strategy platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('3 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('the board brief resolves through the strategy branch, not the Stage 5 brief flow', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Prepare the board brief');
    expect(h.strategyCalls).toEqual(['Prepare the board brief']);
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'strategy status');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'What are our strategic risks?');
    expect(env.unavailable).toContainEqual({ system: 'strategy', reason: 'strategy port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing strategy subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'What is the state of our strategy?');
    expect(env.unavailable.some((u) => u.system === 'strategy' && u.reason.includes('offline'))).toBe(true);
  });

  it('Stage 6 / 7 / 8 / 9 questions still route to their own branches, untouched', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    await askEnvelope(h.service, 'What is our deployment policy?');
    expect(h.knowledgeCalls).toEqual(['What is our deployment policy?']);
    await askEnvelope(h.service, 'What is the status of my automations?');
    expect(h.automationCalls).toEqual(['What is the status of my automations?']);
    await askEnvelope(h.service, 'What are our operational objectives?');
    expect(h.operationsCalls).toEqual(['What are our operational objectives?']);
    expect(h.strategyCalls).toEqual([]);
  });

  it('"launch the onboarding automation" stays with the OPERATIONAL action flow — no research branch fires', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'launch the onboarding automation');
    expect(h.strategyCalls).toEqual([]);
    expect(h.operationsCalls).toEqual([]);
  });
});
