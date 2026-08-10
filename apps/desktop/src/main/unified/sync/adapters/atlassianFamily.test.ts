import { makeUnifiedId } from '../../ids';
/**
 * P5 — Increment 7: the Atlassian connector FAMILY (Jira projects/issues/boards + Confluence
 * spaces/pages on one `atlassian` connector). Pure-node, fake HttpClient. Covers family composition,
 * the cloudId resolution (accessible-resources → cached in the cursor), graceful degradation (403/404),
 * the mappers (kinds, id-collision prevention, container links, timestamp normalization), the offset /
 * cursor / newest-first-stop-at-baseline pulls, and runtime capability discovery.
 */
import { describe, expect, it } from 'vitest';
import type { SyncContext } from '../adapterSdk';
import { AuthError, HttpError, type HttpRequestOptions } from '../http';
import {
  atlassianAdapter,
  atlassianServiceAvailability,
  mapBoard,
  mapIssue,
  mapPage,
  mapProject,
  mapSpace,
  ATLASSIAN_SERVICES,
} from './atlassian';

const SITE = { cloud: 'cid', url: 'https://acme.atlassian.net' };
const NOW = '2026-07-12T00:00:00.000Z';
const base = { tenantId: 'org-test', connectorId: 'atlassian', accountId: 'a1', now: NOW } as const;
const pureCtx: SyncContext = { ...base, http: undefined as never, cursor: null };
/** A cursor with the site pre-resolved, so a resource test skips the accessible-resources call. */
const sited = (extra: Record<string, unknown> = {}): string => JSON.stringify({ site: SITE, ...extra });

/** ctx whose http replays a body per URL (200), or throws. */
function routed(handler: (url: string, opts?: HttpRequestOptions) => unknown, cursor: string | null): SyncContext {
  const http = {
    getJson: (url: string, opts?: HttpRequestOptions) => {
      try {
        return Promise.resolve({ data: handler(url, opts), headers: {}, status: 200 });
      } catch (err) {
        return Promise.reject(err);
      }
    },
  } as unknown as SyncContext['http'];
  return { ...base, http, cursor };
}
const rejecting = (err: Error, cursor: string | null): SyncContext => ({
  ...base,
  http: { getJson: () => Promise.reject(err) } as unknown as SyncContext['http'],
  cursor,
});

const projectsR = atlassianAdapter.resources.find((r) => r.id === 'jira_projects')!;
const issuesR = atlassianAdapter.resources.find((r) => r.id === 'jira_issues')!;
const boardsR = atlassianAdapter.resources.find((r) => r.id === 'jira_boards')!;
const spacesR = atlassianAdapter.resources.find((r) => r.id === 'confluence_spaces')!;
const pagesR = atlassianAdapter.resources.find((r) => r.id === 'confluence_pages')!;

describe('Atlassian family — composition, cloudId & graceful', () => {
  it('is ONE connector with every Jira + Confluence service mounted as a resource', () => {
    expect(atlassianAdapter.connectorId).toBe('atlassian');
    expect(atlassianAdapter.resources.map((r) => r.id)).toEqual([
      'jira_projects', 'jira_issues', 'jira_boards', 'confluence_spaces', 'confluence_pages',
    ]);
  });

  it('resolves the site cloudId via accessible-resources and caches {cloud,url} in the cursor', async () => {
    const ctx = routed((url) => {
      if (url.includes('accessible-resources')) return [{ id: 'cid', name: 'Acme', url: 'https://acme.atlassian.net' }];
      if (url.includes('/ex/jira/cid/rest/api/3/project/search')) return { values: [{ id: '1', key: 'ENG', name: 'Engineering' }], isLast: true };
      throw new Error(`unexpected ${url}`);
    }, null);
    const page = await projectsR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['1']);
    expect(JSON.parse(page.cursor as string).site).toEqual({ cloud: 'cid', url: 'https://acme.atlassian.net' });
  });

  it('graceful — a missing scope (403) degrades the SERVICE as unauthorized, not the family', async () => {
    const page = await projectsR.pull(rejecting(new AuthError('forbidden', 403), sited()));
    expect(page.entities).toEqual([]);
    expect(page.degraded?.kind).toBe('unauthorized');
  });

  it('graceful — Jira Software agile absent (boards 404) degrades as unprovisioned', async () => {
    const page = await boardsR.pull(rejecting(new HttpError(404, 'not found', false), sited()));
    expect(page.degraded?.kind).toBe('unprovisioned');
  });

  it('a rate limit / 5xx propagates connector-wide (never a per-service degrade)', async () => {
    await expect(issuesR.pull(rejecting(new HttpError(500, 'server error', true), sited()))).rejects.toThrow();
  });
});

