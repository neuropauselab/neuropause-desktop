import { describe, expect, it, beforeEach } from 'vitest';
import {
  ASSISTANT_CONFIDENCE_FLOOR,
  baseEnvelope,
  buildPlan,
  classifyAssistantIntent,
  conversationTitle,
  emptyTrace,
  INTENT_QUERIES,
  MODE_CONFIG,
  nameMatches,
  planStateFrom,
  renderHistory,
  renderWorkspaceSnapshot,
  resetPlanStepIds,
  emptyWorkspaceSnapshot,
} from './assistantModel';
import type { AssistantIntentId, AssistantMode } from '@neuropause/shared';

const NOW = '2026-07-31T09:00:00.000Z';

describe('assistant intent classification (deterministic, 11 classes)', () => {
  const CASES: [string, AssistantIntentId][] = [
    ['Launch the onboarding workflow', 'workflow'],
    ['run the invoice automation', 'automation'],
    ['run the research worker on this', 'execution'],
    ['send an email to the customer about the delay', 'connector-action'],
    ['find every invoice overdue by 30 days', 'search'],
    ['explain why sales dropped last month', 'analysis'],
    ["prepare tomorrow's meeting", 'planning'],
    ['draft a customer response', 'content-creation'],
    ['show pending approvals', 'decision-support'],
    ['open mission control', 'navigation'],
    ['how many connectors are connected?', 'question'],
  ];
  for (const [text, expected] of CASES) {
    it(`classifies "${text}" → ${expected}`, () => {
      const r = classifyAssistantIntent(text);
      expect(r.intent).toBe(expected);
      expect(r.confidence).toBeGreaterThanOrEqual(ASSISTANT_CONFIDENCE_FLOOR);
      expect(r.matched.length).toBeGreaterThan(0);
    });
  }

  it('yields unclear (confidence 0) for unrecognizable input — never guesses', () => {
    const r = classifyAssistantIntent('florble the wibble zorp');
    expect(r.intent).toBe('unclear');
    expect(r.confidence).toBe(0);
    expect(r.matched).toEqual([]);
  });

  it('is deterministic: same input → identical result', () => {
    const a = classifyAssistantIntent('explain why sales dropped');
    const b = classifyAssistantIntent('explain why sales dropped');
    expect(a).toEqual(b);
  });

  it('has a retrieval phrasing for every intent id', () => {
    const r = classifyAssistantIntent('summarize today');
    expect(INTENT_QUERIES[r.intent]).toBeTruthy();
    const ids: AssistantIntentId[] = [
      'question', 'search', 'analysis', 'planning', 'automation', 'execution',
      'decision-support', 'content-creation', 'navigation', 'connector-action',
      'workflow', 'unclear',
    ];
    for (const id of ids) expect(typeof INTENT_QUERIES[id]).toBe('string');
  });
});

describe('assistant modes — one pipeline, five deterministic configurations', () => {
  it('declares exactly the five modes with coherent flags', () => {
    const modes = Object.keys(MODE_CONFIG) as AssistantMode[];
    expect(modes.sort()).toEqual(['analyze', 'ask', 'execute', 'monitor', 'plan']);
    // Ask + Analyze never offer actions.
    expect(MODE_CONFIG.ask.allowSideEffects).toBe(false);
    expect(MODE_CONFIG.analyze.allowSideEffects).toBe(false);
    // Plan builds but never dispatches; Execute both builds and dispatches.
    expect(MODE_CONFIG.plan.allowSideEffects).toBe(true);
    expect(MODE_CONFIG.plan.dispatchOnApproval).toBe(false);
    expect(MODE_CONFIG.execute.dispatchOnApproval).toBe(true);
    // Monitor is deterministic-only: no reasoning, no retrieval, no actions.
    expect(MODE_CONFIG.monitor.reason).toBe(false);
    expect(MODE_CONFIG.monitor.retrieval).toBeNull();
    expect(MODE_CONFIG.monitor.operational).toBe(true);
  });

  it('gives Analyze a deeper retrieval budget than Ask', () => {
    expect(MODE_CONFIG.analyze.retrieval!.maxItems).toBeGreaterThan(MODE_CONFIG.ask.retrieval!.maxItems);
    expect(MODE_CONFIG.analyze.retrieval!.maxChars).toBeGreaterThan(MODE_CONFIG.ask.retrieval!.maxChars);
  });
});

