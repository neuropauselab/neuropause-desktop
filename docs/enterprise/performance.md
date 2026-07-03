# Enterprise Experience — Performance

> How the Stage 2 surfaces stay fast and live without adding load.

## Rendering: lazy, code-split

The entire Enterprise experience is a single lazily-loaded route. The shell
imports it with `React.lazy` behind `Suspense` + an `ErrorBoundary`, so it is not
in the initial bundle and a failure in one surface cannot take down the app.

From the production build:

```
out/renderer/assets/EnterpriseView-*.js    128 kB   (lazy chunk — all 8 surfaces)
out/renderer/assets/index-*.js             750 kB   (shell, loaded once)
```

The eight surfaces share one chunk; switching sub-tabs is pure in-memory state,
no network and no new download.

## One provider, minimal work

`EnterpriseProvider` is the only data owner. It avoids redundant load two ways:

- **Single initial fan-out** — twelve parallel `ipc` calls on mount, once.
- **Two-tier refresh** — events are debounced 180 ms, then:
  - enterprise events → **full** refresh (structure/governance changed),
  - workforce + platform events → **light** refresh of only the fast-moving
    slices (snapshot, compliance, audit, jobs, workers).

High-frequency job/platform traffic therefore never triggers the heavy org/graph
reload. There is **no polling** — updates are event-driven off the Platform Event
Bus.

## Computed on demand, not duplicated

- The executive snapshot, organization graph, and compliance findings are
  **projections** the backend computes per request — the renderer never keeps a
  second copy of truth.
- Graph **neighbors** are fetched lazily, only for the node you select.
- Briefings, federated search, and a worker's skill list are fetched **on demand**
  by their panels, not held in the provider — so they cost nothing until used.

## Preferences are local

Dashboard widget visibility and navigation choices live in `localStorage`
(`np.enterprise.*`). Reading or changing them is instant and never touches the
backend.

## The data underneath is cheap

The Stage 1 / Phase 5 engines that produce what these surfaces read are
benchmarked over **5,000 entities** (`src/main/__bench__/performance.test.ts`):

```
graph.project              8.30 ms
memory.index              17.08 ms
search.query               3.58 ms
timeline.query             3.83 ms
briefing.generate          3.62 ms
recommendations.generate  15.16 ms
```

Every engine is well under a frame budget, so a refresh — even a full one —
returns quickly.

## Verification

| Check | Result |
| --- | --- |
| `tsc -p tsconfig.node.json` | 0 errors |
| `tsc -p tsconfig.web.json` | 0 errors |
| `vitest run` | 30 files / 157 tests pass |
| `electron-vite build` | succeeds; Enterprise chunk emitted |

Stage 2 adds no backend, so the 133 secure-IPC handlers and the test count are
unchanged from Stage 1.
