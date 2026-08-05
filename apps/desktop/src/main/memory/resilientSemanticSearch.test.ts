import { describe, expect, it, vi } from 'vitest';
import type { SemanticOutcome } from '@neuropause/shared';
import type { RetrievalHit } from './memoryHybridSearch';
import type { SemanticSearchFn } from './memorySemanticRecall';
import { createResilientSemanticSearch } from './resilientSemanticSearch';
import { RetrievalHealthTracker } from './retrievalHealth';
import { SemanticUnavailableError } from './semanticFailure';

const QUERY = { text: 'quarterly plan', orgId: 'org-1', topK: 20 };

function hits(n: number): RetrievalHit[] {
  return Array.from({ length: n }, (_, i) => ({ memoryId: `m-${i}`, score: 1 - i / 100 }));
}

/** A clock the test advances, so latency assertions never touch the wall clock. */
function clock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

describe('createResilientSemanticSearch — pass-through', () => {
  it('returns the wrapped source’s hits unchanged', async () => {
    const { search } = createResilientSemanticSearch(async () => hits(3));
    await expect(search(QUERY)).resolves.toEqual(hits(3));
  });

  it('passes the query through verbatim', async () => {
    const inner = vi.fn<Parameters<SemanticSearchFn>, Promise<RetrievalHit[]>>(async () => []);
    const { search } = createResilientSemanticSearch(inner);
    await search(QUERY);
    expect(inner.mock.calls[0]?.[0]).toEqual(QUERY);
  });

  it('reports a successful outcome with the hit count and measured latency', async () => {
    const c = clock();
    const seen: SemanticOutcome[] = [];
    const { search } = createResilientSemanticSearch(
      async () => {
        c.advance(37);
        return hits(2);
      },
      { now: c.now },
    );
    await search(QUERY, { onOutcome: (o) => seen.push(o) });
    expect(seen).toEqual([{ state: 'ok', hits: 2, latencyMs: 37 }]);
  });
});

