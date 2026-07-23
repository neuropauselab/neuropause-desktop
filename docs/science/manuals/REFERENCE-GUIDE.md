# NeuroPause — Reference Guide

> Part of the NSSP. A terse, tabular quick-reference over the platform that exists.
> Numbers are copied unaltered from [`bench/results/`](../../../bench/results/) or
> named reports; commands and paths are real. Terms are defined in
> [`GLOSSARY.md`](./GLOSSARY.md); the narrative is the
> [Engineering Handbook](./ENGINEERING-HANDBOOK.md).

---

## Evidence ladder

| Level | Name | Means | Cite with |
|---|---|---|---|
| L4 | Validated | Implemented + verified by tests/gates/reliability | test file + gate/`bench/results` |
| L3 | Measured | Implemented + real recorded telemetry/measurement | metric series / `bench/results/*.json` |
| L2 | Implemented | Exists and runs; not scientifically measured | source path |
| L1 | Modeled | Types/schema exist + tested; not wired live | type path |
| L0 | Proposed | Defined by a framework; not in code | none — labelled |

---

## Commands

### Quality gates (root `package.json`)

| Purpose | Command | Passing |
|---|---|---|
| Type check | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 warnings (`--max-warnings 0`) |
| Build | `npm run build` | exit 0 |
| Tests | `npm run test` | 3,856 tests / 442 files green |
| Prod audit | `npm audit --omit=dev` | 0 production vulns |
| Format check | `npm run format:check` | clean (Prettier) |

### Dev / infra

| Purpose | Command |
|---|---|
| Run backend + desktop | `npm run dev` |
| Backend only | `npm run dev:backend` |
| Desktop only | `npm run dev:desktop` |
| DB migrate | `npm run db:migrate` |
| Infra up / down | `npm run infra:up` / `npm run infra:down` |
| Plugin SDK CLI | `npm run nps` (`tools/nps/cli.mjs`) |

### Benchmarks (`bench/`)

| Harness | Command | Produces |
|---|---|---|
| HTTP load | `node bench/http-load.mjs` | `bench/results/http-load.json` |
| DB latency | `node bench/db-latency.mjs` | `bench/results/db-latency.json` |
| Cold start | `bash bench/startup.sh` | `bench/results/startup.json` |
| Engine hot-paths | `vitest` on `apps/desktop/src/main/__bench__/performance.test.ts` | `bench/results/intelligence-engines.json` |

See the [Benchmark Guide](./BENCHMARK-GUIDE.md) for full reproduction steps and the
[Benchmark Framework](../BENCHMARK-FRAMEWORK.md) for methodology.

---

## Backend endpoints

| Endpoint | Response | Notes | Evidence |
|---|---|---|---|
| `GET /live` | `{status:'alive', uptime}` | Liveness; no DB touch | L2 |
| `GET /health` | `{status:'ok'|'degraded', components:{database,redis}, uptime}` | 200 healthy / 503 degraded; honest per-component | L2 |
| `GET /metrics` | Prometheus text v0.0.4 | Aggregate, non-sensitive; network-restrict in prod | L3 |

Route source: `apps/backend/src/app.ts`. Other groups: `/auth`, `/store`,
`/organizations`, `/billing`, `/devices`, `/subscriptions`.

---

## Metric catalog

Live series from `GET /metrics` (`apps/backend/src/observability/metrics.ts`).

| Series | Type | Meaning |
|---|---|---|
| `neuropause_backend_up` | gauge | 1 when serving |
| `neuropause_backend_uptime_seconds` | gauge | process uptime |
| `neuropause_backend_resident_memory_bytes` | gauge | RSS |
| `neuropause_backend_heap_used_bytes` | gauge | V8 heap used |
| `neuropause_pg_pool_connections{state}` | gauge | Postgres pool by state |
| `neuropause_http_requests_total{method,status}` | counter | HTTP requests |

