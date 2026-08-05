import { describe, expect, it } from 'vitest';
import type { RetrievalHealthSnapshot } from '@neuropause/shared';
import { aiMemoryProbe, knowledgeGraphProbe, ollamaProbe, retrievalProbe } from './aiHealthProbes';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('ollamaProbe', () => {
  it('reports ok with the model count and latency when reachable', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => jsonResponse(200, { models: [{}, {}, {}] }),
    });
    const check = await probe();
    expect(check).toMatchObject({ id: 'ai.ollama', status: 'ok' });
    expect(check.detail).toContain('3 model(s)');
    expect(check.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports degraded on a non-2xx response', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => jsonResponse(500, {}),
    });
    const check = await probe();
    expect(check.status).toBe('degraded');
    expect(check.detail).toContain('HTTP 500');
  });

  it('reports down with the ollama serve hint when unreachable', async () => {
    const probe = ollamaProbe({
      baseUrl: 'http://127.0.0.1:11434',
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const check = await probe();
    expect(check.status).toBe('down');
    expect(check.recommendation).toContain('ollama serve');
  });
});

describe('store probes', () => {
  it('aiMemoryProbe reports the indexed total', async () => {
    const check = await aiMemoryProbe(() => 12)();
    expect(check).toMatchObject({ id: 'ai.memory', status: 'ok' });
    expect(check.detail).toContain('12');
  });

  it('knowledgeGraphProbe reports node and edge counts', async () => {
    const check = await knowledgeGraphProbe(() => ({ nodes: 30, edges: 12 }))();
    expect(check).toMatchObject({ id: 'ai.graph', status: 'ok' });
    expect(check.detail).toContain('30 node(s)');
    expect(check.detail).toContain('12 edge(s)');
  });

  it('a throwing getter turns into a down check, never a crash', async () => {
    const check = await aiMemoryProbe(() => {
      throw new Error('store offline');
    })();
    expect(check.status).toBe('down');
    expect(check.detail).toBe('store offline');
  });
});

