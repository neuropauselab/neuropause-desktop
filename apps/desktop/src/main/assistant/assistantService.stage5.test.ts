/**
 * Phase 6 Stage 5 — service-level productivity flows: the task lifecycle over
 * the memory-store lens (create → remind → complete → list → delegate-gated),
 * the brief / meeting-prep / work-summary structured reports with their
 * narrative prompts, and the honesty contract (absent ports → explicit
 * unavailable; unparseable → clarification; empty calendar → honest miss).
 */
import { describe, expect, it } from 'vitest';
import type {
  AiEngineRequest,
  AiEngineResponse,
  AssistantConversation,
  AssistantEnvelope,
  AssistantStructuredReport,
  ExecutionRequest,
  ExecutionSession,
} from '@neuropause/shared';
import { AssistantService, type AssistantServiceDeps } from './assistantService';

const NOW = '2026-07-31T09:00:00.000Z';

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
    data: { answer: 'Narrative.', recommendations: [], assumptions: [], confidence: 0.8 },
    evidence: [],
    confidence: 0.8,
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    latencyMs: 1,
    contextSources: [],
    grounded: true,
    ...over,
  };
}

function mkSession(over: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: 'exec_1',
    kind: 'worker',
    label: 'Worker',
    state: 'completed',
    steps: [],
    currentStep: -1,
    startedAt: NOW,
    completedAt: NOW,
    durationMs: 2,
    error: null,
    resultSummary: 'ok',
    result: null,
    correlationId: null,
    ...over,
  };
}

interface TaskRec {
  id: string;
  title: string;
  status: string;
  due: string | null;
  priority: string;
  createdAt: string;
}

interface Harness {
  service: AssistantService;
  store: ReturnType<typeof fakeStore>;
  aiRequests: AiEngineRequest[];
  execRequests: ExecutionRequest[];
  created: { title: string; due: string | null; priority: string }[];
  completed: string[];
  reminders: { title: string; at: string }[];
  briefCalls: string[];
  tasks: TaskRec[];
}

function report(kind: AssistantStructuredReport['kind'], grounded = true): AssistantStructuredReport {
  return {
    kind,
    title: kind === 'brief' ? 'Today: 2 updates' : kind === 'meeting-brief' ? 'Meeting prep: Design sync' : 'Work summary — 2026-07-31',
    sections: grounded ? [{ title: 'Section', lines: ['line 1'] }] : [],
    grounded,
  };
}

function mkHarness(opts: {
  tasks?: TaskRec[];
  noPorts?: boolean;
  meetingNull?: boolean;
  aiOffline?: boolean;
} = {}): Harness {
  const store = fakeStore();
  const aiRequests: AiEngineRequest[] = [];
  const execRequests: ExecutionRequest[] = [];
  const created: { title: string; due: string | null; priority: string }[] = [];
  const completed: string[] = [];
  const reminders: { title: string; at: string }[] = [];
  const briefCalls: string[] = [];
  const tasks: TaskRec[] = opts.tasks ?? [];
  let seq = 0;
  const deps: AssistantServiceDeps = {
    store,
    context: {
      workers: () => [{ id: 'w1', name: 'Researcher', role: 'research' }],
      automations: () => [],
    },
    buildContext: () => [],
    runAi: (req) => {
      aiRequests.push(req);
      return Promise.resolve(
        aiResponse({
          promptId: req.promptId,
          grounded: !opts.aiOffline,
          data:
            req.promptId === 'brief.executive-summary'
              ? { executiveSummary: 'Brief narrative.', recommendations: [], confidence: 0.7 }
              : { answer: 'Narrative.', recommendations: [], assumptions: [], confidence: 0.8 },
        }),
      );
    },
    screen: () => ({ allowed: true, rejections: [] }),
    execute: (req) => {
      execRequests.push(req);
      return Promise.resolve(mkSession({ correlationId: req.correlationId ?? null }));
    },
    newId: () => `id${(seq++).toString(36)}`,
    now: () => NOW,
    ...(opts.noPorts
      ? {}
      : {
          tasks: {
            create: ({ title, due, priority }) => {
              created.push({ title, due, priority });
              const rec = { id: `t${created.length}`, title, status: 'open', due, priority, createdAt: NOW };
              tasks.push(rec);
              return { id: rec.id, title };
            },
            complete: (id) => {
              completed.push(id);
              const rec = tasks.find((t) => t.id === id);
              if (!rec) return null;
              rec.status = 'done';
              return { id, title: rec.title };
            },
            list: () => [...tasks],
          },
          scheduleReminder: ({ title, at }) => {
            reminders.push({ title, at });
            return { id: 'rem1' };
          },
          briefing: (period) => {
            briefCalls.push(period);
            return report('brief');
          },
          meetingPrep: () => (opts.meetingNull ? null : report('meeting-brief')),
          workSummary: () => report('work-summary'),
        }),
  };
  const service = new AssistantService(deps);
  return { service, store, aiRequests, execRequests, created, completed, reminders, briefCalls, tasks };
}