describe('Atlassian mappers', () => {
  it('maps a Jira project → project', () => {
    const e = mapProject(pureCtx, SITE, { id: '10001', key: 'ENG', name: 'Engineering', lead: { displayName: 'Ada' } });
    expect(e.kind).toBe('project');
    expect(e.id).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'project', '10001'));
    expect(e.url).toBe('https://acme.atlassian.net/browse/ENG');
    expect(e.metadata.atlassianType).toBe('jira_project');
  });

  it('maps a Jira issue → task, linked to its project, with normalized (Z) timestamps + labels', () => {
    const e = mapIssue(pureCtx, SITE, {
      id: '20001', key: 'ENG-42',
      fields: {
        summary: 'Fix bug', status: { name: 'In Progress' },
        updated: '2026-07-01T10:00:00.000+0000', created: '2026-06-01T00:00:00.000+0000',
        project: { id: '10001', key: 'ENG' }, labels: ['backend'], assignee: { displayName: 'Ada' },
      },
    });
    expect(e.kind).toBe('task');
    expect(e.containerId).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'project', '10001'));
    expect(e.title).toBe('Fix bug');
    expect(e.status).toBe('In Progress');
    expect(e.labels).toEqual(['backend']);
    expect(e.updatedAt).toBe('2026-07-01T10:00:00.000Z'); // +0000 normalized to Z
  });

  it('the board- prefix prevents a board id colliding with a Jira project id under the shared project kind', () => {
    const proj = mapProject(pureCtx, SITE, { id: '10001', key: 'ENG', name: 'Engineering' });
    const board = mapBoard(pureCtx, SITE, { id: 10001, name: 'Board', location: { projectId: 10001, projectKey: 'ENG' } });
    expect(proj.id).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'project', '10001'));
    expect(board.id).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'project', 'board-10001'));
    expect(proj.id).not.toBe(board.id);
    expect(board.containerId).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'project', '10001')); // board linked to its project
  });

  it('a project/board/space (no source timestamp) uses a STABLE baseline, never the run clock (churn-free)', () => {
    const early = mapProject({ ...pureCtx, now: '2026-01-01T00:00:00.000Z' }, SITE, { id: '1', key: 'A', name: 'A' });
    const late = mapProject({ ...pureCtx, now: '2026-12-31T00:00:00.000Z' }, SITE, { id: '1', key: 'A', name: 'A' });
    expect(early.updatedAt).toBe(late.updatedAt); // full-walked every sync → must not re-churn on ctx.now
    const spaceEarly = mapSpace({ ...pureCtx, now: '2026-01-01T00:00:00.000Z' }, SITE, { id: 's1', key: 'S', name: 'S' });
    const spaceLate = mapSpace({ ...pureCtx, now: '2026-12-31T00:00:00.000Z' }, SITE, { id: 's1', key: 'S', name: 'S' });
    expect(spaceEarly.updatedAt).toBe(spaceLate.updatedAt);
  });

  it('maps a Confluence space → workspace and a page → document linked to its space', () => {
    const space = mapSpace(pureCtx, SITE, { id: '98304', key: 'ENG', name: 'Engineering', type: 'global' });
    expect(space.kind).toBe('workspace');
    expect(space.id).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'workspace', '98304'));
    const pg = mapPage(pureCtx, SITE, { id: '77', title: 'Runbook', spaceId: '98304', version: { number: 3, createdAt: '2026-07-05T12:00:00.000Z' }, _links: { webui: '/spaces/ENG/pages/77/Runbook' } });
    expect(pg.kind).toBe('document');
    expect(pg.containerId).toBe(makeUnifiedId('org-test', 'atlassian', 'a1', 'workspace', '98304'));
    expect(pg.url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/77/Runbook');
    expect(pg.updatedAt).toBe('2026-07-05T12:00:00.000Z');
  });
});

