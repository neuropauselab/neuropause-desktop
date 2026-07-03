# NeuroPause — Platform Core Performance

> Status: **Part B‑2·II·B** — measured and documented.
> Runnable benchmark: `apps/desktop/src/main/platform/benchmark.mts`.

This documents how the event-driven platform core (Part B‑2·II·A) performs and
why it meets its design targets. The figures below are **real measurements** of
the actual `EventBus` and `TimelineService` implementations — not estimates —
taken with the bundled benchmark. Absolute numbers vary by machine; treat them
as orders of magnitude, and use the **Diagnostics Center** for live, on-device
telemetry (`avgDispatchMs`, `eventsPerMinute`).

## Running the benchmark

From `apps/desktop`:

```
node --experimental-strip-types src/main/platform/benchmark.mts
```

It imports the real, Electron-free modules and exercises the bus and timeline
directly. (Node prints a one-line `MODULE_TYPELESS_PACKAGE_JSON` notice because
the desktop package isn't ESM-typed — it's harmless and doesn't affect timings.)

## Measured results

Reference run — Node 22.22, containerised Linux, single core. Your hardware will
differ; the **shape** of the numbers is the point.

### Event Bus

| Scenario | Throughput | Notes |
| --- | --- | --- |
| publish · 1 subscriber · 1,000,000 events | **~460k–580k events/s** (~1.7–2.2 µs/event) | Cost is dominated by `randomUUID()` + ISO timestamp per event. |
| publish · 10 subscribers · 200,000 events | **~325k–330k events/s** (~2M deliveries) | ≈3.2M subscriber deliveries/s; synchronous fan-out scales linearly with subscriber count. |
| publish · throwing + good subscriber · 200,000 events | **~110k–122k events/s** | A subscriber throwing on **every** event; all 200,000 good deliveries still succeed. Error isolation holds with a modest overhead from exception handling. |

The bus's own `avgDispatchMs` metric reads **0 ms** under load because it samples
a millisecond-resolution clock and per-event dispatch is sub-millisecond. The
throughput figures above are the meaningful measure; the live metric exists to
flag *regressions* (a dispatch creeping above 1 ms), not to time the fast path.

### Timeline Service

| Scenario | Result | Notes |
| --- | --- | --- |
| append · 50,000 events (in-memory) | **~11–18 ms** (~2.9M–4.5M ops/s) | Append is an in-memory push plus a ring-buffer trim; persistence is deferred. |
| flush · 50,000 events → one JSONL write | **~310–760 ms** for ~19 MB (≈406 B/event) | This is a worst-case *mega-batch*. Production flushes are ~50 events every 2 s → **well under 1 ms** each (≈15 µs/event amortised). |
| query · filter + full-text search over a 5,000-event window | **~4 ms/query** | Category/priority/text filter across the whole in-memory window; comfortably interactive for user-triggered queries. |

## How the design meets each target

**Low-latency event publishing.** Dispatch is synchronous and direct: on
`publish`, the bus materialises the event, pushes it into the replay ring, and
calls each type-matched subscriber in a tight loop. There's no async hop, queue,
or serialization on the hot path, so latency is sub-millisecond and throughput is
hundreds of thousands of events per second on one core.

**Batched timeline persistence.** Appends never touch the disk. Events accumulate
in memory and are written as **batched JSONL appends** on an interval (or when a
batch threshold is reached), so the durable log costs ~15 µs/event amortised and
the UI thread is never blocked on I/O. A `writing` guard plus requeue-on-failure
means a slow or failed write can't corrupt or drop the buffer.

**Minimal UI-thread impact.** All of the above runs in the **main process**.
The renderer (Diagnostics Center, Event Inspector) only receives already-formed
events over IPC and, in the inspector, **coalesces** them on a 300 ms tick with a
capped buffer — so even an event burst can't thrash React.

**Efficient memory use.** Every unbounded structure is bounded: the bus replay
buffer is a fixed ring (default 500), the timeline keeps a capped in-memory
window (default 5,000) with the full history on disk, and the inspector caps its
view at 300 events. Memory stays flat regardless of how long the app runs or how
many events flow.

**Graceful degradation under load.** Subscribers are isolated — a throwing or
slow handler is caught per-event and recorded (error count + last error in the
Diagnostics Center) without affecting other subscribers or the publisher. If the
bus ever has to drop (it doesn't, by construction, on the publish path), the drop
is counted and surfaced. High-frequency events such as `download.progress` are
delivered live but **excluded from persistence**, so a busy download can't bloat
the timeline.

## Where the numbers show up live

You don't have to run the benchmark to see platform-core performance — the
**Diagnostics Center** (Operations → Diagnostics) shows the same metrics from the
running app: events published, events per minute, average dispatch time, dropped
events, and per-subscriber throughput, error counts, and average handler time.
That's the authoritative, on-device measure for your machine.
