/**
 * GitHub adapter. Maps the REST API into the UDM:
 *   repos          → project    (full list; the store dedups)
 *   repo_data      → task + activity  (per ACTIVE repo: open issues, open PRs,
 *                                      recent releases — see Increment 2 below)
 *   notifications  → notification (incremental via ?since=)
 *
 * The `repo_data` resource is the insight-focused deep sync: instead of every
 * repo, it walks only "active" repos (recent push/activity or open issues/PRs)
 * and emits exactly the entities that move the Executive Mission Brief — open
 * work (as tasks the brief already surfaces) and releases (as activity).
 *
 * Cursor encoding (opaque to the engine): repos use a plain page number; the
 * notifications cursor carries query baseline + page + a high-water `updated_at`
 * so reruns only pull what changed; `repo_data` carries its own two-phase
 * (list → deep) state machine (see RepoDataCursor / pullRepoData).
 */
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { hasNextLink, maxIso, parseJsonCursor, toJsonCursor, truncate } from './util';
import { makeUnifiedId } from '../../ids';

const GH = 'https://api.github.com';

interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  pushed_at?: string | null;
  archived: boolean;
  private: boolean;
  visibility?: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  default_branch: string;
  topics?: string[] | null;
  homepage?: string | null;
  license?: { spdx_id: string | null } | null;
  owner: { login: string; id?: number; type?: string } | null;
}

interface GhIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  assignee: { login: string } | null;
  labels: Array<{ name: string } | string>;
  comments: number;
  pull_request?: unknown;
  repository_url: string;
  repository?: { id: number; full_name: string } | null;
}

interface GhNotification {
  id: string;
  reason: string;
  updated_at: string;
  unread: boolean;
  subject: { title: string; url: string | null; type: string } | null;
  repository: { full_name: string } | null;
}

interface ReposCursor {
  page?: number;
}

interface SinceCursor {
  since?: string | null;
  page?: number;
  hw?: string | null;
}

export function mapRepo(ctx: SyncContext, r: GhRepo) {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'project',
    sourceId: String(r.id),
    now: ctx.now,
    title: r.full_name,
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    body: truncate(r.description, 300),
    status: r.archived ? 'archived' : 'active',
    author: r.owner?.login ?? null,
    labels: [...(r.topics ?? []), ...(r.language ? [r.language] : [])],
    metadata: {
      private: r.private,
      visibility: r.visibility ?? (r.private ? 'private' : 'public'),
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      language: r.language ?? null,
      defaultBranch: r.default_branch,
      pushedAt: r.pushed_at ?? null,
      homepage: r.homepage ?? null,
      license: r.license?.spdx_id ?? null,
    },
  });
}

export function mapIssue(ctx: SyncContext, i: GhIssue) {
  const repository = i.repository_url ? (i.repository_url.split('/repos/')[1] ?? null) : null;
  // Link the issue/PR to its repository entity so the graph can draw the
  // "repository contains issue" edge. The repo id comes from the embedded
  // `repository` object; if the repo wasn't synced, the projector simply
  // skips the edge (it checks the container node exists).
  const containerId = i.repository
    ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'project', String(i.repository.id))
    : null;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'task',
    sourceId: String(i.id),
    containerId,
    now: ctx.now,
    title: i.title,
    url: i.html_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    body: truncate(i.body, 500),
    status: i.state,
    author: i.user?.login ?? i.assignee?.login ?? null,
    timestamp: i.created_at,
    labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    metadata: {
      number: i.number,
      isPullRequest: i.pull_request != null,
      comments: i.comments,
      assignee: i.assignee?.login ?? null,
      repository,
    },
  });
}

export function mapNotification(ctx: SyncContext, n: GhNotification) {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'notification',
    sourceId: String(n.id),
    now: ctx.now,
    title: n.subject?.title ?? '(notification)',
    url: null,
    createdAt: n.updated_at,
    updatedAt: n.updated_at,
    status: n.unread ? 'unread' : 'read',
    body: n.reason,
    metadata: {
      reason: n.reason,
      type: n.subject?.type ?? null,
      repository: n.repository?.full_name ?? null,
      unread: n.unread,
    },
  });
}

async function pullRepos(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<ReposCursor>(ctx.cursor);
  const page = c?.page ?? 1;
  const resp = await ctx.http.getJson<GhRepo[]>(`${GH}/user/repos`, {
    query: { per_page: 100, page, sort: 'updated', direction: 'desc', affiliation: 'owner,collaborator,organization_member' },
  });
  const entities = (resp.data ?? []).map((r) => mapRepo(ctx, r));
  const more = hasNextLink(resp.headers['link']);
  return { entities, cursor: more ? toJsonCursor({ page: page + 1 }) : null, hasMore: more };
}

