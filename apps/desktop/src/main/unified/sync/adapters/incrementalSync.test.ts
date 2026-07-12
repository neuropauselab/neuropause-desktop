/**
 * P5 — Increment 1: the incremental-sync foundation exercised through the REAL adapters.
 *   • GitHub `repos` — ETag conditional requests: first sync captures the head validator,
 *     an unchanged head returns 304 (skip), a changed head re-walks and stores the new validator,
 *     and pagination carries the page-1 validator to the end of the walk.
 *   • Google Calendar `events` — an expired syncToken (410 Gone) transparently full-resyncs,
 *     proving the refactor onto the shared `isExpiredCursorError` predicate kept that behavior.
 * Pure-node: a fake HttpClient stands in for the transport (no Electron, no network).
 */
import { describe, expect, it } from 'vitest';
import { githubAdapter } from './github';
import { googleCalendarResources } from './googleCalendar';
import type { SyncContext } from '../adapterSdk';
import { HttpError, type HttpClient, type HttpRequestOptions, type HttpResponse } from '../http';

/** A fake HttpClient that replays a fixed sequence of responses and records the request options. */
function seqHttp(responses: Array<HttpResponse<unknown>>) {
  const seen: HttpRequestOptions[] = [];
  let i = 0;
  const getJson = (_url: string, opts?: HttpRequestOptions): Promise<HttpResponse<unknown>> => {
    seen.push(opts ?? {});
    return Promise.resolve(responses[i++] ?? { data: [], headers: {}, status: 200 });
  };
  return { http: { getJson } as unknown as HttpClient, seen };
}

const NOW = '2026-07-01T00:00:00.000Z';
const ghCtx = (http: HttpClient, cursor: string | null): SyncContext => ({ connectorId: 'github', accountId: 'a1', http, cursor, now: NOW });

const repo = (id: number, full_name: string) => ({
  id,
  full_name,
  html_url: `https://github.com/${full_name}`,
  description: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
  archived: false,
  private: false,
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  language: null,
  default_branch: 'main',
  owner: { login: full_name.split('/')[0] },
});

const reposResource = githubAdapter.resources.find((r) => r.id === 'repos')!;

describe('GitHub repos — ETag conditional sync', () => {
  it('first sync captures the head ETag as the cursor (no precondition sent)', async () => {
    const { http, seen } = seqHttp([{ data: [repo(1, 'acme/web')], headers: { etag: '"E1"' }, status: 200 }]);
    const page = await reposResource.pull(ghCtx(http, null));
    expect(page.entities.map((e) => e.sourceId)).toEqual(['1']);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ etag: '"E1"' });
    expect(seen[0]?.headers?.['If-None-Match']).toBeUndefined(); // nothing to condition on yet
  });

  it('a FULL single page (== per_page) stores NO validator, so a newly-born page 2 can never be silently skipped', async () => {
    // 100 repos, no rel="next" → looks like a single page. But a repo added later that sorts to position
    // 101 would be invisible to a page-1 304, so the ETag must NOT be trusted for a full page.
    const full = Array.from({ length: 100 }, (_, i) => repo(i + 1, `acme/r${i + 1}`));
    const { http } = seqHttp([{ data: full, headers: { etag: '"EF"' }, status: 200 }]);
    const page = await reposResource.pull(ghCtx(http, null));
    expect(page.entities).toHaveLength(100);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({}); // full page → no validator → re-walks next time
  });

  it('an unchanged head returns 304 → the resource is skipped, validator preserved', async () => {
    const { http, seen } = seqHttp([{ data: null, headers: {}, status: 304 }]);
    const page = await reposResource.pull(ghCtx(http, JSON.stringify({ etag: '"E1"' })));
    expect(page.entities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ etag: '"E1"' });
    expect(seen[0]?.headers?.['If-None-Match']).toBe('"E1"');
  });

  it('a changed head re-walks and stores the new validator', async () => {
    const { http, seen } = seqHttp([{ data: [repo(2, 'acme/api')], headers: { etag: '"E2"' }, status: 200 }]);
    const page = await reposResource.pull(ghCtx(http, JSON.stringify({ etag: '"E1"' })));
    expect(page.entities.map((e) => e.sourceId)).toEqual(['2']);
    expect(JSON.parse(page.cursor as string)).toEqual({ etag: '"E2"' });
    expect(seen[0]?.headers?.['If-None-Match']).toBe('"E1"');
  });

  it('a multi-page list stores NO validator, so it re-walks fully next time (never wrongly skips)', async () => {
    const linkNext = '<https://api.github.com/user/repos?page=2>; rel="next"';
    const { http } = seqHttp([{ data: [repo(1, 'acme/web')], headers: { etag: '"E1"', link: linkNext }, status: 200 }]);
    const p1 = await reposResource.pull(ghCtx(http, null));
    expect(p1.hasMore).toBe(true);
    expect(JSON.parse(p1.cursor as string)).toEqual({ page: 2, pendingEtag: '"E1"' });

    // Last page: the walk spanned >1 page, so the page-1 ETag is deliberately dropped — a page-1 304
    // could not vouch for deeper pages, and skipping would risk missing an in-place page-2 change.
    const { http: http2 } = seqHttp([{ data: [repo(2, 'acme/api')], headers: {}, status: 200 }]);
    const p2 = await reposResource.pull(ghCtx(http2, p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string)).toEqual({});

    // The next sync therefore starts a full, unconditional walk (no If-None-Match precondition).
    const { http: http3, seen } = seqHttp([{ data: [repo(1, 'acme/web')], headers: { etag: '"E3"' }, status: 200 }]);
    await reposResource.pull(ghCtx(http3, p2.cursor));
    expect(seen[0]?.headers?.['If-None-Match']).toBeUndefined();
  });
});

describe('Google Calendar events — syncToken expiry (410) full-resync', () => {
  const eventsResource = googleCalendarResources.find((r) => r.id === 'calendar')!;

  /** Throws 410 once (expired syncToken), then returns a fresh page with a new nextSyncToken. */
  function stub410Then(final: HttpResponse<unknown>): HttpClient {
    let first = true;
    const getJson = (): Promise<HttpResponse<unknown>> => {
      if (first) {
        first = false;
        return Promise.reject(new HttpError(410, 'Gone', false));
      }
      return Promise.resolve(final);
    };
    return { getJson } as unknown as HttpClient;
  }

  it('recovers from an expired syncToken with a bounded full resync', async () => {
    const http = stub410Then({
      data: {
        items: [{ id: 'ev1', status: 'confirmed', summary: 'Standup', start: { dateTime: '2026-07-02T09:00:00Z' }, end: { dateTime: '2026-07-02T09:15:00Z' } }],
        nextSyncToken: 'FRESH',
      },
      headers: {},
      status: 200,
    });
    const page = await eventsResource.pull({ connectorId: 'google-workspace', accountId: 'a1', http, cursor: JSON.stringify({ sync: 'STALE' }), now: NOW });
    expect(page.entities.map((e) => e.sourceId)).toEqual(['ev1']);
    expect(JSON.parse(page.cursor as string)).toEqual({ sync: 'FRESH' });
  });
});
