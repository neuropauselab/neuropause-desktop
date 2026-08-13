/**
 * The Slack connector FAMILY (P5 — Increment 6).
 *
 * ONE connector (`slack`) — one OAuth v2 app, one bot token, one vault record, one card, one health
 * engine, one inspector — with each Slack service mounted as an `AdapterResource` on the SAME
 * authenticated session. This mirrors, exactly, how `microsoft-entra` hosts `m365Resources`,
 * `google-workspace` hosts its service resources, and `github` hosts its family. Every resource is
 * wrapped in the shared `graceful()` guard, so a service the user didn't scope (403) or a resource that
 * isn't provisioned (404) degrades to a tagged empty page instead of failing the whole family.
 *
 * Service resources → UDM:
 *   conversations → conversation   (public channels, cursor list)
 *   messages      → message        (per-channel history, per-channel high-water; skips channels the bot
 *                                   can't read so one bad channel never wedges the walk)
 *   users         → contact        (workspace directory, cursor list; deleted members tombstoned)
 *   files         → file           (workspace files, page-based + ts_from high-water)
 *
 * Slack returns HTTP 200 with `{ok:false, error}` on logical failures, so `slackGet` maps those codes
 * into the engine's typed error taxonomy — WITHOUT which `graceful()` (which degrades only on a 403/404
 * `AuthError`/`HttpError`) would re-throw a bare `Error` and fail the whole family. Realtime is handled
 * separately by the Increment-2 Socket Mode inbound runtime, which triggers this same incremental sync.
 *
 * Capability discovery is runtime-driven: `slackServiceAvailability(grantedScopes)` projects the
 * `SLACK_SERVICES` catalog against the bot scopes Slack actually granted (✓/✗), consumed by the
 * Enterprise Connector Center. Nothing in the UI is hardcoded.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { AuthError, HttpError } from '../http';
import { errorStatus, graceful } from './delta';
import { firstLine, parseJsonCursor, slackTsToIso, toJsonCursor, unixToIso } from './util';

const SLACK = 'https://slack.com/api';
const MAX_CHANNELS = 20;
const FILES_PER_PAGE = 100;
/** Bound intra-channel history backfill per drain so one busy channel can't run away (recent-activity focus). */
const MAX_MSG_PAGES = 10;
/**
 * Stable baseline for a member whose `updated` field is absent or 0 (e.g. USLACKBOT, present in every
 * workspace). Using the run clock there would re-classify the row as "updated" on every full re-walk —
 * the churn the GitHub org/team mappers already fixed. The store still detects a real change via its
 * equal-timestamp content-signature check.
 */
const SLACK_STABLE_TS = '1970-01-01T00:00:00.000Z';

/* ── Slack `ok:false` error code → the engine's typed error taxonomy ─────────── */

/** Missing/insufficient scope or token-type → a per-service 403 (graceful → `unauthorized`). */
const SLACK_MISSING_SCOPE = new Set(['missing_scope', 'not_allowed_token_type', 'no_permission', 'restricted_action', 'access_denied', 'ekm_access_denied']);
/** Not-in / not-found → a per-service 404 (graceful → `unprovisioned`). */
const SLACK_NOT_FOUND = new Set(['not_in_channel', 'is_archived', 'channel_not_found', 'user_not_found', 'file_not_found', 'file_deleted', 'not_found']);
/** Token invalid/revoked → connector-wide reauth (must propagate, never per-service degrade). */
const SLACK_REAUTH = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'no_authed_user']);

/** Map a Slack `ok:false` error code into the typed taxonomy so graceful/degrade + reauth work. */
function slackError(code: string): Error {
  if (SLACK_REAUTH.has(code)) return new AuthError(`slack: ${code}`); // no status → connector-wide reauth
  if (SLACK_MISSING_SCOPE.has(code)) return new AuthError(`slack: ${code}`, 403); // → graceful unauthorized
  if (SLACK_NOT_FOUND.has(code)) return new HttpError(404, `slack: ${code}`, false); // → graceful unprovisioned
  if (code === 'ratelimited') return new HttpError(429, `slack: ${code}`, true); // retryable (transport usually maps 429)
  if (code.includes('auth')) return new AuthError(`slack: ${code}`); // unknown auth-ish → reauth
  return new HttpError(502, `slack: ${code}`, false); // other → surfaced, non-retryable
}

async function slackGet<T extends { ok: boolean; error?: string }>(
  ctx: SyncContext,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const resp = await ctx.http.getJson<T>(`${SLACK}/${path}`, { query });
  const data = resp.data;
  if (!data.ok) throw slackError(data.error ?? 'unknown_error');
  return data;
}

