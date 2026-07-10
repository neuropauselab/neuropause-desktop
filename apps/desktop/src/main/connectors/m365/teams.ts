/**
 * P2.4 — Microsoft Teams write actions (live Microsoft Graph, no mocks).
 *
 * send / reply channel message, send chat message, create channel, read channel members, @mentions,
 * and best-effort adaptive cards. Reuses the same authenticated Graph session. Teams message APIs are
 * no longer metered (Microsoft, 25 Aug 2025), so no billing configuration is required.
 */
import {
  GRAPH,
  enc,
  optObj,
  optStr,
  quotaFrom,
  str,
  type WriteAction,
  type WriteActionContext,
  type WriteActionResult,
  type WriteParams,
} from './actionSdk';

const CHANNEL_SEND = 'ChannelMessage.Send';
const CHAT_RW = 'Chat.ReadWrite';
const CHANNEL_CREATE = 'Channel.Create';
const CHANNEL_MEMBER = 'ChannelMember.Read.All';

interface GraphChatMessageRef {
  id?: string;
  webUrl?: string;
}
interface GraphChannelRef {
  id?: string;
  displayName?: string;
  webUrl?: string;
}
interface GraphMember {
  id?: string;
  displayName?: string;
  roles?: string[];
}

interface Mention {
  id: string;
  displayName: string;
}

function parseMentions(p: WriteParams): Mention[] {
  const raw = p['mentions'];
  if (!Array.isArray(raw)) return [];
  const out: Mention[] = [];
  for (const m of raw) {
    if (m !== null && typeof m === 'object') {
      const id = (m as Record<string, unknown>)['id'];
      const displayName = (m as Record<string, unknown>)['displayName'];
      if (typeof id === 'string' && typeof displayName === 'string') out.push({ id, displayName });
    }
  }
  return out;
}

/** Build a Graph chatMessage body, weaving in @mentions and an optional adaptive card. */
function chatMessageBody(p: WriteParams): Record<string, unknown> {
  const contentType = optStr(p, 'contentType') === 'text' ? 'text' : 'html';
  let content = str(p, 'content');
  const mentions = parseMentions(p);
  const body: Record<string, unknown> = {};
  if (mentions.length > 0) {
    const atTags = mentions
      .map((m, i) => `<at id="${i}">${m.displayName}</at>`)
      .join(' ');
    content = `${atTags} ${content}`;
    body.mentions = mentions.map((m, i) => ({
      id: i,
      mentionText: m.displayName,
      mentioned: { user: { id: m.id, displayName: m.displayName } },
    }));
  }
  const card = optObj(p, 'card');
  if (card) {
    body.attachments = [
      { id: '1', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) },
    ];
    content = `${content}<attachment id="1"></attachment>`;
  }
  body.body = { contentType, content };
  return body;
}

async function sendChannel(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const teamId = str(p, 'teamId');
  const channelId = str(p, 'channelId');
  const res = await ctx.http.postJson<GraphChatMessageRef>(
    `${GRAPH}/teams/${enc(teamId)}/channels/${enc(channelId)}/messages`,
    chatMessageBody(p),
  );
  return { ok: true, summary: 'Sent channel message', data: { id: res.data.id ?? null, webUrl: res.data.webUrl ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function replyChannel(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const teamId = str(p, 'teamId');
  const channelId = str(p, 'channelId');
  const messageId = str(p, 'messageId');
  const res = await ctx.http.postJson<GraphChatMessageRef>(
    `${GRAPH}/teams/${enc(teamId)}/channels/${enc(channelId)}/messages/${enc(messageId)}/replies`,
    chatMessageBody(p),
  );
  return { ok: true, summary: 'Replied to channel message', data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function sendChat(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const chatId = str(p, 'chatId');
  const res = await ctx.http.postJson<GraphChatMessageRef>(`${GRAPH}/chats/${enc(chatId)}/messages`, chatMessageBody(p));
  return { ok: true, summary: 'Sent chat message', data: { id: res.data.id ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function createChannel(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const teamId = str(p, 'teamId');
  const displayName = str(p, 'displayName');
  const res = await ctx.http.postJson<GraphChannelRef>(`${GRAPH}/teams/${enc(teamId)}/channels`, {
    displayName,
    description: optStr(p, 'description') ?? '',
    membershipType: optStr(p, 'membershipType') === 'private' ? 'private' : 'standard',
  });
  return { ok: true, summary: `Created channel “${displayName}”`, data: { id: res.data.id ?? null, webUrl: res.data.webUrl ?? null }, quotaRemaining: quotaFrom(res.headers) };
}

async function listMembers(ctx: WriteActionContext, p: WriteParams): Promise<WriteActionResult> {
  const teamId = str(p, 'teamId');
  const channelId = str(p, 'channelId');
  const res = await ctx.http.getJson<{ value?: GraphMember[] }>(
    `${GRAPH}/teams/${enc(teamId)}/channels/${enc(channelId)}/members`,
  );
  const members = res.data.value ?? [];
  return { ok: true, summary: `Channel has ${members.length} member(s)`, data: { count: members.length }, quotaRemaining: quotaFrom(res.headers) };
}

export const teamsActions: WriteAction[] = [
  { id: 'teams.sendChannelMessage', label: 'Send channel message', domain: 'teams', scopes: [CHANNEL_SEND], mutates: true, run: sendChannel },
  { id: 'teams.replyChannelMessage', label: 'Reply in channel', domain: 'teams', scopes: [CHANNEL_SEND], mutates: true, run: replyChannel },
  { id: 'teams.sendChatMessage', label: 'Send chat message', domain: 'teams', scopes: [CHAT_RW], mutates: true, run: sendChat },
  { id: 'teams.createChannel', label: 'Create channel', domain: 'teams', scopes: [CHANNEL_CREATE], mutates: true, run: createChannel },
  { id: 'teams.listChannelMembers', label: 'Read channel members', domain: 'teams', scopes: [CHANNEL_MEMBER], mutates: false, run: listMembers },
];
