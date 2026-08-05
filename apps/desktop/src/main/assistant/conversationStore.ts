/**
 * Assistant Conversation Store (Phase 6 Stage 4) — durable persistence for
 * assistant conversations, mirroring the proven ExecutionStore pattern:
 * synchronous load at startup, serialized atomic writes (unique temp file +
 * rename, mode 0600), bounded retention. The store is dumb persistence —
 * governance (secret screening before anything is stored) lives in the service.
 * Electron-free: the file path is injected, so it unit-tests on a temp dir.
 */
import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AssistantConversation,
  AssistantConversationSummary,
  AssistantIntentId,
} from '@neuropause/shared';

interface ConversationFile {
  conversations: AssistantConversation[];
}

/** Keep at most this many conversations (most recently updated first). */
export const MAX_CONVERSATIONS = 100;
/** Keep at most this many messages per conversation (oldest trimmed). */
export const MAX_MESSAGES = 200;

export class ConversationStore {
  private conversations: AssistantConversation[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Synchronous load at startup. Corrupt or missing files yield an empty store. */
  loadAllSync(): AssistantConversation[] {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ConversationFile>;
        this.conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
      } catch {
        this.conversations = [];
      }
    }
    return [...this.conversations];
  }

  get(id: string): AssistantConversation | null {
    if (!this.loaded) this.loadAllSync();
    return this.conversations.find((c) => c.id === id) ?? null;
  }

  /** Summaries, newest-updated first; pinned float to the top. */
  list(workspaceId?: string | null, limit = 50): AssistantConversationSummary[] {
    if (!this.loaded) this.loadAllSync();
    const filtered =
      workspaceId === undefined || workspaceId === null
        ? this.conversations
        : this.conversations.filter((c) => c.workspaceId === workspaceId);
    return [...filtered]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      })
      .slice(0, Math.max(1, limit))
      .map((c) => this.summarize(c));
  }

  private summarize(c: AssistantConversation): AssistantConversationSummary {
    let lastIntent: AssistantIntentId | null = null;
    for (let i = c.messages.length - 1; i >= 0; i -= 1) {
      const env = c.messages[i]?.envelope;
      if (env) {
        lastIntent = env.intent.intent;
        break;
      }
    }
    // Phase 6 Stage 5 — plan steps still parked for a human decision, across
    // every message. Feeds the followup_conversation recommendation rule.
    let waitingSteps = 0;
    for (const m of c.messages) {
      const plan = m.envelope?.plan;
      if (!plan) continue;
      for (const s of plan.steps) if (s.state === 'waiting') waitingSteps += 1;
    }
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.title,
      pinned: c.pinned,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
      lastIntent,
      waitingSteps,
    };
  }

  /** Upsert (by id) and persist. Messages are trimmed to the retention cap. */
  upsert(conversation: AssistantConversation): Promise<void> {
    if (!this.loaded) this.loadAllSync();
    const snapshot: AssistantConversation = {
      ...conversation,
      messages:
        conversation.messages.length > MAX_MESSAGES
          ? conversation.messages.slice(conversation.messages.length - MAX_MESSAGES)
          : [...conversation.messages],
    };
    const idx = this.conversations.findIndex((c) => c.id === snapshot.id);
    if (idx >= 0) this.conversations[idx] = snapshot;
    else this.conversations.unshift(snapshot);
    if (this.conversations.length > MAX_CONVERSATIONS) {
      // Drop the least-recently-updated unpinned conversations first.
      const keep = [...this.conversations].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      });
      this.conversations = keep.slice(0, MAX_CONVERSATIONS);
    }
    return this.persist();
  }

  delete(id: string): Promise<boolean> {
    if (!this.loaded) this.loadAllSync();
    const before = this.conversations.length;
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (this.conversations.length === before) return Promise.resolve(false);
    return this.persist().then(() => true);
  }

  private persist(): Promise<void> {
    const run = this.writeChain.then(() => this.writeNow());
    this.writeChain = run.catch(() => {});
    return run;
  }

  private async writeNow(): Promise<void> {
    const file: ConversationFile = { conversations: this.conversations };
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