/* ── Types ───────────────────────────────────────────────────────────────────── */

interface SlackChannel {
  id: string;
  name?: string;
  created: number;
  is_archived?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  num_members?: number;
  topic?: { value: string };
  purpose?: { value: string };
}

interface SlackListResp {
  ok: boolean;
  error?: string;
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
  subtype?: string;
  edited?: { ts: string };
  reactions?: unknown[];
}

interface SlackHistoryResp {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_admin?: boolean;
  updated?: number;
  tz?: string;
  profile?: { email?: string | null; display_name?: string; title?: string };
}

interface SlackUsersResp {
  ok: boolean;
  error?: string;
  members?: SlackUser[];
  response_metadata?: { next_cursor?: string };
}

interface SlackFile {
  id: string;
  created: number;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  pretty_type?: string;
  user?: string;
  size?: number;
  is_public?: boolean;
  permalink?: string;
  channels?: string[];
}

interface SlackFilesResp {
  ok: boolean;
  error?: string;
  files?: SlackFile[];
  paging?: { count: number; total: number; page: number; pages: number };
}

interface MsgCursor {
  hw: Record<string, string>;
  queue?: string[];
  idx?: number;
  /** Intra-channel history cursor (Slack `next_cursor`) while draining one channel's new-message window. */
  mcur?: string;
  /** Newest ts seen during the current channel drain; committed to `hw` only when the channel finishes. */
  pending?: string;
  /** Intra-channel page count for the current channel, bounded by MAX_MSG_PAGES. */
  page?: number;
}

interface FilesCursor {
  tsFrom?: string;
  page?: number;
  maxTs?: string;
}

/* ── Mappers ─────────────────────────────────────────────────────────────────── */

export function mapChannel(ctx: SyncContext, ch: SlackChannel): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'conversation',
    sourceId: ch.id,
    now: ctx.now,
    title: ch.name ? `#${ch.name}` : ch.id,
    url: null,
    createdAt: unixToIso(ch.created),
    updatedAt: unixToIso(ch.created),
    status: ch.is_archived ? 'archived' : 'active',
    metadata: {
      isPrivate: ch.is_private ?? false,
      isMember: ch.is_member ?? false,
      numMembers: ch.num_members ?? 0,
      topic: ch.topic?.value ?? null,
      purpose: ch.purpose?.value ?? null,
    },
  });
}

export function mapMessage(ctx: SyncContext, channelId: string, m: SlackMessage): UnifiedEntity {
  const ts = slackTsToIso(m.ts);
  const channelRef = makeUnifiedId(ctx.tenantId, ctx.connectorId, ctx.accountId, 'conversation', channelId);
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'message',
    sourceId: `${channelId}:${m.ts}`,
    now: ctx.now,
    title: firstLine(m.text) || '(message)',
    url: null,
    createdAt: ts,
    updatedAt: slackTsToIso(m.edited?.ts ?? m.ts),
    body: m.text ?? null,
    author: m.user ?? m.bot_id ?? null,
    timestamp: ts,
    parentId: channelRef,
    containerId: channelRef,
    metadata: {
      channel: channelId,
      ts: m.ts,
      threadTs: m.thread_ts ?? null,
      reactions: m.reactions?.length ?? 0,
      subtype: m.subtype ?? null,
    },
  });
}

/** Slack workspace member → contact. `updated` is a real source timestamp, so re-syncs don't churn. */
export function mapUser(ctx: SyncContext, u: SlackUser): UnifiedEntity {
  const p = u.profile ?? {};
  // A real `updated` timestamp keeps re-syncs churn-free; 0/absent → a stable baseline (never ctx.now).
  const when = u.updated ? unixToIso(u.updated) : SLACK_STABLE_TS;
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'contact',
    sourceId: u.id,
    now: ctx.now,
    title: u.real_name || p.display_name || u.name || u.id,
    url: null,
    createdAt: when,
    updatedAt: when,
    status: u.deleted ? 'deleted' : 'active',
    author: p.email ?? null,
    metadata: {
      username: u.name ?? null,
      email: p.email ?? null,
      title: p.title ?? null,
      isBot: u.is_bot ?? false,
      isAdmin: u.is_admin ?? false,
      tz: u.tz ?? null,
      deleted: u.deleted ?? false,
    },
  });
}

