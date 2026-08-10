/**
 * Gmail adapter. Maps messages → the UDM `message` kind, linked to their thread (`conversation`).
 *
 * Incremental sync uses the Gmail History API — the production-correct delta mechanism:
 *   INIT     — capture the mailbox `historyId` baseline from `users.getProfile` FIRST, then enumerate a
 *              bounded window of recent messages (`messages.list` ids → `messages.get?format=metadata`).
 *   HISTORY  — from the baseline, `users.history.list(startHistoryId)` returns only messagesAdded /
 *              messagesDeleted since; the top-level `historyId` is persisted as the next high-water cursor.
 *              An expired historyId (404 — Gmail retains history only a bounded window) restarts a full INIT.
 *
 * Least-privilege: `gmail.readonly`, `format=metadata` (headers + labels + snippet, never the raw body).
 * Bounded like the other adapters — initial enumeration is windowed; the history feed keeps it current.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { AdapterResource, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { isExpiredCursorError } from './delta';
import { parseJsonCursor, toJsonCursor, truncate } from './util';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1';
/** Bound the per-page id list so one pull does a bounded number of message.get calls (no batch API here). */
const LIST_PAGE = 50;

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}
interface MessagesListResp {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
}
interface HistoryRecord {
  id?: string;
  messagesAdded?: Array<{ message?: { id: string } }>;
  messagesDeleted?: Array<{ message?: { id: string } }>;
  labelsAdded?: Array<{ message?: { id: string } }>;
  labelsRemoved?: Array<{ message?: { id: string } }>;
}
interface HistoryResp {
  history?: HistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

/** INIT enumerates recent messages; between runs `{ historyId }` drives the incremental history feed. */
interface GmailCursor {
  phase?: 'init';
  /** INIT: messages.list page token. */
  page?: string;
  /** HISTORY: history.list page token (mid-run). */
  hp?: string;
  /** The mailbox history baseline / high-water. */
  historyId?: string;
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function mapMessage(ctx: SyncContext, m: GmailMessage): UnifiedEntity {
  const headers = m.payload?.headers;
  const subject = header(headers, 'Subject') ?? '(no subject)';
  const from = header(headers, 'From');
  const dateHeader = header(headers, 'Date');
  const ts = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : ctx.now;
  const threadRef = m.threadId ? makeUnifiedId(ctx.tenantId, ctx.connectorId, ctx.accountId, 'conversation', m.threadId) : null;
  const labels = m.labelIds ?? [];
  return makeEntity({
    connectorId: ctx.connectorId,
    tenantId: ctx.tenantId,
    accountId: ctx.accountId,
    kind: 'message',
    sourceId: m.id,
    now: ctx.now,
    title: subject,
    url: null,
    createdAt: ts,
    updatedAt: ts,
    timestamp: ts,
    body: truncate(m.snippet, 500),
    author: from,
    status: labels.includes('UNREAD') ? 'unread' : 'read',
    parentId: threadRef,
    containerId: threadRef,
    labels,
    metadata: {
      threadId: m.threadId ?? null,
      from,
      date: dateHeader,
      snippet: m.snippet ?? null,
      labelCount: labels.length, // the labels themselves are on the entity's top-level `labels`
    },
  });
}

/** Fetch metadata for each id (N+1 — no batch endpoint in the runtime HttpClient). A single 404 is skipped. */
async function getMessages(ctx: SyncContext, ids: string[]): Promise<UnifiedEntity[]> {
  const out: UnifiedEntity[] = [];
  for (const id of ids) {
    try {
      const resp = await ctx.http.getJson<GmailMessage>(`${GMAIL}/users/me/messages/${id}`, {
        query: { format: 'metadata' },
      });
      out.push(mapMessage(ctx, resp.data));
    } catch {
      // A message deleted between list and get 404s — don't fail the whole page for one id.
    }
  }
  return out;
}

async function pullHistory(ctx: SyncContext, startHistoryId: string, pageToken: string | undefined): Promise<SyncPage> {
  let data: HistoryResp;
  try {
    data = (
      await ctx.http.getJson<HistoryResp>(`${GMAIL}/users/me/history`, {
        query: { startHistoryId, pageToken },
      })
    ).data;
  } catch (err) {
    // Expired historyId → full resync (drop the cursor; next pull re-runs INIT).
    if (isExpiredCursorError(err, [404])) return { entities: [], cursor: null, hasMore: true };
    throw err;
  }
  const added = new Set<string>();
  const deleted = new Set<string>();
  for (const h of data.history ?? []) {
    for (const a of h.messagesAdded ?? []) if (a.message?.id) added.add(a.message.id);
    // Label changes (read/unread, archived, starred, moved) re-fetch the message so its status/labels refresh.
    for (const l of h.labelsAdded ?? []) if (l.message?.id) added.add(l.message.id);
    for (const l of h.labelsRemoved ?? []) if (l.message?.id) added.add(l.message.id);
    for (const d of h.messagesDeleted ?? []) if (d.message?.id) deleted.add(d.message.id);
  }
  for (const id of deleted) added.delete(id); // a message added then deleted in the same window is just gone
  const entities = await getMessages(ctx, [...added]);
  const deletedSourceIds = [...deleted];
  const next = data.nextPageToken;
  if (next) {
    const cursor: GmailCursor = { historyId: startHistoryId, hp: next };
    return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: true };
  }
  const cursor: GmailCursor = { historyId: data.historyId ?? startHistoryId };
  return { entities, deletedSourceIds, cursor: toJsonCursor(cursor), hasMore: false };
}

async function pullMessages(ctx: SyncContext): Promise<SyncPage> {
  const c = parseJsonCursor<GmailCursor>(ctx.cursor);

  // Incremental: we have a baseline and are not mid-INIT.
  if (c?.historyId && c.phase !== 'init') {
    return pullHistory(ctx, c.historyId, c.hp);
  }

  // INIT: capture the baseline once, then enumerate recent messages.
  let historyId = c?.historyId ?? null;
  if (!historyId) {
    const prof = await ctx.http.getJson<{ historyId: string }>(`${GMAIL}/users/me/profile`);
    historyId = prof.data.historyId;
  }
  const resp = await ctx.http.getJson<MessagesListResp>(`${GMAIL}/users/me/messages`, {
    query: { maxResults: LIST_PAGE, pageToken: c?.page },
  });
  const ids = (resp.data.messages ?? []).map((m) => m.id);
  const entities = await getMessages(ctx, ids);
  const next = resp.data.nextPageToken;
  if (next) {
    const cursor: GmailCursor = { phase: 'init', page: next, historyId };
    return { entities, cursor: toJsonCursor(cursor), hasMore: true };
  }
  // Enumeration complete → switch to the incremental history feed at the captured baseline.
  const cursor: GmailCursor = { historyId };
  return { entities, cursor: toJsonCursor(cursor), hasMore: false };
}

/** Gmail service resource(s), mounted on the google-workspace connector (one shared token). */
export const gmailResources: AdapterResource[] = [
  { id: 'gmail', label: 'Gmail', kind: 'message', pull: pullMessages },
];
