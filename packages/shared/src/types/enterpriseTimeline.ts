/**
 * Enterprise Timeline — the universal "what happened" stream.
 *
 * A read-model that unifies two existing sources into one typed entry stream:
 *   - **platform** events from the durable platform Timeline (app launches,
 *     syncs, connector/knowledge/permission/session events, …), and
 *   - **activity** derived from the Unified Data Model — the actual work from
 *     connected systems (messages, meetings, documents, tasks, …) placed on the
 *     timeline at the moment they happened.
 *
 * It owns no storage of its own; it composes the platform timeline query and the
 * UDM at read time, then filters, orders, paginates, replays, and exports. The
 * `since`/`until` window, free-text, entity filtering, and replay all operate
 * over the merged stream.
 *
 * Types-only.
 */

export type TimelineEntrySource = 'platform' | 'activity';

export const TIMELINE_ENTRY_SOURCES: readonly TimelineEntrySource[] = ['platform', 'activity'] as const;

export type EnterpriseTimelineMeta = Record<string, string | number | boolean | null>;

export interface EnterpriseTimelineEntry {
  /** Event id for platform entries; `activity:<entityId>` for UDM activity. */
  id: string;
  source: TimelineEntrySource;
  /** ISO timestamp — the sort key. */
  at: string;
  /** Platform event type, or UDM entity kind. */
  kind: string;
  /** Platform event category, or 'activity'. */
  category: string;
  title: string;
  summary: string | null;
  actorId: string | null;
  actorLabel: string | null;
  connectorId: string | null;
  /**
   * P2.5 — the domain the entry came from: the ERP module id for enterprise records
   * (e.g. 'finance-invoices', 'maintenance-downtime'), the resource type otherwise. Makes the unified
   * stream filterable per business domain instead of lumping every ERP event under 'enterprise'.
   */
  sourceModule: string | null;
  /** The primary entity/resource this entry concerns. */
  resourceId: string | null;
  /** All entity ids this entry references (for entity filtering). */
  entityRefs: string[];
  url: string | null;
  metadata: EnterpriseTimelineMeta;
}

export interface EnterpriseTimelineQuery {
  text?: string;
  sources?: TimelineEntrySource[];
  /** Filter by event type / entity kind. */
  kinds?: string[];
  categories?: string[];
  connectorId?: string;
  actorId?: string;
  /** P2.5 — filter by business domain (ERP module id / resource type). */
  sourceModule?: string;
  /** Only entries that concern this entity / resource id. */
  entityRef?: string;
  since?: string;
  until?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

export interface EnterpriseTimelinePage {
  entries: EnterpriseTimelineEntry[];
  nextCursor: string | null;
  total: number;
}

export interface TimelineReplayQuery {
  since?: string;
  until?: string;
  sources?: TimelineEntrySource[];
  limit?: number;
}

/** A chronological (ascending) window for replaying a period. */
export interface TimelineReplay {
  entries: EnterpriseTimelineEntry[];
  from: string | null;
  to: string | null;
  count: number;
}

export interface EnterpriseTimelineStats {
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  oldest: string | null;
  newest: string | null;
}

export interface EnterpriseTimelineExport {
  format: 'ndjson';
  generatedAt: string;
  count: number;
  entries: EnterpriseTimelineEntry[];
}