describe('createResilientSemanticSearch — deadline', () => {
  it('rejects when the source outlives the deadline instead of hanging', async () => {
    const { search } = createResilientSemanticSearch(() => new Promise<RetrievalHit[]>(() => {}), {
      timeoutMs: 5,
    });
    await expect(search(QUERY)).rejects.toBeInstanceOf(SemanticUnavailableError);
  });

  it('classifies a blown deadline as a retryable timeout', async () => {
    const seen: SemanticOutcome[] = [];
    const { search } = createResilientSemanticSearch(() => new Promise<RetrievalHit[]>(() => {}), {
      timeoutMs: 5,
    });
    await search(QUERY, { onOutcome: (o) => seen.push(o) }).catch(() => undefined);
    expect(seen[0]).toMatchObject({ state: 'failed', kind: 'timeout', retryable: true });
  });

  it('aborts the signal it handed the source, so the request is cancelled not orphaned', async () => {
    let captured: AbortSignal | undefined;
    const { search } = createResilientSemanticSearch(
      (_q, opts) =>
        new Promise<RetrievalHit[]>(() => {
          captured = opts?.signal;
        }),
      { timeoutMs: 5 },
    );
    await search(QUERY).catch(() => undefined);
    expect(captured?.aborted).toBe(true);
  });

  it('clears its timer on success — a resolved call leaves no pending handle', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { search } = createResilientSemanticSearch(async () => hits(1), { timeoutMs: 50_000 });
    await search(QUERY);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('forwards a caller’s abort to the source, well inside the deadline', async () => {
    const controller = new AbortController();
    let captured: AbortSignal | undefined;
    const { search } = createResilientSemanticSearch(
      (_q, opts) =>
        new Promise<RetrievalHit[]>((resolve) => {
          captured = opts?.signal;
          opts?.signal?.addEventListener('abort', () => resolve([]));
        }),
      { timeoutMs: 50_000 },
    );

    const pending = search(QUERY, { signal: controller.signal });
    await Promise.resolve();
    expect(captured?.aborted).toBe(false);

    controller.abort();
    await expect(pending).resolves.toEqual([]);
    expect(captured?.aborted).toBe(true);
  });

  it('detaches its caller-signal listener, so a long-lived signal does not accumulate them', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const { search } = createResilientSemanticSearch(async () => hits(1), { timeoutMs: 50_000 });
    await search(QUERY, { signal: controller.signal });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe('createResilientSemanticSearch — failure classification', () => {
  it('wraps a backend error in SemanticUnavailableError carrying the verdict', async () => {
    const { search } = createResilientSemanticSearch(async () => {
      throw Object.assign(new Error('Qdrant unreachable'), { status: 503, code: 'search_failed' });
    });
    await expect(search(QUERY)).rejects.toMatchObject({
      name: 'SemanticUnavailableError',
      outcome: { state: 'failed', kind: 'dependency_down', retryable: true, code: 'search_failed' },
    });
  });

  it('rethrows rather than returning [] — no hits and a dead backend must stay distinguishable', async () => {
    const { search } = createResilientSemanticSearch(async () => {
      throw Object.assign(new Error('nope'), { status: 500, code: 'internal_error' });
    });
    await expect(search(QUERY)).rejects.toBeInstanceOf(SemanticUnavailableError);

    const { search: empty } = createResilientSemanticSearch(async () => []);
    await expect(empty(QUERY)).resolves.toEqual([]);
  });
});

describe('createResilientSemanticSearch — breaker', () => {
  it('stops calling the source once the circuit opens', async () => {
    const inner = vi.fn<Parameters<SemanticSearchFn>, Promise<RetrievalHit[]>>(async () => {
      throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
    });
    const { search } = createResilientSemanticSearch(inner, { failureThreshold: 2 });

    await search(QUERY).catch(() => undefined);
    await search(QUERY).catch(() => undefined);
    expect(inner).toHaveBeenCalledTimes(2);

    await search(QUERY).catch(() => undefined);
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('reports the short-circuited call as skipped: circuit_open, not as a failure', async () => {
    const seen: SemanticOutcome[] = [];
    const { search } = createResilientSemanticSearch(
      async () => {
        throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
      },
      { failureThreshold: 1 },
    );
    await search(QUERY).catch(() => undefined);
    await search(QUERY, { onOutcome: (o) => seen.push(o) }).catch(() => undefined);
    expect(seen).toEqual([{ state: 'skipped', reason: 'circuit_open' }]);
  });

  it('short-circuits immediately — an open circuit costs no deadline', async () => {
    const c = clock();
    const { search } = createResilientSemanticSearch(
      async () => {
        c.advance(4_000);
        throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
      },
      { failureThreshold: 1, now: c.now },
    );
    await search(QUERY).catch(() => undefined);
    const before = c.now();
    await search(QUERY).catch(() => undefined);
    expect(c.now()).toBe(before);
  });

  it('recovers after the cooldown and serves again', async () => {
    const c = clock();
    let healthy = false;
    const { search, health } = createResilientSemanticSearch(
      async () => {
        if (!healthy) throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
        return hits(1);
      },
      { failureThreshold: 1, resetTimeoutMs: 30_000, now: c.now },
    );

    await search(QUERY).catch(() => undefined);
    expect(health().breaker).toBe('open');

    c.advance(30_000);
    healthy = true;
    await expect(search(QUERY)).resolves.toEqual(hits(1));
    expect(health().breaker).toBe('closed');
  });
});

describe('createResilientSemanticSearch — subsystem outcome sink (A6)', () => {
  const fail = async (): Promise<RetrievalHit[]> => {
    throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
  };

  it('sees every outcome, including the ones no caller asked to observe', async () => {
    // This is the composition root's only window onto retrieval now that the
    // store absorbs failures: `memory/index.ts` supplies no per-call observer,
    // so a sink that only fired when a caller passed `onOutcome` would log
    // nothing in production.
    const seen: SemanticOutcome[] = [];
    const { search } = createResilientSemanticSearch(fail, {
      failureThreshold: 1,
      onOutcome: (o) => seen.push(o),
    });
    await search(QUERY).catch(() => undefined);
    await search(QUERY).catch(() => undefined);
    expect(seen.map((o) => o.state)).toEqual(['failed', 'skipped']);
    expect(seen[0]).toMatchObject({ kind: 'dependency_down', code: 'search_failed' });
  });

  it('sees successes too, so the sink can decide what is worth logging', async () => {
    const seen: SemanticOutcome[] = [];
    const { search } = createResilientSemanticSearch(async () => hits(2), {
      onOutcome: (o) => seen.push(o),
    });
    await search(QUERY);
    expect(seen).toEqual([{ state: 'ok', hits: 2, latencyMs: expect.any(Number) }]);
  });

  it('does not displace a caller’s observer — both are notified, tracker first', async () => {
    const order: string[] = [];
    const { search, health } = createResilientSemanticSearch(async () => hits(1), {
      onOutcome: () => order.push('subsystem'),
    });
    await search(QUERY, { onOutcome: () => order.push('caller') });
    expect(order).toEqual(['subsystem', 'caller']);
    expect(health().totals.successes).toBe(1);
  });

  it('a throwing sink cannot fail a retrieval that succeeded', async () => {
    // The success-path report runs inside the try that classifies failures, so an
    // unisolated sink would turn a logging bug into a lost result set.
    const { search, health } = createResilientSemanticSearch(async () => hits(3), {
      onOutcome: () => {
        throw new Error('log transport down');
      },
    });
    await expect(search(QUERY)).resolves.toEqual(hits(3));
    expect(health()).toMatchObject({
      breaker: 'closed',
      totals: { attempts: 1, successes: 1, failures: 0, skipped: 0 },
    });
  });

  it('a throwing sink does not mask the real failure on the error path either', async () => {
    const { search } = createResilientSemanticSearch(fail, {
      onOutcome: () => {
        throw new Error('log transport down');
      },
    });
    await expect(search(QUERY)).rejects.toMatchObject({
      name: 'SemanticUnavailableError',
      outcome: { state: 'failed', code: 'search_failed' },
    });
  });
});

describe('createResilientSemanticSearch — health', () => {
  it('projects the tracker snapshot', async () => {
    const { search, health } = createResilientSemanticSearch(async () => hits(4));
    expect(health().totals).toEqual({ attempts: 0, successes: 0, failures: 0, skipped: 0 });
    await search(QUERY);
    expect(health()).toMatchObject({
      breaker: 'closed',
      totals: { attempts: 1, successes: 1, failures: 0, skipped: 0 },
      lastOutcome: { state: 'ok', hits: 4 },
    });
  });

  it('shares an injected tracker, so several sources trip one breaker', async () => {
    const c = clock();
    const tracker = new RetrievalHealthTracker({ failureThreshold: 2, now: c.now });
    const fail = async (): Promise<RetrievalHit[]> => {
      throw Object.assign(new Error('down'), { status: 503, code: 'search_failed' });
    };
    const a = createResilientSemanticSearch(fail, { tracker });
    const b = createResilientSemanticSearch(fail, { tracker });

    await a.search(QUERY).catch(() => undefined);
    await b.search(QUERY).catch(() => undefined);

    expect(tracker.state()).toBe('open');
    expect(a.health().breaker).toBe('open');
    expect(b.health().breaker).toBe('open');
  });
});
