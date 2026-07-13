/**
 * The Atlassian connector FAMILY (P5 — Increment 7) — Jira Cloud + Confluence Cloud.
 *
 * ONE connector (`atlassian`) — one OAuth 2.0 (3LO) app, one token, one vault record, one card, one
 * health engine, one inspector — with each Jira/Confluence service mounted as an `AdapterResource` on
 * the SAME authenticated session. This mirrors, exactly, how `microsoft-entra` hosts `m365Resources`,
 * `google-workspace` / `github` / `slack` host their families. Every resource is wrapped in the shared
 * `graceful()` guard, so a service the user didn't scope (403) or that isn't provisioned — e.g. the Jira
 * Software agile API on a Jira-Core-only site (404/403) — degrades to a tagged empty page instead of
 * failing the whole family.
 *
 * The Atlassian Cloud wrinkle: API calls do NOT go to a fixed host. After OAuth, the adapter resolves the
 * site's `cloudId` (+ base URL) once via `GET https://api.atlassian.com/oauth/token/accessible-resources`,
 * then every Jira call goes to `.../ex/jira/{cloudId}/rest/...` and every Confluence call to
 * `.../ex/confluence/{cloudId}/wiki/...`. The shared `HttpClient` bearers any absolute URL (no host
 * allowlist — the microsoft-entra connector already does the same token-host≠API-host dance), and the
 * resolved site is cached in each resource's opaque cursor. No engine change.
 *
 * Service resources → UDM:
 *   jira_projects     → project    (offset list)
 *   jira_issues       → task        (JQL, newest-first, stop-at-baseline `updated` high-water)
 *   jira_boards       → project (agile board list; graceful — degrades on Jira-Core-only sites)
 *   confluence_spaces → workspace   (cursor list)
 *   confluence_pages  → document    (newest-first by modified-date, stop-at-baseline high-water)
 *
 * Atlassian returns real HTTP status codes (401/403/404/429), so — unlike Slack — no `{ok:false}` shim is
 * needed: the transport maps them into the taxonomy and `graceful` degrades on 403/404. Capability
 * discovery is runtime-driven: `atlassianServiceAvailability(grantedScopes)` projects the
 * `ATLASSIAN_SERVICES` catalog against the granted scopes (✓/✗), consumed by the Enterprise Connector
 * Center. Nothing in the UI is hardcoded.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { HttpError } from '../http';
import { graceful } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

const ATLASSIAN = 'https://api.atlassian.com';
const PAGE = 50;
/** Bound one run's page walk (the JQL/cursor resumes the rest on the next run — never leapfrogged). */
const MAX_PAGES = 20;
const ISSUE_FIELDS = 'summary,status,updated,created,assignee,reporter,priority,issuetype,project,labels,parent';
/**
 * Stable baseline for entities with no source timestamp (projects/boards/spaces — full-walked each run).
 * Using the run clock there would re-classify every row as "updated" on every sync (the churn the GitHub
 * org/team + Slack user mappers already fixed); the store still detects a real change via its
 * equal-timestamp content-signature check.
 */
const ATLASSIAN_STABLE_TS = '1970-01-01T00:00:00.000Z';

