/**
 * The GitHub connector FAMILY (P5 — Increment 5).
 *
 * ONE connector (`github`) — one OAuth, one refresh, one vault record, one card, one health engine,
 * one inspector — with each GitHub service mounted as an `AdapterResource` on the SAME authenticated
 * session. This mirrors, exactly, how `microsoft-entra` hosts `m365Resources` and `google-workspace`
 * hosts its service resources. Every resource is wrapped in the shared `graceful()` guard, so a service
 * the user didn't grant (missing scope → 403) or that isn't provisioned (404) degrades to a tagged empty
 * page instead of failing the whole family.
 *
 * Service resources → UDM:
 *   repos          → project                    (full list, ETag conditional; the store dedups)
 *   repo_data      → task + activity            (per ACTIVE repo: open issues, open PRs, recent
 *                                                releases, recent workflow runs — a two-phase engine)
 *   organizations  → organization               (the viewer's orgs, ETag conditional)
 *   teams          → organization (githubKind:team, linked to its org)
 *   notifications  → notification               (incremental via ?since=)
 *
 * Cursor encoding is opaque to the engine: list resources use a page + ETag validator (see
 * `pullEtagList`); notifications carry a high-water `updated_at`; `repo_data` carries its own two-phase
 * (list → deep) state machine (see RepoDataCursor / pullRepoData).
 *
 * Capability discovery is runtime-driven: `githubServiceAvailability(grantedScopes)` projects the
 * `GITHUB_SERVICES` catalog against the scopes GitHub actually granted (✓/✗), consumed by the
 * Enterprise Connector Center. Nothing is hardcoded in the UI.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { hasNextLink, maxIso, parseJsonCursor, toJsonCursor, truncate } from './util';
import { conditionalGet, graceful } from './delta';
import { makeUnifiedId } from '../../ids';

/**
 * The GitHub REST API base. Defaults to github.com; overridable via `NEUROPAUSE_GITHUB_API_BASE`
 * so the SAME adapter can point at a GitHub Enterprise Server instance (e.g.
 * `https://ghe.example.com/api/v3`) — the data-plane half of Enterprise Server support (the auth-plane
 * OAuth host is a manifest concern). Mirrors the env-driven `ENTRA_TENANT` authority precedent.
 */
const GH = (process.env.NEUROPAUSE_GITHUB_API_BASE ?? '').trim().replace(/\/+$/, '') || 'https://api.github.com';

/**
 * GitHub's org/team LIST endpoints carry no source timestamps. Using the run clock (`ctx.now`) for an
 * org/team `updatedAt` would re-classify every unchanged row as "updated" on every poll whenever the
 * list is re-walked (a 100+ item list stores no ETag validator) — churning update events, search
 * re-indexing, and `since` time-window queries. A STABLE baseline instead lets the unified store treat
 * re-syncs as no-ops via its equal-timestamp content-signature check, while a real rename / description
 * change still propagates (the signature differs → the store updates and emits). Recency ordering is not
 * meaningful for these stable container entities, so a fixed sentinel is the honest, churn-free choice.
 */
const GH_LIST_STABLE_TS = '1970-01-01T00:00:00.000Z';

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

interface GhOrg {
  id: number;
  login: string;
  url: string;
  html_url?: string | null;
  description: string | null;
  name?: string | null;
}

interface GhTeam {
  id: number;
  name: string;
  slug: string;
  privacy?: string | null;
  permission?: string | null;
  html_url?: string | null;
  description?: string | null;
  organization?: { id: number; login: string } | null;
}

interface ReposCursor {
  page?: number;
  /** ETag of page 1 from the last completed walk; sent as If-None-Match to skip an unchanged list. */
  etag?: string | null;
  /** ETag captured on page 1 of the CURRENT walk; promoted to `etag` when the walk finishes. */
  pendingEtag?: string | null;
}

const REPOS_PER_PAGE = 100;
const REPOS_QUERY = {
  per_page: REPOS_PER_PAGE,
  sort: 'updated',
  direction: 'desc',
  affiliation: 'owner,collaborator,organization_member',
} as const;

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

/** GitHub organization → organization entity. */
export function mapOrg(ctx: SyncContext, o: GhOrg) {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'organization',
    sourceId: String(o.id),
    now: ctx.now,
    title: o.name || o.login,
    url: o.html_url ?? `https://github.com/${o.login}`,
    // No source timestamp on /user/orgs → a stable baseline avoids re-sync churn (see GH_LIST_STABLE_TS).
    createdAt: GH_LIST_STABLE_TS,
    updatedAt: GH_LIST_STABLE_TS,
    body: truncate(o.description, 300),
    status: 'active',
    author: o.login,
    metadata: {
      githubKind: 'organization',
      login: o.login,
      description: o.description ?? null,
    },
  });
}

/**
 * GitHub team → organization entity (a sub-org), linked to its parent org via `containerId`. The
 * source id is prefixed `team-` so a team id can never collide with an org id under the shared
 * `organization` kind.
 */
