# NeuroPause — Developer Event Inspector

> Status: **Part B‑2·II·B** — implemented and shipped.
> **Developer mode only.** The tab and its command appear only when
> `import.meta.env.DEV` is true; they are absent from production builds.
> Lives at **Operations → Inspector** (`operations/EventInspectorPanel.tsx`).

The Event Inspector is a live window onto the platform event bus — the tool you
reach for when building a feature on top of the Public Event API and you want to
*see* what's actually flowing.

## Opening it

In a dev build, open the Command Palette (⌘K) and choose **Event Inspector**, or
go to **Operations** and select the **Inspector** tab. In a packaged build it
isn't present.

## What it shows

- **Live event stream.** On open it seeds from the recorded timeline (the most
  recent 200 events), then streams every event the main process forwards over
  `platform:event`. Incoming events are coalesced on a 300 ms tick so a burst
  (e.g. a download in flight) stays smooth, and the buffer is capped at 300 to
  bound memory. Each row shows a priority dot, the event type (coloured by
  category), its source and resource, and a relative timestamp.
- **Filters.** Free‑text (matches type, source, and resource), a category
  selector, and a priority selector — combined live.
- **Event detail.** Click any event to see its full payload: id, category,
  priority, version, source, actor, resource, exact timestamp, correlation id,
  causation id, and every metadata field — with a one‑click **Copy JSON**.
- **Replay.** Reloads the recorded event history from the timeline into the
  stream (`timeline:query`). Useful after clearing, or to inspect what happened
  before the inspector was opened.
- **Subscriber status.** Every bus subscriber with its delivered‑event count,
  error count, and average handler time — pulled live from `diagnostics:get`.
- **Throughput & latency.** Events per minute, average dispatch time, total
  published, buffered (replay buffer depth), dropped, and subscriber count.

## Controls

- **Streaming / Paused** — pause to freeze the view and study it without new
  events scrolling in; resume to catch up (events that arrive while paused are
  dropped from the view, not queued).
- **Replay** — reload recorded history.
- **Clear** — empty the current view.

## Correlation and causation in practice

Because every event carries a `correlationId` and `causationId`, the inspector is
how you verify a chain end‑to‑end: trigger an action, then read the resulting
events and confirm they share a correlation id and point back to their cause via
causation. This is the same data Activity Intelligence and Automation will rely
on later, so the inspector doubles as a correctness check for producers.

## Notes for feature authors

- The stream is the **forwarded** bus, so it includes high‑frequency events such
  as `download.progress` that the timeline intentionally does **not** persist.
  Filter by category to cut the noise.
- The inspector reads only — it never publishes or mutates. It is a safe place
  to observe while developing against `ipc.platform`, `ipc.timeline`, and
  `ipc.diagnostics`.

## Where the code lives

```
apps/desktop/src/renderer/src/operations/EventInspectorPanel.tsx   The tool
apps/desktop/src/renderer/src/lib/ipc.ts                           ipc.platform / ipc.timeline / ipc.diagnostics
apps/desktop/src/main/platform/eventBus.ts                         replay buffer + metrics
```