/** Normalize any timestamp string to a clean ISO-Z, or a fallback when absent/invalid. */
function iso(ts: string | null | undefined, fallback: string): string {
  if (!ts) return fallback;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

/**
 * Format a Jira `updated` timestamp for a JQL `updated >= "..."` filter. Jira returns timestamps in the
 * token owner's timezone AND interprets naked JQL date strings in that SAME timezone, so we use the raw
 * wall-clock (date + HH:mm), NOT a UTC conversion — keeping the filter and the data tz-consistent so the
 * incremental boundary never drifts. Minute precision means the boundary minute is re-scanned (the store
 * dedups); an unparseable value falls back to the raw string.
 */
function jqlDate(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  return m ? `${m[1]} ${m[2]}` : raw;
}

/* ── Cloud-site resolution (cached in each resource's cursor) ─────────────────── */

interface Site {
  cloud: string;
  url: string;
}
interface AccessibleResource {
  id: string;
  name?: string;
  url?: string;
  scopes?: string[];
}

/**
 * Resolve the connected site's `cloudId` + base URL, once, via accessible-resources. Cached in the
 * cursor so it's one extra call per resource per fresh sync. Uses the first accessible site (a
 * single-site model; multi-site is a documented follow-on).
 */
async function resolveSite(ctx: SyncContext, cached?: Site): Promise<Site> {
  if (cached?.cloud) return cached;
  const resp = await ctx.http.getJson<AccessibleResource[]>(`${ATLASSIAN}/oauth/token/accessible-resources`);
  const site = (resp.data ?? [])[0];
  if (!site?.id) throw new HttpError(404, 'atlassian: no accessible Jira/Confluence site for this grant', false);
  return { cloud: site.id, url: (site.url ?? '').replace(/\/+$/, '') };
}

const jiraBase = (site: Site): string => `${ATLASSIAN}/ex/jira/${site.cloud}`;
const confluenceBase = (site: Site): string => `${ATLASSIAN}/ex/confluence/${site.cloud}`;

/** Pull the opaque `?cursor=` value out of a Confluence v2 `_links.next` relative URL. */
function nextCursor(next: string | undefined): string | undefined {
  if (!next) return undefined;
  const m = /[?&]cursor=([^&]+)/.exec(next);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface JiraProject {
  id: string;
  key: string;
  name?: string;
  projectTypeKey?: string;
  lead?: { displayName?: string } | null;
  description?: string | null;
}
interface JiraSearchResp<T> {
  values?: T[];
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
}
interface JiraIssue {
  id: string;
  key: string;
  fields?: {
    summary?: string | null;
    status?: { name?: string } | null;
    updated?: string | null;
    created?: string | null;
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    priority?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    project?: { id?: string; key?: string } | null;
    labels?: string[];
    parent?: { id?: string; key?: string } | null;
  };
}
interface JiraJqlResp {
  issues?: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}
interface JiraBoard {
  id: number;
  name?: string;
  type?: string;
  location?: { projectId?: number; projectKey?: string; projectName?: string } | null;
}
interface ConfluenceSpace {
  id: string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
}
interface ConfluencePage {
  id: string;
  status?: string;
  title?: string;
  spaceId?: string;
  authorId?: string;
  version?: { number?: number; createdAt?: string } | null;
  _links?: { webui?: string } | null;
}
interface ConfluenceListResp<T> {
  results?: T[];
  _links?: { next?: string } | null;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────── */

export function mapProject(ctx: SyncContext, site: Site, p: JiraProject): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'project',
    sourceId: p.id,
    now: ctx.now,
    title: p.name || p.key,
    url: site.url && p.key ? `${site.url}/browse/${p.key}` : null,
    // Project search carries no timestamps → a stable baseline avoids re-sync churn (see ATLASSIAN_STABLE_TS).
    createdAt: ATLASSIAN_STABLE_TS,
    updatedAt: ATLASSIAN_STABLE_TS,
    body: truncate(p.description ?? null, 300),
    status: 'active',
    author: p.lead?.displayName ?? null,
    metadata: {
      atlassianType: 'jira_project',
      key: p.key,
      projectType: p.projectTypeKey ?? null,
      lead: p.lead?.displayName ?? null,
    },
  });
}

export function mapIssue(ctx: SyncContext, site: Site, it: JiraIssue): UnifiedEntity {
  const f = it.fields ?? {};
  const created = iso(f.created, ctx.now);
  const updated = iso(f.updated, created);
  const containerId = f.project?.id ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'project', f.project.id) : null;
  const parentId = f.parent?.id ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'task', f.parent.id) : null;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'task',
    sourceId: it.id,
    now: ctx.now,
    title: f.summary || it.key,
    url: site.url && it.key ? `${site.url}/browse/${it.key}` : null,
    createdAt: created,
    updatedAt: updated,
    status: f.status?.name ?? null,
    author: f.assignee?.displayName ?? f.reporter?.displayName ?? null,
    timestamp: created,
    containerId,
    parentId,
    labels: f.labels ?? [],
    metadata: {
      atlassianType: 'jira_issue',
      key: it.key,
      issueType: f.issuetype?.name ?? null,
      priority: f.priority?.name ?? null,
      assignee: f.assignee?.displayName ?? null,
      reporter: f.reporter?.displayName ?? null,
      project: f.project?.key ?? null,
    },
  });
}

