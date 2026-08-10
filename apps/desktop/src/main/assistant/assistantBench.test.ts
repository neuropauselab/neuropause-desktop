/**
 * Stage 4 benchmark evidence — real measured timings for the assistant's
 * deterministic layers, printed so the verification run captures them.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan, classifyAssistantIntent, resetPlanStepIds } from './assistantModel';
import { ConversationStore } from './conversationStore';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_TENANT_SCOPE } from '../tenancy/testScope';

const NOW = '2026-07-31T09:00:00.000Z';

const PHRASES = [
  "summarize today's work",
  'find every invoice overdue by 30 days',
  'explain why sales dropped',
  'launch the onboarding workflow',
  'draft a customer response',
  'show connector problems',
  "prepare tomorrow's meeting",
  'open mission control',
  'run the research worker',
  'show pending approvals',
];

describe('assistant benchmarks (deterministic layers)', () => {
  it('classifies 2,000 requests quickly', () => {
    const started = Date.now();
    let matched = 0;
    for (let i = 0; i < 2000; i += 1) {
      const r = classifyAssistantIntent(`${PHRASES[i % PHRASES.length]} ${i}`);
      if (r.intent !== 'unclear') matched += 1;
    }
    const ms = Date.now() - started;
    console.log(`assistant.classify  ${ms} ms / 2000 requests (${(ms / 2000).toFixed(3)} ms each, ${matched} matched)`);
    expect(matched).toBeGreaterThan(1500);
    expect(ms).toBeLessThan(1500);
  });

  it('builds 2,000 plans quickly', () => {
    resetPlanStepIds();
    const auto = { id: 'a1', name: 'Onboarding', actionCount: 2, active: true };
    const started = Date.now();
    let steps = 0;
    for (let i = 0; i < 2000; i += 1) {
      const plan = buildPlan('automation', 'execute', `asst_${i}`, { automation: auto }, NOW);
      steps += plan ? plan.steps.length : 0;
    }
    const ms = Date.now() - started;
    console.log(`assistant.plan      ${ms} ms / 2000 plans (${steps} steps)`);
    expect(steps).toBe(2000);
    expect(ms).toBeLessThan(1000);
  });

  it('persists and reloads 60 conversations quickly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-assistant-bench-'));
    const store = new ConversationStore(join(dir, 'c.json')).bindScope(() => TEST_TENANT_SCOPE);
    const started = Date.now();
    for (let i = 0; i < 60; i += 1) {
      await store.upsert({
        id: `c${i}`,
        workspaceId: null,
        title: `Bench ${i}`,
        pinned: false,
        createdAt: NOW,
        updatedAt: NOW,
        parent: null,
        messages: Array.from({ length: 10 }, (_, m) => ({
          id: `c${i}m${m}`,
          role: m % 2 === 0 ? ('user' as const) : ('assistant' as const),
          at: NOW,
          text: `message ${m} of conversation ${i} with a reasonably realistic length of text`,
          envelope: null,
          redactions: [],
        })),
      });
    }
    const writeMs = Date.now() - started;
    const t2 = Date.now();
    const reloaded = new ConversationStore(join(dir, 'c.json')).bindScope(() => TEST_TENANT_SCOPE).loadAllSync();
    const loadMs = Date.now() - t2;
    console.log(`assistant.store     ${writeMs} ms / 60 conversations written · ${loadMs} ms reload (${reloaded.length} loaded)`);
    expect(reloaded).toHaveLength(60);
    expect(writeMs).toBeLessThan(5000);
    expect(loadMs).toBeLessThan(500);
  });
});
