import { describe, expect, it, vi } from 'vitest';
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

/** A response whose body is whatever the transport actually sent — not necessarily JSON. */
function rawRes(status: number, text: string): FetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** A response whose body cannot be read at all — connection dropped after headers. */
function unreadableRes(status: number, err: Error): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => {
      throw err;
    },
  };
}

function abortError(name: 'AbortError' | 'TimeoutError' = 'AbortError'): Error {
  return Object.assign(new Error('The operation was aborted.'), { name });
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

describe('createBackendSemanticSearch — cancellation (A6)', () => {
  it('forwards the caller’s signal to fetch, so a lapsed deadline releases the socket', async () => {
    const controller = new AbortController();
    const { deps, cap } = withCapture(res(200, { hits: [] }));
    await createBackendSemanticSearch(deps)(query, { signal: controller.signal });
    expect(cap.init.signal).toBe(controller.signal);
  });

  it('omits signal entirely when the caller passes none — the pre-A6 init is unchanged', async () => {
    const { deps, cap } = withCapture(res(200, { hits: [] }));
    await createBackendSemanticSearch(deps)(query);
    expect('signal' in cap.init).toBe(false);
  });

  it('fails fast on an already-aborted signal without spending a token or a socket', async () => {
    const controller = new AbortController();
    controller.abort();
    const token = vi.fn(async () => 'tok-123');
    const { deps, cap } = withCapture(res(200, { hits: [] }), { token });
    await expect(
      createBackendSemanticSearch(deps)(query, { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(token).not.toHaveBeenCalled();
    expect(cap.calls).toBe(0);
  });

  it('rethrows an abort from fetch unchanged rather than relabelling it network_error', async () => {
    const { deps } = withCapture(res(200, { hits: [] }));
    deps.fetchFn = async () => {
      throw abortError();
    };
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rethrows an abort raised while reading the body', async () => {
    const { deps } = withCapture(unreadableRes(200, abortError('TimeoutError')));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('wraps a genuine body-read failure as network_error', async () => {
    const { deps } = withCapture(unreadableRes(200, new Error('socket hang up')));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
    });
  });
});

describe('createBackendSemanticSearch — unreadable bodies (A6)', () => {
  it('keeps the real status when an error body will not parse — the proxy HTML-502 case', async () => {
    const { deps } = withCapture(rawRes(502, '<html><body>502 Bad Gateway</body></html>'));
    const err = await createBackendSemanticSearch(deps)(query).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendSemanticError);
    expect(err).toMatchObject({ status: 502, code: 'request_failed' });
    expect(err).not.toBeInstanceOf(SyntaxError);
  });

  it('keeps the real status when an error body is empty', async () => {
    const { deps } = withCapture(rawRes(503, ''));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({
      status: 503,
      code: 'request_failed',
    });
  });

  it('ignores a non-object error envelope rather than trusting it', async () => {
    const { deps } = withCapture(rawRes(500, JSON.stringify({ error: 'boom' })));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
    });
  });

  it('lets a 2xx with an unreadable body surface as SyntaxError — a genuine malformed_response', async () => {
    const { deps } = withCapture(rawRes(200, 'not json at all'));
    await expect(createBackendSemanticSearch(deps)(query)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('treats an empty 2xx body as no hits, not as an error', async () => {
    const { deps } = withCapture(rawRes(200, ''));
    expect(await createBackendSemanticSearch(deps)(query)).toEqual([]);
  });
});
