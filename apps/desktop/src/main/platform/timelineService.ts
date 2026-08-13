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
import { registerTenantStore } from '../tenancy/tenantOwnedStore';
import { declareStoreScope } from '../tenancy/storeScope';

/**
 * P13C ROUND 9 — F11. The structural scope declaration. See tenancy/storeScope.ts.
 */
declareStoreScope({
  name: 'platform-timeline',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'SYSTEM',
  classification: 'CUSTOMER_DERIVED',
  /**
   * P13C ROUND 10 — the enum half of the Round 9 F11 fix.
   *
   * Checked at the three places this class can remove or fail to restore a row,
   * because a window is three code paths and they can disagree:
   *   `admit()`  — the TRIGGER is `bucket.length > this.maxInMemory`, over the
   *                event's OWN bucket, and the `shift()` under it therefore
   *                drops that owner's oldest and nobody else's. A per-owner
   *                eviction under an install-wide trigger is still the finding;
   *                this has neither.
   *   `init()`   — the warm-up fills each bucket to its own budget scanning
   *                newest-first, so a restart cannot silently narrow one tenant's
   *                window because another wrote the last N lines.
   *   `flush()`  — appends the pending batch and trims nothing, so the durable
   *                log holds every row forever and `export()` re-derives from it.
   */
  retentionScope: 'OWNER',
  retentionAuthority: 'SYSTEM',
  retention:
    'The durable JSONL log is append-only and never trimmed. The in-memory query window is bounded ' +
    'PER OWNER (maxInMemory events for each tenant, plus its own bucket for SYSTEM events and one ' +
    'for unowned rows) as of Round 9. It was one install-wide ring buffer, so a busy tenant silently ' +
    'evicted a quiet one from the live window while the durable file still held those rows — which ' +
    'made query() and export() disagree about the same log. ' +
    'THE EVICTION TRIGGER IS PER OWNER, not only the victim: `admit()` compares the length of the ' +
    "event's OWN bucket, so no other tenant's volume can fire it. The restart path (`init`) fills " +
    'each bucket to its own budget and the flush path appends without trimming, so none of the ' +
    'three can shrink a window that is not the writer\'s.',
  reason:
    'Events carry actor ids, resource ids and free-form metadata, and `q.search` matches over metadata ' +
    'values. The log is the second half of every briefing and a leg of Enterprise Search, so it is a ' +
    "targeted oracle over a tenant's activity if it is not owned.",
});

