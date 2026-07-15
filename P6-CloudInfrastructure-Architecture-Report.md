# P6 — Cloud & Infrastructure Control Plane (Architecture)

**Status:** ✅ Architecture production complete — all 6 validation gates green
**Scope:** The five P6 architecture pillars — Cloud Platform abstraction, Discovery Engine, Cloud Platform Center, Resource Graph, Infrastructure Runtime — implemented as production-tested code that EXTENDS the existing runtime.
**Stop condition honored:** No concrete provider was built. **AWS, Azure, and GCP have NOT been started** — those begin in P6.1 against this architecture.

---

## 1. Repository Recon (FIRST — nothing was implemented until recon completed)

Four parallel repository-intelligence sub-agents mapped the exact seams, with file:line references. The decisive findings:

- **Naming collision.** `cloud/`, `ipc.cloud`, `cloud:*`, section `'cloud'`, and `types/platform.ts` are already owned by the Phase-9 Cloud Platform (tenancy/SSO/API). P6 therefore uses **`infrastructure`** / `ipc.infra` / `infra:*` throughout (the user-facing label is "Cloud Platform Center").
- **The reuse precedent already exists.** The ERP Relationship Engine → `erpGraphBridge` → the ONE Knowledge Graph is the proven pattern for adding a domain graph WITHOUT a parallel graph. The Resource Graph mirrors it exactly.
- **The runtime is injectable.** The sync `SyncOrchestrator` is a plain class over `OrchestratorPorts`; `SyncStateStore`/`RetryQueue`/`RateLimiter`/`HttpClient` are Electron-free classes; every subsystem plugs into `runtimeCore` via `init<X>({ broadcast, publish })` → `defs.push(...x.handlers)`. Timeline/Diagnostics/Memory/Automation all attach to the one Platform Event Bus.
- **Additive integration.** The whole subsystem fits: new `infra/*` shared modules + new `main/infrastructure/*` + new `renderer/infrastructure/*`, with small additive edits to the barrel, channels, contracts, `runtimeCore`, `ipc.ts`, and the shell. `ConnectorId` is `string`, `MANIFEST_BY_ID` auto-derives, no count-based test to break.

---

## 2. Architecture Decision

**A Cloud Platform is a NEW abstraction layered ON the existing runtime — never an ordinary connector, never a new runtime.** The reasoning, referencing existing code:

| Concern | Decision | Reuses (existing code) |
|---|---|---|
| Platform model | `CloudPlatform` + `InfrastructureDomain` (15 domains), declared by a `CloudPlatformManifest` in its own catalog + registry (mirrors `ConnectorManifest`/`registry.ts`) — **distinct** from connectors | manifest/registry pattern |
| Discovery | `CloudPlatformAdapter` exposes one `DomainCollector` per domain; `collect(ctx) → DiscoveryPage` mirrors `AdapterResource.pull(ctx) → SyncPage` | the incremental page/cursor model |
| Resource model | Cloud resources are a parallel `CloudResource` model (NOT forced into `UnifiedEntityKind`), analogous to how `ResourceStore` is the analog of `UnifiedStore` | store/change-detection design |
| Resource Graph | Pure `ResourceGraphModel` (health/risk/blast-radius/KPIs) bridged into the ONE EKG via `resourceGraphBridge` — the ERP-bridge precedent, reusing the existing 10 `GraphEdgeType`s | `erpGraphBridge`, `graphStore` |
| Runtime seams | Discovery reuses `RetryQueue`/`RateLimiter`/`HttpClient`; emits onto the Platform Event Bus (→ Timeline); registers a diagnostics probe | bus, diagnostics, retry, rate-gate |
| Center | The Cloud Platform Center mirrors the Connector Center (pure model + provider + tabbed hub), reusing the design system + secure-bridge IPC | `connectorCenterModel`, NPDS |

**Nothing duplicates a production system.** No new runtime, OAuth, vault, health engine, inspector, timeline, memory, or graph.

---

## 3. Infrastructure Runtime Design

`initInfrastructure(deps)` (`main/infrastructure/index.ts`) is the composition root, wired into `runtimeCore` beside `initConnectors`/`initCloud`:

