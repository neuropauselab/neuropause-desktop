import { describe, expect, it } from 'vitest';
import type {
  AiEngineRequest,
  AiEngineResponse,
  AssistantConversation,
  AssistantEvent,
  ExecutionRequest,
  ExecutionSession,
} from '@neuropause/shared';
import { AssistantService, resolveNavigation, type AssistantServiceDeps } from './assistantService';

const NOW = '2026-07-31T09:00:00.000Z';

/* ── Fakes ─────────────────────────────────────────────────────────────────── */

function fakeStore(): AssistantServiceDeps['store'] & { all: () => AssistantConversation[] } {
  const map = new Map<string, AssistantConversation>();
  return {
    get: (id) => map.get(id) ?? null,
    upsert: (c) => {
      map.set(c.id, c);
      return Promise.resolve();
    },
    list: () => [],
    delete: (id) => Promise.resolve(map.delete(id)),
    all: () => [...map.values()],
  };
}

function aiResponse(over: Partial<AiEngineResponse> = {}): AiEngineResponse {
  return {
    responseId: 'resp_1',
    worker: 'assistant',
    promptId: 'assistant.workspace',
    promptVersion: 1,
    model: 'claude-test',
    text: '{}',
    data: {
      answer: 'Grounded answer.',
      recommendations: ['Do the next thing'],
      assumptions: ['model assumption'],
      confidence: 0.8,
    },
    evidence: [],
    confidence: 0.8,
    usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    latencyMs: 3,
    contextSources: ['ai-memory'],
    grounded: true,
    ...over,
  };
}

function mkSession(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec_1',
    kind: 'automation',
    label: 'Automation: Onboarding',
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: NOW,
    completedAt: NOW,
    durationMs: 12,
    error: null,
    resultSummary: '2 action(s) run',
    result: null,
    correlationId: null,
    ...over,
  };
}

interface Harness {
  service: AssistantService;
  store: ReturnType<typeof fakeStore>;
  calls: string[];
  aiRequests: AiEngineRequest[];
  execRequests: ExecutionRequest[];
  published: { type: string; correlationId?: string }[];
  events: AssistantEvent[];
  recallCids: string[];
  captureArgs: { correlationId: string }[];
}

function mkHarness(over: Partial<AssistantServiceDeps> = {}, opts: { failWorkspaces?: boolean; cancelDuringAi?: boolean } = {}): Harness {
  const store = fakeStore();
  const calls: string[] = [];
  const aiRequests: AiEngineRequest[] = [];
  const execRequests: ExecutionRequest[] = [];
  const published: { type: string; correlationId?: string }[] = [];
  const events: AssistantEvent[] = [];
  const recallCids: string[] = [];
  const captureArgs: { correlationId: string }[] = [];
  let seq = 0;

  const deps: AssistantServiceDeps = {
    store,
    context: {
      workspaces: () => {
        calls.push('port:workspaces');
        if (opts.failWorkspaces) throw new Error('workspace store exploded');
        return { active: { id: 'ws1', name: 'Pilot' }, count: 2 };
      },
      connectors: () => [
        { id: 'gmail', connected: true, problem: null },
        { id: 'slack', connected: false, problem: 'health degraded (status error)' },
      ],
      executions: () => ({ active: 1 }),
      pendingApprovals: () => 2,
      automations: () => [{ id: 'a1', name: 'Onboarding', actionCount: 2, active: true }],
      workers: () => [{ id: 'w1', name: 'Researcher', role: 'research' }],
      timeline: () => [{ id: 't1', at: NOW, kind: 'sync', title: 'Gmail synced' }],
      memoryTotal: () => 42,
    },
    buildContext: (req) => {
      calls.push(`buildContext:${req.worker}`);
      return [
        { source: 'ai-memory', text: 'Invoice INV-9 overdue 31 days', evidence: [{ kind: 'memory', id: 'm1' }] },
      ];
    },
    runAi: (req) => {
      calls.push(`runAi:${req.promptId}`);
      aiRequests.push(req);
      if (opts.cancelDuringAi) service.cancel('c-pre');
      return Promise.resolve(aiResponse({ promptId: req.promptId }));
    },
    recallMemories: (_q, _now, cid) => {
      recallCids.push(cid);
      return [{ title: 'Decision: ship Friday' }];
    },
    captureMemory: (args) => {
      captureArgs.push({ correlationId: args.correlationId });
      return { outcome: 'stored', type: 'conversation' };
    },
    screen: (text) =>
      /sk-[A-Za-z0-9]{8,}/.test(text)
        ? { allowed: false, rejections: [{ category: 'api-key', detail: 'Looks like an API key.' }] }
        : { allowed: true, rejections: [] },
    execute: (req) => {
      calls.push(`execute:${req.kind}`);
      execRequests.push(req);
      return Promise.resolve(mkSession({ correlationId: req.correlationId ?? null }));
    },
    publish: (e) => published.push({ type: e.type, ...(e.correlationId ? { correlationId: e.correlationId } : {}) }),
    broadcast: (e) => events.push(e),
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    ...over,
  };
  const service = new AssistantService(deps);
  return { service, store, calls, aiRequests, execRequests, published, events, recallCids, captureArgs };
}

