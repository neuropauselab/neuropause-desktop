import { describe, expect, it } from 'vitest';
import { MODEL_PRICING, computeCostUsd } from './pricing';
import { UsageTracker } from './usageTracker';
import { PromptManager, interpolate, DEFAULT_PROMPTS } from './promptManager';
import { parseModelText } from './responseParser';
import { ModelRouter } from './modelRouter';
import { AiAuditLog } from './auditLog';
import { ClaudeModelClient } from './claudeClient';
import { MockModelClient } from './mockClient';
import { AiEngine } from './aiEngine';
import type { ModelClient, ModelResult } from './modelClient';

// --- Pricing / Cost Tracker -------------------------------------------------

describe('pricing', () => {
  it('computes cost from per-token rates (Haiku: $1/$5 per MTok)', () => {
    // 1,000,000 in + 1,000,000 out on Haiku → $1 + $5 = $6
    expect(computeCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBeCloseTo(6, 9);
  });
  it('prices Sonnet and Opus from the table', () => {
    expect(computeCostUsd('claude-sonnet-4-6', 1_000_000, 0)).toBeCloseTo(3, 9);
    expect(computeCostUsd('claude-opus-4-8', 0, 1_000_000)).toBeCloseTo(25, 9);
  });
  it('unknown models cost 0', () => {
    expect(computeCostUsd('gpt-some-future-model', 1000, 1000)).toBe(0);
  });
  it('keeps every priced model on the 1:5 input:output ratio', () => {
    for (const price of Object.values(MODEL_PRICING)) {
      expect(price.output).toBeCloseTo(price.input * 5, 12);
    }
  });
});

// --- Usage Tracker (tokens + cost, by worker/model) -------------------------

describe('UsageTracker', () => {
  it('accumulates totals and breaks down by worker and model', () => {
    const t = new UsageTracker();
    t.add({ worker: 'engineering', model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50, costUsd: 0.001 });
    t.add({ worker: 'engineering', model: 'claude-sonnet-4-6', inputTokens: 200, outputTokens: 60, costUsd: 0.002 });
    t.add({ worker: 'founder', model: 'claude-haiku-4-5-20251001', inputTokens: 10, outputTokens: 5, costUsd: 0.0001 });
    const s = t.summary();
    expect(s.calls).toBe(3);
    expect(s.inputTokens).toBe(310);
    expect(s.outputTokens).toBe(115);
    expect(s.byWorker.engineering?.calls).toBe(2);
    expect(s.byWorker.founder?.calls).toBe(1);
    expect(s.byModel['claude-sonnet-4-6']?.calls).toBe(2);
    expect(s.costUsd).toBeCloseTo(0.0031, 9);
  });
});

// --- Prompt Manager (versioned, variables, history) -------------------------

describe('PromptManager', () => {
  it('interpolates {{variables}} and leaves unknowns empty', () => {
    expect(interpolate('Hi {{name}}, {{missing}}!', { name: 'Sam' })).toBe('Hi Sam, !');
  });
  it('renders the latest version with context interpolated', () => {
    const pm = new PromptManager();
    const r = pm.render('engineering.summary', { context: 'CI red', subject: 'repo-x' });
    expect(r.id).toBe('engineering.summary');
    expect(r.version).toBe(1);
    expect(r.user).toContain('CI red');
    expect(r.user).toContain('repo-x');
  });
  it('retains version history and resolves a specific version', () => {
    const pm = new PromptManager();
    pm.register({ id: 'generic.summary', version: 2, label: 'Summary v2', system: 'sys2', user: 'u2 {{context}}', variables: ['context'] });
    expect(pm.get('generic.summary').version).toBe(2); // latest
    expect(pm.getVersion('generic.summary', 1).version).toBe(1); // pinned old
    expect(pm.history('generic.summary').map((p) => p.version)).toEqual([1, 2]);
  });
  it('throws on unknown prompt or version', () => {
    const pm = new PromptManager();
    expect(() => pm.get('does.not.exist')).toThrow();
    expect(() => pm.getVersion('generic.summary', 99)).toThrow();
  });
  it('ships grounding instructions in every seed prompt', () => {
    for (const p of DEFAULT_PROMPTS) {
      expect(p.system).toContain('Never invent facts');
    }
  });
});

// --- Response Parser --------------------------------------------------------

describe('parseModelText', () => {
  it('parses a bare JSON object and extracts confidence + evidence', () => {
    const r = parseModelText('{"summary":"ok","confidence":0.8,"evidence":[{"kind":"activity","id":"run-1"}]}');
    expect(r.data?.summary).toBe('ok');
    expect(r.confidence).toBe(0.8);
    expect(r.evidence).toEqual([{ kind: 'activity', id: 'run-1' }]);
  });
  it('parses JSON inside ```json fences', () => {
    const r = parseModelText('Here you go:\n```json\n{"summary":"fenced","confidence":0.3}\n```\nthanks');
    expect(r.data?.summary).toBe('fenced');
    expect(r.confidence).toBe(0.3);
  });
  it('parses a JSON object wrapped in prose', () => {
    const r = parseModelText('The result is {"answer":"yes","confidence":1} as shown.');
    expect(r.data?.answer).toBe('yes');
    expect(r.confidence).toBe(1);
  });
  it('returns null data for non-JSON prose and a default confidence', () => {
    const r = parseModelText('This is just a sentence.');
    expect(r.data).toBeNull();
    expect(r.confidence).toBe(0.5);
    expect(r.evidence).toEqual([]);
  });
  it('ignores out-of-range confidence values', () => {
    const r = parseModelText('{"confidence": 7}');
    expect(r.confidence).toBe(0.5);
  });
});

// --- Model Router -----------------------------------------------------------

describe('ModelRouter', () => {
  it('maps tiers to the right Claude models', () => {
    const router = new ModelRouter({ client: new MockModelClient() });
    expect(router.resolve('fast').model).toBe('claude-haiku-4-5-20251001');
    expect(router.resolve('balanced').model).toBe('claude-sonnet-4-6');
    expect(router.resolve('deep').model).toBe('claude-opus-4-8');
  });
  it('defaults to balanced when no tier is given', () => {
    const router = new ModelRouter({ client: new MockModelClient() });
    expect(router.resolve().model).toBe('claude-sonnet-4-6');
  });
  it('reflects the client configured-state', () => {
    expect(new ModelRouter({ client: new MockModelClient() }).isConfigured()).toBe(true);
    expect(new ModelRouter({ client: new ClaudeModelClient({ apiKey: '' }) }).isConfigured()).toBe(false);
  });
});

// --- Claude client (stubbed fetch, no network) ------------------------------

describe('ClaudeModelClient', () => {
  it('throws when not configured', async () => {
    const c = new ClaudeModelClient({ apiKey: '' });
    expect(c.isConfigured()).toBe(false);
    await expect(c.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 })).rejects.toThrow();
  });

  it('builds the correct Anthropic request and parses the response', async () => {
    let captured: { url: unknown; init: { headers?: Record<string, string>; body?: string } } | null = null;
    const fetchImpl = (async (url: unknown, init: unknown) => {
      captured = { url, init: init as { headers?: Record<string, string>; body?: string } };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'msg_123',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: '{"summary":"hi","confidence":0.7}' }],
          usage: { input_tokens: 42, output_tokens: 8 },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const c = new ClaudeModelClient({ apiKey: 'sk-test', fetchImpl });
    const res = await c.complete({ model: 'claude-sonnet-4-6', system: 'sys', messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 64 });

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(captured!.init.headers?.['x-api-key']).toBe('sk-test');
    expect(captured!.init.headers?.['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(captured!.init.body ?? '{}');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(64);
    expect(body.system).toBe('sys');
    expect(body.messages[0].content).toBe('hello');

    expect(res.id).toBe('msg_123');
    expect(res.text).toBe('{"summary":"hi","confidence":0.7}');
    expect(res.inputTokens).toBe(42);
    expect(res.outputTokens).toBe(8);
  });

  it('raises the provider error message (never the key) on failure', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 400, json: async () => ({ error: { type: 'invalid_request_error', message: 'bad model' } }) }) as unknown as Response) as unknown as typeof fetch;
    const c = new ClaudeModelClient({ apiKey: 'sk-secret', fetchImpl });
    await expect(c.complete({ model: 'x', messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 10 })).rejects.toThrow('bad model');
  });
});

