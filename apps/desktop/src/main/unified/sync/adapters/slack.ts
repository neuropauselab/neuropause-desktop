/**
 * Slack adapter. Maps a workspace into the UDM:
 *   channels (member, non-archived) → conversation
 *   channel history                 → message
 *
 * Slack returns 200 with `{ ok: false, error }` on failures, so the helper maps
 * those into the engine's error taxonomy (auth errors become AuthError). The
 * messages resource walks a capped set of channels one per page, keeping a
 * per-channel high-water timestamp in a composite cursor so each run only pulls
 * messages newer than the last sync. Message ↔ channel links are Unified
 * Identifiers.
 *
 * Bounded by design: at most MAX_CHANNELS channels and one history page per
 * channel per run — enough for recent activity without unbounded backfill.
 */
import type { UnifiedEntity } from '@neuropause/shared';
import type { ConnectorAdapter, SyncContext, SyncPage } from '../adapterSdk';
import { makeEntity } from '../adapterSdk';
import { makeUnifiedId } from '../../ids';
import { AuthError } from '../http';
import { firstLine, parseJsonCursor, slackTsToIso, toJsonCursor, unixToIso } from './util';

const SLACK = 'https://slack.com/api';
const MAX_CHANNELS = 20;

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
}

interface MsgCursor {
  hw: Record<string, string>;
  queue?: string[];
  idx?: number;
}

async function slackGet<T extends { ok: boolean; error?: string }>(
  ctx: SyncContext,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const resp = await ctx.http.getJson<T>(`${SLACK}/${path}`, { query });
  const data = resp.data;
  if (!data.ok) {
    const e = data.error ?? 'unknown_error';
    if (e.includes('auth') || e === 'token_revoked' || e === 'account_inactive') {
      throw new AuthError(`slack: ${e}`);
    }
    throw new Error(`slack: ${e}`);
  }
  return data;
}

export function mapChannel(ctx: SyncContext, ch: SlackChannel): UnifiedEntity {
  return makeEntity({
    connectorId: ctx.connectorId,
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
  const channelRef = makeUnifiedId(ctx.connectorId, ctx.accountId, 'conversation', channelId);
  return makeEntity({
    connectorId: ctx.connectorId,
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

async function pullConversations(ctx: SyncContext): Promise<SyncPage> {
  const data = await slackGet<SlackListResp>(ctx, 'conversations.list', {
    types: 'public_channel,private_channel',
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
      types: 'public_channel,private_channel',
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
  const data = await slackGet<SlackHistoryResp>(ctx, 'conversations.history', {
    channel: channelId,
    oldest: hw[channelId] ?? undefined,
    limit: 100,
  });
  const messages = data.messages ?? [];
  for (const m of messages) {
    const prev = hw[channelId];
    hw[channelId] = prev && prev > m.ts ? prev : m.ts;
  }

  const nextIdx = idx + 1;
  const more = nextIdx < queue.length;
  const cursor = more ? toJsonCursor({ hw, queue, idx: nextIdx }) : toJsonCursor({ hw });
  return { entities: messages.map((m) => mapMessage(ctx, channelId, m)), cursor, hasMore: more };
}

export const slackAdapter: ConnectorAdapter = {
  connectorId: 'slack',
  resources: [
    { id: 'conversations', label: 'Channels', kind: 'conversation', pull: pullConversations },
    { id: 'messages', label: 'Messages', kind: 'message', pull: pullMessages },
  ],
};