function env(c: AssistantConversation, messageId: string): AssistantEnvelope {
  return c.messages.find((m) => m.id === messageId)!.envelope!;
}

describe('task lifecycle (D-3 — auto-run local writes, recorded as tool calls)', () => {
  it('creates a task with due + priority and records the task tool call', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'add a task to send the Q3 deck tomorrow, urgent' });
    expect(h.created).toEqual([{ title: 'send the Q3 deck', due: '2026-08-01T09:00:00.000Z', priority: 'high' }]);
    const e = env(conversation, messageId);
    const call = e.toolCalls.find((t) => t.tool === 'task')!;
    expect(call.outcome).toBe('ok');
    expect(e.findings.some((f) => f.label === 'Task created')).toBe(true);
    expect(h.execRequests).toEqual([]); // local write — never the ExecuteEngine
  });

  it('remind-me schedules a reminder at the parsed time', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'remind me to call Sam in 2 hours' });
    expect(h.reminders).toEqual([{ title: 'call Sam', at: '2026-07-31T11:00:00.000Z' }]);
    const e = env(conversation, messageId);
    expect(e.toolCalls.some((t) => t.tool === 'reminder' && t.outcome === 'ok')).toBe(true);
  });

  it('remind-me without a parseable time creates the task but NOT a reminder (honest assumption)', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'remind me to review the contract' });
    expect(h.created.length).toBe(1);
    expect(h.reminders).toEqual([]);
    const e = env(conversation, messageId);
    expect(e.assumptions.some((a) => a.includes('No reminder time'))).toBe(true);
  });

  it('completes a matching open task by fuzzy title', async () => {
    const h = mkHarness({
      tasks: [{ id: 't9', title: 'send the Q3 deck', status: 'open', due: null, priority: 'normal', createdAt: NOW }],
    });
    const { conversation, messageId } = await h.service.ask({ text: 'mark the Q3 deck task as done' });
    expect(h.completed).toEqual(['t9']);
    expect(env(conversation, messageId).findings.some((f) => f.label === 'Task completed')).toBe(true);
  });

  it('never guesses on a non-matching completion (skipped + assumption)', async () => {
    const h = mkHarness({
      tasks: [{ id: 't9', title: 'renew SSL cert', status: 'open', due: null, priority: 'normal', createdAt: NOW }],
    });
    const { conversation, messageId } = await h.service.ask({ text: 'mark the Q3 deck task as done' });
    expect(h.completed).toEqual([]);
    const e = env(conversation, messageId);
    expect(e.toolCalls.find((t) => t.tool === 'task')!.outcome).toBe('skipped');
    expect(e.assumptions.some((a) => a.includes('nothing was changed'))).toBe(true);
  });

  it('lists open tasks as findings', async () => {
    const h = mkHarness({
      tasks: [
        { id: 't1', title: 'send deck', status: 'open', due: null, priority: 'high', createdAt: NOW },
        { id: 't2', title: 'old one', status: 'done', due: null, priority: 'normal', createdAt: NOW },
      ],
    });
    const { conversation, messageId } = await h.service.ask({ text: 'show my open tasks' });
    const e = env(conversation, messageId);
    const open = e.findings.filter((f) => f.label === 'Open task');
    expect(open.length).toBe(1);
    expect(open[0]!.text).toContain('send deck');
  });

  it('delegation stays approval-gated through the worker step (no auto dispatch)', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({
      text: 'delegate the competitor research to the Researcher',
      mode: 'execute',
    });
    const e = env(conversation, messageId);
    expect(h.execRequests).toEqual([]); // nothing ran without approval
    const step = e.plan!.steps.find((s) => s.tool === 'worker')!;
    expect(step.needsApproval).toBe(true);
    expect(step.state).toBe('waiting');
    // approving dispatches through the ONE execution path
    await h.service.decideStep({
      conversationId: conversation.id,
      messageId,
      stepId: step.id,
      decision: 'approve',
    });
    expect(h.execRequests.map((r) => r.kind)).toEqual(['worker']);
  });

  it('asks for clarification on an unparseable task instead of guessing', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'add a task' });
    const e = env(conversation, messageId);
    expect(e.clarification).toContain('add a task to send the Q3 deck');
    expect(h.created).toEqual([]);
  });

  it('reports the task port as unavailable when it is not wired', async () => {
    const h = mkHarness({ noPorts: true });
    const { conversation, messageId } = await h.service.ask({ text: 'add a task to send the deck' });
    expect(env(conversation, messageId).unavailable.some((u) => u.system === 'tasks')).toBe(true);
  });
});