export function mapTeam(ctx: SyncContext, t: GhTeam) {
  const org = t.organization?.login ?? null;
  const containerId = t.organization
    ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'organization', String(t.organization.id))
    : null;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'organization',
    sourceId: `team-${t.id}`,
    containerId,
    now: ctx.now,
    title: t.name,
    url: t.html_url ?? (org ? `https://github.com/orgs/${org}/teams/${t.slug}` : null),
    // No source timestamp on /user/teams → a stable baseline avoids re-sync churn (see GH_LIST_STABLE_TS).
    createdAt: GH_LIST_STABLE_TS,
    updatedAt: GH_LIST_STABLE_TS,
    body: truncate(t.description ?? null, 300),
    status: t.privacy ?? 'visible',
    author: org,
    metadata: {
      githubKind: 'team',
      slug: t.slug,
      privacy: t.privacy ?? null,
      permission: t.permission ?? null,
      organization: org,
    },
  });
}

/**
 * Next repos cursor. While there are more pages, keep the page-1 validator pending. At the end of a walk,
 * persist the ETag ONLY when the list fit on a single, NON-FULL page (`pageCount < REPOS_PER_PAGE`).
 * A non-full page proves the WHOLE collection is on page 1 with room to spare, so any repo added later —
 * even an old one that sorts far down under `sort=updated` — must alter page 1's body and force a 200;
 * a later page-1 `304` therefore provably means nothing changed. A FULL page (== per_page) might hide a
 * newly-born page 2 that a page-1 304 cannot witness, so it stores no validator and re-walks next time.
 * Multi-page walks likewise store nothing. This is what makes the conditional skip lossless.
 */
function nextReposCursor(page: number, more: boolean, pendingEtag: string | null, pageCount: number): string {
  if (more) return toJsonCursor({ page: page + 1, pendingEtag });
  const safelyComplete = page === 1 && pageCount < REPOS_PER_PAGE;
  return toJsonCursor(safelyComplete && pendingEtag ? { etag: pendingEtag } : {});
}

