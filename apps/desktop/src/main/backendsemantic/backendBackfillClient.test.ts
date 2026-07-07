import { describe, expect, it } from 'vitest';
import { createBackendBackfill, BackendBackfillError, type BackendBackfillDeps } from './backendBackfillClient';
import type { FetchLike, FetchResponse } from './backendSemanticClient';

function res(status: number, body: unknown): FetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
function withCapture(response: FetchResponse, opts: { token?: () => Promise<string | null>; networkError?: boolean } = {}) {
  const cap = { url: '', init: { method: '', headers: {} } as Parameters<FetchLike>[1], calls: 0 };
  const fetchFn: FetchLike = async (url, init) => {
    cap.calls += 1; cap.url = url; cap.init = init;
    if (opts.networkError) throw new Error('down');
    return response;
  };
  const deps: BackendBackfillDeps = { backendUrl: 'https://api.test', getValidAccessToken: opts.token ?? (async () => 'tok'), fetchFn };
  return { deps, cap };
}

describe('createBackendBackfill', () => {
  it('POSTs memories to /backfill and parses the pipeline result', async () => {
    const { deps, cap } = withCapture(res(200, { processed: 2, embedded: 2, skipped: 0, failed: 0 }));
    const out = await createBackendBackfill(deps)('org-1', [{ memoryId: 'm1', content: 'x' }]);
    expect(cap.url).toBe('https://api.test/memory/semantic/org-1/backfill');
    expect(cap.init.method).toBe('POST');
    expect(cap.init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(cap.init.body ?? '{}')).toEqual({ memories: [{ memoryId: 'm1', content: 'x' }] });
    expect(out).toEqual({ processed: 2, embedded: 2, skipped: 0, failed: 0 });
  });
  it('throws not_authenticated without a token', async () => {
    const { deps } = withCapture(res(200, {}), { token: async () => null });
    await expect(createBackendBackfill(deps)('o', [])).rejects.toMatchObject({ code: 'not_authenticated' });
  });
  it('maps a backend error body', async () => {
    const { deps } = withCapture(res(403, { error: { code: 'not_member', message: 'no' } }));
    await expect(createBackendBackfill(deps)('o', [])).rejects.toMatchObject({ code: 'not_member', status: 403 });
  });
  it('wraps a network failure', async () => {
    const { deps } = withCapture(res(200, {}), { networkError: true });
    await expect(createBackendBackfill(deps)('o', [])).rejects.toBeInstanceOf(BackendBackfillError);
  });
});
