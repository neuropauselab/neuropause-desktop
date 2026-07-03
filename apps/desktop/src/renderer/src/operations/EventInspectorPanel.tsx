import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { formatCount, formatRelative } from '@renderer/lib/format';
import { OpsPanel, StatusDot } from './primitives';
import { TEXT_TONE, type OpsTone } from './lib';
import type {
  DiagnosticsReport,
  EventPriority,
  PlatformEvent,
  PlatformEventCategory,
} from '@neuropause/shared';

const MAX_EVENTS = 300;

const CATEGORIES: PlatformEventCategory[] = [
  'application',
  'runtime',
  'plugin',
  'permission',
  'download',
  'update',
  'session',
  'diagnostics',
  'system',
];

const PRIORITIES: EventPriority[] = ['critical', 'high', 'normal', 'low'];

function priorityTone(p: EventPriority): OpsTone {
  return p === 'critical' ? 'red' : p === 'high' ? 'orange' : p === 'low' ? 'gray' : 'blue';
}

function categoryTone(c: PlatformEventCategory): OpsTone {
  switch (c) {
    case 'application':
      return 'accent';
    case 'runtime':
      return 'blue';
    case 'plugin':
      return 'purple';
    case 'permission':
      return 'green';
    case 'download':
      return 'blue';
    case 'update':
      return 'orange';
    case 'session':
      return 'green';
    default:
      return 'gray';
  }
}

/**
 * Developer Event Inspector — a live window onto the platform event bus. It
 * seeds from the recorded timeline, then streams every event the main process
 * forwards (batched on a short interval so a burst stays smooth). Filter by
 * text, category, and priority; click any event for its full payload including
 * correlation/causation; and watch subscriber throughput and latency live.
 *
 * Developer mode only — the tab is hidden in production builds.
 */