- **Platform registry** (`platformRegistry.ts`) — holds `CloudPlatformAdapter`s; empty until P6.1.
- **Catalog** (`cloudPlatformManifests.ts`) — metadata declarations of AWS/Azure/GCP/Kubernetes/Docker/Cloudflare (identity, domains, auth kind, account noun) — **no discovery code**.
- **Resource Store** (`resourceStore.ts`) — the infra analog of `UnifiedStore`; content-signature upsert (excludes the run clock, so an unchanged re-discovery is a no-op), scoped native-id deletion, TTL-cached graph projection.
- **Discovery state** (`discoveryState.ts`) — the infra analog of `SyncStateStore`; durable per-domain cursor + stats, crash-reconcile.
- **Discovery Engine** (`discoveryEngine.ts`) — see §6.
- **Event builders** (`infraEvents.ts`) — publish `infrastructure.*` events onto the bus (→ Timeline).
- **Diagnostics probe** — discovery health rolls into the existing diagnostics report (registered in `runtimeCore`).
- **IPC** — 6 RBAC-gated channels (`infra:platforms|stats|capabilities|resourceGraph|resourceNeighbors|discover`) + the `infra:event` broadcast.

Wiring in `runtimeCore.ts` is three additive lines (init, `defs.push(...infrastructure.handlers)`, `infrastructure.probe`). Registration and the preload bridge are automatic.

---

## 4. Cloud Platform Center

A new renderer hub (`renderer/infrastructure/`), the infrastructure sibling of the Connector Center — **Connector Center = business SaaS; Cloud Platform Center = infrastructure**:

- **Pure view-model** (`infrastructureCenterModel.ts`, framework-free, unit-tested) — status/tone metadata, platform filtering, overview rollup, resource-graph summary. Mirrors `connectorCenterModel.ts`.
- **Provider** (`InfrastructureProvider.tsx`) — one context over `ipc.infra.*` with a debounced live subscription, mirroring `CloudProvider`.
- **Hub** (`InfrastructurePage.tsx`) — tabbed **Overview / Platforms / Resource Graph / Discovery**, rendering with the existing design system (`Stat`, `StatusBadge`, `SegmentedTabs`, `Card`, `Icon`). The Resource Graph tab surfaces blast-radius; Discovery shows per-platform state.
- **Section** — a new `infrastructure` section (icon `server`) in the sidebar + `InfrastructureView` in the app shell. No preload edit (allowlist-driven).

---

## 5. Resource Graph

The typed, directed infrastructure graph (`shared/infra/resourceGraph.ts`), pure and deterministic:

- **Nodes** — `CloudResource` (`platform:account:type:nativeId` id, domain, health, tags, attributes, relationships).
- **Nine relationship kinds** — Runs On, Depends On, Uses, Connected To, Member Of, Hosted By, Attached To, Backed By, Protected By.
- **`buildResourceGraph`** — dedups by id, resolves each relationship's target (a resolved id OR a native id **scoped to the declaring account** — see §9 Finding 4), materializes edges (dropping dangling + self edges), and computes counts, health rollups, orphan detection, and **blast radius** (reverse reachability — single-point-of-failure ranking). Cycle-safe.
- **Traversal** — `resourceNeighbors`, `resourceDependencyTree` (what a resource depends on), `resourceImpactAnalysis` (what depends on it).
- **EKG bridge** (`resourceGraphBridge.ts`) — projects the model into `cloud_resource` EKG nodes + edges, mapping the nine relations onto the existing 10 generic `GraphEdgeType`s while preserving the precise relation in `edge.label` + `metadata.relation` (and keying edge ids on the precise relation so distinct relations never collapse — §9 Finding 3). Ids namespaced `resource:` so they never alias a UDM id. A single `cloud_resource` `GraphNodeType` was added (the only graph-enum edit). This makes every cloud resource visible to the Timeline, AI Memory, Search, Traces, and Executive Center — the ONE graph, no parallel.

---

## 6. Discovery Engine

`InfrastructureDiscoveryEngine` (`discoveryEngine.ts`) — the discovery analog of the sync orchestrator, a plain class over injected ports:

- **Incremental** — reads the durable cursor, pages a domain via `collect()` up to `MAX_DISCOVERY_PAGES` (50, matching the sync per-resource cap), persists the cursor each page so the next run resumes — **never an unnecessary rescan**.
- **Graceful degrade** — a 403 → `unauthorized`, a 404 → `unprovisioned` (the domain degrades, the platform survives); a hard domain error is isolated so one domain never fails the account.
- **Retryable classification** — 429 (`RateLimitError`), offline (`NetworkError`), and retryable 5xx are marked retryable, matching the sync orchestrator's taxonomy (§9 Finding 2), ready for the P6.1 `RetryQueue` wrap.
- **Reuses** — `RetryQueue`/`RateLimiter`/`HttpClient` verbatim; sinks resources into the Resource Store; publishes `infrastructure.discovery_started/completed/failed` onto the bus.
- **Bounded + cycle-free** — verified by the adversarial review (a fixed-cursor `hasMore:true` collector loops exactly 50× then stops).

Tested end-to-end with a fake platform (2 collectors paging incrementally + 1 degrading) — no concrete provider.

---

## 7. Security Review

- **No parallel OAuth / vault.** `CloudPlatformAuthKind` REFERENCES existing mechanisms (`oauth2` reuses the connector OAuth engine + vault; `api_key`/`service_account`/`kubeconfig`/`iam_role` reuse the same encrypted vault). No credential code was added.
- **No secret in any DTO / resource / cursor / event.** `ResourceAttributes` is documented as never a secret; the cursor holds only tokens/offsets/etags; events carry ids + counts.
- **RBAC.** All 6 IPC handlers are `requireAuth` + permission-gated via the existing secure bridge — reads reuse `connectors:read`, discovery reuses `connectors:manage` (+ `audit`). A dedicated `infrastructure:read`/`infrastructure:manage` scope and high-privilege action scopes (Restart VM / Rotate Secret / …) land in P6.1 with the automation actions; this architecture increment is read-mostly (discovery is the only write, and it's a no-op until an adapter exists).
- **Least privilege** — discovery adapters will issue read-only API calls; the automation-action layer (restart/scale/rotate) is deferred to P6.1 and will reuse the existing confirmation-gated `WriteAction` executor + the automation "never auto-execute a mutating action" rule.
- **Adversarial review** run before shipping — 4 confirmed correctness defects found and fixed (§9).

---

## 8. Performance Review

Designed for the stated scale (100 accounts, 1000 subscriptions, millions of resources):

- **Incremental by construction** — durable per-domain cursors; a domain re-scans only what changed. The `DiscoveryCursor` carries an `etag` slot for conditional skip-an-unchanged-domain.
- **Bounded per run** — 50 pages/domain; the offset/token continuation resumes across runs; the store's content-signature dedup means an unchanged re-discovery writes nothing and rebuilds no graph (TTL-cached).
- **Rate-gated + retryable** — reuses `RateLimiter` + the retry taxonomy, honoring provider throttles.
- **Streaming-ready** — the page/cursor model streams resources into the store incrementally rather than materializing a whole account at once; the Resource Graph is a pure O(V+E) build over the current set, cached.
- **Renderer** — the Cloud Platform Center reads compact DTOs + a summarized graph model (blast-radius top-10), never the full resource set, and refreshes on a 250 ms-debounced live subscription.

---

## 9. Regression Review + Adversarial Findings

- **All 6 gates green.** Desktop suite **2293 tests / 258 files**, up from 2257 — **+36** P6 tests, **zero** regressions.
- **Additive-only edits to shared/production files** — barrel exports, one `cloud_resource` graph node type, one `infrastructure` event category + types, `Infra*` channels/contracts, three `runtimeCore` lines, one `ipc.infra` namespace, one section + view, one vitest include. No existing behavior changed.

**Adversarial review (independent sub-agent) — the core graph math + cursor loop were verified sound; 4 confirmed defects fixed:**

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **HIGH** | `ResourceStore` deleted by an **unscoped** native id — a role named `AdminRole` in account B could delete account A's role (cross-account) and miss B's. The live sink even dropped the scope. | **Fixed.** Native-id deletion is scoped to the discovering `(platform, account)`; the sink threads the scope. Regression test proves only the scoped resource is deleted. |
| 2 | MED/HIGH | The engine marked **429/network non-retryable** (they're `RateLimitError`/`NetworkError`, not `HttpError`), contradicting the orchestrator it mirrors — a transient throttle would become terminal once P6.1 wraps it in a RetryQueue. | **Fixed.** `isRetryable` now covers `RateLimitError`/`NetworkError`/retryable `HttpError`. Regression test for both. |
| 3 | MED/HIGH | The EKG bridge keyed edge ids on the **generic** type, so `A backed_by B` + `A protected_by B` (both → `references`) collapsed to one id — downstream dedup silently dropped one relation. | **Fixed.** Edge id keyed on the precise relation; both survive as distinct edges. Regression test. |
| 4 | MED | `buildResourceGraph` resolved native-id targets **globally, first-wins** — a bare native id could bind an edge to the wrong account's resource. | **Fixed.** Native-id resolution scoped to the declaring resource's `(platform, account)`. Regression test proves the same-account target wins. |

The review explicitly cleared: the adjacency idiom, cycle-safety of all three traversals, blast-radius self-exclusion, dedup/dangling/self-edge handling, the MAX_PAGES bound, cursor persistence across the page loop, domain isolation, and the graceful 403/404/5xx taxonomy.

---

## 10. Tests Added (36, pure-node)

- **`infraModel.test.ts` (18)** — domain catalog completeness (15 domains) + `describeDomains` ordering + manifest projection; graph builder (dedup, native-id resolution, **scoped native-id no-mis-bind**, dangling/self-edge drop, health rollup, blast radius, orphans, empty); traversal (neighbors, dependency tree, impact analysis); discovery factories (`makeResource` id + defaults, `describeCloudPlatform`, cursor codec); the EKG bridge (relation→generic mapping, prefixed `cloud_resource` nodes, precise-relation edges, **distinct-relation no-collapse**).
- **`discoveryEngine.test.ts` (11)** — incremental paging within a run, per-domain outcome + graceful degrade, Resource Graph projection with resolved edges, idempotent re-discovery, run recording + next-discovery time, no-adapter path, hard-error isolation, 404 unprovisioned degrade, **429/network retryable**, **scoped native-id deletion**, registry register/resolve/describe.
- **`infrastructureCenterModel.test.ts` (7)** — status/tone meta, health tone, needs-attention, filtering + providers, overview metrics, resource-graph summary.

---

## 11. Validation Gates (real exit codes)

| Gate | Command | Result |
|---|---|---|
| 1 | `npm run typecheck --workspaces --if-present` | ✅ exit 0 |
| 2 | `npm run lint` | ✅ exit 0 |
| 3 | `npm run test -w @neuropause/desktop` | ✅ exit 0 — 2293 passed |
| 4 | `npm run test -w @neuropause/sdk` | ✅ exit 0 |
| 5 | `npm run test -w @neuropause/cli` | ✅ exit 0 |
| 6 | `npm run build -w @neuropause/desktop` | ✅ exit 0 — built in 5.12s |

**Files:** 18 new (4 shared pure, 9 backend incl. 2 test files, 5 renderer incl. 1 test) + 10 additive edits (barrel, graph node type, platform events, channels, contracts, runtimeCore, ipc.ts, sections, AppShell, vitest config).

---

## 12. Next Increment

**P6.1 — the first concrete Cloud Platform (AWS).** NOT STARTED, per the stop condition. The architecture is complete and green: P6.1 registers an `awsAdapter` (`CloudPlatformAdapter` with per-domain `DomainCollector`s) into the platform registry, wires the credential/token source into `makeHttp`, and adds the high-privilege automation actions (Restart VM / Rotate Secret / …) via the existing confirmation-gated `WriteAction` executor + a dedicated `infrastructure:manage` scope. Every resource it discovers flows — with zero further framework work — into the Resource Graph, the Enterprise Knowledge Graph (via the bridge), the Timeline, Search, AI Memory, and the Cloud Platform Center. **Azure and GCP follow the same shape. None have been started.**