/* ── Pipeline order + explainability ───────────────────────────────────────── */

describe('assistant turn pipeline', () => {
  it('retrieves first, reasons second — and never reasons without context', async () => {
    const h = mkHarness();
    await h.service.ask({ text: 'how many connectors are connected?' });
    const retrieveIdx = h.calls.indexOf('buildContext:assistant');
    const reasonIdx = h.calls.indexOf('runAi:assistant.workspace');
    expect(retrieveIdx).toBeGreaterThanOrEqual(0);
    expect(reasonIdx).toBeGreaterThan(retrieveIdx);
    const req = h.aiRequests[0]!;
    expect(req.context && req.context.length).toBeGreaterThan(0);
  });

  it('produces the mandatory explainability envelope on every response', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.sources.length).toBeGreaterThan(0);
    const retrievalCall = env.toolCalls.find((t) => t.tool === 'retrieval')!;
    expect(retrievalCall.purpose.length).toBeGreaterThan(0);
    expect(retrievalCall.reason.length).toBeGreaterThan(0);
    expect(retrievalCall.expectedOutput.length).toBeGreaterThan(0);
    expect(env.reasoningSummary).toBeTruthy();
    const phases = env.trace.phases.map((p) => p.phase);
    for (const p of ['context', 'retrieval', 'planning', 'reasoning']) expect(phases).toContain(p);
    expect(env.trace.workspace.workspace?.name).toBe('Pilot');
    expect(env.trace.retrieved.length).toBe(1);
  });

  it('threads ONE correlation id through AI, retrieval, memory, events, and the envelope', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    const cid = env.correlationId;
    expect(cid).toMatch(/^asst_/);
    expect(h.aiRequests[0]!.correlationId).toBe(cid);
    expect(env.toolCalls.every((t) => t.correlationId === cid)).toBe(true);
    expect(h.recallCids).toEqual([cid]);
    expect(h.captureArgs[0]!.correlationId).toBe(cid);
    const turnEvents = h.published.filter((p) => p.type.startsWith('assistant.'));
    expect(turnEvents.length).toBeGreaterThan(0);
    expect(turnEvents.every((p) => p.correlationId === cid)).toBe(true);
    expect(h.events.every((e) => e.correlationId === cid)).toBe(true);
  });

  it('uses the grounded narrative when the model ran', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'explain why sales dropped' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.text).toBe('Grounded answer.');
    expect(env.recommendations).toEqual(['Do the next thing']);
    expect(env.assumptions).toContain('model assumption');
    expect(env.grounded).toBe(true);
    expect(env.trace.reasoning?.responseId).toBe('resp_1');
    expect(env.trace.audit.aiResponseId).toBe('resp_1');
  });

  it('degrades honestly when the model is offline: findings still answer, nothing invented', async () => {
    const h = mkHarness({
      runAi: (req) => Promise.resolve(aiResponse({ grounded: false, data: null, confidence: 0, model: 'none', promptId: req.promptId })),
    });
    const { conversation, messageId } = await h.service.ask({ text: 'explain why sales dropped' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.aiOffline).toBe(true);
    expect(env.text).toBeNull();
    expect(env.confidence).toBe(0);
    expect(env.findings.length).toBeGreaterThan(0); // deterministic floor
    expect(env.reasoningSummary).toMatch(/No model was reachable/);
  });

  it('asks for clarification below the confidence floor — no retrieval, no model call', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'florble the wibble zorp' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.clarification).toBeTruthy();
    expect(h.calls).not.toContain('buildContext:assistant');
    expect(h.calls.some((c) => c.startsWith('runAi'))).toBe(false);
  });

  it('refuses to process or store secrets: redacts, explains, and calls no engine', async () => {
    const h = mkHarness();
    const { conversation } = await h.service.ask({ text: 'my key is sk-abcdefgh12345678 please remember it' });
    const userMsg = conversation.messages[0]!;
    expect(userMsg.text).toMatch(/^\[redacted — refused: api-key\]$/);
    expect(userMsg.redactions[0]!.category).toBe('api-key');
    expect(h.calls).not.toContain('buildContext:assistant');
    expect(h.calls.some((c) => c.startsWith('runAi'))).toBe(false);
    expect(h.published.some((p) => p.type === 'assistant.turn.refused')).toBe(true);
  });
});

