# Agriculture — Validation Pack

> **Reference deployment + validation protocol.** This document describes how an
> agribusiness *would* deploy and validate NeuroPause, and gives reproducible
> protocols against the **real** platform. It is not a record of a production
> install. There are **no named customers, no fabricated metrics, and no
> certifications** here. Every number traces to `docs/validation/_grounding.md`;
> every capability traces to a real file in this repository. Where a capability is
> modeled rather than wired to live equipment, it is labeled as such.
>
> Platform under validation: NeuroPause `1.0.0-rc.1` — a secure **Electron desktop**
> app (context isolation, sandbox, strict CSP, allow-listed + Zod-validated IPC with
> a fail-closed RBAC gate) over a **Node/Express backend** (Postgres + Redis; Qdrant
> configured for semantic search). Prior classification: **Release Candidate**
> (`ENTERPRISE-GA-REPORT.md`).

---

## 1. Farm workflow — using the real platform surfaces

An agribusiness — a grower cooperative, a produce packer, or a farm-management
operator — runs its planning, records, and coordination inside the NeuroPause
desktop workspace, and lets the backend hold the shared system-of-record. The
workflow below maps each step to a **surface that exists in the codebase**, not to
an aspirational feature.

| Farm activity | Real platform surface | Where it lives |
|---|---|---|
| Season planning, task boards, field notes | Desktop **workspace views** (unified entities: projects, tasks, documents, events) | `apps/desktop/src/renderer/src/views/workspace`, engine input `UnifiedEntity` |
| Pulling data from ERP / cooperative systems / email / calendars | **Connectors** subsystem (OAuth PKCE, credential vault, runtime supervisor) | `apps/desktop/src/main/connectors/` (`connectorService.ts`, `connectorVault.ts`, `oauthEngine.ts`) |
| Agronomy notes, compliance docs, varietal knowledge | **Knowledge** handlers (links, topic clusters, health) | `apps/desktop/src/main/knowledge/` (`knowledgeHandler.ts`, `topicClusters.ts`) |
| "What changed this week across fields and suppliers" | **Intelligence engines** — briefing, recommendations, timeline, search, memory | `apps/desktop/src/main/{graph,memory,timeline,intelligence,recommendations}` |
| Event-driven coordination (a shipment closes → notify the co-op system) | **Automation / webhooks** (§2) | `apps/desktop/src/main/webhooks/` |
| Working from a barn, a packhouse, or a field with no connectivity | **Local-first desktop + offline bundle** (§3) | Electron main/renderer; `scripts/build-offline-bundle.sh` |

**Why this fits agriculture.** Farm operations are seasonal, distributed, and
frequently disconnected. NeuroPause is **local-first**: the Electron desktop holds
working state on-device and brokers privileged actions through a fail-closed RBAC
IPC gate, so field staff keep working when the network does not cooperate. Every
connector uses **backend-brokered OAuth (PKCE / RFC 8252)** with **no provider
secrets on the client** (`_grounding.md` → Security controls), which matters when
laptops and tablets live in trucks and sheds rather than a locked data center.

Access is role-scoped. Automation and governance surfaces sit behind explicit RBAC
permissions — for example the webhook handlers require `governance:manage` to
mutate and `governance:read` to view (`apps/desktop/src/main/webhooks/index.ts`),
and privileged calls are `audit: true`, appending to the backend `audit_log`
(append-only) as they occur. A seasonal-worker role can be granted read surfaces
without the ability to reconfigure integrations.

---

## 2. Automation validation — the real webhook subsystem

Farm coordination is event-driven: a load is graded, an order is fulfilled, a
runtime health check flips. NeuroPause turns platform events into **signed,
retried, dead-lettered HTTP deliveries** to external systems (a cooperative
portal, an ERP inbound endpoint, a compliance archive). The subsystem is small,
pure-cored, and tested.

### 2.1 Architecture (as built)