/** Slack file → file, linked by permalink. `created` is a real source timestamp. */
export function mapFile(ctx: SyncContext, f: SlackFile): UnifiedEntity {
  const created = unixToIso(f.created);
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'file',
    sourceId: f.id,
    now: ctx.now,
    title: f.title || f.name || f.id,
    url: f.permalink ?? null,
    createdAt: created,
    updatedAt: created,
    author: f.user ?? null,
    timestamp: created,
    metadata: {
      mimetype: f.mimetype ?? null,
      filetype: f.filetype ?? null,
      prettyType: f.pretty_type ?? null,
      size: f.size ?? 0,
      isPublic: f.is_public ?? false,
      channelCount: f.channels?.length ?? 0,
    },
  });
}

/* ── Pulls ───────────────────────────────────────────────────────────────────── */

async function pullConversations(ctx: SyncContext): Promise<SyncPage> {
  // Public channels only — matches the `channels:read` scope. Private channels (groups:read/history) are
  // a documented follow-on; requesting them without the scope would 403 the whole call.
  const data = await slackGet<SlackListResp>(ctx, 'conversations.list', {
    types: 'public_channel',
    exclude_archived: true,
    limit: 200,
    cursor: ctx.cursor ?? undefined,
  });
  const channels = data.channels ?? [];
  const next = data.response_metadata?.next_cursor;
  const more = !!next;
  return { entities: channels.map((ch) => mapChannel(ctx, ch)), cursor: more ? next! : null, hasMore: more };
}

async function pullMessages(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<MsgCursor>(ctx.cursor) ?? { hw: {} };
  const hw = c.hw ?? {};
  let queue = c.queue;
  let idx = c.idx ?? 0;

  if (!queue) {
    const data = await slackGet<SlackListResp>(ctx, 'conversations.list', {
      types: 'public_channel',
      exclude_archived: true,
      limit: 200,
    });
    queue = (data.channels ?? []).filter((ch) => ch.is_member).map((ch) => ch.id).slice(0, MAX_CHANNELS);
    idx = 0;
  }

  if (queue.length === 0 || idx >= queue.length) {
    return { entities: [], cursor: toJsonCursor({ hw }), hasMore: false };
  }

  const channelId = queue[idx]!;
  const page = c.page ?? 0;
  let messages: SlackMessage[] = [];
  let channelMore = false;
  try {
    // History is newest-first within (oldest, latest]. We page OLDER through Slack's own `next_cursor`
    // so a burst larger than one page is fully captured — never leapfrogged by advancing the high-water.
    const data = await slackGet<SlackHistoryResp>(ctx, 'conversations.history', {
      channel: channelId,
      oldest: hw[channelId] ?? undefined,
      cursor: c.mcur ?? undefined,
      limit: 100,
    });
    messages = data.messages ?? [];
    const next = data.response_metadata?.next_cursor;
    channelMore = !!next && messages.length > 0 && page + 1 < MAX_MSG_PAGES;
    // Carry the raw next_cursor through the walk (only meaningful when channelMore is true).
    c.mcur = next || undefined;
  } catch (err) {
    // A per-channel 403/404 (bot not in channel, channel archived/gone) must SKIP this channel and
    // advance the queue — never wedge the whole walk on one bad channel (graceful freezes the cursor at
    // this idx, so it would retry the same channel forever). Connector-wide errors (reauth / rate limit
    // / 5xx) still propagate to graceful / the orchestrator.
    const status = errorStatus(err);
    if (status !== 403 && status !== 404) throw err;
    messages = [];
    channelMore = false;
  }

  // messages[0] is the newest on page 1 (and never newer on later pages), so it is the channel's overall
  // newest — held as `pending` and committed to the high-water only once the channel is fully drained.
  let pending = c.pending;
  if (messages.length > 0) {
    const newest = messages[0]!.ts;
    pending = pending && pending > newest ? pending : newest;
  }
  const entities = messages.map((m) => mapMessage(ctx, channelId, m));

  if (channelMore) {
    // Still draining THIS channel: keep idx, carry the intra-channel cursor + pending high-water.
    const cursor = toJsonCursor({ hw, queue, idx, mcur: c.mcur, pending, page: page + 1 });
    return { entities, cursor, hasMore: true };
  }

  // Channel drained: commit its newest ts as the high-water, then advance to the next channel.
  const newHw = { ...hw };
  if (pending) newHw[channelId] = pending;
  const nextIdx = idx + 1;
  const more = nextIdx < queue.length;
  const cursor = more ? toJsonCursor({ hw: newHw, queue, idx: nextIdx }) : toJsonCursor({ hw: newHw });
  return { entities, cursor, hasMore: more };
}