async function pullNotifications(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<SinceCursor>(ctx.cursor);
  const resuming = c?.page != null;
  const page = resuming ? (c?.page ?? 1) : 1;
  const since = resuming ? (c?.since ?? null) : (c?.since ?? null);
  let hw = resuming ? (c?.hw ?? null) : null;

  const resp = await ctx.http.getJson<GhNotification[]>(`${GH}/notifications`, {
    query: { all: true, per_page: 100, page, since: since ?? undefined },
  });
  const items = resp.data ?? [];
  for (const n of items) hw = maxIso(hw, n.updated_at);
  const more = hasNextLink(resp.headers['link']);
  const cursor = more ? toJsonCursor({ page: page + 1, since, hw }) : toJsonCursor({ since: hw ?? since ?? null });
  return { entities: items.map((n) => mapNotification(ctx, n)), cursor, hasMore: more };
}

// ─── Increment 2: deep sync of ACTIVE repositories ──────────────────────────
// Rather than every repo, deep-sync only repos carrying live signal for the
// Executive Mission Brief: recent pushes (proxy for recent commits), recent
// activity, or open issues/PRs. For each active repo we emit its OPEN issues and
// OPEN pull requests (as `task`s, which the brief already surfaces) and recent
// releases (as `activity`), all linked to the repo's `project` so the graph
// draws "repository contains …". Judging "active" needs no extra API calls — it
// reads fields already present on the repo-list object.

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_REPOS = 100; // bound the deep-sync set (most-recently-pushed first)
const MAX_DEEP_PAGES = 10; // bound pages per (repo, resource) so one repo can't run away

interface GhPull {
  id: number;
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  state: string;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  user: { login: string } | null;
  labels?: Array<{ name: string } | string>;
  requested_reviewers?: Array<{ login: string }> | null;
}

interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: { login: string } | null;
}

interface GhWorkflowRun {
  id: number;
  name: string | null; // workflow name
  head_branch: string | null;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | skipped | null
  run_number: number;
  event: string; // push | pull_request | schedule | ...
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
}

interface GhWorkflowRunsResponse {
  total_count: number;
  workflow_runs: GhWorkflowRun[];
}

interface RepoRef {
  owner: string;
  name: string;
  id: number;
}

type DeepRes = 'issues' | 'prs' | 'releases' | 'ci';

interface RepoDataCursor {
  phase: 'list' | 'deep';
  /** list phase: which /user/repos page we're on */
  reposPage?: number;
  /** active repos accumulated so far (carried into the deep phase) */
  active?: RepoRef[];
  /** deep phase: index into `active` */
  i?: number;
  /** deep phase: which per-repo resource */
  res?: DeepRes;
  /** deep phase: page within `res` */
  resPage?: number;
}

/**
 * Is this repo worth deep-syncing? Judged from the repo-list object alone (no
 * extra requests): not archived, and either a recent push, recent activity, or
 * any open issues/PRs. "Recent release" is subsumed by push/activity recency;
 * "user-pinned" needs the GraphQL API and is deferred (see CONNECTOR-GITHUB.md).
 */
export function isActiveRepo(r: GhRepo, nowIso: string): boolean {
  if (r.archived) return false;
  const now = Date.parse(nowIso);
  const recent = (iso?: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && now - t <= NINETY_DAYS_MS;
  };
  if (recent(r.pushed_at)) return true;
  if (recent(r.updated_at)) return true;
  return (r.open_issues_count ?? 0) > 0;
}

function repoRefOf(r: GhRepo): RepoRef {
  const slash = r.full_name.indexOf('/');
  const owner = slash >= 0 ? r.full_name.slice(0, slash) : (r.owner?.login ?? '');
  const name = slash >= 0 ? r.full_name.slice(slash + 1) : r.full_name;
  return { owner, name, id: r.id };
}

const repoContainer = (ctx: SyncContext, repo: RepoRef): string =>
  makeUnifiedId(ctx.connectorId, ctx.accountId, 'project', String(repo.id));

