/**
 * Phase 6 Stage 7 (D-8) — the assistant's knowledge flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * structured report (the approved kind reuse) with an inspectable tool call,
 * the honesty contract (absent/throwing port → explicit unavailable), the
 * productivityResolved gate for low-scoring phrasings, precedence isolation
 * from the Stage 6 intelligence branch, and the invariant that knowledge
 * turns never execute anything.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveKnowledgeQuestion } from './assistantModel';
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

function knowledgeReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: knowledge answers ride the existing report kind
    title: 'What is our deployment policy?',
    sections: [
      { title: 'Answer', lines: ['Deployment policy: “Deployment Policy” (approved-document, rank 4, fresh).'] },
      { title: 'Evidence', lines: ['ka:governed-document:doc-1'] },
      { title: 'Authority', lines: ['Deployment policy: 2 candidate(s) resolved by authority-precedence → freshness → stable-id.'] },
      { title: 'Uncertainty', lines: ['Security standards: no defining asset exists.'] },
    ],
    grounded: true,
  };
}

function mkService(
  opts: { port?: boolean; throws?: boolean } = {},
): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('knowledge turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // The Stage 6 intelligence port stays wired — precedence isolation is asserted below.
    intelligence: (text) => {
      intelligenceCalls.push(text);
      return null;
    },
    ...(opts.port === false
      ? {}
      : {
          knowledge: (text) => {
            if (opts.throws) throw new Error('knowledge subsystem offline');
            knowledgeCalls.push(text);
            return knowledgeReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveKnowledgeQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical knowledge questions', () => {
    expect(resolveKnowledgeQuestion('What is our deployment policy?')).toBe('deployment-policy');
    expect(resolveKnowledgeQuestion('Which documents conflict?')).toBe('conflicting-documents');
    expect(resolveKnowledgeQuestion('draft an email')).toBeNull();
  });
});

describe('the knowledge turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'What is our deployment policy?');
    expect(h.knowledgeCalls).toEqual(['What is our deployment policy?']);
    expect(h.intelligenceCalls).toEqual([]); // disjoint matchers: the Stage 6 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    expect(env.structured?.sections.map((s) => s.title)).toContain('Authority');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the knowledge platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('4 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'conflicting documents');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'Which knowledge is outdated?');
    expect(env.unavailable).toContainEqual({ system: 'knowledge', reason: 'knowledge port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing knowledge subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'Which documents conflict?');
    expect(env.unavailable.some((u) => u.system === 'knowledge' && u.reason.includes('offline'))).toBe(true);
  });

  it('Stage 6 intelligence questions still route to the intelligence branch, untouched', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    expect(h.knowledgeCalls).toEqual([]);
  });
});