describe('retrievalProbe (A6)', () => {
  const HEALTHY: RetrievalHealthSnapshot = {
    breaker: 'closed',
    consecutiveFailures: 0,
    retryAt: null,
    lastOutcome: null,
    lastOutcomeAt: null,
    totals: { attempts: 0, successes: 0, failures: 0, skipped: 0 },
    avgSuccessLatencyMs: null,
  };
  const snapshot = (over: Partial<RetrievalHealthSnapshot> = {}): RetrievalHealthSnapshot => ({
    ...HEALTHY,
    ...over,
  });
  const run = (over: Partial<RetrievalHealthSnapshot> = {}) => retrievalProbe(() => snapshot(over))();

  it('reports ok with the served ratio and mean latency once the leg has answered', async () => {
    const check = await run({
      lastOutcome: { state: 'ok', hits: 4, latencyMs: 120 },
      totals: { attempts: 10, successes: 9, failures: 1, skipped: 0 },
      avgSuccessLatencyMs: 118,
    });
    expect(check).toMatchObject({ id: 'ai.retrieval', status: 'ok', latencyMs: 118 });
    expect(check.detail).toContain('9/10 call(s) succeeded');
    expect(check.detail).toContain('avg 118 ms');
  });

  it('reports unknown — never ok — before the leg has ever run', async () => {
    // The distinction A6 exists to preserve: "no evidence of health" must not be
    // presented as "healthy", or a build with a dead semantic source looks green.
    const check = await run();
    expect(check.status).toBe('unknown');
    expect(check.detail).toContain('No semantic retrieval attempted yet');
  });

  it('explains an unconfigured build as by-design rather than as a fault', async () => {
    const check = await run({
      lastOutcome: { state: 'skipped', reason: 'not_configured' },
      totals: { attempts: 1, successes: 0, failures: 0, skipped: 1 },
    });
    expect(check.status).toBe('unknown');
    expect(check.detail).toContain('not_configured');
    expect(check.recommendation).toContain('keyword-only by design');
  });

  it('leaves a skip for a different reason without a recommendation to act on', async () => {
    const check = await run({
      lastOutcome: { state: 'skipped', reason: 'no_org' },
      totals: { attempts: 1, successes: 0, failures: 0, skipped: 1 },
    });
    expect(check.status).toBe('unknown');
    expect(check.detail).toContain('no_org');
    expect(check.recommendation).toBeNull();
  });

  it('reports degraded with the retry time while the breaker is open', async () => {
    const check = await run({
      breaker: 'open',
      consecutiveFailures: 3,
      retryAt: '2026-07-08T10:00:30.000Z',
      lastOutcome: {
        state: 'failed',
        kind: 'dependency_down',
        retryable: true,
        code: 'http_503',
        detail: 'Service Unavailable',
        latencyMs: 900,
      },
      totals: { attempts: 8, successes: 5, failures: 3, skipped: 0 },
      avgSuccessLatencyMs: 140,
    });
    expect(check.status).toBe('degraded');
    expect(check.detail).toContain('3 consecutive failure(s)');
    expect(check.recommendation).toContain('2026-07-08T10:00:30.000Z');
    expect(check.recommendation).toContain('keyword-only');
  });

  it('tells a half-open breaker apart: the next search trials the source', async () => {
    const check = await run({
      breaker: 'half_open',
      consecutiveFailures: 3,
      retryAt: null,
      totals: { attempts: 8, successes: 5, failures: 3, skipped: 0 },
    });
    expect(check.status).toBe('degraded');
    expect(check.recommendation).toContain('next search will trial');
  });

  it('reports a single failure as degraded and calls a retryable one transient', async () => {
    const check = await run({
      consecutiveFailures: 1,
      lastOutcome: {
        state: 'failed',
        kind: 'timeout',
        retryable: true,
        code: 'timeout',
        detail: 'deadline elapsed',
        latencyMs: 4_000,
      },
      totals: { attempts: 4, successes: 3, failures: 1, skipped: 0 },
      avgSuccessLatencyMs: 130,
    });
    expect(check.status).toBe('degraded');
    expect(check.detail).toContain('timeout');
    expect(check.detail).toContain('deadline elapsed');
    expect(check.latencyMs).toBe(4_000);
    expect(check.recommendation).toContain('Transient');
  });

  it('says outright that a non-retryable failure will not fix itself', async () => {
    const check = await run({
      lastOutcome: {
        state: 'failed',
        kind: 'auth',
        retryable: false,
        code: 'not_authenticated',
        detail: 'Sign in to use semantic search.',
        latencyMs: 12,
      },
      totals: { attempts: 2, successes: 1, failures: 1, skipped: 0 },
    });
    expect(check.status).toBe('degraded');
    expect(check.recommendation).toContain('not fix itself');
  });

  it('prefers the live failure over past successes — a healthy history is not current health', async () => {
    const check = await run({
      lastOutcome: {
        state: 'failed',
        kind: 'network',
        retryable: true,
        code: 'unknown_error',
        detail: 'socket hang up',
        latencyMs: 30,
      },
      totals: { attempts: 100, successes: 99, failures: 1, skipped: 0 },
      avgSuccessLatencyMs: 90,
    });
    expect(check.status).toBe('degraded');
  });

  it('never reports down for a retrieval outcome, only for an unreadable tracker', async () => {
    // `down` is the aggregator's worst rank (`RANK.down = 3`) and would drag the
    // whole report down for a condition where memory search still fully answers
    // from the lexical retriever.
    const outcomes = await Promise.all([
      run({ breaker: 'open', consecutiveFailures: 5 }),
      run({
        lastOutcome: {
          state: 'failed',
          kind: 'dependency_down',
          retryable: true,
          code: 'http_500',
          detail: 'boom',
          latencyMs: 5,
        },
      }),
    ]);
    expect(outcomes.map((c) => c.status)).toEqual(['degraded', 'degraded']);

    const broken = await retrievalProbe(() => {
      throw new Error('tracker gone');
    })();
    expect(broken).toMatchObject({ id: 'ai.retrieval', status: 'down', detail: 'tracker gone' });
  });
});
