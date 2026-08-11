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
  TenantScope,
} from '@neuropause/shared';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';

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

    /**
   * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate.
   *
   * The seam below predates the registry, so the gate could not see it: an
   * unbound instance denied every read (correct) but shipped silently (not
   * correct). One line, so the next store has no excuse to skip it.
   */
  constructor(private readonly filePath: string) {
    registerTenantStore('assistant-conversations', () => this.hasScope());
  }

  /* ── P13C N7: the tenant boundary ──────────────────────────────────────
   *
   * Conversation bodies carry assistant answers synthesised from tenant data —
   * record names, figures, summaries of a customer's business. Before this the
   * store had no boundary at all, and two specific shapes made that reachable:
   *
   *   list(null)  meant NO FILTER — every conversation on the install. The IPC
   *               schema makes `workspaceId` nullable AND optional, so `{}` was
   *               a valid payload that returned everything.
   *   get(id)     selected by bare id, so knowing a uuid was the whole
   *               authorization.
   *
   * Both channels were also on the PUBLIC allowlist — no auth, no permission.
   *
   * `bindScope` follows the same convention as the notification inbox and the
   * webhook store: UNBOUND DENIES, so a future caller that forgets to bind gets
   * an empty store rather than an open one.
   */
  private scopeSource: (() => TenantScope | null) | null = null;

  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  private scopeOrDeny(): TenantScope | null {
    return this.scopeSource === null ? null : this.scopeSource();
  }

  /** Whether `c` belongs to the caller. An unowned conversation belongs to nobody. */
  private mine(c: AssistantConversation): boolean {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return false;
    return typeof c.tenantId === 'string' && c.tenantId !== '' && c.tenantId === scope.tenantId;
  }

  /** Ownership counts across EVERY row, ignoring scope. Migration evidence only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    if (!this.loaded) this.loadAllSync();
    let assigned = 0;
    for (const c of this.conversations) {
      if (typeof c.tenantId === 'string' && c.tenantId !== '') assigned += 1;
    }
    return {
      total: this.conversations.length,
      assigned,
      unresolved: this.conversations.length - assigned,
    };
  }

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

  /**
   * The conversation, IF it is the caller's.
   *
   * A foreign id reads as absent rather than refused, so this cannot be used to
   * probe which conversation ids exist.
   */
  get(id: string): AssistantConversation | null {
    if (!this.loaded) this.loadAllSync();
    const c = this.conversations.find((x) => x.id === id) ?? null;
    return c !== null && this.mine(c) ? c : null;
  }

  /** Summaries, newest-updated first; pinned float to the top. */
  /**
   * Summaries, newest-updated first; pinned float to the top.
   *
   * P13C N7 — `null` NO LONGER MEANS ALL. The tenant filter is applied first
   * and unconditionally, so a null or omitted `workspaceId` now means "every
   * conversation of MINE" — the optional argument narrows within a boundary it
   * cannot cross. There is deliberately no argument that widens it: an
   * administrative cross-tenant read would need its own authorized channel, not
   * a falsy value on this one.
   */
  list(workspaceId?: string | null, limit = 50): AssistantConversationSummary[] {
    if (!this.loaded) this.loadAllSync();
    const mine = this.conversations.filter((c) => this.mine(c));
    const filtered =
      workspaceId === undefined || workspaceId === null
        ? mine
        : mine.filter((c) => c.workspaceId === workspaceId);
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
    const scope = this.scopeOrDeny();
    /**
     * No tenant, no conversation. Storing it unowned would make it invisible to
     * everyone while still consuming a retention slot, and the retention cap
     * evicts the least-recently-updated — so unowned rows would quietly push out
     * real ones.
     */
    if (scope === null || !scope.tenantId) return Promise.resolve();
    /**
     * An existing conversation may only be updated by its OWNER. Without this,
     * `upsert` was a write-side IDOR: a caller who knew an id could overwrite
     * another tenant's conversation, title and message history.
     */
    const existing = this.conversations.find((c) => c.id === conversation.id) ?? null;
    if (existing !== null && !this.mine(existing)) return Promise.resolve();
    const snapshot: AssistantConversation = {
      ...conversation,
      tenantId: scope.tenantId,
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
    // Scoped: a foreign id deletes nothing and reports nothing was deleted.
    if (this.get(id) === null) return Promise.resolve(false);
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