describe('Atlassian pulls — pagination & incremental high-water', () => {
  it('projects: offset pagination advances startAt while isLast is false', async () => {
    const ctx = routed(() => ({ values: [{ id: '1', key: 'A', name: 'A' }, { id: '2', key: 'B', name: 'B' }], isLast: false }), sited());
    const page = await projectsR.pull(ctx);
    expect(page.entities).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string)).toMatchObject({ startAt: 2 });
  });

  it('issues: incremental JQL filters by the wall-clock high-water (tz-consistent) in ASCENDING order', async () => {
    let seenJql = '';
    const ctx = routed((url, opts) => {
      if (url.includes('/search/jql')) {
        seenJql = String(opts?.query?.jql);
        return { issues: [{ id: '1', key: 'E-1', fields: { updated: '2026-07-10T10:30:00.000+0000' } }] };
      }
      throw new Error(url);
    }, sited({ hw: '2026-07-05T08:15:20.000+0000' }));
    const page = await issuesR.pull(ctx);
    // Wall-clock (date + HH:mm) preserved, NOT UTC-converted — matches how Jira interprets JQL dates.
    expect(seenJql).toBe('updated >= "2026-07-05 08:15" ORDER BY updated ASC');
    expect(page.entities.map((e) => e.sourceId)).toEqual(['1']);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10T10:30:00.000+0000'); // raw newest committed
  });

  it('issues: first sync (no high-water) walks ascending and commits the newest ONLY at drain', async () => {
    const p1 = await issuesR.pull(routed((url, opts) => {
      expect(String(opts?.query?.jql)).toBe('ORDER BY updated ASC'); // no filter on the first sync
      return { issues: [{ id: '5', key: 'E-5', fields: { updated: '2026-07-18T00:00:00.000Z' } }], nextPageToken: 'T2' };
    }, sited()));
    expect(p1.hasMore).toBe(true);
    const c1 = JSON.parse(p1.cursor as string);
    expect(c1.token).toBe('T2');
    expect(c1.pending).toBe('2026-07-18T00:00:00.000Z');
    expect(c1.hw).toBeUndefined(); // not committed mid-walk

    const p2 = await issuesR.pull(routed(() => ({ issues: [{ id: '6', key: 'E-6', fields: { updated: '2026-07-20T00:00:00.000Z' } }] }), p1.cursor));
    expect(p2.hasMore).toBe(false);
    expect(JSON.parse(p2.cursor as string).hw).toBe('2026-07-20T00:00:00.000Z'); // newest across the walk
  });

  it('issues: at the MAX_PAGES cap it commits the high-water and drops the token — the JQL resumes next run (NO leapfrog)', async () => {
    // page 19 → page+1 (20) is not < MAX_PAGES (20), so even WITH a live token the run caps and commits.
    const page = await issuesR.pull(routed(() => ({ issues: [{ id: '9', key: 'E-9', fields: { updated: '2026-07-25T00:00:00.000Z' } }], nextPageToken: 'MORE' }), sited({ hw: '2026-07-01T00:00:00.000Z', page: 19 })));
    expect(page.hasMore).toBe(false);
    const c = JSON.parse(page.cursor as string);
    expect(c.hw).toBe('2026-07-25T00:00:00.000Z'); // committed → next run's `updated >= this` resumes forward
    expect(c.token).toBeUndefined(); // token dropped, but the high-water (not the token) drives resumption
  });

  it('spaces: extracts the next cursor from the Confluence _links.next relative URL', async () => {
    const ctx = routed(() => ({ results: [{ id: '98304', key: 'ENG', name: 'Engineering' }], _links: { next: '/wiki/api/v2/spaces?limit=50&cursor=ABC123' } }), sited());
    const page = await spacesR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['98304']);
    expect(page.hasMore).toBe(true);
    expect(JSON.parse(page.cursor as string).next).toBe('ABC123');
  });

  it('pages: newest-first, stops at the modified high-water, commits the newest on drain', async () => {
    const ctx = routed(() => ({
      results: [
        { id: '9', title: 'new', spaceId: '1', version: { createdAt: '2026-07-10T00:00:00.000Z' } },
        { id: '8', title: 'old', spaceId: '1', version: { createdAt: '2026-07-01T00:00:00.000Z' } },
      ],
      _links: {},
    }), sited({ hw: '2026-07-05T00:00:00.000Z' }));
    const page = await pagesR.pull(ctx);
    expect(page.entities.map((e) => e.sourceId)).toEqual(['9']);
    expect(JSON.parse(page.cursor as string).hw).toBe('2026-07-10T00:00:00.000Z');
  });
});

describe('Atlassian capability discovery (runtime-driven, ✓/✗)', () => {
  it('read:jira-work unlocks Jira projects/issues/boards', () => {
    const byId = Object.fromEntries(atlassianServiceAvailability(['read:jira-work']).map((s) => [s.id, s.available]));
    expect(byId.jira_projects).toBe(true);
    expect(byId.jira_issues).toBe(true);
    expect(byId.jira_boards).toBe(true);
    expect(byId.confluence_spaces).toBe(false);
    expect(byId.confluence_pages).toBe(false);
  });

  it('the Confluence scopes unlock spaces + pages', () => {
    const byId = Object.fromEntries(atlassianServiceAvailability(['read:confluence-space.summary', 'read:confluence-content.all']).map((s) => [s.id, s.available]));
    expect(byId.confluence_spaces).toBe(true);
    expect(byId.confluence_pages).toBe(true);
    expect(byId.jira_projects).toBe(false);
  });

  it('the catalog ids match the adapter resource ids (so live counts appear per service)', () => {
    expect(ATLASSIAN_SERVICES.map((s) => s.id)).toEqual(atlassianAdapter.resources.map((r) => r.id));
  });
});
