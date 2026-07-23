# NeuroPause — Engineering Handbook

> Part of the NeuroPause Scientific & Standards Program (NSSP). This is a
> **formalization** of how the platform is *already* engineered — a practitioner's
> account read directly from the codebase, not a design proposal. Every structural
> claim cites a real path. Terminology is authoritative in
> [`GLOSSARY.md`](./GLOSSARY.md); evidence levels follow
> [`../_grounding.md`](../_grounding.md) (**L4** Validated · **L3** Measured ·
> **L2** Implemented · **L1** Modeled · **L0** Proposed).

**Evidence of this handbook: L2 (Implemented).** It describes structures that exist
and run; where it names a measured property it cites the artifact, and where it
names an absent one it labels it plainly.

---

## 1. Shape of the repository

NeuroPause is a single npm-workspaces monorepo
([`package.json`](../../../package.json), `workspaces: ["packages/*", "apps/*"]`).
Node `>=20.11`, TypeScript `strict`, npm `10.5.0`.

| Workspace | Package | Role |
|---|---|---|
| `packages/shared` | `@neuropause/shared` | The contract layer: **1,925 exported types**, the Zod IPC contracts, channel names, and the RBAC scope union. Imported by every app. |
| `packages/sdk` | — | Plugin/extension SDK surface. |
| `packages/cli` | — | Command-line surface. |
| `apps/backend` | `@neuropause/backend` | Express + Postgres + Redis service. |
| `apps/desktop` | `@neuropause/desktop` | Electron + React + TypeScript client. |

The dependency arrow runs **one way**: `apps/*` depend on `packages/shared`; the
shared package depends on neither app. This is what lets the renderer, the preload
bridge, and the backend agree on one contract without a cycle.

---

## 2. The desktop application (Electron)

The desktop app uses `electron-vite` and enforces the standard hardened three-tier
Electron split. The trust boundary is the point of the design.

### 2.1 Main process — `apps/desktop/src/main`

The privileged tier. It owns roughly seventy domain modules (`auth/`, `enterprise/`,
`workforce/`, `connectors/`, `sandbox/`, `graph/`, `memory/`, `intelligence/`,
`ipc/`, `permissions/`, `observability/`, …). It talks to the backend, the OS
keychain, the local registry, and the filesystem. The renderer never does any of
these directly.

### 2.2 Preload — `apps/desktop/src/preload/index.ts`

**The entire surface the renderer can touch.** It runs sandboxed and context-isolated
and exposes exactly two functions on `window.neuropause`:

- `invoke(channel, payload)` — guarded request/response.
- `subscribe(channel, listener)` — guarded broadcast, returns an unsubscribe handle.

Both check the channel against the shared allowlists (`ALL_INVOKABLE_CHANNELS`,
`ALL_SUBSCRIBABLE_CHANNELS`) before any IPC occurs. No Node or Electron internal
leaks through. A channel not on the allowlist is rejected in the preload, before it
ever reaches main.

### 2.3 Renderer — `apps/desktop/src/renderer/src`

React 18 + Tailwind. It is organized into **workspace sections** (`shell/sections.ts`
defines the `SectionId` union and `SectionDef`) — e.g. `intent-home`, `enterprise`,
`workforce-center`, `decision-center`. Each section is a view composed of **lenses**
(§4). The renderer holds no privileged capability; it fetches typed data through the
preload bridge and derives what it displays.

---

## 3. The backend service

`apps/backend/src` is an Express app (`app.ts`, `index.ts`) over Postgres (`pg`),
Redis (`ioredis`), structured logging (`pino`), and Zod. Route groups include
`/auth`, `/store`, `/organizations`, `/billing`, `/devices`, `/subscriptions`, and
the operational probes.

| Endpoint | Shape | Evidence |
|---|---|---|
| `GET /live` | `{status:'alive', uptime}` — liveness, no DB touch | L2 (`app.ts`) |
| `GET /health` | `{status:'ok'|'degraded', components:{database,redis}, uptime}`, 200/503 | L2 (`app.ts`) |
| `GET /metrics` | Prometheus text exposition v0.0.4, aggregate + non-sensitive | L3 (`observability/metrics.ts`) |