| Stage | Behavior | File |
|---|---|---|
| Subscription match | Endpoint receives an event if it subscribes to the event's **category** or **type**; empty filters = firehose | `webhooks/matcher.ts` |
| Fan-out | Each `PlatformEvent` enqueues one delivery per matching enabled endpoint | `webhooks/webhookProducer.ts` |
| Egress guard (SSRF) | Only **public HTTPS** endpoints; loopback / private / link-local / CGNAT / IPv4-mapped-IPv6 / `169.254.169.254` metadata all rejected | `webhooks/urlGuard.ts` |
| Signing | **HMAC-SHA256** over `<timestamp>.<body>`, emitted as `t=<ms>,v1=<hex>` in `x-neuropause-signature`; timing-safe verify; 5-min freshness | `webhooks/signing.ts` |
| Delivery | Timeout-bounded `fetch` (10 s), **`redirect: 'error'`** so a 302 can't defeat the guard; re-checks egress at send time | `webhooks/index.ts`, `webhooks/webhookDispatcher.ts` |
| Retry / dead-letter | Backoff `[0, 30, 120, 600, 3600, 21600]` s → **6 attempts** then dead-letter; DLQ + replay | `webhooks/retry.ts`, `webhooks/delivery.ts` |
| Durability | Endpoints + outbox persisted `0600`; delivery log capped at 5000 with terminal-first eviction | `webhooks/webhookStore.ts` |

Defense-in-depth is deliberate: the store rejects an unsafe URL at **registration**
(`assertSafeWebhookUrl`), and the dispatcher **re-classifies at send time**
(`classifyWebhookUrl`) — protecting against rows written before the guard existed
and against a hostname that later resolves internally. The documented residual is
DNS-rebinding across the check, mitigated by the send-time re-check
(`webhooks/urlGuard.ts` header comment).

### 2.2 Reproducible validation of the automation path

The pure cores are unit-tested and run under Node with **no Docker, no network, no
Electron** — reproducible in this harness. This is the honest, executable evidence
for the automation claim.

```bash
# From repo root — runs the webhook unit suites (part of the 3,856-test gate).
npx vitest run apps/desktop/src/main/webhooks
```

Expected coverage, tied to real test files:

| Property validated | Assertion | Test file |
|---|---|---|
| SSRF guard accepts only public HTTPS | loopback, `10/172.16-31/192.168`, CGNAT `100.64`, `169.254.169.254`, `::1`, `fc00::/7`, `fe80::/10`, `::ffff:` all rejected; public IPs pass | `webhooks/urlGuard.test.ts` |
| Non-HTTPS + embedded creds rejected | `http://`, `ftp://`, `file://`, `user:pass@` rejected | `webhooks/urlGuard.test.ts` |
| Signature is SDK-compatible | signs `t=…,v1=<64-hex>`; verifies within tolerance | `webhooks/signing.test.ts` |
| Signature rejects tampering | wrong secret, mutated body, and **stale timestamp** all fail | `webhooks/signing.test.ts` |
| Matcher eligibility | category OR type match; empty-filter firehose | `webhooks/matcher.test.ts` |
| Delivery state machine | success→delivered, failure→retry, exhaustion→dead | `webhooks/delivery.test.ts`, `webhookDispatcher.test.ts` |

**Receiver-side verification an integrator can run.** Because the wire format is the
same one the official SDK's `verifyWebhook` checks, a co-op's endpoint validates a
delivery deterministically. The check is exactly `signing.ts`:

```
signature header: x-neuropause-signature: t=<unix_ms>,v1=<hex>
verify: HMAC_SHA256(secret, "<t>.<raw_body>") == v1  (timing-safe)
reject if: |now - t| > 5 min  OR  hex decode fails  OR  mismatch
idempotency key: payload.deliveryId  (also x-neuropause-delivery header)
```

**What this does and does not prove.** It proves the automation *logic* — matching,
signing, guarding, retry/dead-letter, replay — is correct and deterministic. It does
**not** exercise a real remote endpoint over a real network at load; live connector
execution under real networks is labeled ABSENT/HARNESS-ONLY in `_grounding.md` and
is not claimed here.

---

## 3. Offline validation — the strongest fit

Agriculture is where NeuroPause's local-first design pays off most directly. Fields,
packhouses, and rural sites are exactly the environments where a cloud-only tool
fails and an **air-gapped-capable, local-first** one keeps running.

### 3.1 What is real

- **Local-first desktop.** The Electron app keeps working state on-device; privileged
  actions are brokered through the RBAC IPC gate rather than requiring a live server
  round-trip for local work. Refresh tokens are encrypted at rest via Keychain
  (`safeStorage`) (`_grounding.md` → Security controls).
