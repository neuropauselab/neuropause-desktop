/**
 * Module 7 — Enterprise Timeline. A unified, chronologically-linked view built from the
 * REAL events the knowledge graph already aggregated (runtime audit entries +
 * connectivity sync outcomes + NEMS-derived events). Each event is classified into a
 * track (engineering, data, security, operations, …) so the same timeline can be sliced
 * by concern. No new event store — it reads what the platform already records.
 */
import type { KnowledgeGraph } from './graph';
import type { TimelineEvent } from './types';

export type TimelineTrack = 'engineering' | 'data' | 'security' | 'operations' | 'compliance' | 'other';

export interface TrackedEvent extends TimelineEvent {
  track: TimelineTrack;
}

function classify(ev: TimelineEvent): TimelineTrack {
  const t = `${ev.type} ${ev.source}`.toLowerCase();
  if (/sync|connector|connectivity/.test(t)) return 'data';
  if (/credential|security|auth|session/.test(t)) return 'security';
  if (/okr|objective|task|dashboard|nems|lifecycle/.test(t)) return 'engineering';
  if (/compliance|policy|control|risk/.test(t)) return 'compliance';
  return 'operations';
}

export class EnterpriseTimeline {
  constructor(private readonly graph: KnowledgeGraph) {}

  /** All events for a tenant, oldest→newest, classified into tracks. */
  unified(tenantId: string, opts: { since?: number; track?: TimelineTrack; limit?: number } = {}): TrackedEvent[] {
    let events: TrackedEvent[] = this.graph.timeline(tenantId).map((ev) => ({ ...ev, track: classify(ev) }));
    if (opts.since !== undefined) events = events.filter((e) => e.at >= opts.since!);
    if (opts.track) events = events.filter((e) => e.track === opts.track);
    if (opts.limit !== undefined) events = events.slice(-opts.limit);
    return events;
  }

  /** Events touching a specific entity, chronologically. */
  forEntity(tenantId: string, entityId: string): TrackedEvent[] {
    return this.graph.timeline(tenantId, entityId).map((ev) => ({ ...ev, track: classify(ev) }));
  }

  byTrack(tenantId: string): Record<TimelineTrack, number> {
    const counts: Record<TimelineTrack, number> = { engineering: 0, data: 0, security: 0, operations: 0, compliance: 0, other: 0 };
    for (const e of this.unified(tenantId)) counts[e.track] += 1;
    return counts;
  }
}
