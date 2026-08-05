/**
 * Universal Inbox (NCEA 10.5, Phase 5). One inbox derived ENTIRELY from the
 * shared event bus — it introduces no store of its own beyond the projected
 * items. It subscribes to workspace activity (assignments, mentions, approvals),
 * connector executions, and AI-runtime events, and turns each into a typed
 * InboxItem routed to the right principal (via the activity `notify` list) or to
 * the workspace/system channel. Filtering and grouping are views over that set.
 */
import { randomId, type CloudEvent, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';

export const INBOX_ITEM_KINDS = [
  'notification',
  'approval',
  'ai-request',
  'connector-event',
  'workflow-event',
  'assignment',
  'mention',
  'alert',
] as const;
export type InboxItemKind = (typeof INBOX_ITEM_KINDS)[number];

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  principalId: string; // recipient, or 'system' for broadcast/workspace channel
  title: string;
  source: string; // event type that produced it
  entity?: string;
  workspace?: string;
  read: boolean;
  at: number;
  meta: Record<string, unknown>;
}

export interface InboxFilter {
  kind?: InboxItemKind;
  read?: boolean;
  workspace?: string;
}

/** Map a workspace.activity action to an inbox item kind. */
function kindForActivity(action: string): InboxItemKind {
  if (action.startsWith('assign')) return 'assignment';
  if (action === 'comment') return 'mention';
  if (action.startsWith('approval')) return 'approval';
  if (action.startsWith('dispatch')) return 'notification';
  return 'notification';
}

export class UniversalInbox {
  private readonly items: InboxItem[] = [];
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly runtime: EnterpriseRuntime,
    private readonly clock: Clock,
  ) {
    this.unsubscribes.push(
      this.runtime.events().subscribe('workspace.activity', (e) => this.ingestActivity(e)),
      this.runtime.events().subscribe('connector.execution', (e) => this.ingestConnector(e)),
      this.runtime.events().subscribe((e: CloudEvent) => e.topic === 'ai' || e.type.startsWith('ai.'), (e) =>
        this.ingestAi(e),
      ),
    );
  }

  private push(item: Omit<InboxItem, 'id' | 'read' | 'at'>): void {
    this.items.push({ ...item, id: randomId('inbx'), read: false, at: this.clock.now() });
  }

  private ingestActivity(event: CloudEvent): void {
    const p = event.payload as {
      domain: string;
      action: string;
      entity: string;
      actor: string;
      workspace?: string;
      approval: string;
      notify?: string[];
    };
    const kind = kindForActivity(p.action);
    const recipients = p.notify && p.notify.length ? p.notify : [];
    for (const principalId of recipients) {
      this.push({
        kind,
        principalId,
        title: `${p.domain}.${p.action}`,
        source: event.type,
        entity: p.entity,
        ...(p.workspace ? { workspace: p.workspace } : {}),
        meta: { actor: p.actor, approval: p.approval },
      });
    }
  }

  private ingestConnector(event: CloudEvent): void {
    const p = event.payload as { connectorId: string; operation: string; ok: boolean; workspace?: string };
    this.push({
      kind: p.ok ? 'connector-event' : 'alert',
      principalId: p.workspace ?? 'system',
      title: `connector ${p.connectorId}.${p.operation} ${p.ok ? 'ok' : 'failed'}`,
      source: event.type,
      entity: p.connectorId,
      ...(p.workspace ? { workspace: p.workspace } : {}),
      meta: { operation: p.operation, ok: p.ok },
    });
  }

  private ingestAi(event: CloudEvent): void {
    const p = (event.payload ?? {}) as { target?: string; kind?: string; workspace?: string; ok?: boolean };
    const kind: InboxItemKind = p.kind === 'workflow' ? 'workflow-event' : 'ai-request';
    this.push({
      kind,
      principalId: p.workspace ?? 'system',
      title: `ai ${p.kind ?? 'execution'}${p.target ? `: ${p.target}` : ''}`,
      source: event.type,
      ...(p.target ? { entity: p.target } : {}),
      ...(p.workspace ? { workspace: p.workspace } : {}),
      meta: { ok: p.ok ?? true },
    });
  }

  // --- reads ----------------------------------------------------------------
  itemsFor(principalId: string, filter: InboxFilter = {}): InboxItem[] {
    return this.items.filter(
      (i) =>
        i.principalId === principalId &&
        (filter.kind === undefined || i.kind === filter.kind) &&
        (filter.read === undefined || i.read === filter.read) &&
        (filter.workspace === undefined || i.workspace === filter.workspace),
    );
  }

  /** Broadcast / workspace-channel items (connector + AI events not routed to a person). */
  system(filter: InboxFilter = {}): InboxItem[] {
    return this.itemsFor('system', filter);
  }

  unreadCount(principalId: string): number {
    return this.itemsFor(principalId, { read: false }).length;
  }

  /** Group a principal's items by kind — the unified-inbox default view. */
  grouped(principalId: string): Record<string, InboxItem[]> {
    const groups: Record<string, InboxItem[]> = {};
    for (const item of this.itemsFor(principalId)) (groups[item.kind] ??= []).push(item);
    return groups;
  }

  markRead(itemId: string): void {
    const item = this.items.find((i) => i.id === itemId);
    if (item) item.read = true;
  }

  markAllRead(principalId: string): void {
    for (const item of this.items) if (item.principalId === principalId) item.read = true;
  }

  all(): InboxItem[] {
    return [...this.items];
  }

  dispose(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;
  }
}