/** Open issue (PRs filtered out by the caller) → task, linked to its repo. */
export function mapRepoIssue(ctx: SyncContext, repo: RepoRef, i: GhIssue) {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'task',
    sourceId: String(i.id),
    containerId: repoContainer(ctx, repo),
    now: ctx.now,
    title: i.title,
    url: i.html_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    body: truncate(i.body, 500),
    status: i.state,
    author: i.user?.login ?? i.assignee?.login ?? null,
    timestamp: i.created_at,
    labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    metadata: {
      number: i.number,
      isPullRequest: false,
      comments: i.comments,
      assignee: i.assignee?.login ?? null,
      repository: `${repo.owner}/${repo.name}`,
    },
  });
}

/** Open pull request → task. `reviewers` (requested count) feeds "awaiting review". */
export function mapPull(ctx: SyncContext, repo: RepoRef, p: GhPull) {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'task',
    sourceId: String(p.id),
    containerId: repoContainer(ctx, repo),
    now: ctx.now,
    title: p.title,
    url: p.html_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    body: truncate(p.body, 500),
    status: p.draft ? 'draft' : p.state,
    author: p.user?.login ?? null,
    timestamp: p.created_at,
    labels: (p.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
    metadata: {
      number: p.number,
      isPullRequest: true,
      draft: p.draft ?? false,
      reviewers: (p.requested_reviewers ?? []).length,
      repository: `${repo.owner}/${repo.name}`,
    },
  });
}

/** Release → activity (release health), linked to its repo. */
export function mapRelease(ctx: SyncContext, repo: RepoRef, r: GhRelease) {
  const when = r.published_at ?? r.created_at;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'activity',
    sourceId: String(r.id),
    containerId: repoContainer(ctx, repo),
    now: ctx.now,
    title: r.name || r.tag_name || '(release)',
    url: r.html_url,
    createdAt: r.created_at,
    updatedAt: when,
    body: truncate(r.body, 500),
    status: r.draft ? 'draft' : r.prerelease ? 'prerelease' : 'released',
    author: r.author?.login ?? null,
    timestamp: when,
    labels: r.tag_name ? [r.tag_name] : [],
    metadata: {
      activityKind: 'release',
      tag: r.tag_name,
      draft: r.draft,
      prerelease: r.prerelease,
      repository: `${repo.owner}/${repo.name}`,
      publishedAt: r.published_at ?? null,
    },
  });
}

/** Recent CI workflow run → activity (CI health). Conclusion drives pass/fail signal. */
export function mapCiRun(ctx: SyncContext, repo: RepoRef, run: GhWorkflowRun) {
  const wf = run.name || 'workflow';
  const branch = run.head_branch || '(unknown)';
  const outcome = run.conclusion ?? run.status ?? 'unknown';
  const when = run.run_started_at ?? run.created_at;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'activity',
    sourceId: `run-${run.id}`, // prefixed so it never collides with a release id
    containerId: repoContainer(ctx, repo),
    now: ctx.now,
    title: `${wf} ${outcome} on ${branch}`,
    url: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    status: outcome,
    author: null,
    timestamp: when,
    labels: [branch],
    metadata: {
      activityKind: 'ci_run',
      workflow: wf,
      branch,
      conclusion: run.conclusion ?? null,
      runStatus: run.status ?? null,
      event: run.event,
      runNumber: run.run_number,
      repository: `${repo.owner}/${repo.name}`,
    },
  });
}

function nextRes(res: DeepRes): DeepRes | null {
  if (res === 'issues') return 'prs';
  if (res === 'prs') return 'releases';
  if (res === 'releases') return 'ci';
  return null; // ci is the last resource for a repo
}

/** Pure cursor transition for the deep phase. Exported for unit tests. */
export function advanceDeep(
  active: RepoRef[],
  i: number,
  res: DeepRes,
  resPage: number,
  moreResPages: boolean,
): string | null {
  if (moreResPages && resPage < MAX_DEEP_PAGES) {
    const c: RepoDataCursor = { phase: 'deep', active, i, res, resPage: resPage + 1 };
    return toJsonCursor(c);
  }
  const nr = nextRes(res);
  if (nr) {
    const c: RepoDataCursor = { phase: 'deep', active, i, res: nr, resPage: 1 };
    return toJsonCursor(c);
  }
  if (i + 1 < active.length) {
    const c: RepoDataCursor = { phase: 'deep', active, i: i + 1, res: 'issues', resPage: 1 };
    return toJsonCursor(c);
  }
  return null;
}

/**
 * `repo_data` resource — a self-contained two-phase state machine over one cursor:
 *   LIST  — page /user/repos, keep the active ones (emits no entities)
 *   DEEP  — for each active repo, walk open issues → open PRs → releases
 * A single repo/resource that 404s or errors is skipped, never failing the run.
 */
