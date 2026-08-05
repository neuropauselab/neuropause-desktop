/**
 * Module 3 — Unified Inbox. One inbox aggregating notifications, tasks, approvals, mentions,
 * workflow messages, system alerts, and AI suggestions. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import { INBOX_KINDS, type InboxKind } from './constants';

export interface InboxItem {
  id: string;
  userId: string;
  kind: InboxKind;
  title: string;
  source: string;
  refId?: string;
  read: boolean;
  at: number;
}

export class UnifiedInbox {
  private readonly items = new Map<string, InboxItem>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async push(input: { userId: string; kind: InboxKind; title: string; source?: string; refId?: string }): Promise<InboxItem> {
    if (!INBOX_KINDS.includes(input.kind)) throw new Error(`unknown inbox kind: ${input.kind}`);
    const item: InboxItem = { id: randomId('inbox'), userId: input.userId, kind: input.kind, title: input.title, source: input.source ?? 'workspace', ...(input.refId ? { refId: input.refId } : {}), read: false, at: this.clock.now() };
    this.items.set(item.id, item);
    await this.governance.record({ actor: input.userId, module: 'inbox', operation: `push.${input.kind}`, targetId: item.id, evidence: 'live-verified' });
    return item;
  }

  markRead(id: string): InboxItem {
    const i = this.items.get(id);
    if (!i) throw new Error(`no inbox item ${id}`);
    i.read = true;
    return i;
  }

  list(userId: string, opts: { kind?: InboxKind } = {}): InboxItem[] {
    return [...this.items.values()].filter((i) => i.userId === userId && (opts.kind ? i.kind === opts.kind : true));
  }
  unread(userId: string): InboxItem[] {
    return this.list(userId).filter((i) => !i.read);
  }
  count(userId?: string): number {
    return userId ? this.list(userId).length : this.items.size;
  }
}
