import { describe, expect, it } from 'vitest';
import type { AssistantEnvelope, AssistantPlanStep, AssistantTrace } from '@neuropause/shared';
import {
  approvalCard,
  explanationSummary,
  inspectorSections,
  STEP_STATE_META,
  stepsAwaitingApproval,
} from './assistantViewModel';

function mkStep(over: Partial<AssistantPlanStep> = {}): AssistantPlanStep {
  return {
    id: 'st_1',
    tool: 'automation',
    label: 'Run automation “Onboarding”',
    purpose: 'Execute the saved rule.',
    reason: 'You asked to launch it.',
    expectedOutput: 'An ExecuteEngine session.',
    needsApproval: true,
    sideEffects: true,
    risk: 'high',
    rollback: 'No automatic rollback — review the target before approving.',
    state: 'waiting',
    executionKind: 'automation',
    targetId: 'a1',
    input: null,
    executionId: null,
    resultSummary: null,
    verification: null,
    error: null,
    note: null,
    decidedBy: null,
    decidedAt: null,
    ...over,
  };
}

function mkTrace(over: Partial<AssistantTrace> = {}): AssistantTrace {
  return {
    correlationId: 'asst_1',
    mode: 'execute',
    intent: { intent: 'automation', confidence: 0.6, matched: ['run automation'] },
    phases: [
      { phase: 'context', durationMs: 2 },
      { phase: 'retrieval', durationMs: 5 },
    ],
    workspace: {
      workspace: { id: 'ws1', name: 'Pilot' },
      workspaceCount: 2,
      activeExecutions: 1,
      pendingApprovals: 2,
      connectors: { total: 3, connected: 2, problems: [] },
      automations: { total: 4, active: 3 },
      recentTimeline: [],
      memoryTotal: 42,
      uiContext: { section: 'mission-control' },
      unavailable: [{ system: 'org', reason: 'not wired' }],
    },
    retrieved: [{ source: 'ai-memory', text: 'Invoice INV-9 overdue', evidence: [] }],
    recalledMemories: 1,
    reasoning: {
      promptId: 'assistant.workspace',
      promptVersion: 1,
      model: 'claude-test',
      grounded: true,
      confidence: 0.8,
      latencyMs: 12,
      contextSources: ['ai-memory'],
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.0012,
      responseId: 'resp_1',
    },
    toolCalls: [
      {
        id: 'tc_1',
        tool: 'retrieval',
        label: 'Enterprise retrieval',
        purpose: 'Gather evidence',
        reason: 'Retrieve first',
        expectedOutput: 'items',
        outcome: 'ok',
        detail: '1 item(s)',
        durationMs: 5,
        correlationId: 'asst_1',
      },
    ],
    audit: {
      permissionClass: 'local (sender-trust)',
      aiResponseId: 'resp_1',
      executionIds: ['exec_1'],
      timelineEventTypes: ['assistant.turn.started'],
    },
    generatedAt: 'now',
    ...over,
  };
}

function mkEnvelope(over: Partial<AssistantEnvelope> = {}): AssistantEnvelope {
  return {
    correlationId: 'asst_1',
    mode: 'execute',
    intent: { intent: 'automation', confidence: 0.6, matched: [] },
    clarification: null,
    text: 'answer',
    findings: [],
    recommendations: [],
    draft: null,
    navigation: null,
    plan: {
      id: 'plan_asst_1',
      correlationId: 'asst_1',
      intent: 'automation',
      mode: 'execute',
      state: 'waiting',
      steps: [mkStep()],
      createdAt: 'now',
      updatedAt: 'now',
    },
    sources: [{ id: 'ai-memory', label: 'ai-memory', kind: 'index', count: 1 }],
    toolCalls: [],
    confidence: 0.8,
    grounded: true,
    aiOffline: false,
    unavailable: [],
    assumptions: ['one assumption'],
    reasoningSummary: null,
    trace: mkTrace(),
    memoryCapture: null,
    generatedAt: 'now',
  ...over,
  };
}