/* ── Context honesty (Stage 2 isolation contract) ──────────────────────────── */

describe('context collection honesty', () => {
  it('a throwing collector becomes an explicit unavailable reason — the turn still completes', async () => {
    const h = mkHarness({}, { failWorkspaces: true });
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.unavailable.some((u) => u.system === 'workspaces' && /exploded/.test(u.reason))).toBe(true);
    expect(env.trace.workspace.connectors?.total).toBe(2); // other collectors unaffected
  });

  it('a missing collector is reported as not wired — never a silent zero', async () => {
    const h = mkHarness({
      context: {
        workspaces: () => ({ active: null, count: 0 }),
        connectors: () => [],
        executions: () => ({ active: 0 }),
        pendingApprovals: () => 0,
        automations: () => [],
        workers: () => [],
        // timeline + memoryTotal deliberately absent
      },
    });
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.unavailable.some((u) => u.system === 'timeline' && /not wired/.test(u.reason))).toBe(true);
    expect(env.unavailable.some((u) => u.system === 'memory' && /not wired/.test(u.reason))).toBe(true);
  });

  it('surfaces operational findings deterministically (pending approvals, connector problems)', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.findings.some((f) => f.label === 'Approvals' && /2 proposal/.test(f.text))).toBe(true);
    expect(env.findings.some((f) => f.label === 'Connector problem' && f.connectorId === 'slack')).toBe(true);
  });
});

/* ── Modes ─────────────────────────────────────────────────────────────────── */

describe('assistant modes over one pipeline', () => {
  it('monitor mode never calls the model and answers with the deterministic snapshot', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'anything at all', mode: 'monitor' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(h.calls.some((c) => c.startsWith('runAi'))).toBe(false);
    expect(h.calls).not.toContain('buildContext:assistant');
    expect(env.text).toMatch(/Operational snapshot: 1 active execution/);
    expect(env.reasoningSummary).toMatch(/Monitor mode/);
  });

  it('ask mode marks action steps skipped with an explicit note + assumption', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'launch the onboarding automation', mode: 'ask' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.plan!.steps[0]!.state).toBe('skipped');
    expect(env.assumptions.some((a) => /Execute mode/.test(a))).toBe(true);
  });

  it('execute mode parks the side-effecting step as waiting (never auto-runs)', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'launch the onboarding automation', mode: 'execute' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.plan!.state).toBe('waiting');
    expect(env.plan!.steps[0]!.state).toBe('waiting');
    expect(h.calls.some((c) => c.startsWith('execute:'))).toBe(false);
  });
});

/* ── Approval → dispatch → verification ────────────────────────────────────── */

async function askForPlan(h: Harness, mode: 'execute' | 'plan'): Promise<{ conversationId: string; messageId: string; stepId: string; cid: string }> {
  const { conversation, messageId } = await h.service.ask({ text: 'launch the onboarding automation', mode });
  const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
  return { conversationId: conversation.id, messageId, stepId: env.plan!.steps[0]!.id, cid: env.correlationId };
}

