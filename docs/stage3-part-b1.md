# Phase 3 · Stage 3 · Part B-1 — Operations Center (Monitoring)

The Operations Center is the command surface that makes NeuroPause feel like an
operating system rather than a launcher. **Part B-1** ships the *monitoring*
half: a new top-level **Operations** section, a live data provider that wires
every event stream, and five real panels — **Overview, Installed Applications,
Running Sessions (Runtime Monitor), Health, and Activity Log**. The remaining
five management panels (Plugins, Downloads, Updates, Permissions, Collections)
and the Command-Palette global search arrive in **Part B-2**; they render honest
"Arrives in Part B-2" placeholders today so the full command-center structure is
already visible.

---

## 1. Architecture — strict module boundaries

The four backend-facing modules stay completely separate, exactly as the spec
requires. The Operations Center is a **pure consumer of their public IPC
services** — no UI component imports a runtime internal, a registry table, a
package-service queue, or the plugin host directly.

```
┌────────────────────────── main process ──────────────────────────┐
│  Runtime Supervisor   Package Service   Local Registry   Plugin   │
│  (lifecycle/health)   (install/verify)  (records/flags)   Host    │
└───────┬───────────────────┬─────────────────┬──────────────┬──────┘
        │  public IPC only   │                 │              │
   ┌────▼────────────────────▼─────────────────▼──────────────▼────┐
   │           Secure preload bridge  (context-isolated)           │
   │   window.neuropause.invoke / subscribe  →  typed `ipc.*`       │
   └────┬──────────────────────────────────────────────────────────┘
        │   ipc.runtime · ipc.nps · ipc.registry · ipc.plugins · ipc.perms
   ┌────▼──────────────────────────────────────────────────────────┐
   │                     OperationsProvider                         │
   │  state hub + 3 event subscriptions + 3 s poll + activity log   │
   └────┬──────────────────────────────────────────────────────────┘
        │  useOperations()
   ┌────▼────┬──────────┬──────────┬─────────┬───────────────────────┐
   │ Overview│ Installed│ Sessions │ Health  │ Activity Log          │
   └─────────┴──────────┴──────────┴─────────┴───────────────────────┘
```

The renderer's only contract with the backend is the typed client in
`renderer/src/lib/ipc.ts`. Every Operations panel calls through
`useOperations()` (which calls `ipc.*`) or, for one-off probes, `ipc.*`
directly. There is no path from a panel to a module's internals.

### Module map (renderer)

| Path | Responsibility |
| --- | --- |
| `operations/OperationsProvider.tsx` | Live state hub: subscriptions, polling, activity log, action wrappers |
| `operations/OperationsView.tsx` | Command-center shell: sub-nav + panel routing + live indicator |
| `operations/lib.ts` | Pure status→`{label, tone}` maps + formatters (uptime/bytes/eta) |
| `operations/primitives.tsx` | Shared UI: `StatusDot`, `StatusBadge`, `OpsPanel`, `Stat`, `OpsTable`, `Bar`, `IconAction` |
| `operations/*Panel.tsx` | One panel per surface; all read from `useOperations()` |

---

## 2. IPC architecture documentation

All channels are request/response (`invoke`) or broadcast (`subscribe`) over the
context-isolated preload bridge. Operations consumes these **public** services:

### Request/response (read + command)

| Service | Methods used by Operations |
| --- | --- |
| `ipc.runtime` | `list()`, `launch(slug)`, `suspend(id)`, `resume(id)`, `restart(id)`, `stop(id)`, `health(id?)` |
| `ipc.nps` | `operations()`, `uninstall(slug)`, `verify(slug)`, `repair(slug)` (B-2 adds `pause/resume/cancel/update/rollback`) |
| `ipc.registry` | `list()`, `stats()`, `setFlags(slug, {pinned, favorite})` |
| `ipc.plugins` | `list()` (B-2 adds `enable/disable/reload/update/remove/grant/revoke`) |
| `ipc.perms` | `list(slug)` (B-2 Permission Center adds `grant/revoke`) |
| `ipc.catalog` | `categories()` (used as a backend+DB reachability probe in Health) |

### Broadcast (subscribe) — the real-time spine

| Channel | Payload | Drives |
| --- | --- | --- |
| `ipc.runtime.onEvent` | `RuntimeEvent` | Instance refresh + activity log |
| `ipc.plugins.onEvent` | `PluginHostEvent` | Plugin refresh + activity log |
| `ipc.nps.onProgress` | `NpsProgressEvent` | Live download-progress patch + activity log |

Each subscription returns an unsubscribe function; the provider stores all three
and tears them down on unmount, alongside the poll interval.

---

## 3. Runtime event model

The provider treats the UI as a **projection of an append-only event stream**.
There are three live sources plus a low-frequency poll for samples the backend
emits continuously (CPU/memory), which would be wasteful to broadcast.

### Event sources

1. **`RuntimeEvent`** — `{ type: 'lifecycle' | 'health' | 'crash' | 'log', instanceId, appSlug, status, health, message, at }`.
   On any event the provider appends a log entry (tone by type: crash→red,
   health→amber, else blue) and re-fetches `runtime.list()` to reconcile state.