describe('brief / work summary / meeting prep (D-2/D-4 + addition #2)', () => {
  it('"plan my day" resolves to the morning brief with the existing brief prompt', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'plan my day' });
    expect(h.briefCalls).toEqual(['morning']);
    const e = env(conversation, messageId);
    expect(e.structured?.kind).toBe('brief');
    expect(e.toolCalls.some((t) => t.tool === 'brief')).toBe(true);
    expect(h.aiRequests[h.aiRequests.length - 1]!.promptId).toBe('brief.executive-summary');
    expect(e.text).toBe('Brief narrative.');
  });

  it('a bare "morning brief" passes the clarity floor via the resolver', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'morning brief' });
    const e = env(conversation, messageId);
    expect(e.clarification).toBeNull();
    expect(e.structured?.kind).toBe('brief');
  });

  it('a grounded report keeps the turn grounded even when the model is offline', async () => {
    const h = mkHarness({ aiOffline: true });
    const { conversation, messageId } = await h.service.ask({ text: 'plan my day' });
    const e = env(conversation, messageId);
    expect(e.grounded).toBe(true);
    expect(e.aiOffline).toBe(true);
    expect(e.structured?.grounded).toBe(true);
  });

  it('meeting prep produces the meeting-brief report and prompt', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'prepare me for my next meeting' });
    const e = env(conversation, messageId);
    expect(e.structured?.kind).toBe('meeting-brief');
    expect(h.aiRequests[h.aiRequests.length - 1]!.promptId).toBe('assistant.meeting-brief');
  });

  it('meeting prep with an empty calendar is an honest miss (skipped + assumption)', async () => {
    const h = mkHarness({ meetingNull: true });
    const { conversation, messageId } = await h.service.ask({ text: 'prepare me for my next meeting' });
    const e = env(conversation, messageId);
    expect(e.structured ?? null).toBeNull();
    expect(e.toolCalls.find((t) => t.tool === 'meeting-prep')!.outcome).toBe('skipped');
    expect(e.assumptions.some((a) => a.includes('No upcoming meeting'))).toBe(true);
  });

  it('"summarize my day" produces the work-summary report', async () => {
    const h = mkHarness();
    const { conversation, messageId } = await h.service.ask({ text: 'summarize my day' });
    const e = env(conversation, messageId);
    expect(e.structured?.kind).toBe('work-summary');
    expect(e.sources.some((s) => s.id === 'productivity-report')).toBe(true);
  });

  it('reports the briefing port as unavailable when it is not wired', async () => {
    const h = mkHarness({ noPorts: true });
    const { conversation, messageId } = await h.service.ask({ text: 'plan my day' });
    expect(env(conversation, messageId).unavailable.some((u) => u.system === 'briefing')).toBe(true);
  });
});