- **Air-gapped backend bundle.** `scripts/build-offline-bundle.sh` is **shellcheck-CLEAN**
  and produces a single tarball containing the backend image plus `postgres:16-alpine`
  and `redis:7-alpine`, an **offline compose file** that references images by tag
  (no build, no registry), an `.env` template, and a `load-and-run.sh` loader. The
  offline compose binds the backend to **loopback only** (`127.0.0.1:${BACKEND_PORT:-4000}`)
  and gates startup on Postgres/Redis **healthchecks** — appropriate for an isolated
  rural host.
- **Documented transfer procedure.** Build on a connected host → transfer the tarball
  → extract → create `.env` (set `POSTGRES_PASSWORD` and a ≥32-char `JWT_ACCESS_SECRET`)
  → `./load-and-run.sh` → probe `/live` and `/health`. The loader refuses to start
  without `.env`, so a misconfigured air-gapped host fails closed rather than booting
  insecurely.
- **Deterministic offline compute.** The intelligence engines are pure and run fully
  offline; measured over 5000 entities they complete far under the 2000 ms budget
  (§5) — no model credentials, no network.

### 3.2 What is honest

- **The full `docker save`/`docker load` round-trip needs a Docker daemon**, which is
  **not present in this validation harness** — so the offline bundle is validated as
  **script-clean + documented procedure**, not as an executed image transfer. This
  matches `_grounding.md` → Reliability: **Offline/air-gapped = PARTIAL**.
- **The desktop app targets macOS** for this program and cannot be launched headless
  here; CI covers backend, deploy-validation, and Windows release, with **no
  macOS/desktop CI yet** (`_grounding.md` → Deployment assets). Desktop startup/render/
  IPC/renderer-memory numbers are ABSENT/HARNESS-ONLY.

### 3.3 Offline-readiness validation checklist

Run on a **build host with Docker + internet**, then on the **air-gapped target**.

| # | Step | Command / check | Real basis | Status in this harness |
|---|---|---|---|---|
| 1 | Lint the bundle script | `shellcheck scripts/build-offline-bundle.sh` | script is shellcheck-CLEAN | ✅ verifiable |
| 2 | Build the bundle | `scripts/build-offline-bundle.sh` | `build-offline-bundle.sh` L24–L110 | ⚠️ needs Docker daemon |
| 3 | Confirm bundle contents | tarball has `images.tar`, `docker-compose.offline.yml`, `.env.example`, `load-and-run.sh` | script L31–L110 | ⚠️ needs Docker daemon |
| 4 | Transfer to air-gapped host | copy `neuropause-offline-*.tar.gz`; no registry pull | offline compose references images **by tag** | ⚠️ needs target host |
| 5 | Loader fails closed without `.env` | run `./load-and-run.sh` with no `.env` → exits non-zero | loader L96–L98 | ✅ logic verifiable |
| 6 | Start stack | create `.env`, `./load-and-run.sh` | loader L100–L103 | ⚠️ needs Docker daemon |
| 7 | Health gate | services wait on pg/redis **healthchecks**; probe `/live`, `/health` | compose L50–L66, L76–L80 | ⚠️ needs running stack |
| 8 | Loopback-only exposure | backend published on `127.0.0.1` only | compose L82 | ✅ config verifiable |
| 9 | Offline compute | intelligence engines run with no network | `__bench__/performance.test.ts` | ✅ runs under Node |

Legend: ✅ verifiable in this harness (static or Node-only); ⚠️ requires a Docker
daemon or the macOS/air-gapped target, honestly out of scope here.

---

## 4. Sensor integration model — clearly MODELED

**Plain statement up front: there is no live sensor, IoT, PLC, SCADA, or hardware
integration in NeuroPause. This section describes the data model and surfaces that
*would* ingest field/agronomy telemetry. It is a model, not a wired integration.**
`_grounding.md` is explicit: *"Vertical sensor/device integrations (e.g., agriculture
IoT, clinical systems) are modeled — schema/surfaces exist, not wired to live
equipment."*

### 4.1 The real surfaces a sensor feed would land on

NeuroPause already ships the *shape* of a telemetry pipeline for an analogous
vertical (manufacturing), and that shape is the honest reference for how agricultural
sensor data would be modeled:

| Modeled ingestion element | Real code today | How agriculture would map |
|---|---|---|
| Append-only event ledger seam | `postManufacturingEvent()` — validates, assigns a monotonic sequence + timestamp, persists, fans out to **audit + Timeline + Search** | An agronomy/field-event ledger appended the same way (irrigation cycle, harvest pass, cold-chain reading) |
| Event fields | `machine`, `workCenter`, `operator`, `quantity`, `reason`, `metadata`, `timestamp` (`manufacturingEventLog.ts`) | `field`/`block`, `zone`, `operator`, `quantity`, `reason`, `metadata`, `timestamp` — same generic shape |
| Platform event bus | `PlatformEvent` with categories incl. `infrastructure`, `enterprise`, `automation` (`packages/shared/src/types/platform.ts`) | Sensor-derived events published to the bus → matched by webhooks (§2) |
| Solution-pack readiness | `industryModel.ts` — a **pure projection** that references real entities and reports `present`/`active`, and already names `IoT / Historian`, `OPC-UA`, `SCADA` as **referenced systems** (L153–L154) | An agriculture suite would reference agronomy connectors/policies and report the same honest readiness signal |

The design guarantees here are real and worth stating: the ledger is **append-only**
(corrections are new events, never edits), ingestion is **best-effort** (emitting an
event never breaks the action that produced it — `manufacturingEventLog.ts` returns
`null` rather than throwing when the module is absent), and every appended event fans
out to the **audit trail, Timeline, and Search** so it is queryable by the same
intelligence engines benchmarked in §5.

### 4.2 The honest boundary

- No device driver, no MQTT/OPC-UA/LoRaWAN listener, no gateway, and no hardware are
  present or claimed. `industryModel.ts` **names** `IoT / Historian` and `OPC-UA` as
  *catalog references* and computes readiness against what is wired in a deployment —
  it does **not** open a socket to a PLC.
- A production sensor integration would be built as a **connector** (using the real
  `apps/desktop/src/main/connectors/` runtime, credential vault, and RBAC) or an
  **inbound** ingest path, terminating in the ledger seam above. That connector does
  not exist today; describing it here is design intent, not a shipped feature.
- Therefore no sensor accuracy, sampling-rate, or device-uptime metric appears in this
  pack. Inventing one would violate the production-authenticity rule.

---

## 5. Operational evidence — reproducible collection

This section is a **procedure** for collecting operational evidence against a running
backend, plus the **already-measured** reference numbers. All figures are from
`docs/validation/_grounding.md`, measured on the reference box: **2-vCPU Xeon
@2.10 GHz, 8 GB, Node 22.22.2, PG 16.13, Redis 7.0.15**, load client co-located
(latency therefore conservative). Do not alter these numbers when re-citing.

### 5.1 Evidence-collection procedure

```bash
# 1. Point telemetry — human- and machine-readable, no auth needed for probes.
curl -s http://127.0.0.1:4000/health   # {status, components:{database,redis}, uptime}
curl -s http://127.0.0.1:4000/live     # liveness
curl -s http://127.0.0.1:4000/metrics  # Prometheus text (real series below)

# 2. Reproducible load evidence (real requests, perf_hooks timing).
node bench/http-load.mjs --json bench/results/http-load.json

# 3. Reproducible DB latency evidence (direct pg round-trips, read-only).
DATABASE_URL=postgresql://... node bench/db-latency.mjs --json bench/results/db-latency.json

# 4. Deterministic offline compute evidence (no network, no Docker).
npx vitest run apps/desktop/src/main/__bench__/performance.test.ts
```

Real Prometheus series exposed by `/metrics` (cite these for KPIs, do not invent
others): `neuropause_backend_up`, `neuropause_backend_uptime_seconds`,
`neuropause_backend_resident_memory_bytes`, `neuropause_backend_heap_used_bytes`,
`neuropause_pg_pool_connections{state="total|idle|waiting"}`,
`neuropause_http_requests_total{method,status}`. `/health` reports
`ok | degraded` with per-component (`database`, `redis`) status.

### 5.2 Measured reference numbers

**Startup & HTTP load** (concurrency 32, 3000 req/scenario, **24,000 total, 0 errors**):