async function pullRepos(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<ReposCursor>(ctx.cursor) ?? {};
  const page = c.page ?? 1;

  // A stored `etag` is only ever written for a single, NON-FULL page (see nextReposCursor), so a page-1
  // `304` provably means the whole list is unchanged → skip for ZERO primary-rate-limit cost (GitHub's
  // recommended polling pattern). Full or multi-page lists carry no validator and re-walk fully.
  if (page === 1 && c.etag) {
    const cond = await conditionalGet<GhRepo[]>(ctx.http, `${GH}/user/repos`, c.etag, {
      query: { ...REPOS_QUERY, page },
    });
    if (cond.notModified) return { entities: [], cursor: toJsonCursor({ etag: c.etag }), hasMore: false };
    const rows = cond.data ?? [];
    const more = hasNextLink(cond.headers['link']);
    return { entities: rows.map((r) => mapRepo(ctx, r)), cursor: nextReposCursor(page, more, cond.etag, rows.length), hasMore: more };
  }

  const resp = await ctx.http.getJson<GhRepo[]>(`${GH}/user/repos`, { query: { ...REPOS_QUERY, page } });
  const rows = resp.data ?? [];
  const more = hasNextLink(resp.headers['link']);
  // page 1 with no prior validator = first-ever sync: capture the head ETag so a single non-full page can skip next time.
  const pendingEtag = page === 1 ? (resp.headers['etag'] ?? null) : (c.pendingEtag ?? null);
  return { entities: rows.map((r) => mapRepo(ctx, r)), cursor: nextReposCursor(page, more, pendingEtag, rows.length), hasMore: more };
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

/* ── Organizations & Teams (ETag-conditional lists) ─────────────────────────── */

const LIST_PER_PAGE = 100;

interface EtagListCursor {
  page?: number;
  etag?: string | null;
  pendingEtag?: string | null;
}

/**
 * Next cursor for an ETag-conditional list — the SAME lossless-skip rule as `nextReposCursor`: persist
 * a page-1 validator ONLY when the whole list fit on a single, non-full page, so a later page-1 `304`
 * provably means nothing changed. Full or multi-page lists store no validator and re-walk next time.
 */
function nextEtagListCursor(page: number, more: boolean, pendingEtag: string | null, pageCount: number): string {
  if (more) return toJsonCursor({ page: page + 1, pendingEtag });
  const safelyComplete = page === 1 && pageCount < LIST_PER_PAGE;
  return toJsonCursor(safelyComplete && pendingEtag ? { etag: pendingEtag } : {});
}

/**
 * Generic ETag-conditional, Link-paginated list pull → entities. Reuses the incremental-sync foundation
 * (`conditionalGet`) with the proven `pullRepos` lossless-skip semantics, so the organizations and teams
 * services poll cheaply: an unchanged list returns 304 at zero primary-rate-limit cost.
 */
async function pullEtagList<T>(
  ctx: SyncContext,
  url: string,
  map: (ctx: SyncContext, row: T) => UnifiedEntity,
): Promise<SyncPage> {
  const c = parseJsonCursor<EtagListCursor>(ctx.cursor) ?? {};
  const page = c.page ?? 1;
  const query = { per_page: LIST_PER_PAGE, page };

  if (page === 1 && c.etag) {
    const cond = await conditionalGet<T[]>(ctx.http, url, c.etag, { query });
    if (cond.notModified) return { entities: [], cursor: toJsonCursor({ etag: c.etag }), hasMore: false };
    const rows = cond.data ?? [];
    const more = hasNextLink(cond.headers['link']);
    return { entities: rows.map((r) => map(ctx, r)), cursor: nextEtagListCursor(page, more, cond.etag, rows.length), hasMore: more };
  }

  const resp = await ctx.http.getJson<T[]>(url, { query });
  const rows = resp.data ?? [];
  const more = hasNextLink(resp.headers['link']);
  const pendingEtag = page === 1 ? (resp.headers['etag'] ?? null) : (c.pendingEtag ?? null);
  return { entities: rows.map((r) => map(ctx, r)), cursor: nextEtagListCursor(page, more, pendingEtag, rows.length), hasMore: more };
}

/** Organizations the viewer belongs to (`GET /user/orgs`). */
function pullOrganizations(ctx: SyncContext): Promise<SyncPage> {
  return pullEtagList<GhOrg>(ctx, `${GH}/user/orgs`, mapOrg);
}

/** Teams the viewer belongs to across all orgs (`GET /user/teams`). */
function pullTeams(ctx: SyncContext): Promise<SyncPage> {
  return pullEtagList<GhTeam>(ctx, `${GH}/user/teams`, mapTeam);
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

const GITHUB_REASONS = {
  unauthorized: 'Service not authorized — this GitHub scope was not granted, or the resource is SSO-restricted (403)',
  unprovisioned: 'Resource not available for this GitHub account (404)',
} as const;

/** Wrap a service resource so one unavailable service degrades instead of failing the whole family. */
function serviceResource(r: AdapterResource): AdapterResource {
  return { ...r, pull: graceful(r.pull, GITHUB_REASONS) };
}

const githubResources: AdapterResource[] = [
  { id: 'repos', label: 'Repositories', kind: 'project', pull: pullRepos },
  { id: 'repo_data', label: 'Issues, PRs, Actions & releases (active repos)', kind: 'task', pull: pullRepoData },
  { id: 'organizations', label: 'Organizations', kind: 'organization', pull: pullOrganizations },
  { id: 'teams', label: 'Teams', kind: 'organization', pull: pullTeams },
  { id: 'notifications', label: 'Notifications', kind: 'notification', pull: pullNotifications },
];

export const githubAdapter: ConnectorAdapter = {
  connectorId: 'github',
  baseHeaders: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  resources: githubResources.map(serviceResource),
};

/* ── Runtime capability discovery ─────────────────────────────────────────────────────────── */

/** A GitHub Workspace service and the OAuth scope that unlocks it. */
export interface GitHubService {
  id: string;
  label: string;
  /** The GitHub OAuth scope granting this service. */
  scope: string;
  /** How this service syncs (informational). */
  sync: string;
}

/**
 * The service catalog — the runtime source of truth for capability discovery. Consumed by the
 * Enterprise Connector Center so the UI hardcodes no service list. Several services ride the single
 * `repo` scope (issues/PRs/Actions/releases sync through the `repo_data` engine); the entities they
 * produce are fully synced even though those services carry no independent per-service object count
 * (exactly as Google's Docs/Sheets/Slides ride the Drive scope).
 */
export const GITHUB_SERVICES: GitHubService[] = [
  { id: 'repos', label: 'Repositories', scope: 'repo', sync: 'ETag conditional' },
  { id: 'issues', label: 'Issues', scope: 'repo', sync: 'Active-repo walk' },
  { id: 'pull_requests', label: 'Pull Requests', scope: 'repo', sync: 'Active-repo walk' },
  { id: 'actions', label: 'Actions', scope: 'repo', sync: 'Workflow runs' },
  { id: 'releases', label: 'Releases', scope: 'repo', sync: 'Active-repo walk' },
  { id: 'organizations', label: 'Organizations', scope: 'read:org', sync: 'ETag conditional' },
  { id: 'teams', label: 'Teams', scope: 'read:org', sync: 'Membership list' },
  { id: 'notifications', label: 'Notifications', scope: 'notifications', sync: 'Since cursor' },
];

/** A service plus whether the connected account actually granted its scope. */
export interface GitHubServiceStatus extends GitHubService {
  available: boolean;
}

/**
 * Runtime capability discovery: which services are available given the scopes GitHub actually granted
 * (`ConnectedAccount.grantedScopes`). Pure — the Enterprise Connector Center renders exactly this (✓/✗);
 * nothing is hardcoded. Mirrors `googleServiceAvailability`.
 */
export function githubServiceAvailability(grantedScopes: readonly string[]): GitHubServiceStatus[] {
  const granted = new Set(grantedScopes);
  return GITHUB_SERVICES.map((s) => ({ ...s, available: granted.has(s.scope) }));
}
