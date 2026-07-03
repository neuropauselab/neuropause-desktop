# NeuroPause — Diagnostics Center

> Status: **Part B‑2·II·B** — implemented and shipped.
> Lives at **Operations → Diagnostics** (`operations/DiagnosticsPanel.tsx`),
> backed by the `diagnostics:get` IPC from the platform core (II·A).

The Diagnostics Center is the production health surface for the whole platform.
Every number on it is a **real snapshot** from the main process — there are no
mocked values. It polls while open, keeps a short health history, and gives
actionable recovery guidance when something is wrong.

## What it monitors

The report aggregates two built‑in checks plus a probe of every core service:

| Check | Source | Healthy means |
| --- | --- | --- |
| **Event Bus** | Live bus metrics | No dropped events, no failing subscribers. |
| **Timeline Service** | Live timeline stats | Events recording normally. |
| **IPC** | The secure bridge | Responding (we're answering this call). |
| **Registry** | `registry.isIntegrityOk()` | Integrity verified. |
| **Package Service** | `packageService.operations()` | Operation pipeline reachable. |
| **Runtime** | `supervisor.list()` | Supervisor reachable. |
| **Plugin Host** | `pluginManager.list()` | Plugin runtime reachable. |
| **Background Services** | Service manager | Scheduler, health monitor, update checker, crash reporter running. |
| **Backend · Database · Cache** | Timed backend round‑trip | Backend (and therefore Postgres/Redis behind it) answering, with latency. |

Each check reports a status — **Operational / Degraded / Down / Unknown** — a
short detail line, and (when not healthy) a recovery recommendation.

## What it shows

- **Overall status banner** — the worst status across all checks, with uptime
  and the time of the last check.
- **Health history** — a compact strip of the last ~48 polls, each tick coloured
  and sized by the overall status at that moment, so a flap or a slow drift is
  visible at a glance. (In‑memory for the session.)
- **Metrics grid** — events published, events per minute, subscriber count,
  dropped events, average dispatch time, and total timeline events. These are
  the Event Bus's live counters.
- **Service checks** — one card per check with its status badge, detail, latency
  (where measured), and an inline recovery recommendation when degraded/down.
- **Subscriber status** — every bus subscriber with its delivered‑event count,
  error count (highlighted if non‑zero), and average handler time.

## Live status, history, and export

- **Live** — polls `diagnostics:get` every 4 seconds; the toggle pauses/resumes
  polling, and **Refresh** forces an immediate read.
- **Export** — downloads the current `DiagnosticsReport` as formatted JSON
  (`neuropause-diagnostics-‹ts›.json`), suitable for a support bundle.
- **Event log** — downloads the full durable event timeline as JSONL via
  `timeline:export` (`neuropause-timeline-‹ts›.jsonl`). This call is audited.

## Recovery recommendations

When a check is degraded or down, the card surfaces a specific next step rather
than a generic error. Examples:

- *Backend · Database · Cache → Down* → "Start the backend (`npm run dev`) and
  infrastructure (`npm run infra:up`)."
- *Registry → Degraded* (integrity failed) → "Restore from a backup."
- *Event Bus → Degraded* (a subscriber is failing) → names the failing
  subscriber(s) so you know where to look.

## How statuses combine

The overall status is the **worst** of all checks, ranked
`ok < unknown < degraded < down`. So a single down service turns the banner red
while still showing every healthy check beneath it — you see both the headline
and the detail.

## Where the code lives

```
apps/desktop/src/renderer/src/operations/DiagnosticsPanel.tsx   The surface
apps/desktop/src/main/platform/diagnostics.ts                   The aggregator
apps/desktop/src/main/platform/index.ts                         Probe wiring
packages/shared/src/types/platform.ts                           DiagnosticsReport / DiagnosticCheck
```