describe('approval gates + execution through the ExecuteEngine only', () => {
  it('approve dispatches through the engine with the plan correlation id, then verifies from the REAL session', async () => {
    const h = mkHarness();
    const { conversationId, messageId, stepId, cid } = await askForPlan(h, 'execute');
    const updated = (await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' }))!;
    const step = updated.messages.find((m) => m.id === messageId)!.envelope!.plan!.steps[0]!;
    expect(h.execRequests).toHaveLength(1);
    expect(h.execRequests[0]!.kind).toBe('automation');
    expect(h.execRequests[0]!.targetId).toBe('a1');
    expect(h.execRequests[0]!.correlationId).toBe(cid);
    expect(step.state).toBe('completed');
    expect(step.executionId).toBe('exec_1');
    expect(step.verification).toMatch(/exec_1 → completed/);
    expect(step.decidedBy).toBe('user');
    const env = updated.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.trace.audit.executionIds).toContain('exec_1');
    expect(h.published.some((p) => p.type === 'assistant.approval.granted' && p.correlationId === cid)).toBe(true);
    expect(h.published.some((p) => p.type === 'assistant.step.completed')).toBe(true);
  });

  it('reject cancels the step and never touches the engine', async () => {
    const h = mkHarness();
    const { conversationId, messageId, stepId } = await askForPlan(h, 'execute');
    const updated = (await h.service.decideStep({ conversationId, messageId, stepId, decision: 'reject', note: 'not now' }))!;
    const step = updated.messages.find((m) => m.id === messageId)!.envelope!.plan!.steps[0]!;
    expect(step.state).toBe('rejected');
    expect(step.note).toBe('not now');
    expect(h.execRequests).toHaveLength(0);
    expect(h.published.some((p) => p.type === 'assistant.approval.rejected')).toBe(true);
  });

  it('is idempotent: a decided step cannot be re-dispatched', async () => {
    const h = mkHarness();
    const { conversationId, messageId, stepId } = await askForPlan(h, 'execute');
    await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' });
    await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' });
    expect(h.execRequests).toHaveLength(1);
  });

  it('records a failed session honestly (step failed, error carried, verification states it)', async () => {
    const h = mkHarness({
      execute: (req) => Promise.resolve(mkSession({ id: 'exec_9', state: 'failed', error: 'rule blew up', resultSummary: null, correlationId: req.correlationId ?? null })),
    });
    const { conversationId, messageId, stepId } = await askForPlan(h, 'execute');
    const updated = (await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' }))!;
    const step = updated.messages.find((m) => m.id === messageId)!.envelope!.plan!.steps[0]!;
    expect(step.state).toBe('failed');
    expect(step.error).toBe('rule blew up');
    expect(step.verification).toMatch(/exec_9 → failed/);
  });

  it('an engine rejection (throw) fails the step without crashing the turn', async () => {
    const h = mkHarness({ execute: () => Promise.reject(new Error('engine offline')) });
    const { conversationId, messageId, stepId } = await askForPlan(h, 'execute');
    const updated = (await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' }))!;
    const step = updated.messages.find((m) => m.id === messageId)!.envelope!.plan!.steps[0]!;
    expect(step.state).toBe('failed');
    expect(step.error).toBe('engine offline');
  });

  it('Plan mode records the approval but dispatches NOTHING by design', async () => {
    const h = mkHarness();
    const { conversationId, messageId, stepId } = await askForPlan(h, 'plan');
    const updated = (await h.service.decideStep({ conversationId, messageId, stepId, decision: 'approve' }))!;
    const step = updated.messages.find((m) => m.id === messageId)!.envelope!.plan!.steps[0]!;
    expect(step.state).toBe('completed');
    expect(step.resultSummary).toMatch(/Plan mode/);
    expect(h.execRequests).toHaveLength(0);
  });
});

/* ── Navigation, search, drafting ──────────────────────────────────────────── */

describe('navigation / search / drafting resolutions', () => {
  it('navigation intent resolves a shell deep-link', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'open mission control' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.navigation).toEqual({ section: 'mission-control', query: null });
  });

  it('search intent hands off to Universal Search with the query', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'find every invoice overdue by 30 days' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.navigation?.section).toBe('search');
    expect(env.navigation?.query).toMatch(/overdue/);
  });

  it('content-creation drafts review-only content via the existing draft prompts', async () => {
    const prompts: string[] = [];
    const h = mkHarness({
      runAi: (req) => {
        prompts.push(req.promptId);
        return Promise.resolve(aiResponse({ promptId: req.promptId, data: req.promptId.startsWith('m365') ? { text: 'Dear customer…', confidence: 0.7 } : { answer: 'Draft prepared.', confidence: 0.7 } }));
      },
    });
    const { conversation, messageId } = await h.service.ask({ text: 'draft a customer response email about the delay' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(prompts).toContain('m365.draft.email');
    expect(env.draft?.kind).toBe('email');
    expect(env.draft?.text).toBe('Dear customer…');
    expect(env.draft?.note).toMatch(/never sends/);
  });

  it('meeting requests draft an agenda instead', async () => {
    const prompts: string[] = [];
    const h = mkHarness({
      runAi: (req) => {
        prompts.push(req.promptId);
        return Promise.resolve(aiResponse({ promptId: req.promptId, data: req.promptId.startsWith('m365') ? { text: '1. Kickoff', confidence: 0.7 } : { answer: 'ok', confidence: 0.7 } }));
      },
    });
    const { conversation, messageId } = await h.service.ask({ text: 'draft an agenda for the meeting tomorrow' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(prompts).toContain('m365.draft.agenda');
    expect(env.draft?.kind).toBe('agenda');
  });

  it('resolveNavigation maps known surfaces and refuses unknowns', () => {
    expect(resolveNavigation('open mission control')?.section).toBe('mission-control');
    expect(resolveNavigation('go to memory')?.section).toBe('memory');
    expect(resolveNavigation('open the flux capacitor')).toBeNull();
  });
});

/* ── Conversation continuity, branch, cancel ───────────────────────────────── */

describe('conversation continuity + interrupt + branch', () => {
  it('persists user + assistant messages and stamps the workspace', async () => {
    const h = mkHarness();
    const { conversation } = await h.service.ask({ text: 'summarize today', workspaceId: 'ws-9' });
    expect(conversation.workspaceId).toBe('ws-9');
    expect(conversation.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(h.store.all()).toHaveLength(1);
  });

  it('feeds prior turns into the reasoning history variable', async () => {
    const h = mkHarness();
    const first = await h.service.ask({ text: 'summarize today' });
    await h.service.ask({ text: 'what changed since this morning?', conversationId: first.conversation.id });
    const secondReq = h.aiRequests.filter((r) => r.promptId === 'assistant.workspace')[1]!;
    expect(secondReq.variables!.history).toContain('summarize today');
  });

  it('branch copies the prefix and records the parent lineage', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const branched = (await h.service.branch(conversation.id, messageId))!;
    expect(branched.parent).toEqual({ conversationId: conversation.id, messageId });
    expect(branched.messages).toHaveLength(2);
    expect(branched.id).not.toBe(conversation.id);
  });

  it('an interrupt lands as an honest "stopped" turn', async () => {
    const h = mkHarness({}, { cancelDuringAi: true });
    // Seed a known conversation id so the cancel (fired from inside the AI fake)
    // can target the in-flight turn.
    await h.store.upsert({
      id: 'c-pre',
      workspaceId: null,
      title: 'Seed',
      pinned: false,
      createdAt: NOW,
      updatedAt: NOW,
      parent: null,
      messages: [],
    });
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today please', conversationId: 'c-pre' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.clarification).toMatch(/interrupted/);
    expect(h.published.some((p) => p.type === 'assistant.turn.interrupted')).toBe(true);
  });

  it('memory capture flows through the existing governance adapter', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize today' });
    const env = conversation.messages.find((m) => m.id === messageId)!.envelope!;
    expect(env.memoryCapture).toEqual({ outcome: 'stored', type: 'conversation' });
  });
});
