import { describe, expect, it, vi } from 'vitest';
import type { SyncChange } from '@neuropause/shared';
import { classifyError } from './backoff';
import { createHttpSyncTransport, SyncTransportError } from './transport';

// config + authService import electron, which can't load under vitest. The transport
// takes injected deps in these tests, so these mocks only satisfy the static imports.
vi.mock('../../config', () => ({ config: { backendUrl: 'http://test.local:4000' } }));
vi.mock('../../auth/authService', () => ({
  authService: { getValidAccessToken: async () => null },
}));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

const token = async (): Promise<string | null> => 'tok-123';

const sampleChange: SyncChange = {
  entityType: 'org_prefs',
  entityId: 'p',
  orgId: 'org 1',
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  deleted: false,
  data: { theme: 'dark' },
};

describe('createHttpSyncTransport', () => {
  it('pushes to the right URL with auth header and JSON body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { results: [], cursor: 3 });
    }) as unknown as typeof fetch;

    const t = createHttpSyncTransport({ baseUrl: 'http://api.test', getToken: token, fetchImpl });
    const res = await t.push('org 1', 'devA', [sampleChange]);

    expect(res.cursor).toBe(3);
    expect(calls[0].url).toBe('http://api.test/sync/org%201/push');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    const body = JSON.parse(calls[0].init.body as string) as {
      deviceId: string;
      changes: unknown[];
    };
    expect(body.deviceId).toBe('devA');
    expect(body.changes).toHaveLength(1);
  });

  it('pulls with cursor, deviceId, limit, and entityTypes in the query', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(200, { changes: [], cursor: 0, hasMore: false });
    }) as unknown as typeof fetch;

    const t = createHttpSyncTransport({ baseUrl: 'http://api.test', getToken: token, fetchImpl });
    await t.pull('org-1', 5, {
      deviceId: 'devA',
      limit: 100,
      entityTypes: ['org_prefs', 'workspace_settings'],
    });

    expect(calls[0]).toContain('/sync/org-1/pull?');
    expect(calls[0]).toContain('cursor=5');
    expect(calls[0]).toContain('deviceId=devA');
    expect(calls[0]).toContain('limit=100');
    expect(calls[0]).toContain('entityTypes=org_prefs%2Cworkspace_settings');
  });

  it('throws a retryable server error on 5xx', async () => {
    const fetchImpl = (async () =>
      jsonResponse(503, { error: { code: 'x', message: 'down' } })) as unknown as typeof fetch;
    const t = createHttpSyncTransport({ baseUrl: 'http://api.test', getToken: token, fetchImpl });

    let caught: unknown;
    try {
      await t.pull('org-1', 0, { deviceId: 'd' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncTransportError);
    expect((caught as SyncTransportError).status).toBe(503);
    expect(classifyError(caught)).toBe('server');
  });

  it('throws a client error on 4xx', async () => {
    const fetchImpl = (async () =>
      jsonResponse(403, {
        error: { code: 'forbidden', message: 'no' },
      })) as unknown as typeof fetch;
    const t = createHttpSyncTransport({ baseUrl: 'http://api.test', getToken: token, fetchImpl });
    await expect(t.pull('org-1', 0, { deviceId: 'd' })).rejects.toMatchObject({ status: 403 });
  });

  it('throws a network error when fetch rejects', async () => {
    const fetchImpl = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const t = createHttpSyncTransport({ baseUrl: 'http://api.test', getToken: token, fetchImpl });

    let caught: unknown;
    try {
      await t.pull('org-1', 0, { deviceId: 'd' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncTransportError);
    expect((caught as SyncTransportError).kind).toBe('network');
    expect(classifyError(caught)).toBe('network');
  });

  it('fails fast without a token and does not call fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const t = createHttpSyncTransport({
      baseUrl: 'http://api.test',
      getToken: async () => null,
      fetchImpl,
    });
    await expect(t.push('org-1', 'd', [])).rejects.toMatchObject({
      status: 401,
      code: 'not_authenticated',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
