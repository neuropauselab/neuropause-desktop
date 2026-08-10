/**
 * The Timeline Service — the authoritative, append-only event store.
 *
 * Responsibilities:
 *   - Append every significant Platform Event durably (batched JSONL writes so
 *     a burst of events costs a handful of file appends, not one per event).
 *   - Serve queries over a bounded in-memory window with filtering, free-text
 *     search, time bounds, ordering, and cursor pagination.
 *   - Expose stats and a full export.
 *
 * It performs *no* AI summarization — only capture and exposure. It is the
 * substrate Activity Intelligence, Summaries, Reminders, Automation, and AI
 * Memory will read from later.
 *
 * Persistence is to a single newline-delimited JSON file. The in-memory window
 * holds the most recent N events for fast queries; `export()` reads the whole
 * durable log. (A future revision can swap the store for SQLite behind this
 * same interface without touching callers.)
 *
 * Electron-free: the storage directory and clock are injected, so it is fully
 * unit-testable against a temp dir.
 */
import { promises as fs } from 'node:fs';
import type { TenantScope } from '@neuropause/shared';
import { recordInScope } from '@neuropause/shared';
import { join } from 'node:path';
import type {
  PlatformEvent,
  PlatformEventType,
  PlatformEventCategory,
  EventPriority,
  TimelineQuery,
  TimelinePage,
  TimelineStats,
  TimelineExport,
} from '@neuropause/shared';

export interface TimelineOptions {
  /** Directory in which the timeline log lives. */
  dir: string;
  /** Max events kept in memory for querying (default 5000). */
  maxInMemory?: number;
  /** Flush cadence for batched persistence in ms (default 2000). */
  flushIntervalMs?: number;
  /** Flush immediately once this many events are pending (default 50). */
  batchSize?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Default page size (default 100). */
  defaultLimit?: number;
}

const FILE = 'timeline.jsonl';

/** The tenant boundary for the durable event log (P13B). `null` means DENY. */
export type TimelineScopeSource = () => TenantScope | null;

/** A process-wide fallback scope, for TESTS ONLY. Same seam and guard as the others. */
let ambientTimelineScope: TimelineScopeSource | null = null;

export function setAmbientTimelineScopeForTests(source: TimelineScopeSource | null): void {
  if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setAmbientTimelineScopeForTests is a test-only seam and must not be called at runtime.',
    );
  }
  ambientTimelineScope = source;
}

export class TimelineService {
  private scopeSource: TimelineScopeSource | null = null;

  /** Bind the tenant boundary. Chainable. UNBOUND DENIES. */
  bindScope(source: TimelineScopeSource): this {
    this.scopeSource = source;
    return this;
  }

  /** The active scope, or `null` meaning DENY. */
  private scopeOrDeny(): TenantScope | null {
    const source = this.scopeSource ?? ambientTimelineScope;
    return source === null ? null : source();
  }

  private readonly dir: string;
  private readonly maxInMemory: number;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => number;
  private readonly defaultLimit: number;

  private mem: PlatformEvent[] = [];
  private pending: PlatformEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private total = 0;
  private writing = false;

  constructor(opts: TimelineOptions) {
    this.dir = opts.dir;
    this.maxInMemory = opts.maxInMemory ?? 5000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.batchSize = opts.batchSize ?? 50;
    this.now = opts.now ?? (() => Date.now());
    this.defaultLimit = opts.defaultLimit ?? 100;
  }