describe('assistant view-model (pure)', () => {
  it('covers every step state with display meta', () => {
    const states: AssistantPlanStep['state'][] = ['pending', 'waiting', 'running', 'completed', 'failed', 'rejected', 'cancelled', 'skipped'];
    for (const s of states) expect(STEP_STATE_META[s].label.length).toBeGreaterThan(0);
  });

  it('builds the approval card from the step itself — what/why/impact/rollback', () => {
    const card = approvalCard(mkStep());
    expect(card.what).toContain('Onboarding');
    expect(card.why).toBe('You asked to launch it.');
    expect(card.impact).toMatch(/real side effects/);
    expect(card.rollback).toMatch(/No automatic rollback/);
    expect(card.risk).toBe('high');
  });

  it('lists only steps genuinely awaiting a human', () => {
    const env = mkEnvelope();
    expect(stepsAwaitingApproval(env)).toHaveLength(1);
    env.plan!.steps[0]!.state = 'completed';
    expect(stepsAwaitingApproval(env)).toHaveLength(0);
  });
});

describe('session inspector — role-appropriate levels over one trace', () => {
  it('user level: sources + tools, but no retrieval items, internals, timings, or audit', () => {
    const sections = inspectorSections(mkTrace(), 'user');
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('turn');
    expect(ids).toContain('context');
    expect(ids).toContain('retrieval');
    expect(ids).not.toContain('timings');
    expect(ids).not.toContain('audit');
    const retrieval = sections.find((s) => s.id === 'retrieval')!;
    expect(retrieval.rows.some((r) => r.value.includes('INV-9'))).toBe(false); // counts only
    const reasoning = sections.find((s) => s.id === 'reasoning')!;
    expect(reasoning.rows.some((r) => r.label === 'Model')).toBe(false);
  });

  it('developer level adds retrieval items, prompt/model internals, and phase timings', () => {
    const sections = inspectorSections(mkTrace(), 'developer');
    const retrieval = sections.find((s) => s.id === 'retrieval')!;
    expect(retrieval.rows.some((r) => r.value.includes('INV-9'))).toBe(true);
    const reasoning = sections.find((s) => s.id === 'reasoning')!;
    expect(reasoning.rows.some((r) => r.label === 'Prompt' && /assistant\.workspace v1/.test(r.value))).toBe(true);
    expect(sections.map((s) => s.id)).toContain('timings');
    expect(sections.map((s) => s.id)).not.toContain('audit');
  });

  it('administrator level adds the audit joins (permission class, AI record, execution sessions, timeline events)', () => {
    const sections = inspectorSections(mkTrace(), 'administrator');
    const audit = sections.find((s) => s.id === 'audit')!;
    expect(audit.rows.some((r) => r.label === 'Permission class')).toBe(true);
    expect(audit.rows.some((r) => r.value === 'resp_1')).toBe(true);
    expect(audit.rows.some((r) => r.value.includes('exec_1'))).toBe(true);
    expect(audit.rows.some((r) => r.value.includes('assistant.turn.started'))).toBe(true);
  });

  it('always surfaces the correlation id and unavailable systems at EVERY level', () => {
    for (const level of ['user', 'developer', 'administrator'] as const) {
      const sections = inspectorSections(mkTrace(), level);
      const turn = sections.find((s) => s.id === 'turn')!;
      expect(turn.rows.some((r) => r.value === 'asst_1')).toBe(true);
      const context = sections.find((s) => s.id === 'context')!;
      expect(context.rows.some((r) => r.label.includes('Unavailable — org'))).toBe(true);
    }
  });

  it('handles a no-reasoning trace honestly', () => {
    const sections = inspectorSections(mkTrace({ reasoning: null }), 'developer');
    const reasoning = sections.find((s) => s.id === 'reasoning')!;
    expect(reasoning.rows[0]!.value).toMatch(/No model call/);
  });
});

describe('explanation summary strip', () => {
  it('compacts the envelope honestly', () => {
    const s = explanationSummary(mkEnvelope());
    expect(s).toContain('1 source');
    expect(s).toContain('confidence 80%');
    expect(s).toContain('1 assumption');
  });
  it('says so when the AI was offline', () => {
    const s = explanationSummary(mkEnvelope({ aiOffline: true }));
    expect(s).toContain('AI offline — deterministic only');
  });
});