export function EventInspectorPanel(): JSX.Element {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PlatformEventCategory | 'all'>('all');
  const [priority, setPriority] = useState<EventPriority | 'all'>('all');
  const [selected, setSelected] = useState<PlatformEvent | null>(null);
  const [diag, setDiag] = useState<DiagnosticsReport | null>(null);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const bufferRef = useRef<PlatformEvent[]>([]);

  const reload = useCallback(async () => {
    try {
      const page = await ipc.timeline.query({ order: 'desc', limit: 200 });
      setEvents(page.events);
    } catch {
      /* ignore */
    }
  }, []);

  // Seed from the timeline, then stream live events (coalesced every 300ms).
  useEffect(() => {
    let alive = true;
    void ipc.timeline
      .query({ order: 'desc', limit: 200 })
      .then((page) => {
        if (alive) setEvents(page.events);
      })
      .catch(() => undefined);

    const unsub = ipc.platform.onEvent((e) => {
      if (!pausedRef.current) bufferRef.current.push(e);
    });

    const flush = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const batch = bufferRef.current;
      bufferRef.current = [];
      setEvents((prev) => [...batch.reverse(), ...prev].slice(0, MAX_EVENTS));
    }, 300);

    return () => {
      alive = false;
      unsub();
      clearInterval(flush);
    };
  }, []);

  // Subscriber status + throughput/latency.
  useEffect(() => {
    const load = (): void => void ipc.diagnostics.get().then(setDiag).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (priority !== 'all' && e.priority !== priority) return false;
      if (q) {
        const hay = `${e.type} ${e.source} ${e.resource?.id ?? ''} ${e.resource?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, query, category, priority]);

  const metrics = diag?.metrics;

  return (
    <OpsPanel
      title="Event Inspector"
      subtitle="Developer tool · live platform event stream"
      actions={
        <>
          <Button size="sm" variant="secondary" icon={paused ? 'pulse' : 'pause'} onClick={() => setPaused((v) => !v)}>
            {paused ? 'Paused' : 'Streaming'}
          </Button>
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => void reload()}>
            Replay
          </Button>
          <Button size="sm" variant="secondary" icon="trash" onClick={() => { setEvents([]); setSelected(null); }}>
            Clear
          </Button>
        </>
      }
    >
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by type, source, or resource…"
            className="h-9 w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] pl-9 pr-3 text-sm outline-none placeholder:text-faint focus-visible:shadow-focus"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as PlatformEventCategory | 'all')}
          className="h-9 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 text-sm text-muted outline-none focus-visible:shadow-focus"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as EventPriority | 'all')}
          className="h-9 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 text-sm text-muted outline-none focus-visible:shadow-focus"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <span className="text-2xs text-faint">{formatCount(filtered.length)} shown</span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Event stream */}
        <div className="min-w-0 flex-1">
          <div className="h-[58vh] overflow-y-auto rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
            {filtered.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-faint">
                {paused ? 'Stream paused.' : 'Waiting for events… interact with the app to see them flow.'}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {filtered.map((e) => {
                  const active = selected?.id === e.id;
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(e)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3.5 py-2 text-left outline-none transition',
                          active ? 'surface-raised' : 'hover:[background:var(--fill-2)]',
                        )}
                      >
                        <StatusDot tone={priorityTone(e.priority)} />
                        <span className={cn('shrink-0 font-mono text-xs font-medium', TEXT_TONE[categoryTone(e.category)])}>
                          {e.type}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-faint">
                          {e.source}
                          {e.resource ? ` · ${e.resource.name ?? e.resource.id}` : ''}
                        </span>
                        <span className="shrink-0 text-2xs text-faint">{formatRelative(e.timestamp)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Detail + subscriber status */}
        <div className="w-full shrink-0 space-y-4 lg:w-80">
          <div className="rounded-2xl border border-[var(--hairline)] p-4 [background:var(--fill-1)]">
            <h3 className="mb-2 text-sm font-semibold text-muted">Event detail</h3>
            {selected ? (
              <EventDetail event={selected} />
            ) : (
              <p className="text-xs text-faint">Select an event to inspect its full payload.</p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--hairline)] p-4 [background:var(--fill-1)]">
            <h3 className="mb-1 text-sm font-semibold text-muted">Throughput &amp; latency</h3>
            {metrics ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <Metric label="Events / min" value={formatCount(metrics.eventsPerMinute)} />
                <Metric label="Avg dispatch" value={`${metrics.avgDispatchMs}ms`} />
                <Metric label="Published" value={formatCount(metrics.eventsPublished)} />
                <Metric label="Buffered" value={formatCount(metrics.bufferedEvents)} />
                <Metric label="Dropped" value={String(metrics.droppedEvents)} tone={metrics.droppedEvents > 0 ? 'red' : undefined} />
                <Metric label="Subscribers" value={String(metrics.subscribers)} />
              </div>
            ) : (
              <p className="text-xs text-faint">Loading…</p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--hairline)] p-4 [background:var(--fill-1)]">
            <h3 className="mb-2 text-sm font-semibold text-muted">Subscriber status</h3>
            <div className="space-y-1">
              {(diag?.subscribers ?? []).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink">{s.id}</span>
                  <span className="flex shrink-0 items-center gap-2 text-faint">
                    <span className="tabular-nums">{formatCount(s.events)}</span>
                    {s.errors > 0 && <span className="tabular-nums text-syspink">{s.errors} err</span>}
                    <span className="tabular-nums">{s.avgMs}ms</span>
                  </span>
                </div>
              ))}
              {(diag?.subscribers ?? []).length === 0 && <p className="text-xs text-faint">No subscribers reporting.</p>}
            </div>
          </div>
        </div>
      </div>
    </OpsPanel>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: OpsTone }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-faint">{label}</span>
      <span className={cn('font-medium tabular-nums', tone ? TEXT_TONE[tone] : 'text-ink')}>{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-2xs uppercase tracking-wide text-faint">{label}</span>
      <span className="min-w-0 break-all text-right text-xs text-ink">{value}</span>
    </div>
  );
}

function EventDetail({ event }: { event: PlatformEvent }): JSX.Element {
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(event, null, 2)).catch(() => undefined);
  };
  const meta = Object.entries(event.metadata);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StatusDot tone={priorityTone(event.priority)} />
        <span className={cn('font-mono text-xs font-semibold', TEXT_TONE[categoryTone(event.category)])}>{event.type}</span>
      </div>
      <div className="rounded-xl [background:var(--fill-2)] px-3 py-2">
        <Row label="ID" value={event.id} />
        <Row label="Category" value={event.category} />
        <Row label="Priority" value={event.priority} />
        <Row label="Version" value={String(event.version)} />
        <Row label="Source" value={event.source} />
        <Row label="Actor" value={`${event.actor.kind}${event.actor.id ? ` · ${event.actor.id}` : ''}`} />
        {event.resource && <Row label="Resource" value={`${event.resource.type} · ${event.resource.name ?? event.resource.id}`} />}
        <Row label="Time" value={new Date(event.timestamp).toLocaleString()} />
        <Row label="Correlation" value={event.correlationId} />
        {event.causationId && <Row label="Causation" value={event.causationId} />}
      </div>
      {meta.length > 0 && (
        <div className="rounded-xl [background:var(--fill-2)] px-3 py-2">
          <div className="mb-1 text-2xs uppercase tracking-wide text-faint">Metadata</div>
          {meta.map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
        </div>
      )}
      <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
        <Icon name="clipboard" size={13} /> Copy JSON
      </button>
    </div>
  );
}
