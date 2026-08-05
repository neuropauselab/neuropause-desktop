/**
 * Collaboration (NCEA 10.5, Phase 7). Threads, comments, mentions, presence,
 * shared context, and shared AI sessions — all recorded through the ONE workspace
 * governance path, so the activity feed and workspace timeline are just
 * projections of the same governed event stream. Mentions carry `notify` so they
 * land in the universal inbox. Humans and AI employees participate in the same
 * shared sessions (they are the same principal model).
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance, WorkspaceActivityRecord } from './governance';

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface Thread {
  id: string;
  workspaceId: string;
  subject: string;
  entityRef?: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  threadId: string;
  authorPrincipalId: string;
  body: string;
  mentions: string[];
  at: number;
}

export interface Presence {
  principalId: string;
  workspaceId: string;
  status: PresenceStatus;
  at: number;
}

export interface SharedAiSession {
  id: string;
  workspaceId: string;
  topic: string;
  participants: string[];
  createdAt: number;
  active: boolean;
}

export class CollaborationHub {
  private readonly threads = new Map<string, Thread>();
  private readonly comments = new Map<string, Comment[]>();
  private readonly presence = new Map<string, Presence>(); // key: principalId@workspaceId
  private readonly context = new Map<string, { value: unknown; updatedBy: string; at: number }>(); // key: workspaceId::key
  private readonly sessions = new Map<string, SharedAiSession>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  // --- threads & comments ---------------------------------------------------
  async startThread(workspaceId: string, subject: string, entityRef?: string, actor = 'system'): Promise<Thread> {
    const thread: Thread = {
      id: randomId('thr'),
      workspaceId,
      subject,
      ...(entityRef ? { entityRef } : {}),
      createdAt: this.clock.now(),
    };
    this.threads.set(thread.id, thread);
    this.comments.set(thread.id, []);
    await this.governance.record({
      domain: 'collaboration',
      action: 'thread.start',
      entity: thread.id,
      actor,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { subject },
    });
    return thread;
  }

  async post(threadId: string, authorPrincipalId: string, body: string, mentions: string[] = []): Promise<Comment> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`thread '${threadId}' not found`);
    const comment: Comment = { id: randomId('cmt'), threadId, authorPrincipalId, body, mentions, at: this.clock.now() };
    this.comments.get(threadId)!.push(comment);
    await this.governance.record({
      domain: 'collaboration',
      action: 'comment',
      entity: threadId,
      actor: authorPrincipalId,
      workspace: thread.workspaceId,
      approval: 'not-required',
      ok: true,
      ...(mentions.length ? { notify: mentions } : {}),
      meta: { commentId: comment.id, mentions },
    });
    return comment;
  }

  threadComments(threadId: string): Comment[] {
    return [...(this.comments.get(threadId) ?? [])];
  }

  threadsIn(workspaceId: string): Thread[] {
    return [...this.threads.values()].filter((t) => t.workspaceId === workspaceId);
  }

  // --- presence -------------------------------------------------------------
  async setPresence(principalId: string, workspaceId: string, status: PresenceStatus): Promise<Presence> {
    const record: Presence = { principalId, workspaceId, status, at: this.clock.now() };
    this.presence.set(`${principalId}@${workspaceId}`, record);
    await this.governance.record({
      domain: 'collaboration',
      action: 'presence',
      entity: principalId,
      actor: principalId,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { status },
    });
    return record;
  }

  presenceIn(workspaceId: string): Presence[] {
    return [...this.presence.values()].filter((p) => p.workspaceId === workspaceId);
  }

  // --- shared context -------------------------------------------------------
  async shareContext(workspaceId: string, key: string, value: unknown, updatedBy: string): Promise<void> {
    this.context.set(`${workspaceId}::${key}`, { value, updatedBy, at: this.clock.now() });
    await this.governance.record({
      domain: 'collaboration',
      action: 'context.share',
      entity: `${workspaceId}::${key}`,
      actor: updatedBy,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { key },
    });
  }

  getContext(workspaceId: string, key: string): unknown {
    return this.context.get(`${workspaceId}::${key}`)?.value;
  }

  // --- shared AI sessions ---------------------------------------------------
  async startSharedSession(workspaceId: string, topic: string, participants: string[], actor = 'system'): Promise<SharedAiSession> {
    const session: SharedAiSession = {
      id: randomId('shs'),
      workspaceId,
      topic,
      participants: [...participants],
      createdAt: this.clock.now(),
      active: true,
    };
    this.sessions.set(session.id, session);
    await this.governance.record({
      domain: 'collaboration',
      action: 'session.start',
      entity: session.id,
      actor,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { topic, participants },
    });
    return session;
  }

  async joinSession(sessionId: string, principalId: string): Promise<SharedAiSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`shared session '${sessionId}' not found`);
    if (!session.participants.includes(principalId)) session.participants.push(principalId);
    await this.governance.record({
      domain: 'collaboration',
      action: 'session.join',
      entity: sessionId,
      actor: principalId,
      workspace: session.workspaceId,
      approval: 'not-required',
      ok: true,
    });
    return session;
  }

  session(sessionId: string): SharedAiSession | undefined {
    return this.sessions.get(sessionId);
  }

  // --- activity feed / workspace timeline (projection of governance) --------
  activityFeed(workspaceId: string, limit = 50): WorkspaceActivityRecord[] {
    return this.governance
      .history()
      .filter((r) => r.workspace === workspaceId)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  }
}