/** Jira board → project (a board is a container/view); `board-` prefix avoids colliding with a project id. */
export function mapBoard(ctx: SyncContext, site: Site, b: JiraBoard): UnifiedEntity {
  const projectId = b.location?.projectId != null ? String(b.location.projectId) : null;
  const containerId = projectId ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'project', projectId) : null;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'project',
    sourceId: `board-${b.id}`,
    now: ctx.now,
    title: b.name || `Board ${b.id}`,
    url: site.url ? `${site.url}/jira/software/boards/${b.id}` : null,
    // No source timestamp → a stable baseline avoids re-sync churn (see ATLASSIAN_STABLE_TS).
    createdAt: ATLASSIAN_STABLE_TS,
    updatedAt: ATLASSIAN_STABLE_TS,
    status: 'active',
    containerId,
    metadata: {
      atlassianType: 'jira_board',
      boardType: b.type ?? null,
      project: b.location?.projectKey ?? null,
    },
  });
}

export function mapSpace(ctx: SyncContext, site: Site, s: ConfluenceSpace): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'workspace',
    sourceId: s.id,
    now: ctx.now,
    title: s.name || s.key || s.id,
    url: site.url && s.key ? `${site.url}/wiki/spaces/${s.key}` : null,
    // Space list carries no timestamps → a stable baseline avoids re-sync churn (see ATLASSIAN_STABLE_TS).
    createdAt: ATLASSIAN_STABLE_TS,
    updatedAt: ATLASSIAN_STABLE_TS,
    status: s.status ?? 'active',
    metadata: {
      atlassianType: 'confluence_space',
      key: s.key ?? null,
      spaceType: s.type ?? null,
    },
  });
}

export function mapPage(ctx: SyncContext, site: Site, p: ConfluencePage): UnifiedEntity {
  const modified = iso(p.version?.createdAt, ctx.now);
  const containerId = p.spaceId ? makeUnifiedId(ctx.connectorId, ctx.accountId, 'workspace', p.spaceId) : null;
  return makeEntity({
    connectorId: ctx.connectorId,
    accountId: ctx.accountId,
    kind: 'document',
    sourceId: p.id,
    now: ctx.now,
    title: p.title || p.id,
    url: site.url && p._links?.webui ? `${site.url}/wiki${p._links.webui}` : null,
    createdAt: modified,
    updatedAt: modified,
    status: p.status ?? 'current',
    author: p.authorId ?? null,
    timestamp: modified,
    containerId,
    metadata: {
      atlassianType: 'confluence_page',
      spaceId: p.spaceId ?? null,
      version: p.version?.number ?? null,
    },
  });
}

/* ── Pulls ───────────────────────────────────────────────────────────────────── */

interface OffsetCursor {
  site?: Site;
  startAt?: number;
}

async function pullProjects(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<OffsetCursor>(ctx.cursor) ?? {};
  const site = await resolveSite(ctx, c.site);
  const startAt = c.startAt ?? 0;
  const resp = await ctx.http.getJson<JiraSearchResp<JiraProject>>(`${jiraBase(site)}/rest/api/3/project/search`, {
    query: { startAt, maxResults: PAGE },
  });
  const values = resp.data.values ?? [];
  const more = resp.data.isLast === false && values.length > 0;
  const cursor = more ? toJsonCursor({ site, startAt: startAt + values.length }) : toJsonCursor({ site });
  return { entities: values.map((p) => mapProject(ctx, site, p)), cursor, hasMore: more };
}

async function pullBoards(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<OffsetCursor>(ctx.cursor) ?? {};
  const site = await resolveSite(ctx, c.site);
  const startAt = c.startAt ?? 0;
  const resp = await ctx.http.getJson<JiraSearchResp<JiraBoard>>(`${jiraBase(site)}/rest/agile/1.0/board`, {
    query: { startAt, maxResults: PAGE },
  });
  const values = resp.data.values ?? [];
  const more = resp.data.isLast === false && values.length > 0;
  const cursor = more ? toJsonCursor({ site, startAt: startAt + values.length }) : toJsonCursor({ site });
  return { entities: values.map((b) => mapBoard(ctx, site, b)), cursor, hasMore: more };
}

