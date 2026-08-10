/**
 * Phase 6 Stage 5 — conversation summaries now carry `waitingSteps` (plan steps
 * still parked for a human decision), the signal behind the
 * followup_conversation recommendation rule.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssistantConversation, AssistantEnvelope, AssistantPlanStep } from '@neuropause/shared';
import { ConversationStore } from './conversationStore';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const NOW = '2026-07-31T09:00:00.000Z';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-conv5-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function step(state: AssistantPlanStep['state']): AssistantPlanStep {
  return {
    id: `st-${state}-${Math.random().toString(36).slice(2, 6)}`,
    tool: 'worker',
    label: 'Run worker',
    purpose: 'p',
    reason: 'r',
    expectedOutput: 'o',
    needsApproval: true,
    sideEffects: true,
    risk: 'high',
    rollback: 'none',
    state,
    executionKind: 'worker',
    targetId: 'w1',
    input: null,
    executionId: null,
    resultSummary: null,
    verification: null,
    error: null,
    note: null,
    decidedBy: null,
    decidedAt: null,
  };
}

function envelopeWith(steps: AssistantPlanStep[]): AssistantEnvelope {
  return {
    correlationId: 'asst_x',
    mode: 'execute',
    intent: { intent: 'execution', confidence: 0.6, matched: [] },
    clarification: null,
    text: null,
    findings: [],
    recommendations: [],
    draft: null,
    navigation: null,
    structured: null,
    plan: {
      id: 'plan_x',
      correlationId: 'asst_x',
      intent: 'execution',
      mode: 'execute',
      state: 'waiting',
      steps,
      createdAt: NOW,
      updatedAt: NOW,
    },
    sources: [],
    toolCalls: [],
    confidence: 0,
    grounded: false,
    aiOffline: true,
    unavailable: [],
    assumptions: [],
    reasoningSummary: null,
    trace: {
      correlationId: 'asst_x',
      mode: 'execute',
      intent: { intent: 'execution', confidence: 0.6, matched: [] },
      phases: [],
      workspace: {
        workspace: null,
        workspaceCount: null,
        activeExecutions: null,
        pendingApprovals: null,
        connectors: null,
        automations: null,
        recentTimeline: [],
        memoryTotal: null,
        uiContext: null,
        unavailable: [],
      },
      retrieved: [],
      recalledMemories: 0,
      reasoning: null,
      toolCalls: [],
      audit: { permissionClass: 'local', aiResponseId: null, executionIds: [], timelineEventTypes: [] },
      generatedAt: NOW,
    },
    memoryCapture: null,
    generatedAt: NOW,
  };
}

function conv(id: string, steps: AssistantPlanStep[][]): AssistantConversation {
  return {
    id,
    workspaceId: null,
    title: `Conv ${id}`,
    pinned: false,
    createdAt: NOW,
    updatedAt: NOW,
    parent: null,
    messages: steps.map((s, i) => ({
      id: `m${i}`,
      role: 'assistant',
      at: NOW,
      text: 'x',
      envelope: envelopeWith(s),
      redactions: [],
    })),
  };
}

describe('waitingSteps on summaries', () => {
  it('counts waiting steps across every message', async () => {
    const store = new ConversationStore(join(dir, 'c.json')).bindScope(() => TEST_TENANT_SCOPE);
    await store.upsert(conv('c1', [[step('waiting'), step('completed')], [step('waiting')]]));
    await store.upsert(conv('c2', [[step('completed'), step('rejected')]]));
    const summaries = store.list();
    expect(summaries.find((s) => s.id === 'c1')?.waitingSteps).toBe(2);
    expect(summaries.find((s) => s.id === 'c2')?.waitingSteps).toBe(0);
  });

  it('survives the persistence round-trip', async () => {
    const file = join(dir, 'c.json');
    const a = new ConversationStore(file).bindScope(() => TEST_TENANT_SCOPE);
    await a.upsert(conv('c1', [[step('waiting')]]));
    const b = new ConversationStore(file).bindScope(() => TEST_TENANT_SCOPE);
    expect(b.list().find((s) => s.id === 'c1')?.waitingSteps).toBe(1);
  });
});
