/**
 * P5 — Increment 5: the GitHub connector FAMILY (repositories, issues, PRs, Actions, releases,
 * organizations, teams, notifications on one `github` connector). Pure-node, fake HttpClient —
 * the new org/team mappers + ETag-conditional list sync, family graceful-degradation, and runtime
 * capability discovery. The existing repos/issue/PR/release/CI mappers stay covered by adapters.test.ts
 * and the repos ETag flow by incrementalSync.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, RateLimitError, type HttpRequestOptions, type HttpResponse } from '../http';
import { GITHUB_SERVICES, githubAdapter, githubServiceAvailability, mapOrg, mapTeam } from './github';

const NOW = '2026-07-12T00:00:00.000Z';
const base = { connectorId: 'github', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...base, http: undefined as never, cursor: null };

/** ctx whose http replays one response (or throws). */
function routed(handler: (url: string, opts?: HttpRequestOptions) => HttpResponse<unknown>, cursor: string | null = null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        return Promise.resolve(handler(url, opts));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
}
const rejecting = (err: Error, cursor: string | null = null): SyncContext => {
  const http = { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
};

const orgsR = githubAdapter.resources.find((r) => r.id === 'organizations')!;
const teamsR = githubAdapter.resources.find((r) => r.id === 'teams')!;

describe('GitHub family — composition & graceful degradation', () => {
  it('is ONE connector with every service mounted as a resource', () => {
    expect(githubAdapter.connectorId).toBe('github');
    expect(githubAdapter.resources.map((r) => r.id)).toEqual(
      expect.arrayContaining(['repos', 'repo_data', 'organizations', 'teams', 'notifications']),
    );
  });

  it('graceful-wraps each service — an unauthorized service (403) degrades instead of failing the family', async () => {
    const page = await orgsR.pull(rejecting(new AuthError('forbidden', 403)));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('graceful maps a 404 (unprovisioned) to a degraded skip', async () => {
    const page = await teamsR.pull(rejecting(new HttpError(404, 'Not Found', false)));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unprovisioned');
  });

  it('a rate limit (429) still propagates connector-wide (not swallowed per-service)', async () => {
    await expect(orgsR.pull(rejecting(new HttpError(429, 'Too Many Requests', true)))).rejects.toThrow();
  });

  it('a RateLimitError (e.g. a secondary/abuse 403) propagates for backoff — never a degraded service', async () => {
    // The transport classifies a 403-with-Retry-After as a RateLimitError; graceful must NOT swallow it
    // as "unauthorized", or the connector would silently stop backing off and mislabel a rate limit.
    await expect(orgsR.pull(rejecting(new RateLimitError(1000)))).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('GitHub Organizations & Teams', () => {
  it('maps an organization', () => {
    const e = mapOrg(pureCtx, { id: 42, login: 'acme', url: 'https://api.github.com/orgs/acme', description: 'Acme Inc' });
    expect(e.kind).toBe('organization');
    expect(e.id).toBe('github:a1:organization:42');
    expect(e.title).toBe('acme');
    expect(e.url).toBe('https://github.com/acme');
    expect(e.metadata.githubKind).toBe('organization');
  });

  it('maps a team linked to its org — the team- prefix avoids colliding with an org id', () => {
    const e = mapTeam(pureCtx, { id: 42, name: 'Platform', slug: 'platform', privacy: 'closed', organization: { id: 42, login: 'acme' } });
    expect(e.kind).toBe('organization');
    // team id 42 and org id 42 must NOT collide under the shared 'organization' kind.
    expect(e.id).toBe('github:a1:organization:team-42');
    expect(e.containerId).toBe('github:a1:organization:42');
    expect(e.metadata.githubKind).toBe('team');
    expect(e.metadata.organization).toBe('acme');
  });

  it('org/team timestamps are STABLE (independent of the run clock) so unchanged re-syncs never churn', () => {
    const o = { id: 42, login: 'acme', url: 'u', description: null };
    const early = mapOrg({ ...pureCtx, now: '2026-01-01T00:00:00.000Z' }, o);
    const late = mapOrg({ ...pureCtx, now: '2026-12-31T00:00:00.000Z' }, o);
    // Same input across two syncs → identical updatedAt, so the unified store's updatedAt check treats a
    // re-walked (100+ item) list as unchanged rather than re-emitting every row on every poll.
    expect(early.updatedAt).toBe(late.updatedAt);
    expect(early.createdAt).toBe(late.createdAt);
    const teamEarly = mapTeam({ ...pureCtx, now: '2026-01-01T00:00:00.000Z' }, { id: 7, name: 'P', slug: 'p', organization: { id: 42, login: 'acme' } });
    const teamLate = mapTeam({ ...pureCtx, now: '2026-12-31T00:00:00.000Z' }, { id: 7, name: 'P', slug: 'p', organization: { id: 42, login: 'acme' } });
    expect(teamEarly.updatedAt).toBe(teamLate.updatedAt);
  });

  it('organizations: first sync maps rows and stores the page-1 ETag (single non-full page)', async () => {
    const ctx = routed(() => ({ data: [{ id: 42, login: 'acme', url: 'u', description: null }], headers: { etag: '"O1"' }, status: 200 }));
    const page = await orgsR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['42']);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ etag: '"O1"' });
  });

  it('organizations: an unchanged list returns 304 → skipped, validator preserved (zero-cost poll)', async () => {
    const ctx = routed(() => ({ data: null, headers: {}, status: 304 }), JSON.stringify({ etag: '"O1"' }));
    const page = await orgsR.pull(ctx);
    expect(page.entities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(JSON.parse(page.cursor as string)).toEqual({ etag: '"O1"' });
  });

  it('teams: a FULL page paginates via Link and stores NO validator (lossless-skip rule)', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `t${i + 1}`, slug: `t${i + 1}`, organization: { id: 42, login: 'acme' } }));
    const ctx = routed(() => ({ data: full, headers: { etag: '"T1"', link: '<https://api.github.com/user/teams?page=2>; rel="next"' }, status: 200 }));
    const page = await teamsR.pull(ctx);
    expect(page.entities).toHaveLength(100);
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string)).toMatchObject({ page: 2 });
  });
});

describe('GitHub capability discovery (runtime-driven, ✓/✗)', () => {
  it('the repo scope unlocks repositories/issues/PRs/Actions/releases; read:org gates orgs/teams', () => {
    const byId = Object.fromEntries(githubServiceAvailability(['repo', 'notifications']).map((s) => [s.id, s.available]));
    expect(byId.repos).toBe(true);
    expect(byId.issues).toBe(true); // rides the single `repo` scope
    expect(byId.pull_requests).toBe(true);
    expect(byId.actions).toBe(true);
    expect(byId.releases).toBe(true);
    expect(byId.notifications).toBe(true);
    expect(byId.organizations).toBe(false); // read:org not granted → ✗
    expect(byId.teams).toBe(false);
  });

  it('read:org unlocks organizations + teams', () => {
    const byId = Object.fromEntries(githubServiceAvailability(['repo', 'read:org']).map((s) => [s.id, s.available]));
    expect(byId.organizations).toBe(true);
    expect(byId.teams).toBe(true);
    expect(byId.notifications).toBe(false); // notifications scope not granted → ✗
  });

  it('the catalog declares the delivered family services', () => {
    expect(GITHUB_SERVICES.map((s) => s.id)).toEqual(
      expect.arrayContaining(['repos', 'issues', 'pull_requests', 'actions', 'releases', 'organizations', 'teams', 'notifications']),
    );
  });
});