`/health` degrades honestly: it pings the database and Redis and reports each
component up/down rather than crashing. This is the seam the reliability runs exercise
(see [Validation](../frameworks/VALIDATION.md)).

---

## 4. The reuse-only "lens" pattern

This is the central engineering discipline and the reason the platform grows without
sprawl. A **lens** is a **pure derivation over data the platform already produces** —
it adds **no** new runtime, IPC channel, engine, or store.

The canonical primitives live in
`apps/desktop/src/renderer/src/aiOperations/aiOperationsModel.ts`: `OpLens`,
`OpStat`, `OpRow`, `OpGroup`, `OpGap`, `OpLink`, `OpsTone`, and the `EMPTY_LENS`
constant. A lens module is a pure function `(existingData) => OpLens`. A worked
example is `platformEcosystem/analyticsModel.ts` (`summarizeAnalytics`), whose header
states the contract exactly:

> "Like every tab in the ecosystem workspace this adds **NO** runtime, IPC channel,
> engine, or store — a **PURE** function over data the renderer already fetched from
> **EXISTING** `ipc.*` methods, composed into one honest analytics lens."

The lens contract carries three non-negotiables, all enforced by tests:

1. **Read only what is real.** Every stat/row comes from a present field. An absent
   source produces an **honest empty state**, never a placeholder or an invented
   number.
2. **Gate demo data OFF.** Demo-seeded inputs are surfaced as labelled gaps
   (`OpGap`), never read as earned numbers — even if a payload happens to carry
   non-zero counts.
3. **Degrade gracefully.** Input shapes are a minimal, defensively-optional subset,
   so partial or absent payloads never throw.

A lens is therefore the L0→L2 bridge in reverse: it lets a new *view* ship at L2
(real, running, tested) without pretending to be a new *engine* it is not.

---

## 5. Contracts — the Zod IPC boundary

The renderer and main never share types by convention; they share them by contract,
in `packages/shared/src/ipc`.

- **`channels.ts`** — the canonical channel-name registry (`IpcChannel`), the single
  string constant every tier agrees on. It is large (600+ entries) and split into a
  legacy auth/app group and the runtime-core group.
- **`contracts.ts`** — a **Zod schema for every IPC payload**. The header states the
  rule: "the main process validates *all* inbound IPC arguments against these before
  doing any work — untrusted renderer input is never trusted by shape alone." Empty
  payloads still get a `z.object({}).strict()` so the router stays uniform.

### 5.1 The secure-bridge pipeline

`apps/desktop/src/main/ipc/secureBridge.ts` runs every runtime-core call through one
ordered pipeline:

1. **Sender trust** — only the app's own renderer frame may invoke.
2. **Auth gate** — channels marked `requireAuth` need an authenticated session.
3. **Permission (RBAC)** — channels declaring a `permission` require the current
   actor to hold that enterprise permission.
4. **Validation** — the payload is parsed against its Zod schema.
5. **Timeout** — handlers are bounded (default 30 s) so a hung backend cannot wedge
   IPC.
6. **Audit** — each call is recorded (channel, outcome, duration).
7. **Error shaping** — failures surface as clean, user-safe messages.

A handler that declares a `permission` but is given no `authorize` dependency **fails
closed**, not open.

### 5.2 Fail-closed channel classification

`apps/desktop/src/main/ipc/runtimeAuthz.ts` closes the "privileged channel riding on
sender-trust alone" gap. It provides:

- `RUNTIME_CHANNEL_PERMISSIONS` — every privileged runtime channel mapped to the
  **existing** `EnterprisePermission` it requires (no new scopes are minted).
- `PUBLIC_CHANNELS` — the vetted allowlist of genuinely-public / parameterless-safe /
  local-desktop channels.
- `assertAllChannelsClassified(...)` — a **startup invariant** that returns every
  channel that is neither gated nor public, so the composition root can fail closed.
  A new privileged channel added without a classification cannot silently ship
  ungated — composition throws.

---

## 6. Access governance (RBAC)