interface IssuesCursor {
  site?: Site;
  hw?: string;
  token?: string;
  pending?: string;
  page?: number;
}

async function pullIssues(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<IssuesCursor>(ctx.cursor) ?? {};
  const site = await resolveSite(ctx, c.site);
  const page = c.page ?? 0;
  // ASCENDING by `updated`, filtered server-side to `updated >= high-water`. This resumes forward across
  // runs via the high-water (NOT a fragile page token), so a large backfill is walked in `updated` order
  // without ever leapfrogging: a MAX_PAGES cap simply commits the newest-synced ts, and the next run's
  // JQL picks up from exactly there. (A newest-first walk with a single high-water cannot bound a
  // backfill without silently dropping the issues beyond the page cap.)
  const jql = c.hw ? `updated >= "${jqlDate(c.hw)}" ORDER BY updated ASC` : 'ORDER BY updated ASC';
  const resp = await ctx.http.getJson<JiraJqlResp>(`${jiraBase(site)}/rest/api/3/search/jql`, {
    query: { jql, maxResults: PAGE, nextPageToken: c.token ?? undefined, fields: ISSUE_FIELDS },
  });
  const issues = resp.data.issues ?? [];
  // Advance the high-water to the newest `updated` seen this walk (ASC → the newest is the last row).
  let pending = c.pending ?? c.hw;
  for (const it of issues) {
    const u = it.fields?.updated;
    if (u && (!pending || Date.parse(u) > Date.parse(pending))) pending = u;
  }
  const token = resp.data.nextPageToken;
  const more = !!token && issues.length > 0 && page + 1 < MAX_PAGES;
  const cursor = more
    ? toJsonCursor({ site, hw: c.hw, token, pending, page: page + 1 })
    : toJsonCursor({ site, hw: pending });
  return { entities: issues.map((it) => mapIssue(ctx, site, it)), cursor, hasMore: more };
}

interface CursorState {
  site?: Site;
  next?: string;
}

async function pullSpaces(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<CursorState>(ctx.cursor) ?? {};
  const site = await resolveSite(ctx, c.site);
  const resp = await ctx.http.getJson<ConfluenceListResp<ConfluenceSpace>>(`${confluenceBase(site)}/wiki/api/v2/spaces`, {
    query: { limit: PAGE, cursor: c.next ?? undefined },
  });
  const results = resp.data.results ?? [];
  const next = nextCursor(resp.data._links?.next ?? undefined);
  const more = !!next && results.length > 0;
  const cursor = more ? toJsonCursor({ site, next }) : toJsonCursor({ site });
  return { entities: results.map((s) => mapSpace(ctx, site, s)), cursor, hasMore: more };
}

interface PagesCursor {
  site?: Site;
  hw?: string;
  next?: string;
  pending?: string;
  page?: number;
}