| Signal | Value | Source |
|---|---|---|
| Cold start → healthy (DB + Redis) | **0.66 s** | `_grounding.md` benchmarks |
| `GET /health` | 1221 rps, p50 22 ms | http-load harness |
| `GET /live` | 2103 rps, p50 11 ms | http-load harness |
| `GET /metrics` | 1789 rps, p50 16 ms | http-load harness |
| `GET /store/apps` (DB list, 20 rows) | 610 rps, p50 52 ms, p99 80 ms | http-load harness |
| `GET /store/apps` filter+sort | 639 rps, p50 49 ms | http-load harness |
| `GET /store/featured` (join) | 529 rps, p50 60 ms | http-load harness |
| `GET /store/categories` (agg) | 1559 rps, p50 19 ms | http-load harness |
| `GET /store/apps/:slug` (point read) | 424 rps, p50 72 ms, p99 118 ms | http-load harness |

**DB latency** (direct pg, 2000 iters, 0 errors): point read p50 **0.23 ms** / p95 0.46 ms;
filtered list p50 0.16 ms; aggregate p50 0.12 ms; join p50 0.24 ms. The database is
sub-millisecond; app-layer work + 2-vCPU contention dominates HTTP latency.

**Offline intelligence engines** over 5000 entities (budget 2000 ms): graph.project
92.8 ms, memory.index 74.4 ms, timeline.query 76.8 ms, search.index 55.9 ms,
briefing.generate 24.3 ms, recommendations.generate 17.1 ms, search.query 6.1 ms,
memory.recall 4.4 ms — the compute a disconnected farm site relies on.

**Auth cost / resources / gates:** Argon2id hash p50 19.7 ms, verify p50 19.6 ms
(deliberately bounds auth throughput); RSS 117 MB idle → 213 MB under 24k-request
load; heap 20 → 70 MB; pg pool auto-scaled 1 → 10. Quality gates: typecheck 0, lint 0,
**3,856 tests pass**, build exit 0, **0 production npm-audit vulns**.

### 5.3 Reliability evidence (executed this program)

| Scenario | Result | Verdict |
|---|---|---|
| Migration idempotency (12 forward-only migrations, re-run) | 0 new applied | PASS |
| Backup/restore (`pg_dump -Fc` 136 KB → fresh DB → `pg_restore`) | row counts match exactly | PASS |
| Restart recovery (SIGTERM → restart) | healthy in **0.46 s** | PASS |
| Redis-down fail-open | `/store/apps` served 200×5; `/health` `degraded/redis:down`; no crash | PASS |
| DB-down degradation + auto-recovery | clean 500s; pool **auto-reconnected without a backend restart** | PASS |
| Offline/air-gapped bundle | script shellcheck-CLEAN + documented; full `docker save/load` needs a daemon | **PARTIAL** |

The rate limiter **fails open if Redis is down** (a deliberate availability choice,
stated in `_grounding.md`) — a defensible trade-off for a rural deployment that must
stay usable when a datastore blips, and one an evaluator should weigh explicitly.

---

## Honest limitations

- **Sensor / IoT integration is MODELED, not wired.** There is no live device, PLC,
  SCADA, MQTT/OPC-UA/LoRaWAN, or gateway integration. §4 describes real data-model
  surfaces (`manufacturingEventLog.ts` ingestion seam, the `PlatformEvent` bus, the
  `industryModel.ts` readiness projection) that *would* carry agricultural telemetry.
  No sensor accuracy, sampling, or device-uptime metric is claimed.
- **The offline bundle was not fully executed here.** `scripts/build-offline-bundle.sh`
  is shellcheck-CLEAN with a documented procedure and fail-closed loader, but the full
  `docker save`/`docker load` round-trip requires a Docker daemon absent from this
  harness — validated as script-clean + procedure, not an executed image transfer
  (`_grounding.md`: Offline/air-gapped **PARTIAL**).
- **The desktop app targets macOS** and cannot be launched headless in this
  environment; desktop startup/render/IPC/renderer-memory numbers are
  ABSENT/HARNESS-ONLY, and there is **no macOS/desktop CI** yet. Backend, deploy-
  validation, and Windows-release CI are real.
- **Live AI-model latency and real connector execution over real networks** are not
  measured (need live credentials / real endpoints) and are not claimed.
- **No named customers, no fabricated metrics, no certifications.** This is a reference
  deployment and validation protocol; any compliance language elsewhere in the program
  is a **self-assessment mapping**, not a certification. Every number here traces to
  `docs/validation/_grounding.md`.