// --- Audit Log --------------------------------------------------------------

describe('AiAuditLog', () => {
  it('records, counts, and returns recent newest-first', () => {
    const log = new AiAuditLog();
    for (let i = 0; i < 3; i++) {
      log.record({
        id: `a${i}`, timestamp: 't', worker: 'engineering', promptId: 'p', promptVersion: 1,
        model: 'm', contextSources: [], inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0,
        responseId: 'r', confidence: 0, outcome: 'ok',
      });
    }
    expect(log.count()).toBe(3);
    expect(log.recent(2).map((r) => r.id)).toEqual(['a2', 'a1']);
  });
  it('caps the ring at the configured size', () => {
    const log = new AiAuditLog(2);
    for (let i = 0; i < 5; i++) {
      log.record({
        id: `a${i}`, timestamp: 't', worker: 'support', promptId: 'p', promptVersion: 1,
        model: 'm', contextSources: [], inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0,
        responseId: 'r', confidence: 0, outcome: 'ok',
      });
    }
    expect(log.count()).toBe(2);
    expect(log.all().map((r) => r.id)).toEqual(['a3', 'a4']);
  });
});

// --- AI Engine (end-to-end with mock; fallback + error paths) ---------------

describe('AiEngine', () => {
  it('runs a grounded call: parses output, tracks usage, audits, merges evidence', async () => {
    const client = new MockModelClient({
      reply: () => '{"summary":"all good","confidence":0.9,"evidence":[{"kind":"activity","id":"run-1"}]}',
      inputTokens: 120,
      outputTokens: 20,
    });
    const engine = new AiEngine({
      router: new ModelRouter({ client }),
      now: () => '2026-06-30T00:00:00.000Z',
      id: () => 'AID',
    });

    const res = await engine.run({
      worker: 'diagnostic',
      promptId: 'generic.summary',
      tier: 'fast',
      context: [{ source: 'mission-brief', text: 'CI red', evidence: [{ kind: 'activity', id: 'run-2' }] }],
    });

    expect(res.grounded).toBe(true);
    expect(res.model).toBe('claude-haiku-4-5-20251001');
    expect(res.responseId).toBe('mock-response');
    expect(res.data?.summary).toBe('all good');
    expect(res.confidence).toBe(0.9);
    // evidence from context (run-2) + parsed output (run-1), deduped
    expect(res.evidence).toEqual([{ kind: 'activity', id: 'run-2' }, { kind: 'activity', id: 'run-1' }]);
    expect(res.contextSources).toEqual(['mission-brief']);
    // cost = 120 in + 20 out on Haiku
    expect(res.usage.costUsd).toBeCloseTo(120 / 1e6 + (20 * 5) / 1e6, 9);

    const summary = engine.usageSummary();
    expect(summary.calls).toBe(1);
    expect(summary.byWorker.diagnostic?.calls).toBe(1);

    const audit = engine.audit.recent(1)[0];
    expect(audit?.outcome).toBe('ok');
    expect(audit?.worker).toBe('diagnostic');
    expect(audit?.model).toBe('claude-haiku-4-5-20251001');
    expect(audit?.contextSources).toEqual(['mission-brief']);
    expect(audit?.timestamp).toBe('2026-06-30T00:00:00.000Z');
    expect(audit?.responseId).toBe('mock-response');
  });

  it('falls back deterministically when no model is configured', async () => {
    const engine = new AiEngine({
      router: new ModelRouter({ client: new ClaudeModelClient({ apiKey: '' }) }),
      id: () => 'FB',
    });
    const res = await engine.run({ worker: 'engineering', promptId: 'engineering.summary', variables: { subject: 'x' } });
    expect(res.grounded).toBe(false);
    expect(res.model).toBe('none');
    expect(res.text).toBe('');
    expect(res.usage.costUsd).toBe(0);
    expect(engine.audit.recent(1)[0]?.outcome).toBe('fallback');
    expect(engine.isConfigured()).toBe(false);
  });

  it('records an error outcome and falls back when the model call throws', async () => {
    class ThrowingClient implements ModelClient {
      readonly provider = 'throwing';
      isConfigured(): boolean {
        return true;
      }
      async complete(): Promise<ModelResult> {
        throw new Error('boom');
      }
    }
    const engine = new AiEngine({ router: new ModelRouter({ client: new ThrowingClient() }), id: () => 'E' });
    const res = await engine.run({ worker: 'founder', promptId: 'founder.answer', variables: { question: 'why?' } });
    expect(res.grounded).toBe(false);
    const audit = engine.audit.recent(1)[0];
    expect(audit?.outcome).toBe('error');
    expect(audit?.error).toBe('boom');
  });
});
