/**
 * The Enterprise Timeline — a read-model over two existing sources.
 *
 * Composes the durable platform Timeline (via an injected query) with UDM
 * work-activity (via an injected entity lister) into one merged, typed stream,
 * then filters, orders, paginates, replays, and exports it. It persists nothing
 * of its own — every call reads live from its sources. Pure and electron-free:
 * the sources are injected, so it unit-tests with fakes; the runtime wires the
 * real `platform.api.query` and `unifiedStore`.
 */
import type {
  EnterpriseTimelineEntry,
  EnterpriseTimelineExport,
  EnterpriseTimelinePage,
  EnterpriseTimelineQuery,
  EnterpriseTimelineStats,
  PlatformEvent,
  TimelineEntrySource,
  TimelinePage,
  TimelineQuery,
  TimelineReplay,
  TimelineReplayQuery,
  UnifiedEntity,
} from '@neuropause/shared';

export interface EnterpriseTimelineSources {
  /** Read durable platform events (the platform Timeline query). */
  platformQuery: (q: TimelineQuery) => TimelinePage;
  /** Snapshot of active UDM entities. */
  listEntities: () => UnifiedEntity[];
}

/** Upper bound on platform events pulled into a merge pass. */
const WINDOW = 5000;

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unknown'
  );
}