  /** Prepare storage and warm the in-memory window from the durable log tail. */
  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const raw = await fs.readFile(this.path(), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      this.total = lines.length;
      const tail = lines.slice(Math.max(0, lines.length - this.maxInMemory));
      this.mem = tail
        .map((l) => safeParse(l))
        .filter((e): e is PlatformEvent => e !== null);
    } catch {
      // No prior log yet — start clean.
      this.total = 0;
    }
    this.startTimer();
  }

  /** Record an event. Non-blocking: persistence is batched. */
  append(event: PlatformEvent): void {
    this.mem.push(event);
    if (this.mem.length > this.maxInMemory) this.mem.shift();
    this.pending.push(event);
    this.total += 1;
    if (this.pending.length >= this.batchSize) void this.flush();
  }

  /** Persist any pending events. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.writing || this.pending.length === 0) return;
    this.writing = true;
    const batch = this.pending;
    this.pending = [];
    try {
      const payload = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(this.path(), payload, 'utf8');
    } catch {
      // On failure, requeue so nothing is silently lost.
      this.pending = batch.concat(this.pending);
    } finally {
      this.writing = false;
    }
  }

  /** Query the live window with filtering, search, ordering, and pagination. */
  query(q: TimelineQuery = {}): TimelinePage {
    const types = setOf(q.types as PlatformEventType[] | undefined);
    const categories = setOf(q.categories as PlatformEventCategory[] | undefined);
    const priorities = setOf(q.priorities as EventPriority[] | undefined);
    const search = q.search?.trim().toLowerCase();
    const since = q.since ? Date.parse(q.since) : null;
    const until = q.until ? Date.parse(q.until) : null;

    /**
     * P13B — the tenant filter runs FIRST, before every other predicate.
     *
     * This log is the second half of every briefing (the Enterprise Timeline
     * fuses it with scoped entities), and it is reachable directly through
     * `timeline:query` / `timeline:export`. An event carries `actor.id`,
     * `resource.id` and free-form `metadata`, and `q.search` matches over
     * metadata values — so unscoped this was a targeted oracle over another
     * tenant's activity, not merely a listing.
     *
     * An event with no tenant belongs to nobody and is shown to nobody: events
     * written before P13B, and those published with no active tenant (boot,
     * background timers), stay in the durable log for local diagnostics and
     * out of every tenant-facing read.
     */
    const scope = this.scopeOrDeny();
    if (scope === null) return { events: [], total: 0, nextCursor: null };
    const matched = this.mem.filter((e) => {
      if (!recordInScope(e, scope)) return false;
      if (types && !types.has(e.type)) return false;
      if (categories && !categories.has(e.category)) return false;
      if (priorities && !priorities.has(e.priority)) return false;
      if (q.source && e.source !== q.source) return false;
      if (q.actorId && e.actor.id !== q.actorId) return false;
      if (q.resourceId && e.resource?.id !== q.resourceId) return false;
      if (q.correlationId && e.correlationId !== q.correlationId) return false;
      const ts = Date.parse(e.timestamp);
      if (since !== null && ts < since) return false;
      if (until !== null && ts > until) return false;
      if (search && !matchesText(e, search)) return false;
      return true;
    });

    const order = q.order ?? 'desc';
    matched.sort((a, b) =>
      order === 'asc'
        ? a.timestamp.localeCompare(b.timestamp)
        : b.timestamp.localeCompare(a.timestamp),
    );

    const limit = q.limit ?? this.defaultLimit;
    const offset = decodeCursor(q.cursor ?? null);
    const slice = matched.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < matched.length ? encodeCursor(nextOffset) : null;

    return { events: slice, nextCursor, total: matched.length };
  }

  /** Statistics for THIS CALLER only — an install-wide histogram is a disclosure. */
  stats(): TimelineStats {
    const byCategory: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const scope = this.scopeOrDeny();
    if (scope === null) {
      return { total: 0, byCategory, byType, oldest: null, newest: null };
    }
    const mine = this.mem.filter((e) => recordInScope(e, scope));
    for (const e of mine) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return {
      // `this.total` counts every event ever written, across tenants. Replaced
      // with what this caller can actually see, so the number agrees with the
      // histogram beside it rather than contradicting it.
      total: mine.length,
      byCategory,
      byType,
      oldest: mine[0]?.timestamp ?? null,
      newest: mine[mine.length - 1]?.timestamp ?? null,
    };
  }

  /**
   * Durable export as newline-delimited JSON — THIS CALLER'S EVENTS ONLY.
   *
   * The file holds every tenant's events, so returning its bytes verbatim was
   * the single largest disclosure in this program: a full copy of another
   * tenant's activity log, over an IPC channel with no permission attached.
   * The file is now parsed and filtered rather than streamed, which costs a
   * pass over the log and is the only way to export a subset of it.
   */
  async export(): Promise<TimelineExport> {
    await this.flush();
    const scope = this.scopeOrDeny();
    const generatedAt = new Date(this.now()).toISOString();
    if (scope === null) return { format: 'jsonl', generatedAt, count: 0, data: '' };
    let raw = '';
    try {
      raw = await fs.readFile(this.path(), 'utf8');
    } catch {
      raw = '';
    }
    const lines: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as PlatformEvent;
        // A line that does not parse is dropped rather than passed through:
        // an unparseable record cannot be shown to belong to this tenant.
        if (recordInScope(e, scope)) lines.push(line);
      } catch {
        continue;
      }
    }
    return { format: 'jsonl', generatedAt, count: lines.length, data: lines.join('\n') };
  }

  /** Flush and stop the background timer. */
  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  private path(): string {
    return join(this.dir, FILE);
  }
}

function matchesText(e: PlatformEvent, q: string): boolean {
  if (e.type.includes(q) || e.source.includes(q)) return true;
  if (e.resource && (e.resource.id.toLowerCase().includes(q) || (e.resource.name ?? '').toLowerCase().includes(q))) return true;
  for (const v of Object.values(e.metadata)) {
    if (v !== null && String(v).toLowerCase().includes(q)) return true;
  }
  return false;
}

function setOf<T>(arr: T[] | undefined): Set<T> | null {
  return arr && arr.length ? new Set(arr) : null;
}

function safeParse(line: string): PlatformEvent | null {
  try {
    return JSON.parse(line) as PlatformEvent;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const n = Number(raw.replace(/^o:/, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