2. **`PluginHostEvent`** — `{ pluginId, type: 'lifecycle' | 'log' | 'crash' | 'host', status, health, message, at }`.
   Appends a log entry and re-fetches `plugins.list()`.

3. **`NpsProgressEvent`** — `{ id, appSlug, status, progress, bytesDownloaded, bytesTotal, message }`.
   The matching operation is **patched in place** so progress animates smoothly
   between polls. A log entry is appended **only on status transitions** (a
   `Map<id, status>` ref guards against logging every tick), and a registry
   refresh fires when an operation reaches `completed`.

### Reconciliation strategy

- **Events** carry *what changed* and trigger a targeted refetch — the authoritative
  state always comes from the list endpoint, so the UI can never drift from the
  backend even if an event is missed.
- **Polling** (`POLL_MS = 3000`) refreshes `runtime.list()` and `nps.operations()`
  to pull fresh resource samples and progress. Polling is paused implicitly when
  the section unmounts (interval cleared).
- **Activity log** is a capped ring buffer (`LOG_CAP = 500`, newest-first) composed
  from all three streams plus action outcomes. Entries are tagged by source
  (`runtime | plugin | download | permission | registry | system`) for filtering
  and JSON export.

### State shape

```ts
interface OperationsState {
  instances:  RuntimeInstanceDto[];   // runtime.list()  + onEvent + poll
  plugins:    PluginDto[];            // plugins.list()  + onEvent
  operations: NpsOperationDto[];      // nps.operations() + onProgress + poll
  registry:   RegistryEntryDto[];     // registry.list()
  stats:      RegistryStats | null;   // registry.stats()
  logEntries: OpsLogEntry[];          // composed, capped at 500
  ready:      boolean;                // first full load complete
}
```

Action helpers (`runtimeLaunch`, `runtimeSuspend/Resume/Restart/Stop`,
`appUninstall/Verify/Repair`, `setFlags`) each wrap a public IPC call, append a
log entry describing the outcome, and trigger the relevant refresh — so a button
press, its backend effect, and its audit trail are a single unit.

---

## 4. Operations Center documentation (panels)

**Overview (Runtime Overview).** Four live stat tiles (installed / running /
active plugins / active downloads), a system-health card (disk, launches,
pinned, favorites with an overall status dot), and a recent-activity list of the
last-launched apps. Cross-links into Health and Installed.

**Installed Applications.** The Local Registry inventory as a table: glyph,
favorite/pin markers, runtime adapter, version + channel, disk, launch count,
last launch, and live status. Row actions: favorite, pin, launch, **verify
integrity**, **repair**, and **uninstall** (two-click armed confirm). Clicking a
row expands a detail drawer (install location, package hash, signature key,
install/update times, active minutes, granted-permission chips).

**Running Sessions (Runtime Monitor).** Every runtime instance with live status
(Running / Sleeping / Starting / Stopping / Crashed / Failed), health, CPU,
memory, uptime, and restart count, plus the runtime adapter. Actions are
status-aware: Launch (stopped), Suspend (running), Resume (sleeping), Restart and
Terminate (active), Open Logs, Open Registry Entry.

**Health Center.** Five **real, timed IPC probes** — Runtime Supervisor, Local
Registry, Package Service, Plugin Host, and Store API · Database — each measured
with `performance.now()`: Healthy under 800 ms, Slow above, Down on error. Two
derived rows (Secure IPC Bridge, Disk & Storage) and a Re-check action.

**Activity Log.** The composed event timeline with source filter chips (All /
Runtime / Downloads / Plugins / Permissions / Registry / System), relative
timestamps, tone dots, and **JSON export** of the current (filtered) view.

---

## 5. Performance notes

- **Bounded re-renders.** State lives in one provider; panels read via context and
  re-render only on the slices they use. The activity log is capped at 500 entries
  to keep array operations and DOM size bounded over long sessions.
- **Events over polling where it matters.** Lifecycle, crash, and download-status
  changes arrive as broadcasts (no busy-wait). Only continuously-varying samples
  (CPU/memory/progress) are polled, at a deliberate 3 s cadence.
- **In-place progress patching.** Download progress mutates the single matching
  operation rather than refetching the whole list on every tick, so a fast
  download doesn't thrash the renderer.
- **Transition-gated logging.** A status ref ensures one log entry per state
  change, not one per progress event — the log stays readable and cheap.
- **Cleanup on unmount.** All three subscriptions and the poll interval are torn
  down when the section is left, so background work stops when Operations isn't
  visible.
- **Honest boundaries.** Resource columns show real CPU/memory for web/renderer
  instances; native child processes that don't expose per-PID metrics through the
  supervisor render `—` rather than a fabricated number. Per-PID native sampling
  is a documented seam for a later phase.

---

## What's next — Part B-2 (Management)

Plugin Manager, Download Center, Update Center, Permission Center, Collections,
and the Command-Palette global-search expansion. All build on the same provider
and public IPC surface already wired here — the management panels replace the
five placeholders and flip their nav tabs to ready.
