/**
 * Phase 6 Stage 9 (D-8) — the assistant's operations flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), FIVE-WAY service-level disjointness
 * (productivity / S6 insight / S7 knowledge / S8 automation / S9 operations),
 * and the invariant that operations turns never execute anything.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveOperationsQuestion } from './assistantModel';
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

function operationsReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: operations answers ride the existing report kind
    title: 'Operations status',
    sections: [
      { title: 'Answer', lines: ['Services: 7/7 operational · SLA 7/9 met (2 declared unmeasurable).'] },
      { title: 'Evidence', lines: ['execution-stats', 'connector-service'] },
      { title: 'Uncertainty', lines: ['2 target(s) declared unmeasurable.'] },
    ],
    grounded: true,
  };
}

function mkService(opts: { port?: boolean; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  operationsCalls: string[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('operations turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Stage 6/7/8 ports stay wired — precedence isolation is asserted below.
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
    ...(opts.port === false
      ? {}
      : {
          operations: (text) => {
            if (opts.throws) throw new Error('operations platform offline');
            operationsCalls.push(text);
            return operationsReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, operationsCalls, automationCalls, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveOperationsQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical operations questions', () => {
    expect(resolveOperationsQuestion('Operations status, please')).toBe('ops-status');
    expect(resolveOperationsQuestion('Are we meeting our SLAs?')).toBe('sla');
    expect(resolveOperationsQuestion('draft an email')).toBeNull();
  });
});

describe('the operations turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Are we meeting our SLAs?');
    expect(h.operationsCalls).toEqual(['Are we meeting our SLAs?']);
    expect(h.intelligenceCalls).toEqual([]); // disjoint: the Stage 6 branch never fired
    expect(h.knowledgeCalls).toEqual([]); // disjoint: the Stage 7 branch never fired
    expect(h.automationCalls).toEqual([]); // disjoint: the Stage 8 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the operations platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('3 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'ops overview');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'What is our business continuity posture?');
    expect(env.unavailable).toContainEqual({ system: 'operations', reason: 'operations port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing operations subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'Operations status, please');
    expect(env.unavailable.some((u) => u.system === 'operations' && u.reason.includes('offline'))).toBe(true);
  });

  it('Stage 6 / 7 / 8 questions still route to their own branches, untouched', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    await askEnvelope(h.service, 'What is our deployment policy?');
    expect(h.knowledgeCalls).toEqual(['What is our deployment policy?']);
    await askEnvelope(h.service, 'What is the status of my automations?');
    expect(h.automationCalls).toEqual(['What is the status of my automations?']);
    expect(h.operationsCalls).toEqual([]);
  });

  it('"launch the onboarding automation" stays with the OPERATIONAL action flow — no research branch fires', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'launch the onboarding automation');
    expect(h.operationsCalls).toEqual([]);
    expect(h.automationCalls).toEqual([]);
  });
});