function excerpt(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function connectorFromEvent(e: PlatformEvent): string | null {
  if (e.resource?.type === 'connector') return e.resource.id;
  const c = e.metadata?.connectorId;
  return typeof c === 'string' ? c : null;
}

function titleForEvent(e: PlatformEvent): string {
  if (e.resource?.name) return e.resource.name;
  if (e.resource) return `${e.resource.type} ${e.resource.id}`;
  return e.type;
}

function mapEvent(e: PlatformEvent): EnterpriseTimelineEntry {
  return {
    id: e.id,
    source: 'platform',
    at: e.timestamp,
    kind: e.type,
    category: e.category,
    title: titleForEvent(e),
    summary: null,
    actorId: e.actor.id,
    actorLabel: e.actor.kind,
    connectorId: connectorFromEvent(e),
    resourceId: e.resource?.id ?? null,
    entityRefs: e.resource ? [e.resource.id] : [],
    url: null,
    metadata: e.metadata ?? {},
  };
}

/** When (if ever) a UDM entity belongs on the timeline, and at what instant. */
function activityTimeFor(e: UnifiedEntity): string | null {
  if (e.timestamp) return e.timestamp;
  switch (e.kind) {
    case 'document':
    case 'task':
    case 'file':
    case 'attachment':
    case 'notification':
      return e.updatedAt;
    default:
      return null;
  }
}

function mapEntity(e: UnifiedEntity, at: string): EnterpriseTimelineEntry {
  const entityRefs = [e.id];
  if (e.containerId) entityRefs.push(e.containerId);
  if (e.parentId) entityRefs.push(e.parentId);
  return {
    id: `activity:${e.id}`,
    source: 'activity',
    at,
    kind: e.kind,
    category: 'activity',
    title: e.title,
    summary: e.body ? excerpt(e.body, 160) : null,
    actorId: e.author ? `person:${e.connectorId}:${slug(e.author)}` : null,
    actorLabel: e.author ?? null,
    connectorId: e.connectorId,
    resourceId: e.id,
    entityRefs,
    url: e.url,
    metadata: { kind: e.kind, status: e.status },
  };
}

function matchesText(e: EnterpriseTimelineEntry, t: string): boolean {
  if (e.title.toLowerCase().includes(t)) return true;
  if (e.summary && e.summary.toLowerCase().includes(t)) return true;
  if (e.kind.toLowerCase().includes(t)) return true;
  if (e.category.toLowerCase().includes(t)) return true;
  if (e.actorLabel && e.actorLabel.toLowerCase().includes(t)) return true;
  if (e.connectorId && e.connectorId.toLowerCase().includes(t)) return true;
  for (const v of Object.values(e.metadata)) {
    if (v !== null && String(v).toLowerCase().includes(t)) return true;
  }
  return false;
}

function matchEntry(e: EnterpriseTimelineEntry, q: EnterpriseTimelineQuery): boolean {
  if (q.kinds && q.kinds.length > 0 && !q.kinds.includes(e.kind)) return false;
  if (q.categories && q.categories.length > 0 && !q.categories.includes(e.category)) return false;
  if (q.connectorId && e.connectorId !== q.connectorId) return false;
  if (q.actorId && e.actorId !== q.actorId) return false;
  if (q.entityRef && !(e.entityRefs.includes(q.entityRef) || e.resourceId === q.entityRef)) return false;
  if (q.since && e.at < q.since) return false;
  if (q.until && e.at > q.until) return false;
  if (q.text) {
    const t = q.text.trim().toLowerCase();
    if (t && !matchesText(e, t)) return false;
  }
  return true;
}

export class EnterpriseTimeline {
  constructor(private readonly sources: EnterpriseTimelineSources) {}

  private collect(opts: {
    since?: string;
    until?: string;
    sources?: TimelineEntrySource[];
  }): EnterpriseTimelineEntry[] {
    const want = opts.sources && opts.sources.length > 0 ? new Set(opts.sources) : null;
    const out: EnterpriseTimelineEntry[] = [];

    if (!want || want.has('platform')) {
      const page = this.sources.platformQuery({
        since: opts.since,
        until: opts.until,
        limit: WINDOW,
        order: 'desc',
      });
      for (const e of page.events) out.push(mapEvent(e));
    }

    if (!want || want.has('activity')) {
      for (const ent of this.sources.listEntities()) {
        const at = activityTimeFor(ent);
        if (!at) continue;
        out.push(mapEntity(ent, at));
      }
    }

    return out;
  }

  query(q: EnterpriseTimelineQuery = {}): EnterpriseTimelinePage {
    const entries = this.collect({ since: q.since, until: q.until, sources: q.sources }).filter(
      (e) => matchEntry(e, q),
    );
    const order = q.order ?? 'desc';
    entries.sort((a, b) => (order === 'asc' ? cmp(a.at, b.at) : cmp(b.at, a.at)));

    const limit = q.limit ?? 50;
    const offset = decodeCursor(q.cursor);
    const slice = entries.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < entries.length ? encodeCursor(nextOffset) : null;
    return { entries: slice, nextCursor, total: entries.length };
  }

  replay(q: TimelineReplayQuery = {}): TimelineReplay {
    let entries = this.collect({ since: q.since, until: q.until, sources: q.sources });
    entries.sort((a, b) => cmp(a.at, b.at)); // ascending — replay order
    if (q.limit) entries = entries.slice(0, q.limit);
    return {
      entries,
      from: entries[0]?.at ?? null,
      to: entries[entries.length - 1]?.at ?? null,
      count: entries.length,
    };
  }

  stats(): EnterpriseTimelineStats {
    const entries = this.collect({});
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let oldest: string | null = null;
    let newest: string | null = null;
    for (const e of entries) {
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      if (oldest === null || e.at < oldest) oldest = e.at;
      if (newest === null || e.at > newest) newest = e.at;
    }
    return { total: entries.length, bySource, byCategory, oldest, newest };
  }

  export(): EnterpriseTimelineExport {
    const entries = this.collect({}).sort((a, b) => cmp(b.at, a.at));
    return {
      format: 'ndjson',
      generatedAt: new Date().toISOString(),
      count: entries.length,
      entries,
    };
  }

  /** Free-text entries for the Enterprise Search 'timeline' source. */
  search(text: string, limit: number): EnterpriseTimelineEntry[] {
    return this.query({ text, limit, order: 'desc' }).entries;
  }
}