Full measurement catalog (units, sources, evidence) is the
[Measurement Matrix](../SCIENTIFIC-MATRICES.md#3-measurement-matrix). Selected
measured values, copied unaltered:

| Metric | Unit | Example value | Source |
|---|---|---|---|
| Cold start → healthy | s | 0.66 cold / 0.624 warm | `startup.json` |
| Restart recovery | s | 0.46 | `reliability.json` |
| `/live` throughput | req/s | 2,102.96 | `http-load.json` |
| `/health` throughput | req/s | 1,221.27 | `http-load.json` |
| HTTP error rate | ratio | 0 errors | `http-load.json` |
| DB point read | ms (p50) | 0.23 | `db-latency.json` |
| Engine `graph.project` | ms | 92.84 | `intelligence-engines.json` |
| Argon2id hash / verify | ms (mean) | 21.36 / 20.06 | `argon2.json` |
| Resident memory (idle) | bytes | 117,813,248 | `startup.json` |

**Measurement environment** (`bench/results/environment.json`, captured 2026-07-18):
2 vCPU Intel Xeon @ 2.10 GHz, 8 GB RAM, Node v22.22.2, Postgres 16.13, Redis 7.0.15,
Ubuntu 24.04. Single shared cloud container with the load client co-located — latency
figures are therefore **conservative**, not best-case.

---

## Renderer perf telemetry (harness-ready, L2)

Sampled from real values (rAF frame rate, `performance.memory`). Shapes in
`perfMetrics.ts`; recorder `lib/perf/perfRecorder.ts`; sampler `state/PerfSampler.tsx`.

| Shape | Fields |
|---|---|
| `DurationSummary` | `count, avgMs, p50Ms, p95Ms, maxMs` |
| `IpcChannelStat` | `channel, count, avgMs, maxMs` |
| `RenderComponentStat` | per-component render timing |

---

## Key file locations

| What | Path |
|---|---|
| Shared contract layer | `packages/shared/src` (1,925 exported types) |
| Zod IPC contracts | `packages/shared/src/ipc/contracts.ts` |
| IPC channel registry | `packages/shared/src/ipc/channels.ts` |
| RBAC scope union | `packages/shared/src/types/enterprise.ts` (`EnterprisePermission`) |
| Electron main | `apps/desktop/src/main` |
| Preload bridge | `apps/desktop/src/preload/index.ts` |
| Renderer root | `apps/desktop/src/renderer/src` |
| Secure IPC bridge | `apps/desktop/src/main/ipc/secureBridge.ts` |
| Fail-closed channel authz | `apps/desktop/src/main/ipc/runtimeAuthz.ts` |
| Lens primitives | `apps/desktop/src/renderer/src/aiOperations/aiOperationsModel.ts` |
| Backend app / routes | `apps/backend/src/app.ts` |
| Backend metrics | `apps/backend/src/observability/metrics.ts` |
| Audit log table | `apps/backend/src/db/migrations/0001_init.sql:50` |
| Benchmark harnesses | `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh` |
| Benchmark artifacts | `bench/results/*.json` |
| CI workflows | `.github/workflows/{backend-ci,deploy-validation,windows-release}.yml` |

---

## RBAC scope naming

Convention: **`resource:action`**. Union `EnterprisePermission`
(`packages/shared/src/types/enterprise.ts`); enumerated as
`ALL_ENTERPRISE_PERMISSIONS`. The canonical vocabulary is **57 enterprise RBAC scopes** (`EnterprisePermission`) plus 18 developer API scopes; ~85 total scope literals exist across registries. The
owner role holds all scopes; the gate bites only for multi-user RBAC.

| Action suffix | Grants | Examples |
|---|---|---|
| `:read` | View / observe | `org:read`, `intelligence:read`, `cloud:read`, `federation:read` |
| `:manage` | Create / mutate / configure | `org:manage`, `connectors:manage`, `marketplace:manage`, `cloud:manage` |
| `:operate` | Run / drive execution | `workforce:operate` |
| `:approve` | Approve a pending action | `workforce:approve`, `federation:approve`, `executive:approve` |
| `:verify` / `:execute` | Verify / execute (executive tier) | `executive:verify`, `executive:execute` |

Runtime channel → scope mapping: `apps/desktop/src/main/ipc/runtimeAuthz.ts`
(`RUNTIME_CHANNEL_PERMISSIONS`). A privileged channel with no classification fails
composition (`assertAllChannelsClassified`).

---

## Adopted standards (adoption, not certification)

| Standard | Where |
|---|---|
| SemVer | `1.0.0-rc.1` across `package.json` |
| Conventional Commits | commit history |
| RFC 8252 + PKCE | backend-brokered native OAuth |
| Prometheus exposition | `/metrics` (v0.0.4) |
| Keep a Changelog | `CHANGELOG.md` |
| Ed25519 / Argon2id / SHA-256 | signing / passwords / token hashes |
| TypeScript `strict` | `tsconfig.base.json` |
| Zod IPC contracts | `packages/shared` |

NeuroPause holds **no** international-standard certification. Details:
[Standards Manual](./STANDARDS-MANUAL.md) and
[Standards Matrix](../SCIENTIFIC-MATRICES.md#5-standards-matrix).

---

## Known open items (stated, not hidden)

| ID | Item | Severity |
|---|---|---|
| TD-1 | Apple `id_token` not JWKS-verified | High |
| TD-2 | Unsigned marketplace-app install when trust store empty | High |
| TD-3 | Rate limiter fails open on Redis loss (deliberate) | Medium |
| TD-4 | No per-PR desktop CI / macOS release automation | Medium |
| TD-6 | No alert routing, distributed tracing, or capacity forecasting | Medium |
| TD-7 | Renderer E2E / a11y tests + coverage absent | Medium |

Full backlog: [`ENTERPRISE-GA-REPORT.md`](../../../ENTERPRISE-GA-REPORT.md); research
framing: [Research Roadmap](./RESEARCH-ROADMAP.md).
