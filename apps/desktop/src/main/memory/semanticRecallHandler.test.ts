import { describe, expect, it, vi } from 'vitest';
import { handleSemanticRecall, type SemanticRecallHandlerDeps } from './semanticRecallHandler';
import { SemanticUnavailableError } from './semanticFailure';
import type { MemoryRecallResult } from '@neuropause/shared';

const LEXICAL: MemoryRecallResult = { hits: [], total: 0, retriever: 'lexical' };
const SEMANTIC: MemoryRecallResult = { hits: [], total: 3, retriever: 'lexical+semantic' };

function deps(over: Partial<SemanticRecallHandlerDeps> = {}): SemanticRecallHandlerDeps {
  return {
    recallSemantic: vi.fn(async () => SEMANTIC),
    recall: vi.fn(() => LEXICAL),
    getOrgId: vi.fn(() => 'org-1'),
    ...over,
  };
}

const q = { text: 'investor deck', limit: 25 };

/** A `recallSemantic` that always throws the given value. */
function throwing(err: unknown): () => Promise<MemoryRecallResult> {
  return vi.fn(async () => {
    throw err;
  });
}

describe('handleSemanticRecall', () => {
  it('uses semantic recall with the active org when one is present', async () => {
    const recallSemantic = vi.fn(async () => SEMANTIC);
    const d = deps({ recallSemantic });
    const out = await handleSemanticRecall(d, q);
    expect(out).toBe(SEMANTIC);
    expect(recallSemantic).toHaveBeenCalledWith(q, 'org-1');
    expect(d.recall).not.toHaveBeenCalled();
  });

  it('returns the store’s result untouched, so its retrieval envelope survives', async () => {
    const hybrid: MemoryRecallResult = {
      ...SEMANTIC,
      retrieval: { mode: 'hybrid', semantic: { state: 'ok', hits: 4, latencyMs: 12 }, lexicalCandidates: 9 },
    };
    const out = await handleSemanticRecall(deps({ recallSemantic: vi.fn(async () => hybrid) }), q);
    expect(out).toBe(hybrid);
  });

  it('still delegates when there is no active org — the store owns the gate, not this handler', async () => {
    // Pre-A6 this short-circuited to `recall`, which returned an *unlabelled*
    // lexical result. Delegating keeps "never query semantic against a guessed
    // org" in one place and lets the caller see *why* it stayed lexical.
    const recallSemantic = vi.fn(async () => LEXICAL);
    const d = deps({ getOrgId: vi.fn(() => undefined), recallSemantic });
    const out = await handleSemanticRecall(d, q);
    expect(recallSemantic).toHaveBeenCalledWith(q, undefined);
    expect(d.recall).not.toHaveBeenCalled();
    expect(out).toBe(LEXICAL);
  });

  it('degrades to lexical when semantic recall throws, and reports the error', async () => {
    const onSemanticError = vi.fn();
    const d = deps({ recallSemantic: throwing(new Error('backend 503')), onSemanticError });
    const out = await handleSemanticRecall(d, q);
    expect(out.hits).toEqual(LEXICAL.hits);
    expect(out.retriever).toBe('lexical');
    expect(d.recall).toHaveBeenCalledWith(q);
    expect(onSemanticError).toHaveBeenCalledTimes(1);
    expect((onSemanticError.mock.calls[0][0] as Error).message).toBe('backend 503');
  });

  it('does not require an error observer to fall back', async () => {
    const d = deps({ recallSemantic: throwing(new Error('boom')), onSemanticError: undefined });
    expect((await handleSemanticRecall(d, q)).retriever).toBe('lexical');
  });
});

describe('handleSemanticRecall — backstop labelling (A6)', () => {
  it('labels the fallback degraded rather than passing it off as a clean lexical result', async () => {
    const d = deps({ recallSemantic: throwing(new Error('ranker blew up')) });
    const out = await handleSemanticRecall(d, q);
    expect(out.retrieval?.mode).toBe('degraded');
    expect(out.retrieval?.semantic.state).toBe('failed');
  });

  it('omits lexicalCandidates — it did not run the retriever and 0 would mean "found nothing"', async () => {
    const out = await handleSemanticRecall(deps({ recallSemantic: throwing(new Error('x')) }), q);
    expect(out.retrieval).toBeDefined();
    expect('lexicalCandidates' in (out.retrieval ?? {})).toBe(false);
  });

  it('preserves an already-classified outcome instead of re-classifying it', async () => {
    const outcome = {
      state: 'failed',
      kind: 'auth',
      retryable: false,
      code: 'not_authenticated',
      detail: 'Sign in to use semantic search.',
      latencyMs: 7,
    } as const;
    const d = deps({ recallSemantic: throwing(new SemanticUnavailableError(outcome)) });
    const out = await handleSemanticRecall(d, q);
    expect(out.retrieval?.semantic).toEqual(outcome);
  });

  it('measures the fallback latency from the injected clock', async () => {
    let t = 1_000;
    const d = deps({
      recallSemantic: throwing(new Error('slow failure')),
      now: () => t,
    });
    (d.recall as ReturnType<typeof vi.fn>).mockImplementation(() => {
      t = 1_250;
      return LEXICAL;
    });
    const out = await handleSemanticRecall(d, q);
    const semantic = out.retrieval?.semantic;
    expect(semantic?.state === 'failed' ? semantic.latencyMs : null).toBe(250);
  });

  it('lets a lexical-retriever failure surface — there is nothing honest left to return', async () => {
    const d = deps({
      recallSemantic: throwing(new Error('semantic down')),
      recall: vi.fn(() => {
        throw new Error('retriever corrupt');
      }),
    });
    await expect(handleSemanticRecall(d, q)).rejects.toThrow('retriever corrupt');
  });
});
