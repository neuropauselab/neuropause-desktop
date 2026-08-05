/**
 * Module 9 — Enterprise Chat, and Module 11 — Whiteboard. Direct messages, group chats, channels,
 * threads, reactions, mentions, and file-sharing references; plus whiteboards with sticky notes,
 * shapes, flowcharts, and planning boards. All in-process — live-verified; start empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export type ChannelKind = 'dm' | 'group' | 'channel';
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  members: string[];
  createdAt: number;
}
export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  text: string;
  threadId?: string;
  mentions: string[];
  fileRefs: string[];
  reactions: Record<string, number>;
  at: number;
}

export class ChatRuntime {
  private readonly channels = new Map<string, Channel>();
  private readonly messages = new Map<string, ChatMessage>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async createChannel(input: { name: string; kind: ChannelKind; members?: string[] }): Promise<Channel> {
    const c: Channel = { id: randomId('chan'), name: input.name, kind: input.kind, members: input.members ?? [], createdAt: this.clock.now() };
    this.channels.set(c.id, c);
    await this.governance.record({ actor: 'system', module: 'chat', operation: `channel.${input.kind}`, targetId: c.id, evidence: 'live-verified' });
    return c;
  }
  async send(input: { channelId: string; authorId: string; text: string; threadId?: string; fileRefs?: string[] }): Promise<ChatMessage> {
    if (!this.channels.has(input.channelId)) throw new Error(`no channel ${input.channelId}`);
    const mentions = (input.text.match(/@(\w+)/g) ?? []).map((m) => m.slice(1));
    const m: ChatMessage = { id: randomId('msg'), channelId: input.channelId, authorId: input.authorId, text: input.text, ...(input.threadId ? { threadId: input.threadId } : {}), mentions, fileRefs: input.fileRefs ?? [], reactions: {}, at: this.clock.now() };
    this.messages.set(m.id, m);
    return m;
  }
  react(messageId: string, emoji: string): ChatMessage {
    const m = this.messages.get(messageId);
    if (!m) throw new Error(`no message ${messageId}`);
    m.reactions[emoji] = (m.reactions[emoji] ?? 0) + 1;
    return m;
  }
  channelMessages(channelId: string, opts: { threadId?: string } = {}): ChatMessage[] {
    return [...this.messages.values()].filter((m) => m.channelId === channelId && (opts.threadId ? m.threadId === opts.threadId : true));
  }
  listChannels(): Channel[] { return [...this.channels.values()]; }
  count(): number { return this.messages.size; }
}

export type BoardObjectKind = 'sticky' | 'shape' | 'flow' | 'text';
export interface Whiteboard {
  id: string;
  name: string;
  ownerId: string;
  objects: Array<{ id: string; kind: BoardObjectKind; content: string }>;
}

export class WhiteboardRuntime {
  private readonly boards = new Map<string, Whiteboard>();

  constructor(private readonly governance: WorkspaceGovernance) {}

  async createBoard(input: { name: string; ownerId: string }): Promise<Whiteboard> {
    const b: Whiteboard = { id: randomId('board'), name: input.name, ownerId: input.ownerId, objects: [] };
    this.boards.set(b.id, b);
    await this.governance.record({ actor: input.ownerId, module: 'whiteboard', operation: 'board.create', targetId: b.id, evidence: 'live-verified' });
    return b;
  }
  addObject(boardId: string, input: { kind: BoardObjectKind; content: string }): Whiteboard {
    const b = this.boards.get(boardId);
    if (!b) throw new Error(`no board ${boardId}`);
    b.objects.push({ id: randomId('obj'), kind: input.kind, content: input.content });
    return b;
  }
  boardsList(): Whiteboard[] { return [...this.boards.values()]; }
  count(): number { return this.boards.size; }
}