export interface TimelineOptions {
  /** Directory in which the timeline log lives. */
  dir: string;
  /**
   * Max events kept in memory for querying, PER OWNER (default 5000).
   *
   * P13C ROUND 9 — F11: it used to be the size of ONE shared window across every
   * tenant. An install with more tenants now holds more events in memory, which
   * is the same honest trade `TenantOwnership.pruneOwn` makes: the alternative is
   * one customer able to evict another's.
   */
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

/**
 * The in-memory window's retention buckets.
 *
 * SYSTEM events belong to the product rather than to a customer and are readable
 * by every resolved viewer, so they get their own budget: no tenant's traffic can
 * push the runtime supervisor's CRITICAL alerts out of the live window, and the
 * alerts cannot push a tenant's events out either. Unowned rows (published before
 * P13B, or with no principal at all) are visible to nobody and likewise cannot
 * evict, or be evicted by, anyone.
 *
 * The leading space keeps these keys out of the `t:` namespace used for tenants,
 * so no tenant id can collide with them.
 */
const SYSTEM_BUCKET = ' system';
const UNOWNED_BUCKET = ' unowned';

/** The bucket an event's retention belongs to. Derived from the event, never guessed. */
function windowBucket(e: PlatformEvent): string {
  if (e.scopeKind === 'system') return SYSTEM_BUCKET;
  const owner = e.tenantId;
  return typeof owner === 'string' && owner !== '' ? `t:${owner}` : UNOWNED_BUCKET;
}

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
  /** True once a boundary is bound. Evidence for the startup gate. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

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

  /**
   * The live query window, ONE BOUNDED BUFFER PER OWNER. P13C ROUND 9 — F11.
   *
   * It was a single `PlatformEvent[]` with `shift()` at `maxInMemory`, which made
   * eviction a cross-tenant act: tenant A's volume pushed tenant B's events out
   * of the window while the durable file still held them, so `query()` and
   * `export()` — two reads of the same log — returned different answers for B.
   * Filtering the window on read could not fix that; by the time the filter ran,
   * B's rows had already been deleted from memory by A's writes.
   */
  private windows = new Map<string, PlatformEvent[]>();
  private pending: PlatformEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private total = 0;
  /**
   * Writes are serialized on a chain rather than guarded by a boolean.
   *
   * P13C — the boolean version made `flush()` return early whenever a write was
   * already in flight, so `await flush()` was not a barrier. `export()` and
   * `dispose()` both await it and then read the file, which meant a read could
   * land before the append it was supposed to wait for. Under load that
   * surfaced as `query()` and `export()` disagreeing — the exact F11 symptom
   * the per-owner window above was written to remove, reintroduced one layer
   * down in the persistence path. `dispose()` had the same hole, so the tail of
   * the log could be dropped at shutdown.
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(opts: TimelineOptions) {
    /**
     * P13C ROUND 3 — PHASE 4. Declare this store to the startup gate. The seam
     * below predates the registry, so the gate could not see it: an unbound
     * instance denied every read (correct) and shipped silently (not correct).
     */
    registerTenantStore('platform-timeline', () => this.hasScope());
    this.dir = opts.dir;
    this.maxInMemory = opts.maxInMemory ?? 5000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 2000;
    this.batchSize = opts.batchSize ?? 50;
    this.now = opts.now ?? (() => Date.now());
    this.defaultLimit = opts.defaultLimit ?? 100;
  }

  /**
   * Prepare storage and warm the in-memory window from the durable log.
   *
   * P13C ROUND 9 — F11. The warm-up used to take the last `maxInMemory` LINES of
   * the file, which is the same install-wide window in a different place: a
   * tenant that wrote the last 5000 lines meant every other tenant restarted with
   * an empty timeline while its own events sat in the file untouched. The scan
   * now runs newest-first and fills each owner's own budget, so a restart
   * restores the same window each tenant would have had.
   *
   * It parses more lines than the old tail did. The file was already read into
   * memory in one call, so the added cost is JSON parsing at startup only, and it
   * stops adding to any bucket that is already full.
   */
  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const raw = await fs.readFile(this.path(), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      this.total = lines.length;
      const newestFirst = new Map<string, PlatformEvent[]>();
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const e = safeParse(lines[i] as string);
        if (e === null) continue;
        const key = windowBucket(e);
        let bucket = newestFirst.get(key);
        if (!bucket) newestFirst.set(key, (bucket = []));
        if (bucket.length < this.maxInMemory) bucket.push(e);
      }
      this.windows = new Map([...newestFirst].map(([k, b]) => [k, b.reverse()]));
    } catch {
      // No prior log yet — start clean.
      this.total = 0;
    }
    this.startTimer();
  }

  /** Record an event. Non-blocking: persistence is batched. */
  append(event: PlatformEvent): void {
    this.admit(event);
    this.pending.push(event);
    this.total += 1;
    if (this.pending.length >= this.batchSize) void this.flush();
  }

  /**
   * Put one event into ITS OWNER'S window, evicting only that owner's oldest.
   *
   * A retention cap is a WRITE, so the only rows this may delete are the ones
   * belonging to the event's own owner. The bucket is derived from the event
   * itself, which was stamped from the resolved principal at materialization —
   * a producer cannot choose it.
   */
  private admit(event: PlatformEvent): void {
    const key = windowBucket(event);
    let bucket = this.windows.get(key);
    if (!bucket) this.windows.set(key, (bucket = []));
    bucket.push(event);
    if (bucket.length > this.maxInMemory) bucket.shift();
  }

  /**
   * The live window THIS CALLER can see, oldest first.
   *
   * Two buckets: the caller's own tenant, and the SYSTEM bucket that belongs to
   * the product. `recordInScope` still runs over the result — the bucket key is
   * derived from `tenantId` alone, so the workspace half of the boundary is
   * checked here and a planted row cannot ride in on a bucket name.
   */
  private windowFor(scope: TenantScope): PlatformEvent[] {
    const mine = [
      ...(this.windows.get(`t:${scope.tenantId}`) ?? []),
      ...(this.windows.get(SYSTEM_BUCKET) ?? []),
    ].filter((e) => (e.scopeKind === 'system' ? true : recordInScope(e, scope)));
    mine.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return mine;
  }

  /**
   * Persist any pending events AND wait for any write already in flight.
   *
   * This is a barrier: when it resolves, every event appended before the call
   * is on disk, or has been requeued because the disk refused it. Callers that
   * read the file afterwards — `export()`, `dispose()` — depend on that.
   */
  async flush(): Promise<void> {
    const run = this.writeChain.then(() => this.drain());
    this.writeChain = run.catch(() => undefined);
    await run;
  }

  /**
   * Drain the pending queue, including events appended while an earlier batch
   * was being written. On a write failure the batch is requeued and the drain
   * stops rather than spinning: the interval timer retries, and a failing disk
   * must not turn into a hot loop.
   */
  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      try {
        const payload = batch.map((e) => JSON.stringify(e)).join('\n') + '\n';
        await fs.appendFile(this.path(), payload, 'utf8');
      } catch {
        // On failure, requeue so nothing is silently lost.
        this.pending = batch.concat(this.pending);
        return;
      }
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
    /**
     * P13C ROUND 9 — F11. `windowFor` has already applied the tenant boundary AND
     * the per-owner retention, so what this filter sees is the caller's own
     * window plus the SYSTEM bucket — never a window another tenant's volume has
     * been allowed to shrink. A SYSTEM event carries no customer data and is
     * readable by any resolved viewer: the same rule `memoryVisibleTo` applies to
     * SYSTEM memory, and the reason the supervisor's alerts are visible again.
     */
    const matched = this.windowFor(scope).filter((e) => {
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
    const mine = this.windowFor(scope);
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
        if (e.scopeKind === 'system' || recordInScope(e, scope)) lines.push(line);
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
