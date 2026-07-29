/**
 * Session management (NCEA 10.3, Phase 1). Long-running AI sessions carry a
 * layered context and a conversation history and can be resumed until closed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import { ConversationManager, type LayeredContext } from './context';

export interface AiSession {
  id: string;
  actor: string;
  createdAt: number;
  context: LayeredContext;
  conversation: ConversationManager;
  state: 'active' | 'closed';
}

export interface CreateSessionInput {
  actor: string;
  context: LayeredContext;
}

export class SessionManager {
  private readonly sessions = new Map<string, AiSession>();

  constructor(private readonly clock: Clock) {}

  create(input: CreateSessionInput): AiSession {
    const session: AiSession = {
      id: randomId('ses'),
      actor: input.actor,
      createdAt: this.clock.now(),
      context: input.context,
      conversation: new ConversationManager(),
      state: 'active',
    };
    this.sessions.set(session.id, session);
    return session;
  }
  get(id: string): AiSession | undefined {
    return this.sessions.get(id);
  }
  close(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.state = 'closed';
  }
  list(): AiSession[] {
    return [...this.sessions.values()];
  }
  active(): AiSession[] {
    return this.list().filter((s) => s.state === 'active');
  }
}
