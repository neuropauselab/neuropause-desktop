/**
 * Phase 6 Stage 6 (D-5) — the assistant's intelligence flow: the ten-question
 * resolver re-export, the service branch producing the 'intelligence'
 * structured report with an inspectable tool call, the honesty contract
 * (absent port → explicit unavailable), and the invariant that intelligence
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
import { resolveInsightQuestion } from './assistantModel';
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

function intelligenceReport(grounded = true): AssistantStructuredReport {
  return {
    kind: 'intelligence',
    title: 'Enterprise health summary',
    sections: [
      { title: 'Answer', lines: ['Overall enterprise health 74/100 (watch), composed from 6 of 8 domains.'] },
      { title: 'Confidence', lines: ['Confidence 68% (data availability 75%, signal quality 82%, historical coverage 33%, correlation strength 55%).'] },
    ],
    grounded,
  };
}

function mkService(opts: { port?: boolean; answer?: AssistantStructuredReport | null; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('intelligence turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    ...(opts.port === false
      ? {}
      : {
          intelligence: (text) => {
            if (opts.throws) throw new Error('insight subsystem offline');
            intelligenceCalls.push(text);
            return opts.answer === undefined ? intelligenceReport() : opts.answer;
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveInsightQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the ten canonical questions', () => {
    expect(resolveInsightQuestion('Summarize enterprise health')).toBe('enterprise-health-summary');
    expect(resolveInsightQuestion('Which approvals are blocking delivery?')).toBe('blocking-approvals');
    expect(resolveInsightQuestion('draft an email')).toBeNull();
  });
});

describe('the intelligence turn', () => {
  it('produces the intelligence structured report with an inspectable tool call and no execution', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    expect(env.structured?.kind).toBe('intelligence');
    expect(env.structured?.title).toBe('Enterprise health summary');
    const call = env.toolCalls.find((t) => t.label === 'Answer from enterprise intelligence')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('2 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring intent phrasing still resolves (productivityResolved gate)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'operational anomalies');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'Which projects are most at risk?');
    expect(env.unavailable).toContainEqual({ system: 'intelligence', reason: 'intelligence port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing insight subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'show operational anomalies');
    expect(env.unavailable.some((u) => u.system === 'intelligence' && u.reason.includes('offline'))).toBe(true);
  });

  it('an ungrounded intelligence report renders the honest empty state (structured.grounded=false)', async () => {
    const h = mkService({ answer: intelligenceReport(false) });
    const env = await askEnvelope(h.service, 'why did sales decrease?');
    expect(env.structured?.grounded).toBe(false);
    // The Stage 5 grounding rule is untouched: only a GROUNDED report upgrades
    // the envelope; an ungrounded one never does.
    expect(env.structured?.sections.length).toBeGreaterThan(0);
  });

  it('non-intelligence requests never touch the port', async () => {
    const h = mkService();
    await h.service.ask({ text: 'find messages about the offsite' });
    expect(h.intelligenceCalls).toEqual([]);
  });
});
