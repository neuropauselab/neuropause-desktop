/**
 * Phase 6 Stage 8 (D-8) — the assistant's automation flow: the six-question
 * resolver re-export, the service branch producing the 'intelligence'-kind
 * report with an inspectable tool call, the honesty contract (absent/throwing
 * port → explicit unavailable), FOUR-WAY matcher disjointness (productivity /
 * Stage 6 insight / Stage 7 knowledge / Stage 8 automation), the operational
 * "launch …" phrasing staying with the gated action flow, and the invariant
 * that automation turns never execute anything.
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
} from '@neuropause/shared';
import { resolveAutomationQuestion, resolveInsightQuestion, resolveKnowledgeQuestion } from './assistantModel';
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

function automationReport(): AssistantStructuredReport {
  return {
    kind: 'intelligence', // D-8: automation answers ride the existing report kind
    title: 'Automation status',
    sections: [
      { title: 'Answer', lines: ['No automation findings: nothing stuck, failing, aging at approval, or unparseable.'] },
      { title: 'Evidence', lines: ['catalog: 12 automation-capable entries'] },
    ],
    grounded: true,
  };
}

function mkService(opts: { port?: boolean; throws?: boolean } = {}): {
  service: AssistantService;
  execRequests: ExecutionRequest[];
  automationCalls: string[];
  knowledgeCalls: string[];
  intelligenceCalls: string[];
} {
  const execRequests: ExecutionRequest[] = [];
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
      throw new Error('automation turns must never execute');
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    // Stage 6 + Stage 7 ports stay wired — precedence isolation is asserted below.
    intelligence: (text) => {
      intelligenceCalls.push(text);
      return null;
    },
    knowledge: (text) => {
      knowledgeCalls.push(text);
      return null;
    },
    ...(opts.port === false
      ? {}
      : {
          automation: (text) => {
            if (opts.throws) throw new Error('automation platform offline');
            automationCalls.push(text);
            return automationReport();
          },
        }),
  };
  return { service: new AssistantService(deps), execRequests, automationCalls, knowledgeCalls, intelligenceCalls };
}

async function askEnvelope(service: AssistantService, text: string): Promise<AssistantEnvelope> {
  const res = await service.ask({ text });
  const msg = res.conversation.messages.find((m) => m.id === res.messageId)!;
  return msg.envelope!;
}

describe('resolveAutomationQuestion re-export (single resolver surface)', () => {
  it('the assistantModel re-export matches the canonical automation questions', () => {
    expect(resolveAutomationQuestion('What is the status of my automations?')).toBe('monitor-automation');
    expect(resolveAutomationQuestion('Explain the daily-ops-review playbook')).toBe('explain-automation');
    expect(resolveAutomationQuestion('draft an email')).toBeNull();
  });

  it('FOUR-WAY disjointness: each stage answers its own questions and no one else’s', () => {
    const battery: { text: string; owner: 'insight' | 'knowledge' | 'automation' | 'none' }[] = [
      { text: 'Summarize the current enterprise health', owner: 'insight' },
      { text: 'What is our deployment policy?', owner: 'knowledge' },
      { text: 'Which documents conflict?', owner: 'knowledge' },
      { text: 'What is the status of my automations?', owner: 'automation' },
      { text: 'Simulate the incident playbook', owner: 'automation' },
      { text: 'Why did my automation fail?', owner: 'automation' },
      { text: 'draft an email to the team', owner: 'none' },
    ];
    for (const { text, owner } of battery) {
      expect(resolveInsightQuestion(text) !== null, `insight vs "${text}"`).toBe(owner === 'insight');
      expect(resolveKnowledgeQuestion(text) !== null, `knowledge vs "${text}"`).toBe(owner === 'knowledge');
      expect(resolveAutomationQuestion(text) !== null, `automation vs "${text}"`).toBe(owner === 'automation');
    }
  });
});

describe('the automation turn', () => {
  it("produces the 'intelligence'-kind report (D-8) with an inspectable tool call and no execution", async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'What is the status of my automations?');
    expect(h.automationCalls).toEqual(['What is the status of my automations?']);
    expect(h.intelligenceCalls).toEqual([]); // disjoint: the Stage 6 branch never fired
    expect(h.knowledgeCalls).toEqual([]); // disjoint: the Stage 7 branch never fired
    expect(env.structured?.kind).toBe('intelligence');
    const call = env.toolCalls.find((t) => t.label === 'Answer from the automation platform')!;
    expect(call.outcome).toBe('ok');
    expect(call.detail).toContain('2 section(s)');
    expect(env.grounded).toBe(true);
    expect(h.execRequests).toEqual([]); // read-only turn — nothing dispatched
    expect(env.plan?.steps.some((s) => s.sideEffects) ?? false).toBe(false);
  });

  it('a low-scoring phrasing still resolves (productivityResolved gate extension)', async () => {
    const h = mkService();
    const env = await askEnvelope(h.service, 'automations status');
    expect(env.clarification).toBeNull();
    expect(env.structured?.kind).toBe('intelligence');
  });

  it('absent port → explicit unavailable, never a silent zero', async () => {
    const h = mkService({ port: false });
    const env = await askEnvelope(h.service, 'Why did my automation fail?');
    expect(env.unavailable).toContainEqual({ system: 'automation', reason: 'automation port not wired' });
    expect(env.structured ?? null).toBeNull();
  });

  it('a throwing automation subsystem becomes an explicit unavailable reason', async () => {
    const h = mkService({ throws: true });
    const env = await askEnvelope(h.service, 'What is the status of my automations?');
    expect(env.unavailable.some((u) => u.system === 'automation' && u.reason.includes('offline'))).toBe(true);
  });

  it('"launch the onboarding automation" stays with the OPERATIONAL flow — the Stage 8 branch never fires', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'launch the onboarding automation');
    expect(h.automationCalls).toEqual([]);
  });

  it('Stage 6 + Stage 7 questions still route to their own branches, untouched', async () => {
    const h = mkService();
    await askEnvelope(h.service, 'Summarize the current enterprise health');
    expect(h.intelligenceCalls).toEqual(['Summarize the current enterprise health']);
    await askEnvelope(h.service, 'What is our deployment policy?');
    expect(h.knowledgeCalls).toEqual(['What is our deployment policy?']);
    expect(h.automationCalls).toEqual([]);
  });
});