describe('plan construction (deterministic templates)', () => {
  beforeEach(() => resetPlanStepIds());
  const auto = { id: 'a1', name: 'Onboarding', actionCount: 2, active: true };

  it('automation intent in Execute mode → an approval-gated waiting step with full declarations', () => {
    const plan = buildPlan('automation', 'execute', 'asst_1', { automation: auto }, NOW);
    expect(plan).not.toBeNull();
    expect(plan!.correlationId).toBe('asst_1');
    expect(plan!.state).toBe('waiting');
    const step = plan!.steps[0]!;
    expect(step.state).toBe('waiting');
    expect(step.needsApproval).toBe(true);
    expect(step.sideEffects).toBe(true);
    expect(step.risk).toBe('high');
    expect(step.executionKind).toBe('automation');
    expect(step.targetId).toBe('a1');
    // Spec 4.5: every tool call declares purpose / reason / expected output.
    expect(step.purpose.length).toBeGreaterThan(0);
    expect(step.reason.length).toBeGreaterThan(0);
    expect(step.expectedOutput.length).toBeGreaterThan(0);
    // Spec 4.8: rollback availability is stated honestly.
    expect(step.rollback).toMatch(/No automatic rollback/);
  });

  it('the same intent in Ask mode → the step is skipped with an explicit mode note (nothing hidden)', () => {
    const plan = buildPlan('automation', 'ask', 'asst_2', { automation: auto }, NOW);
    const step = plan!.steps[0]!;
    expect(step.state).toBe('skipped');
    expect(step.note).toMatch(/Execute mode/);
  });

  it('an inactive rule is never runnable — skipped with the reason', () => {
    const plan = buildPlan('automation', 'execute', 'asst_3', { automation: { ...auto, active: false } }, NOW);
    expect(plan!.steps[0]!.state).toBe('skipped');
    expect(plan!.steps[0]!.note).toMatch(/inactive/);
  });

  it('worker targets build an approval-gated worker step', () => {
    const plan = buildPlan('execution', 'execute', 'asst_4', { worker: { id: 'w1', name: 'Researcher', role: 'research' } }, NOW);
    const step = plan!.steps[0]!;
    expect(step.executionKind).toBe('worker');
    expect(step.needsApproval).toBe(true);
    expect(step.expectedOutput).toMatch(/Approval Center|approval/i);
  });

  it('navigation resolves to an already-completed low-risk step', () => {
    const plan = buildPlan('navigation', 'ask', 'asst_5', { navigate: { section: 'search', query: null } }, NOW);
    const step = plan!.steps[0]!;
    expect(step.state).toBe('completed');
    expect(step.needsApproval).toBe(false);
    expect(step.sideEffects).toBe(false);
  });

  it('search intent yields a hand-off step to Universal Search', () => {
    const plan = buildPlan('search', 'ask', 'asst_6', { searchQuery: 'overdue invoices' }, NOW);
    expect(plan!.steps[0]!.tool).toBe('search');
    expect(plan!.steps[0]!.input).toBe('overdue invoices');
  });

  it('returns null when the intent has no actionable steps', () => {
    expect(buildPlan('question', 'ask', 'asst_7', {}, NOW)).toBeNull();
    expect(buildPlan('automation', 'execute', 'asst_8', { automation: null }, NOW)).toBeNull();
  });

  it('planStateFrom aggregates step states with the right precedence', () => {
    const base = buildPlan('automation', 'execute', 'asst_9', { automation: auto }, NOW)!;
    const s = base.steps[0]!;
    expect(planStateFrom([{ ...s, state: 'running' }])).toBe('running');
    expect(planStateFrom([{ ...s, state: 'waiting' }])).toBe('waiting');
    expect(planStateFrom([{ ...s, state: 'failed' }])).toBe('failed');
    expect(planStateFrom([{ ...s, state: 'completed' }])).toBe('completed');
    expect(planStateFrom([{ ...s, state: 'rejected' }])).toBe('completed');
  });
});

describe('target name matching (conservative)', () => {
  it('matches when every significant token of the name appears in the request', () => {
    expect(nameMatches('launch the onboarding workflow', 'Onboarding')).toBe(true);
    expect(nameMatches('run customer onboarding now', 'Customer Onboarding')).toBe(true);
  });
  it('refuses partial matches — never guesses a target', () => {
    expect(nameMatches('launch the onboarding workflow', 'Customer Onboarding')).toBe(false);
    expect(nameMatches('run something', 'Onboarding')).toBe(false);
  });
});

describe('envelope + trace scaffolding (explainability is structural)', () => {
  it('baseEnvelope always carries the mandatory explainability surface', () => {
    const intent = classifyAssistantIntent('how many connectors?');
    const env = baseEnvelope('asst_x', 'ask', intent, NOW);
    expect(env.correlationId).toBe('asst_x');
    expect(Array.isArray(env.sources)).toBe(true);
    expect(Array.isArray(env.toolCalls)).toBe(true);
    expect(Array.isArray(env.unavailable)).toBe(true);
    expect(Array.isArray(env.assumptions)).toBe(true);
    expect(env.trace.correlationId).toBe('asst_x');
    expect(env.trace.audit.permissionClass).toBeTruthy();
  });

  it('emptyTrace threads the correlation id and starts honest (nothing claimed)', () => {
    const t = emptyTrace('asst_y', 'monitor', { intent: 'unclear', confidence: 0, matched: [] }, NOW);
    expect(t.correlationId).toBe('asst_y');
    expect(t.reasoning).toBeNull();
    expect(t.toolCalls).toEqual([]);
    expect(t.audit.executionIds).toEqual([]);
  });

  it('renderWorkspaceSnapshot reports unavailability explicitly', () => {
    const s = emptyWorkspaceSnapshot();
    s.unavailable.push({ system: 'connectors', reason: 'port down' });
    expect(renderWorkspaceSnapshot(s)).toMatch(/Unavailable — connectors: port down/);
  });

  it('conversationTitle trims and caps', () => {
    expect(conversationTitle('  hello   world  ')).toBe('hello world');
    expect(conversationTitle('x'.repeat(100)).length).toBeLessThanOrEqual(64);
    expect(conversationTitle('')).toBe('New conversation');
  });

  it('renderHistory compacts turns and handles empties', () => {
    expect(renderHistory([])).toBe('(no prior turns)');
    const out = renderHistory([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'answer' },
    ]);
    expect(out).toContain('User: first');
    expect(out).toContain('Assistant: answer');
  });
});