async function pullPages(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<PagesCursor>(ctx.cursor) ?? {};
  const site = await resolveSite(ctx, c.site);
  const page = c.page ?? 0;
  const resp = await ctx.http.getJson<ConfluenceListResp<ConfluencePage>>(`${confluenceBase(site)}/wiki/api/v2/pages`, {
    query: { limit: PAGE, sort: '-modified-date', cursor: c.next ?? undefined },
  });
  const results = resp.data.results ?? [];

  // Newest-first by modified date; stop STRICTLY below the baseline high-water (a same-ms page at the
  // boundary is re-emitted, not skipped — the store dedups by id), then commit the newest on drain.
  // Confluence v2 has no server-side modified filter, so on a first sync only the newest ~MAX_PAGES×PAGE
  // pages are captured; every NEW/edited page is caught incrementally. Deeper backfill is a follow-on.
  const hwMs = c.hw ? Date.parse(c.hw) : null;
  const fresh: ConfluencePage[] = [];
  let reachedBaseline = false;
  for (const p of results) {
    const m = p.version?.createdAt;
    if (hwMs != null && m && Date.parse(m) < hwMs) {
      reachedBaseline = true;
      break;
    }
    fresh.push(p);
  }
  let pending = c.pending;
  const newest = results[0]?.version?.createdAt ?? null;
  if (newest && (!pending || Date.parse(newest) > Date.parse(pending))) pending = newest;

  const next = nextCursor(resp.data._links?.next ?? undefined);
  const more = !reachedBaseline && !!next && results.length > 0 && page + 1 < MAX_PAGES;
  const cursor = more
    ? toJsonCursor({ site, hw: c.hw, next, pending, page: page + 1 })
    : toJsonCursor({ site, hw: pending ?? c.hw });
  return { entities: fresh.map((p) => mapPage(ctx, site, p)), cursor, hasMore: more };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const ATLASSIAN_REASONS = {
  unauthorized: 'Service not authorized — this Atlassian scope was not granted for the site (403)',
  unprovisioned: 'Resource not available for this Atlassian site — e.g. Jira Software agile is not enabled (404)',
} as const;

/** Wrap a service resource so one unavailable service degrades instead of failing the whole family. */
function serviceResource(r: AdapterResource): AdapterResource {
  return { ...r, pull: graceful(r.pull, ATLASSIAN_REASONS) };
}

const atlassianResources: AdapterResource[] = [
  { id: 'jira_projects', label: 'Jira Projects', kind: 'project', pull: pullProjects },
  { id: 'jira_issues', label: 'Jira Issues', kind: 'task', pull: pullIssues },
  { id: 'jira_boards', label: 'Jira Boards', kind: 'project', pull: pullBoards },
  { id: 'confluence_spaces', label: 'Confluence Spaces', kind: 'workspace', pull: pullSpaces },
  { id: 'confluence_pages', label: 'Confluence Pages', kind: 'document', pull: pullPages },
];

export const atlassianAdapter: ConnectorAdapter = {
  connectorId: 'atlassian',
  baseHeaders: { Accept: 'application/json' },
  resources: atlassianResources.map(serviceResource),
};

/* ── Runtime capability discovery ─────────────────────────────────────────────── */

/** An Atlassian service and the OAuth scope that unlocks it. */
export interface AtlassianService {
  id: string;
  label: string;
  /** The Atlassian OAuth scope granting this service. */
  scope: string;
  /** How this service syncs (informational). */
  sync: string;
}

/**
 * The service catalog — the runtime source of truth for capability discovery. Consumed by the Enterprise
 * Connector Center so the UI hardcodes no service list. Each id matches its `AdapterResource.id`, so the
 * Center shows a live object count per service. Mirrors `GITHUB_SERVICES` / `SLACK_SERVICES`.
 */
export const ATLASSIAN_SERVICES: AtlassianService[] = [
  { id: 'jira_projects', label: 'Jira Projects', scope: 'read:jira-work', sync: 'Offset list' },
  { id: 'jira_issues', label: 'Jira Issues', scope: 'read:jira-work', sync: 'JQL updated high-water' },
  { id: 'jira_boards', label: 'Jira Boards', scope: 'read:jira-work', sync: 'Agile board list' },
  { id: 'confluence_spaces', label: 'Confluence Spaces', scope: 'read:confluence-space.summary', sync: 'Cursor list' },
  { id: 'confluence_pages', label: 'Confluence Pages', scope: 'read:confluence-content.all', sync: 'Modified high-water' },
];

/** A service plus whether the connected site actually granted its scope. */
export interface AtlassianServiceStatus extends AtlassianService {
  available: boolean;
}

/**
 * Runtime capability discovery: which services are available given the scopes Atlassian actually granted
 * (`ConnectedAccount.grantedScopes`). Pure — the Enterprise Connector Center renders exactly this (✓/✗);
 * nothing is hardcoded. Mirrors `githubServiceAvailability` / `slackServiceAvailability`.
 */
export function atlassianServiceAvailability(grantedScopes: readonly string[]): AtlassianServiceStatus[] {
  const granted = new Set(grantedScopes);
  return ATLASSIAN_SERVICES.map((s) => ({ ...s, available: granted.has(s.scope) }));
}