Authorization is one union of scopes, `EnterprisePermission`
(`packages/shared/src/types/enterprise.ts`), enumerated at runtime as
`ALL_ENTERPRISE_PERMISSIONS`. Scopes follow a strict **`resource:action`** naming
convention — `org:read`, `org:manage`, `workforce:operate`, `workforce:approve`,
`executive:verify`, `connectors:manage`, and so on. The canonical vocabulary is **57
enterprise RBAC scopes** (`EnterprisePermission`); ~85 total scope literals exist across all registries. The owner role holds every permission,
so single-user installs are unaffected; the gate bites only for multi-user
enterprise RBAC. The full naming table is in the
[Reference Guide](./REFERENCE-GUIDE.md#rbac-scope-naming).

---

## 7. Quality gates

The platform's L4 evidence rests on gates that are run and recorded, not asserted.
All are invoked from the root [`package.json`](../../../package.json).

| Gate | Command | Passing state | Evidence |
|---|---|---|---|
| Type safety | `npm run typecheck` | 0 errors (`strict`) | L4 |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) | 0 warnings | L4 |
| Build | `npm run build` | exit 0 | L4 |
| Tests | `npm run test` (per-workspace `vitest`) | **3,856 tests / 442 files** green | L4 |
| Supply chain | `npm audit --omit=dev` | **0 production vulnerabilities** | L4 |

The desktop test count (3,548) is the bulk; backend 263, sdk 15, cli 30. CI runs in
[`.github/workflows`](../../../.github/workflows) — `backend-ci.yml`,
`deploy-validation.yml`, `windows-release.yml`. Per-PR desktop CI and macOS release
automation are **not** yet present (tracked as TD-4 in the
[Research Roadmap](./RESEARCH-ROADMAP.md)); the desktop suite is run locally and at
release gating.

---

## 8. Evidence discipline for engineers

The same ladder the science uses governs engineering claims. When you add or change
code, state its level honestly:

- **Do not** write "measured" in a comment or doc unless a `bench/results/*.json`
  artifact or a metric series backs it (that is L3).
- **Do not** write "validated" unless an executed test or gate covers it (L4).
- A new **type/model** with tests but no live wiring is **L1 (Modeled)** — say so.
  `capacityScheduler.ts` and `enterpriseDecisionEngine.ts` are the canonical
  type-only examples.
- A **concept you are proposing** is **L0** until code exists. Label it; do not
  imply an engine that is not there. (The recurring example: "forecast/predict" in
  this codebase is AI-agent *reasoning*, not a statistical prediction engine — there
  is no such engine.)

---

## 9. How to add a capability without duplicating a system

The Sub-Agent-9 discipline: **map to existing systems, never duplicate or redesign
them.** The order of preference when adding a capability:

1. **Prefer a lens.** If the capability is a new *view* or *derived indicator* over
   data the platform already produces, write a pure lens module (§4). No new channel,
   engine, or store. This is L2 the moment it is real and tested.
2. **If it needs new data flow, reuse the contract.** Add the channel name to
   `channels.ts`, a Zod schema to `contracts.ts`, and register the handler through
   the secure bridge — inheriting the whole pipeline (§5). Classify it in
   `runtimeAuthz.ts` or composition throws.
3. **Reuse an existing scope.** Map the channel to an existing `EnterprisePermission`
   (§6). Mint a new scope only when no existing one expresses the authority.
4. **Only then consider new engine code** — and only when steps 1–3 genuinely cannot
   express the capability. New engines are the exception, not the reflex.
5. **Gate it.** It is not done until `typecheck`, `lint`, `build`, `test`, and
   `npm audit --omit=dev` are all green (§7), and its evidence level is stated
   honestly (§8).

The measure of a good change here is not how much it adds, but how little it
duplicates.

---

## 10. Where to look next

- Architecture-to-file mapping: [Reference Implementation Matrix](../REFERENCE-IMPLEMENTATION-MATRIX.md).
- Commands, endpoints, metric catalog, RBAC table: [Reference Guide](./REFERENCE-GUIDE.md).
- What is measured and how: [Benchmark Framework](../BENCHMARK-FRAMEWORK.md) and
  [Benchmark Guide](./BENCHMARK-GUIDE.md).
- The security controls and their open items: [Assurance framework](../frameworks/ASSURANCE.md)
  and [Assurance Manual](./ASSURANCE-MANUAL.md).
- What the platform does **not** yet do: [Research Roadmap](./RESEARCH-ROADMAP.md).
