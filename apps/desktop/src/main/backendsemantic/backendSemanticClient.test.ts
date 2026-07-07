import { describe, expect, it } from 'vitest';
import {
  BackendSemanticError,
  createBackendSemanticSearch,
  type BackendSemanticDeps,
  type FetchLike,
  type FetchResponse,
} from './backendSemanticClient';

function res(status: number, body: unknown): FetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

interface Capture {
  url: string;
  init: Parameters<FetchLike>[1];
  calls: number;
}

function withCapture(
  response: FetchResponse,
  opts: { token?: () => Promise<string | null>; networkError?: boolean } = {},
) {
  const cap: Capture = { url: '', init: { method: '', headers: {} }, calls: 0 };
  const fetchFn: FetchLike = async (url, init) => {
    cap.calls += 1;
    cap.url = url;
    cap.init = init;
    if (opts.networkError) throw new Error('socket hang up');
    return response;
  };
  const deps: BackendSemanticDeps = {
    backendUrl: 'https://api.test',
    getValidAccessToken: opts.token ?? (async () => 'tok-123'),
    fetchFn,
  };
  return { deps, cap };
}

const query = { text: 'investor deck', orgId: 'org-1', topK: 20 };

describe('createBackendSemanticSearch', () => {
  it('calls POST /memory/semantic/:orgId/search with a bearer token and text/limit body', async () => {
    const { deps, cap } = withCapture(res(200, { orgId: 'org-1', hits: [{ memoryId: 'm1', score: 0.9, payload: {} }] }));
    const hits = await createBackendSemanticSearch(deps)(query);
    expect(cap.calls).toBe(1);
    expect(cap.url).toBe('https://api.test/memory/semantic/org-1/search');
    expect(cap.init.method).toBe('POST');
    expect(cap.init.headers.Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(cap.init.body ?? '{}')).toEqual({ text: 'investor deck', limit: 20 });
    expect(hits).toEqual([{ memoryId: 'm1', score: 0.9 }]);
  });

  it('url-encodes the orgId', async () => {
    const { deps, cap } = withCapture(res(200, { hits: [] }));
    await createBackendSemanticSearch(deps)({ ...query, orgId: 'org/with space' });
    expect(cap.url).toBe('https://api.test/memory/semantic/org%2Fwith%20space/search');
  });

  it('throws not_authenticated (401) when there is no token — and does NOT call fetch', async () => {
    const { deps, cap } = withCapture(res(200, { hits: [] }), { token: async () => null });
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({ code: 'not_authenticated', status: 401 });
    expect(cap.calls).toBe(0);
  });

  it('maps a backend error body to a structured BackendSemanticError', async () => {
    const { deps } = withCapture(res(403, { error: { code: 'not_member', message: 'Not a member.' } }));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({ code: 'not_member', status: 403 });
  });

  it('wraps a network failure as network_error', async () => {
    const { deps } = withCapture(res(200, { hits: [] }), { networkError: true });
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toBeInstanceOf(BackendSemanticError);
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({ code: 'network_error' });
  });

  it('tolerates a malformed hits payload (returns [])', async () => {
    const { deps } = withCapture(res(200, { orgId: 'org-1' }));
    expect(await createBackendSemanticSearch(deps)(query)).toEqual([]);
  });

  it('drops malformed hit rows but keeps valid ones', async () => {
    const { deps } = withCapture(
      res(200, { orgId: 'org-1', hits: [{ memoryId: 'ok', score: 0.5 }, { memoryId: 42, score: 0.9 }, { memoryId: 'no-score' }] }),
    );
    expect(await createBackendSemanticSearch(deps)(query)).toEqual([{ memoryId: 'ok', score: 0.5 }]);
  });
});
