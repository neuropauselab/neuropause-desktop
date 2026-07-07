import { describe, expect, it, vi } from 'vitest';
import { handleSemanticRecall, type SemanticRecallHandlerDeps } from './semanticRecallHandler';
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

describe('handleSemanticRecall', () => {
  it('uses semantic recall with the active org when one is present', async () => {
    const recallSemantic = vi.fn(async () => SEMANTIC);
    const d = deps({ recallSemantic });
    const out = await handleSemanticRecall(d, q);
    expect(out).toBe(SEMANTIC);
    expect(recallSemantic).toHaveBeenCalledWith(q, 'org-1');
    expect(d.recall).not.toHaveBeenCalled();
  });

  it('falls back to lexical (never calls semantic) when there is no active org', async () => {
    const d = deps({ getOrgId: vi.fn(() => undefined) });
    const out = await handleSemanticRecall(d, q);
    expect(out).toBe(LEXICAL);
    expect(d.recallSemantic).not.toHaveBeenCalled();
    expect(d.recall).toHaveBeenCalledWith(q);
  });

  it('degrades to lexical when semantic recall throws, and reports the error', async () => {
    const onSemanticError = vi.fn();
    const d = deps({
      recallSemantic: vi.fn(async () => {
        throw new Error('backend 503');
      }),
      onSemanticError,
    });
    const out = await handleSemanticRecall(d, q);
    expect(out).toBe(LEXICAL);
    expect(d.recall).toHaveBeenCalledWith(q);
    expect(onSemanticError).toHaveBeenCalledTimes(1);
    expect((onSemanticError.mock.calls[0][0] as Error).message).toBe('backend 503');
  });

  it('does not require an error observer to fall back', async () => {
    const d = deps({
      recallSemantic: vi.fn(async () => {
        throw new Error('boom');
      }),
      onSemanticError: undefined,
    });
    expect(await handleSemanticRecall(d, q)).toBe(LEXICAL);
  });
});
