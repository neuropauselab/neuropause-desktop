# NeuroPause Enterprise — Operations Guide (Day-2)

Consolidated day-2 operations for the NeuroPause Enterprise GA: how to monitor
health, scrape metrics, read logs, capture diagnostics, respond to incidents, and
where the built-in operational surfaces live. Every capability below is documented
from source with a `file:line` citation. Capabilities that do **not** exist are
called out honestly in [Known Operational Gaps & Recommendations](#known-operational-gaps--recommendations)
rather than implied.

The system has two operable planes:

- **Backend** (`apps/backend`) — the Express cloud API. This is the plane with a
  real HTTP surface: liveness/readiness probes and a Prometheus scrape endpoint.
- **Desktop** (`apps/desktop`, Electron) — the client. Its health, metrics,
  tracing, logging, and recovery are all **in-process**, surfaced to the renderer
  over secure IPC. The desktop exposes no listening network port for
  observability (the only bound socket is the OAuth loopback helper,
  `apps/desktop/src/main/auth/loopbackServer.ts:101`, bound to `127.0.0.1`).

Keep that split in mind throughout: **only the backend `/metrics` endpoint is a
real scrape target.** Desktop telemetry is retrieved by the app itself, not pulled
by an external collector.

---

## Overview

| Concern | Backend | Desktop |
|---|---|---|
| Liveness | `GET /live` (`apps/backend/src/app.ts:84`) | process + tray; NeuroCore snapshot |
| Readiness / health | `GET /health` (deps-checked, `app.ts:88`) | NeuroCore `snapshot()` + Diagnostics `report()` |
| Metrics | `GET /metrics` Prometheus text (`app.ts:99`) | in-process Prometheus formatter (IPC-only) |
| Tracing | per-request `x-request-id` header | per-request OTLP spans (IPC-only, uncorrelated) |
| Logging | pino JSON w/ redaction | IPC `audit.log` (JSONL) + console loggers |
| Incident tooling | Postgres dump/restore scripts | support bundle, crash archive, recovery engines |
| Dashboards | n/a (headless API) | Ops Center, Intelligence, AI Operations, Extensibility |

Deployment mechanics (Compose / Kubernetes / Helm) are covered by
`docs/DEPLOYMENT.md` and `deploy/README.md`; this guide references them but does
not duplicate them.

---

## Monitoring & Health

### Backend probes

Two distinct endpoints, by design:

- **`GET /live`** — liveness (`apps/backend/src/app.ts:84`). Returns
  `{ status: 'alive', uptime }` with **no dependency checks**, so a transient
  Postgres/Redis blip will not cause an orchestrator to kill the container. The
  container `HEALTHCHECK` uses this probe (`docs/DEPLOYMENT.md:79`).
- **`GET /health`** — readiness (`apps/backend/src/app.ts:88`). Pings Postgres and
  Redis in parallel (`pingDatabase()`, `pingRedis()`) and returns **200** when
  both are up or **503** when either is down, with a per-component breakdown:
  `{ status: 'ok'|'degraded', components: { database, redis }, uptime }`
  (`app.ts:89-95`). Use this for a load balancer's readiness check
  (`docs/DEPLOYMENT.md:80-81`).

Request logging deliberately ignores `/health` to avoid probe self-noise
(`app.ts:69`).

### Desktop NeuroCore health

NeuroCore is the runtime coordinator; it does not re-implement subsystem
monitoring, it **composes** the signals subsystems already emit into one scored
`SystemHealthSnapshot` (`apps/desktop/src/main/neuroCore.ts:1-9`). Each
`snapshot()` (`neuroCore.ts:65`) re-probes the backend (throttled), reads platform
diagnostics, and folds in automation, voice, backend connectivity, license,
device-trust, and cloud-sync state (`neuroCore.ts:78-95`). It also emits platform
telemetry events on notable transitions — backend connect/disconnect, overall
health level change, voice change, and edge-triggered high memory pressure
(`neuroCore.ts:103-156`). A recovery hook, `forceBackendProbe()`, bypasses the
probe throttle for the supervisor's backend-recovery path (`neuroCore.ts:168-171`).

Retrieved read-only over IPC channel `neurocore:systemHealth`
(`packages/shared/src/ipc/channels.ts:127`), handled by
`neuroCore.snapshot()` with an `EmptyRequest` schema (`apps/desktop/src/main/runtimeCore.ts:1066-1069`).
The channel is RBAC-gated (`apps/desktop/src/main/ipc/runtimeAuthz.ts:284`).

### Desktop platform diagnostics

`DiagnosticsService.report()` (`apps/desktop/src/main/platform/diagnostics.ts:67`)
assembles a single report from built-in Event Bus and Timeline checks plus a set
of injected service probes (runtime, registry, package service, plugin host,
backend/database/cache). The report's `overall` status is the **worst** of all
checks (`diagnostics.ts:85-88`), and each failing check carries a recovery
recommendation (`diagnostics.ts:101-118`).

Retrieved read-only over IPC channel `diagnostics:get`
(`packages/shared/src/ipc/channels.ts:159`), handled by
`diagnostics.report()` (`apps/desktop/src/main/platform/index.ts:206-209`),
also RBAC-gated (`runtimeAuthz.ts:249`).

---

## Metrics & Scraping

### Backend `/metrics` (the real scrape target)

`GET /metrics` (`apps/backend/src/app.ts:99`) renders Prometheus text-exposition
(`version=0.0.4`) from a tiny in-process registry
(`apps/backend/src/observability/metrics.ts`). It exposes **only non-sensitive
aggregate signals** — no bodies, no identifier-bearing paths, no PII
(`metrics.ts:1-12`):

| Metric | Type | Source |
|---|---|---|
| `neuropause_backend_up` | gauge (always 1) | `metrics.ts:53` |
| `neuropause_backend_uptime_seconds` | gauge | `metrics.ts:57` |
| `neuropause_backend_resident_memory_bytes` | gauge | `metrics.ts:61` |
| `neuropause_backend_heap_used_bytes` | gauge | `metrics.ts:65` |
| `neuropause_pg_pool_connections{state="total\|idle\|waiting"}` | gauge | `metrics.ts:70-72` |
| `neuropause_http_requests_total{method,status}` | counter | `metrics.ts:75-80` |

HTTP requests are counted by a middleware that excludes the `/metrics`, `/health`,
and `/live` probes to avoid self-noise (`app.ts:74-79`; `recordHttpRequest`,
`metrics.ts:18-21`). Pool gauges are injected live from the real `pg` pool at
scrape time (`app.ts:102`).

> **No latency histogram.** The backend records request *counts* by method+status
> only — there is no `_bucket`/histogram or per-route latency series. Request-rate
> and error-rate alerts are derivable; latency SLOs are **not** available from
> `/metrics` as shipped. See the gaps section.

**Scraping.** The endpoint is unauthenticated by design and must be
network-restricted in production (`app.ts:98`, `metrics.ts:10-11`):

- **Compose** — loopback bind.
- **Kubernetes** — pod annotations advertise the scrape
  (`deploy/kubernetes/backend.yaml:122-124`):
  `prometheus.io/scrape: "true"`, `prometheus.io/path: "/metrics"`,
  `prometheus.io/port: "4000"`.
- **Helm** — the same annotations are parameterized
  (`deploy/helm/neuropause-backend/values.yaml:69-71`).

See `deploy/README.md:76-81` for the observability notes.

### Desktop Prometheus formatter (in-process only)

`toPrometheus(metrics, health)`
(`apps/desktop/src/main/observability/prometheus.ts:61`) is a **pure formatter**.
It renders the Ecosystem gateway metrics and the NeuroCore health snapshot into
Prometheus text — `neuropause_gateway_requests_*`,
`neuropause_gateway_request_latency_p95_ms`, `neuropause_health_score`,
`neuropause_uptime_seconds`, `neuropause_cpu_percent`, `neuropause_memory_used_mb`,
`neuropause_subsystem_up{subsystem,level}`, etc. (`prometheus.ts:64-96`).

Critically, **this is not a scrape listener.** Its only caller is the in-process
Enterprise API route `GET /observability/metrics`
(`apps/desktop/src/main/api/routeRegistry.ts:216-219`, scope `observability:read`).
That "REST" API is a pure dispatcher invoked over the IPC channel `api:request`
(`apps/desktop/src/main/api/index.ts:31-37`) and reused in-process by the sandbox
runner (`apps/desktop/src/main/runtimeCore.ts:1716-1723`) — it binds **no network
port** (there is no `createServer`/`listen` in `apps/desktop/src/main/api`;
`runtimeCore.ts:1701` describes it as "the in-process REST gateway"). Prometheus
cannot scrape it over the network.

### Gateway p95 latency (admission-decision, not round-trip)

`GatewayStore.metrics()`
(`apps/desktop/src/main/ecosystem/gateway/gatewayStore.ts:129-159`) computes p95
from the latencies stored in the gateway audit trail (`gatewayStore.ts:144-147`).

> **What this p95 measures.** Each audit entry's `latencyMs` is
> `Math.max(1, Date.now() - start)` around the gateway's **admission decision**
> (auth / scope / rate / quota / version), recorded at
> `apps/desktop/src/main/ecosystem/index.ts:291,310`. It is the in-process cost of
> *deciding* to allow a request — **not** an upstream round-trip to the backend or
> any handler execution time. Read `neuropause_gateway_request_latency_p95_ms`
> accordingly.

### AI cost & token metering

`UsageTracker` (`apps/desktop/src/main/ai/usageTracker.ts:14-47`) accumulates
calls, input tokens, output tokens, and USD cost, broken down `byWorker` and
`byModel` (`usageTracker.ts:22-46`). Cost always arrives pre-computed from
`pricing.ts`, the single source of rates (`usageTracker.ts:1-6`). The rollup is
exposed as `AiUsageSummary` via `aiEngine.usageSummary()`
(`apps/desktop/src/main/ai/aiEngine.ts:122`) and drives the AI Operations surface.
These are **current metered actuals**, not forecasts (see gaps).

---

## Logging

### Backend (pino, redacting)

Structured JSON logging via pino (`apps/backend/src/config/logger.ts:6-15`), one
line per request through `pino-http` plus application events
(`apps/backend/src/app.ts:65-71`). Level is `LOG_LEVEL` (default `info` in
production, `debug` in dev); `pino-pretty` is used **only** in development
(`logger.ts:7,12-14`). Redaction censors `req.headers.authorization`, `password`,
`*.password`, `refreshToken`, and `accessToken` to `[redacted]`
(`logger.ts:8-11`). Each request carries a stable `x-request-id`
(`apps/backend/src/middleware/requestId.ts:11-15`).

Ship these to your log stack via the Docker logging driver
(`docs/DEPLOYMENT.md:122-132`) — the backend writes to stdout, not to files.

### Desktop IPC audit log

Every audited secure-IPC call appends one structured JSONL line to
`<userData>/logs/audit.log` (`apps/desktop/src/main/ipc/secureBridge.ts:49-60`).
The record is `{ at, channel, ok, durationMs, error? }`
(`secureBridge.ts:130-141`), written fire-and-forget so it never blocks the IPC
response (`secureBridge.ts:53-60`). Auditing is opt-in per handler via
`audit: true` — e.g. migrations, backups, recovery, and support-bundle generation
all audit (`apps/desktop/src/main/releaseOps/index.ts:228,238,255,263,274,318,332`).

### Desktop console loggers

Both the main process (`apps/desktop/src/main/logger.ts`) and the renderer
(`apps/desktop/src/renderer/src/lib/logger.ts`) use small leveled **console**
loggers — verbose in dev, quiet (info+/warn+) in production
(`main/logger.ts:8-9`, `renderer/src/lib/logger.ts:8-10`). They are namespaced and
credential-free by construction; neither writes to a file or a transport.

> **No log rotation.** The on-disk desktop logs — `audit.log`
> (`secureBridge.ts:49-51`) and the crash archive `crashes.log`
> (`crashReporter.ts:38-39`) — are **append-only with no rotation, size cap, or
> retention policy.** (The gateway audit *array* is capped at 10,000 entries in
> memory — `gatewayStore.ts:14,119` — but that is not file rotation.) The backend
> logs to stdout and delegates rotation entirely to your container runtime. See
> the gaps section.

---

## Diagnostics & Support Bundles

### Redacted support bundle

`SupportBundleGenerator.generate()`
(`apps/desktop/src/main/support/supportBundle.ts:93-152`) assembles a shareable
diagnostics package: `versions.json`, `diagnostics.json`, `modules.json`,
`connectors.json` (names + status only), `plugins.json`, `crashes.json`, plus
copied log files, all written with mode `0o600` and a `manifest.json`
(`supportBundle.ts:107-143`). Redaction runs over **all** text — JWTs, `Bearer`
tokens, key/value secrets (access/refresh tokens, API keys, client secrets,
passwords), and email addresses (`supportBundle.ts:13-35`). Raw `connectors.json`
and `telemetry.log` are never copied verbatim (`supportBundle.ts:46,124`).
Generated on demand via IPC `SupportGenerateBundle`
(`releaseOps/index.ts:330-335`).

### Crash reporter (local only)

The crash reporter (`apps/desktop/src/main/services/crashReporter.ts`) keeps faults
in a local on-device archive `<userData>/logs/crashes.log`
(`crashReporter.ts:38-39,80-88`). It hooks `uncaughtException`,
`unhandledRejection`, `render-process-gone`, and `child-process-gone`
(`crashReporter.ts:44-48`).

> **Nothing is ever uploaded.** Native minidump capture (Electron's
> `crashReporter`) is **opt-in and disabled by default**, and even when enabled it
> runs with `uploadToServer: false` and a deliberately invalid `submitURL` — there
> is no crash-ingest endpoint (`crashReporter.ts:2-11,68-77`). Crash telemetry
> leaves the device only inside a support bundle the operator generates.

It also turns recent crash patterns into actionable recovery recommendations —
e.g. repeated renderer crashes suggest Safe Mode, repeated plugin-host crashes
suggest disabling plugins (`crashReporter.ts:118-161`). Exposed via IPC
`CrashGetStatus` / `CrashExport` / `CrashRecommendations` / `CrashSetOptIn` /
`CrashReport` (`releaseOps/index.ts:266-294`).

### 90-day health history

`HealthHistoryStore` (`apps/desktop/src/main/enterprise/healthHistoryStore.ts`)
persists at most one org-health datapoint per calendar day, bounded to
**`MAX_POINTS = 90`** (~3 months) (`healthHistoryStore.ts:27,83-93`). It offers
`valueAround(daysAgo)` for week-over-week comparison (`healthHistoryStore.ts:101`)
and `windowStats()` for moving average / high / low / stddev over a trailing window
(`healthHistoryStore.ts:125-158`). This feeds the Executive Center's Weekly Trends.

### Release diagnostics

`collectReleaseDiagnostics` composes build identity, code-signing status, updater
status, platform health, installed modules, and connectors
(`releaseOps/index.ts:187-196`), retrievable and exportable-as-text via IPC
`ReleaseDiagnosticsGet` / `ReleaseDiagnosticsExport`
(`releaseOps/index.ts:296-309`).

---

## Incident Response & Recovery

### Recovery engines

`initReleaseOps()` (`apps/desktop/src/main/releaseOps/index.ts:75`) is the
reliability composition root. It constructs and wires, as one unit:

- **Migration engine** — versioned data migrations with a pre-migration backup and
  auto-restore on failure; runs pending migrations at startup
  (`releaseOps/index.ts:106-115,154-167`) and keeps a bounded migration audit log
  (`releaseOps/index.ts:138-142`).
- **Backup manager** — local-domain snapshots; **scheduled backups every 24h,
  keeping the 10 most recent** (`releaseOps/index.ts:57-58,212-223`); manual and
  pre-migration snapshots on demand.
- **Recovery service** — Safe Mode (start with plugins disabled), plugin disable,
  app repair/verify, and graph/search rebuild (`releaseOps/index.ts:117-128`).
- **Support bundle generator** and **release diagnostics** (above).

Operator actions are exposed as audited IPC channels: `MigrationStatus/Run`,
`BackupList/Create/Validate/Restore/Delete`, the `Crash*` set,
`RecoverySafeModeStatus`, `RecoveryRun`, and `SupportGenerateBundle`
(`releaseOps/index.ts:225-336`). Heavy operations run under a 120s timeout
(`releaseOps/index.ts:56`).

### Backend data recovery

Backend recovery is Postgres-level and documented in `docs/DEPLOYMENT.md:94-120`:
`scripts/backup-db.sh` (timestamped gzip `pg_dump`, keeps the most recent 14) and
`scripts/restore-db.sh` (confirmation-gated `psql` restore), with a cron example
for nightly backups (`docs/DEPLOYMENT.md:113-117`).

### Typical incident flow

1. **Detect** — backend: monitor `/health` (non-200) and container restarts
   (`docs/DEPLOYMENT.md:131`); desktop: watch the NeuroCore level transition
   events and the Ops Center.
2. **Triage** — pull the desktop Diagnostics report (`diagnostics:get`) and
   NeuroCore snapshot (`neurocore:systemHealth`); on the backend, tail structured
   logs by `x-request-id`.
3. **Contain** — desktop: Safe Mode / disable the offending plugin via
   `RecoveryRun`; backend: rely on the readiness probe to drain an unhealthy
   replica.
4. **Collect** — generate a redacted support bundle (`SupportGenerateBundle`) and
   export crashes (`CrashExport`).
5. **Recover** — restore a backup (desktop `BackupRestore`, backend
   `restore-db.sh`); re-run migrations if needed.

---

## Operational Dashboards

All desktop dashboards are **read-only surfaces fed by IPC** — they render existing
telemetry and never mutate runtime state. They are registered as navigation
sections in `apps/desktop/src/renderer/src/shell/sections.ts`:

- **Ops Center** (`opscenter`, `sections.ts:88`) — the incident surface. Its
  provider fetches an `EnterpriseIntelligenceReport` over IPC, polls every ~30s
  with debounced refresh on infra events, and offers read-only blast-radius
  (`intel:changeImpact`) and root-cause (`intel:rootCause`) analysis
  (`apps/desktop/src/renderer/src/operationsCenter/OpsCenterProvider.tsx:23-46`).
- **Intelligence** (`intelligence`, `sections.ts:80`) — cross-domain intelligence
  report surface.
- **AI Operations** (`ai-operations`, `sections.ts:85`) — surfaces the metered AI
  cost/quota **actuals** from the usage tracker. The model is explicit that these
  are current actuals and **not** a per-action forecast
  (`apps/desktop/src/renderer/src/aiOperations/simulationModel.ts:9,15,48-49`).
- **Extensibility** (`extensibility`, `sections.ts:87`) — plugin / connector /
  developer-platform surface.

Related read-only panels include the Diagnostics and Event Inspector panels
(`apps/desktop/src/renderer/src/operations/`) and the enterprise Runtime Health
panel.

---

## Known Operational Gaps & Recommendations

The following day-2 disciplines are **not implemented** in NeuroPause GA. Each was
verified absent against source. Adopt the recommended external tooling — the system
is built to integrate with it (notably via the backend `/metrics` scrape target),
not to replace it.

### 1. No native alerting, paging, or threshold triggers

There is **no** PagerDuty / Opsgenie / Slack / email alert integration, no
Alertmanager, no on-call routing, and no threshold-trigger/alert-rule engine
anywhere in the backend or desktop source (verified: no such references exist).
The NeuroCore telemetry events (`neuroCore.ts:103-156`) are in-process signals
consumed by the UI/supervisor, not outbound notifications. The shipped guidance is
simply to "poll `/health` … and alert on non-200" from your own system
(`docs/DEPLOYMENT.md:131`).

**Recommendation.** Scrape the backend `/metrics` with **Prometheus** and run
**Alertmanager** for routing/paging to PagerDuty, Slack, or email. Author alert
rules on the shipped series — e.g. `neuropause_backend_up == 0`, error-ratio from
`neuropause_http_requests_total{status=~"5.."}`, and pool saturation from
`neuropause_pg_pool_connections{state="waiting"}`. Add a blackbox/HTTP probe on
`/health` for readiness alerting.

### 2. No distributed, cross-service tracing

Tracing is **per-request single spans only**. The desktop emits one OTLP SERVER
span per gateway audit entry, with the `traceId` **derived from the entry id**
(`apps/desktop/src/main/observability/otel.ts:70-86`) — so every request is its own
standalone root trace, with no parent/child span linkage and no shared trace across
a call chain. The backend's `x-request-id`
(`apps/backend/src/middleware/requestId.ts:11-15`) is a separate identifier that is
**not correlated** to those desktop-derived trace ids. There is **no OTLP
exporter/collector**: the OTLP projections are formatters only
(`otel.ts:1-8`), served through the in-process IPC route `/observability/traces`
(`routeRegistry.ts:227-231`) with nothing pushing them anywhere.

**Recommendation.** Deploy an **OpenTelemetry Collector**. Instrument the backend
and desktop with real OTLP exporters, and propagate **W3C `traceparent`** from the
desktop through the gateway into backend requests (reusing/aligning `x-request-id`)
so spans correlate end-to-end. Send to a tracing backend (Jaeger, Tempo, or a
vendor).

### 3. No capacity forecasting

There is **no** capacity-planning or predictive-load capability. The AI Operations
model states this outright: "there is no cost/resource forecast," its cost rows are
labeled "current actuals — not a per-action forecast," and it explicitly lists
"Per-action cost & resource forecast" as a capability the platform does not have
(`apps/desktop/src/renderer/src/aiOperations/simulationModel.ts:9,48-49,219,398`;
see also `executiveModel.ts:21`). `HealthHistoryStore.windowStats()` provides
descriptive trailing-window statistics only (`healthHistoryStore.ts:125-158`), not
projection.

**Recommendation.** Forecast **externally** from the historical `/metrics` time
series — e.g. Prometheus `predict_linear()` for pool/memory/traffic trends, or a BI
/ data-warehouse pipeline over exported metrics — rather than expecting the app to
project capacity.

### 4. No log rotation

The on-disk desktop logs — `audit.log` (`secureBridge.ts:49-51`) and `crashes.log`
(`crashReporter.ts:38-39`) — append **without any rotation, size cap, or
retention**. The backend logs to stdout and ships no rotation of its own.

**Recommendation.** Rotate at the platform layer: **logrotate** for the desktop
`<userData>/logs` directory, and the Docker `json-file` driver's `max-size` /
`max-file` (or journald) for the backend. For retention and search, ship logs to
**Loki**, the **ELK/OpenSearch** stack, or CloudWatch, as `docs/DEPLOYMENT.md:130`
suggests.

### 5. Desktop metrics/traces have no live network transport

Only the backend `/metrics` endpoint is a real scrape target. The desktop's
Prometheus and OTLP outputs are reachable **only** through the in-process Enterprise
API IPC routes (`routeRegistry.ts:214-237`, scope `observability:read`); the
desktop binds no HTTP/metrics port. External Prometheus/OTLP collectors cannot pull
from a running desktop client.

**Recommendation.** If fleet-wide desktop metrics are required, add an outbound
push from the app — a **Prometheus Pushgateway** target or an **OTLP push** to a
collector — or aggregate the equivalent signals server-side. Do not assume the
desktop is scrapeable as-is.

### 6. Backend `/metrics` is unauthenticated

`GET /metrics` is registered before the authenticated routers and carries no auth
middleware or token (`apps/backend/src/app.ts:99`); its safety model is network
restriction, stated inline (`app.ts:98`, `metrics.ts:10-11`).

**Recommendation.** Keep it **network-restricted** — loopback bind in Compose, a
scrape-only path or `NetworkPolicy` in Kubernetes (`deploy/README.md:78-81`). If it
must traverse an untrusted network, front it with an authenticating reverse proxy
(bearer/mTLS) or move it to a separate, firewalled metrics port. Note the endpoint
is aggregate and non-sensitive by construction (no PII, bodies, or secrets —
`metrics.ts:1-12`), which limits but does not eliminate the exposure.

---

### Source-verification note

Every capability above is cited to `file:line` in the GA source tree. Absent
capabilities in this section were confirmed by the absence of any implementing code
(alerting/paging, OTLP export/collection, forecasting, log rotation, desktop metric
transport) and, where the codebase self-declares a limitation (forecasting, crash
upload, gateway latency semantics, `/metrics` network restriction), by that
declaration. This guide describes NeuroPause GA as it is — not as roadmap.