async function pullUsers(ctx: SyncContext): Promise<SyncPage> {
  const cur = parseJsonCursor<{ cursor?: string }>(ctx.cursor) ?? {};
  const data = await slackGet<SlackUsersResp>(ctx, 'users.list', {
    limit: 200,
    cursor: cur.cursor ?? undefined,
  });
  const members = data.members ?? [];
  const entities = members.filter((u) => !u.deleted).map((u) => mapUser(ctx, u));
  const deletedSourceIds = members.filter((u) => u.deleted).map((u) => u.id);
  const next = data.response_metadata?.next_cursor;
  const more = !!next;
  return { entities, deletedSourceIds, cursor: more ? toJsonCursor({ cursor: next }) : null, hasMore: more };
}

async function pullFiles(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<FilesCursor>(ctx.cursor) ?? {};
  const page = c.page ?? 1;
  const data = await slackGet<SlackFilesResp>(ctx, 'files.list', {
    ts_from: c.tsFrom ?? undefined,
    count: FILES_PER_PAGE,
    page,
  });
  const files = data.files ?? [];
  const entities = files.map((f) => mapFile(ctx, f));
  // Track the max created ts across the paged walk → next run's `ts_from` (incremental). Numeric compare
  // (created is unix seconds), seeded from the current baseline so an empty page never rewinds it.
  let maxTs = Number(c.maxTs ?? c.tsFrom ?? 0);
  for (const f of files) if (f.created > maxTs) maxTs = f.created;
  const pages = data.paging?.pages ?? 1;
  const more = page < pages;
  const cursor = more
    ? toJsonCursor({ tsFrom: c.tsFrom, page: page + 1, maxTs: String(maxTs) })
    : toJsonCursor({ tsFrom: String(maxTs) });
  return { entities, cursor, hasMore: more };
}

/* ── Family composition ──────────────────────────────────────────────────────── */

const SLACK_REASONS = {
  unauthorized: 'Service not authorized — this Slack scope was not granted for the workspace (403)',
  unprovisioned: 'Resource not available for this Slack workspace (404)',
} as const;

/** Wrap a service resource so one unavailable service degrades instead of failing the whole family. */
function serviceResource(r: AdapterResource): AdapterResource {
  return { ...r, pull: graceful(r.pull, SLACK_REASONS) };
}

const slackResources: AdapterResource[] = [
  { id: 'conversations', label: 'Channels', kind: 'conversation', pull: pullConversations },
  { id: 'messages', label: 'Messages', kind: 'message', pull: pullMessages },
  { id: 'users', label: 'Users', kind: 'contact', pull: pullUsers },
  { id: 'files', label: 'Files', kind: 'file', pull: pullFiles },
];

export const slackAdapter: ConnectorAdapter = {
  connectorId: 'slack',
  resources: slackResources.map(serviceResource),
};

/* ── Runtime capability discovery ─────────────────────────────────────────────── */

/** A Slack service and the OAuth bot scope that unlocks it. */
export interface SlackService {
  id: string;
  label: string;
  /** The Slack bot scope granting this service. */
  scope: string;
  /** How this service syncs (informational). */
  sync: string;
}

/**
 * The service catalog — the runtime source of truth for capability discovery. Consumed by the Enterprise
 * Connector Center so the UI hardcodes no service list. Each id matches its `AdapterResource.id`, so the
 * Center shows a live object count per service. Mirrors `GITHUB_SERVICES` / `GOOGLE_WORKSPACE_SERVICES`.
 */
export const SLACK_SERVICES: SlackService[] = [
  { id: 'conversations', label: 'Channels', scope: 'channels:read', sync: 'Cursor list' },
  { id: 'messages', label: 'Messages', scope: 'channels:history', sync: 'Per-channel high-water' },
  { id: 'users', label: 'Users', scope: 'users:read', sync: 'Cursor list' },
  { id: 'files', label: 'Files', scope: 'files:read', sync: 'Paged (ts_from)' },
];

/** A service plus whether the connected workspace actually granted its bot scope. */
export interface SlackServiceStatus extends SlackService {
  available: boolean;
}

/**
 * Runtime capability discovery: which services are available given the bot scopes Slack actually granted
 * (`ConnectedAccount.grantedScopes`). Pure — the Enterprise Connector Center renders exactly this (✓/✗);
 * nothing is hardcoded. Mirrors `githubServiceAvailability` / `googleServiceAvailability`.
 */
export function slackServiceAvailability(grantedScopes: readonly string[]): SlackServiceStatus[] {
  const granted = new Set(grantedScopes);
  return SLACK_SERVICES.map((s) => ({ ...s, available: granted.has(s.scope) }));
}