async function pullRepoData(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<RepoDataCursor>(ctx.cursor) ?? { phase: 'list', reposPage: 1, active: [] };

  if (c.phase === 'list') {
    const page = c.reposPage ?? 1;
    const active = c.active ?? [];
    const resp = await ctx.http
      .getJson<GhRepo[]>(`${GH}/user/repos`, {
        query: {
          per_page: 100,
          page,
          sort: 'pushed',
          direction: 'desc',
          affiliation: 'owner,collaborator,organization_member',
        },
      })
      .catch(() => null);
    if (!resp) return { entities: [], cursor: null, hasMore: false };
    for (const r of resp.data ?? []) {
      if (active.length >= MAX_ACTIVE_REPOS) break;
      if (isActiveRepo(r, ctx.now)) active.push(repoRefOf(r));
    }
    const moreRepoPages = hasNextLink(resp.headers['link']) && active.length < MAX_ACTIVE_REPOS;
    if (moreRepoPages) {
      const next: RepoDataCursor = { phase: 'list', reposPage: page + 1, active };
      return { entities: [], cursor: toJsonCursor(next), hasMore: true };
    }
    if (active.length === 0) return { entities: [], cursor: null, hasMore: false };
    const next: RepoDataCursor = { phase: 'deep', active, i: 0, res: 'issues', resPage: 1 };
    return { entities: [], cursor: toJsonCursor(next), hasMore: true };
  }

  // deep phase
  const active = c.active ?? [];
  const i = c.i ?? 0;
  const repo = active[i];
  if (!repo) return { entities: [], cursor: null, hasMore: false };
  const res = c.res ?? 'issues';
  const resPage = c.resPage ?? 1;

  let entities: SyncPage['entities'] = [];
  let moreResPages = false;
  try {
    if (res === 'issues') {
      const resp = await ctx.http.getJson<GhIssue[]>(`${GH}/repos/${repo.owner}/${repo.name}/issues`, {
        query: { state: 'open', per_page: 100, page: resPage, sort: 'updated', direction: 'desc' },
      });
      // The issues endpoint also lists PRs; take PRs from /pulls (different ids) to avoid dupes.
      entities = (resp.data ?? [])
        .filter((it) => it.pull_request == null)
        .map((it) => mapRepoIssue(ctx, repo, it));
      moreResPages = hasNextLink(resp.headers['link']);
    } else if (res === 'prs') {
      const resp = await ctx.http.getJson<GhPull[]>(`${GH}/repos/${repo.owner}/${repo.name}/pulls`, {
        query: { state: 'open', per_page: 100, page: resPage, sort: 'updated', direction: 'desc' },
      });
      entities = (resp.data ?? []).map((p) => mapPull(ctx, repo, p));
      moreResPages = hasNextLink(resp.headers['link']);
    } else if (res === 'releases') {
      const resp = await ctx.http.getJson<GhRelease[]>(`${GH}/repos/${repo.owner}/${repo.name}/releases`, {
        query: { per_page: 30, page: resPage },
      });
      entities = (resp.data ?? []).map((r) => mapRelease(ctx, repo, r));
      moreResPages = hasNextLink(resp.headers['link']);
    } else {
      // CI: only the most recent page of runs — enough for a health signal, bounded cost.
      const resp = await ctx.http.getJson<GhWorkflowRunsResponse>(
        `${GH}/repos/${repo.owner}/${repo.name}/actions/runs`,
        { query: { per_page: 50, page: resPage } },
      );
      entities = (resp.data?.workflow_runs ?? []).map((run) => mapCiRun(ctx, repo, run));
      moreResPages = false; // don't walk deep CI history; the latest page is the signal
    }
  } catch {
    // One repo/resource failing (deleted, archived, permissions) must not fail the whole sync.
    entities = [];
    moreResPages = false;
  }

  const cursor = advanceDeep(active, i, res, resPage, moreResPages);
  return { entities, cursor, hasMore: cursor != null };
}

export const githubAdapter: ConnectorAdapter = {
  connectorId: 'github',
  baseHeaders: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  resources: [
    { id: 'repos', label: 'Repositories', kind: 'project', pull: pullRepos },
    { id: 'repo_data', label: 'Issues, PRs & releases (active repos)', kind: 'task', pull: pullRepoData },
    { id: 'notifications', label: 'Notifications', kind: 'notification', pull: pullNotifications },
  ],
};
