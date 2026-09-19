# NeuroPause — Evidence Collection (CDEP)

The CDEP operational manual for **collecting real evidence from a real customer
deployment** — execution, not engineering (no runtime, no platform added). It names
which real tool makes which artifact, how to run it, and how to store it reproducibly.

> **Read this rule first (from `_grounding.md`).** _No pilot has run yet._ Every
> results table, capture template, and manifest below is a **blank instrument** to
> be filled during a real deployment. The only real numbers in this document are
> the **EVP 2-vCPU reference measurements**, and they appear **only** where
> explicitly labelled _"reference floor — not this pilot."_ A customer's numbers do
> not exist until the harnesses below are run against the customer's instance.
> Never copy a reference number into a customer cell.

**Builds on (does not duplicate):** the EVP evidence
`docs/validation/PERFORMANCE-BENCHMARKS.md`, `RELIABILITY-RESULTS.md`,
`DEPLOYMENT-VALIDATION.md`; the harnesses `bench/http-load.mjs`,
`bench/db-latency.mjs`, `bench/startup.sh`; CDEP §3 of `PILOT-MATRICES.md`; and the
gates/scorecards in `PILOT-FRAMEWORK.md` / `DEPLOYMENT-QUALITY.md` (deploy steps:
`DEPLOYMENT-PLAYBOOKS.md`, GEAP `DEPLOYMENT-PROGRAM.md`). This is the evidence loop
that wraps them.

---

## 1. Evidence taxonomy

Eight evidence classes. Each names **what it proves**, the **real generator** that
produces it (never a spreadsheet estimate), the **output schema/artifact**, and the
**collection cadence** during a pilot. Every "result" is `Template` until the tool
is run against the customer instance.

| Class              | What it proves                                                           | Real generator (tool)                                                                   | Output artifact / schema                                                                                         | Cadence                                                               |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Performance**    | API latency/throughput/error-rate; DB latency; cold-start on customer HW | `bench/http-load.mjs`, `bench/db-latency.mjs`, `bench/startup.sh`                       | per-scenario JSON (`throughput_rps`, `mean/p50/p90/p95/p99/max_ms`, `errors`); `db-latency` JSON; `startup.json` | baseline at deploy; after each scale/config change; weekly; at exit   |
| **Reliability**    | System survives perturbation and self-heals                              | reliability procedures (`RELIABILITY-RESULTS.md`) run on the instance                   | `reliability.json` — `{id, result: PASS/FAIL/PARTIAL, evidence}` per scenario                                    | once at entry (controlled window); re-run after infra change; at exit |
| **Availability**   | Uptime / health over time                                                | `GET /health`, `GET /live` sampled by an **external** blackbox probe                    | `health-<ts>.json` series (`status`, `components.database\|redis`, `uptime`)                                     | continuous sampling (probe is customer-supplied — see honest gap)     |
| **Capacity**       | Resource envelope: RSS/heap/pool vs load                                 | `GET /metrics` scrape (customer's own instance)                                         | `metrics-<ts>.prom` + under-load snapshot (`*_under_load`, pool `{total,idle,waiting}`)                          | `/metrics` scraped on interval; snapshot at peak                      |
| **Security**       | Control posture + dependency exposure                                    | control checklist (attested) + `npm audit --omit=dev` + `audit_log`                     | `security-controls.md` attestation + `npm-audit-<ts>.json`                                                       | at entry; on every dependency bump; re-attest at exit                 |
| **Data-integrity** | Migrations idempotent; backup restores exactly                           | `npm run db:migrate` (12 forward-only) + `backup-db.sh`/`restore-db.sh` row-count check | integrity record (migration re-run diff; source vs restored row counts)                                          | at entry; each backup cycle during pilot                              |
| **Business**       | Value-model **inputs** (no numbers here)                                 | customer-sourced inputs + capacity sizing inputs                                        | input register (name/source/unit/owner) — ROI math deferred                                                      | baseline at entry; delta at exit                                      |
| **Acceptance**     | Gates + criteria met; formal sign-off                                    | quality gates (`typecheck`/`lint`/`test`/`build`) + scorecards                          | signed acceptance record (`DEPLOYMENT-QUALITY.md`)                                                               | at exit gate                                                          |

**Honest gaps (do not fabricate around them).** There is **no built-in alerting,
tracing, or capacity forecasting** (per `_grounding.md`). Availability therefore
needs a **customer-supplied external probe** on `/health`/`/live`; capacity is a
**captured time-series**, not a forecast. State these limits — do not invent coverage.

---

## 2. Evidence store layout & chain-of-custody

Every artifact is filed under one pilot-scoped tree, checksummed, and wrapped in a
custody manifest. **An artifact with no manifest and no checksum is not evidence.**

```bash
# Set once per pilot (PILOT_ID is assigned in PILOT-FRAMEWORK.md; NOT invented here)
export PILOT_ID=<pilot-id>                       # e.g. cdep-YYYY-NNN
export NP_BASE=https://<customer-instance>        # the customer's deployed backend
export EVID=evidence/${PILOT_ID}
mkdir -p ${EVID}/{performance,reliability,availability,capacity,security,data-integrity,business,acceptance}
export TS() { date -u +%Y%m%dT%H%M%SZ; }          # UTC timestamps only
git rev-parse HEAD > ${EVID}/tool_git_ref.txt     # the harness build that produced the numbers
# after each run:  sha256sum ${EVID}/**/*.json > ${EVID}/SHA256SUMS   (integrity of every artifact)
```

**Custody manifest** — one JSON sidecar per captured artifact (all fields blank
until collection; fill at pilot time, never pre-fill):

```json
{
  "pilot_id": "",
  "artifact_class": "",
  "tool": "",
  "tool_git_ref": "",
  "instance_id": "",
  "instance_base_url": "",
  "environment_ref": "environment.json",
  "collected_by": "",
  "collected_at_utc": "",
  "witnessed_by": "",
  "sha256": "",
  "notes": ""
}
```

**Environment capture** — blank, matching the real `bench/results/environment.json`
schema; the customer's hardware makes their numbers **theirs**, not ours:

```json
{
  "captured": "",
  "cpu_model": "",
  "vcpus": null,
  "mem_total_kb": null,
  "node": "",
  "os": "",
  "postgres": "",
  "redis": "",
  "note": "customer instance — not the EVP 2-vCPU reference"
}
```

Chain-of-custody rule set: UTC timestamps only; one `sha256` per artifact (in the
manifest **and** `SHA256SUMS`); `tool_git_ref` captured so the run is reproducible
from source; a named `collected_by` and `witnessed_by`; artifacts **append-only** —
a re-run is a new timestamped file, never an overwrite.

---

## 3. Operational measurements

Exact commands to run each real harness **against the customer instance** and file
the JSON. Confirm the target is up first — every harness refuses to invent numbers
for an unreachable backend.

```bash
curl -fsS "$NP_BASE/health" | tee ${EVID}/availability/health-$(TS).json   # gate: must be 200
```

**HTTP load** (`bench/http-load.mjs` — same flags as the EVP run for comparability):

```bash
node bench/http-load.mjs --base "$NP_BASE" --conc 32 --reqs 3000 --warmup 300 \
  --json ${EVID}/performance/http-load-$(TS).json
```

**DB latency** (`bench/db-latency.mjs` — read-only; point it at the customer DB):

```bash
DATABASE_URL="$CUSTOMER_DATABASE_URL" node bench/db-latency.mjs --iters 2000 \
  --json ${EVID}/performance/db-latency-$(TS).json
```

**Cold start + idle metrics** (`bench/startup.sh` — host-local: runs on the instance
host against its own `apps/backend/dist` + `.env`; writes `bench/results/startup.json`,
then file it):

```bash
bash bench/startup.sh
cp bench/results/startup.json ${EVID}/performance/startup-$(TS).json
# Kubernetes note: startup.sh is a host/VM measurement. On K8s, also record pod
# Ready time (kubectl get pod -o json → status.conditions[Ready].lastTransitionTime)
# as the deployment-level cold start; keep both, labelled by method.
```

**`/metrics` scrape** (capacity substrate — the customer collects from their own
instance; excerpt of the real series):

```bash
curl -fsS "$NP_BASE/metrics" > ${EVID}/capacity/metrics-$(TS).prom
# Series to retain: neuropause_backend_up, _uptime_seconds,
#   _resident_memory_bytes, _heap_used_bytes,
#   neuropause_pg_pool_connections{state="total|idle|waiting"},
#   neuropause_http_requests_total{method,status}
```

**Under-load capacity snapshot** — scrape `/metrics` right after an `http-load`
burst; retain the blank schema of `bench/results/metrics-under-load.json`:
`{resident_memory_bytes_under_load, heap_used_bytes_under_load,
pg_pool_connections{total,idle,waiting}, http_requests_total{GET_200}}` — all `null`
until captured.

Every command ends the same way: write the JSON, write the manifest, `sha256sum`
into `SHA256SUMS` — no artifact is "collected" until all three exist.

---

## 4. Reliability evidence

Run the real `RELIABILITY-RESULTS.md` procedures against the customer instance in a
**controlled maintenance window** (scenarios 3–5 stop/start Redis and Postgres).
Capture pass/fail with the **observed** evidence — never a copied verdict.

Blank capture template — mirrors the real `bench/results/reliability.json`
(`{id, result, evidence}`); fill `Result` and `Observed evidence` live:

| #   | Scenario (real procedure)            | How to perturb                              | Result                  | Observed evidence (fill live)                                                                  |
| --- | ------------------------------------ | ------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Migration idempotency                | re-run `npm run db:migrate`                 | ☐ PASS ☐ FAIL           | applied ___ new migrations (expect **0**); "Migrations complete"                               |
| 2   | Backup & restore                     | `backup-db.sh` → fresh DB → `restore-db.sh` | ☐ PASS ☐ FAIL           | source vs restored row counts: apps _**/**_, versions _**/**_, categories _**/**_              |
| 3   | Backend restart recovery             | `SIGTERM` → restart                         | ☐ PASS ☐ FAIL           | `/health` → 000 on stop; healthy again in ____ s                                               |
| 4   | Redis-down fail-open                 | stop Redis, hit `/store/apps` ×5            | ☐ PASS ☐ FAIL           | responses: **,**,**,**,__ ; `/health` = degraded/redis:down; no crash                          |
| 5   | Postgres-down degrade + auto-recover | `pg_ctl stop -m fast` → restart             | ☐ PASS ☐ FAIL           | process alive ☐; `/health` degraded/db:down; DB read → clean 500; auto-reconnect w/o restart ☐ |
| 6   | Offline / air-gapped bundle          | `build-offline-bundle.sh` → transfer → load | ☐ PASS ☐ PARTIAL ☐ FAIL | shellcheck ___; `docker save/load` executed? ☐ (needs a daemon)                                |

**Data-integrity** evidence is scenarios 1–2 above: the migration re-run diff and the
row-count match are the integrity proof. File the reliability JSON under
`${EVID}/reliability/` and the row-count check under `${EVID}/data-integrity/`.

---

## 5. Performance evidence

Invoke the three harnesses as in §3, then transcribe the JSON into the blank tables.
**All customer cells start blank** (`—`). The final row of each table is the
**EVP 2-vCPU reference floor** — _our_ validated result, labelled so it can
never be mistaken for this pilot's measurement.

### 5.1 HTTP API load — `bench/http-load.mjs`

Columns match the real JSON exactly (`throughput_rps`, `mean/p50/p90/p95/p99/max_ms`,
`errors`). Concurrency 32, 3,000 measured requests/scenario, 300 warmup.

| Scenario                                                                   | requests | errors | throughput_rps | mean_ms | p50_ms | p90_ms | p95_ms | p99_ms | max_ms |
| -------------------------------------------------------------------------- | -------: | -----: | -------------: | ------: | -----: | -----: | -----: | -----: | -----: |
| GET /health (liveness, no DB)                                              |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /live (readiness)                                                      |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /metrics (prometheus)                                                  |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /store/apps (DB list, 20 rows)                                         |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /store/apps?q=ai&sort=trending                                         |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /store/featured (DB join)                                              |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /store/categories (DB agg)                                             |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| GET /store/apps/:slug (DB point read)                                      |        — |      — |              — |       — |      — |      — |      — |      — |      — |
| _GET /store/apps — **reference floor, not this pilot** (EVP 2-vCPU)_       |     3000 |      0 |         610.29 |   52.23 |  51.87 |  64.27 |  68.51 |  79.77 | 126.97 |
| _GET /store/apps/:slug — **reference floor, not this pilot** (EVP 2-vCPU)_ |     3000 |      0 |         423.72 |   75.33 |  72.19 |  94.82 | 104.35 | 117.82 | 131.85 |

_The full EVP reference set (all 8 scenarios) lives in
`PERFORMANCE-BENCHMARKS.md` §2 — it is the reference floor, not a customer result._

### 5.2 Database latency — `bench/db-latency.mjs`

| Query shape                                                     | iters | errors | mean_ms | p50_ms | p95_ms | p99_ms | max_ms |
| --------------------------------------------------------------- | ----: | -----: | ------: | -----: | -----: | -----: | -----: |
| point read (application by slug)                                |     — |      — |       — |      — |      — |      — |      — |
| filtered list (published, limit 24)                             |     — |      — |       — |      — |      — |      — |      — |
| aggregate (count by status)                                     |     — |      — |       — |      — |      — |      — |      — |
| join (app + latest version)                                     |     — |      — |       — |      — |      — |      — |      — |
| index probe (`SELECT 1`)                                        |     — |      — |       — |      — |      — |      — |      — |
| _point read — **reference floor, not this pilot** (EVP 2-vCPU)_ |  2000 |      0 |    0.30 |   0.23 |   0.46 |   2.37 |  15.88 |

### 5.3 Cold start + idle metrics — `bench/startup.sh`

| Metric                                      | Customer instance (fill) | EVP reference floor — not this pilot                          |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| cold_start_to_healthy_sec (first cold boot) | —                        | 0.66 (2-vCPU reference)                                       |
| cold_start_to_healthy_sec (warm reboot)     | —                        | 0.624 (2-vCPU reference)                                      |
| `/health` at readiness                      | —                        | `{"status":"ok","components":{"database":"up","redis":"up"}}` |
| metrics_idle.resident_memory_bytes          | —                        | 117813248 (~117 MB, reference)                                |
| metrics_idle.heap_used_bytes                | —                        | 20579624 (~20 MB, reference)                                  |
| metrics_idle.pg_pool_total                  | —                        | 1 (reference)                                                 |

> Interpretation guardrail: the EVP reference is a **2-vCPU shared container with a
> co-located load client** — a conservative floor, not a target. Compare a pilot
> number to the pilot's own baseline and SLOs (`PILOT-FRAMEWORK.md`), not the reference.

---

## 6. Security evidence

Three artifacts: a **control attestation** (checklist), a **dependency audit**, and
an **honest disclosure** of the two known HIGH items. No finding is invented —
controls are attested against the real implementation, and the open items are carried
verbatim from `ENTERPRISE-GA-REPORT.md` / `docs/guides/SECURITY-GUIDE.md`.

### 6.1 Control checklist (attest against the deployed instance)

| #   | Control (real implementation)                                               | Present? | Evidence / note (fill) |
| --- | --------------------------------------------------------------------------- | -------- | ---------------------- |
| 1   | Electron context isolation, sandbox, `nodeIntegration` off, strict CSP      | ☐        | —                      |
| 2   | Channel-allowlisted **Zod** IPC router + sender-trust; **fails closed**     | ☐        | —                      |
| 3   | RBAC scope enforcement (57-scope model; owner holds all)                    | ☐        | —                      |
| 4   | OAuth 2.0 **PKCE (S256)** + RFC 8252 loopback                               | ☐        | —                      |
| 5   | JWT access tokens **algorithm-pinned HS256**                                | ☐        | —                      |
| 6   | Refresh-token rotation with reuse detection                                 | ☐        | —                      |
| 7   | Passwords **Argon2id** (memoryCost 19456 KiB, timeCost 2, parallelism 1)    | ☐        | —                      |
| 8   | OS-keychain secret storage + connector vault                                | ☐        | —                      |
| 9   | SSRF egress guard on webhooks; inbound HMAC timing-safe compare             | ☐        | —                      |
| 10  | Backend `helmet`, loopback-only CORS, rate limiting                         | ☐        | —                      |
| 11  | Marketplace signing + static scan (Ed25519); worker install **fail-closed** | ☐        | —                      |
| 12  | Append-only `audit_log` table                                               | ☐        | —                      |
| 13  | Prod config: `SEED_STORE_ON_BOOT=false`, `RUN_MIGRATIONS_ON_BOOT=false`     | ☐        | —                      |

### 6.2 Dependency audit

```bash
npm audit --omit=dev --json > ${EVID}/security/npm-audit-$(TS).json
```

Record the customer's result in the pilot record. The EVP reference run reported
**0 production vulnerabilities** (`PERFORMANCE-BENCHMARKS.md` §7) — reference floor,
not a customer guarantee; re-run and record what the customer's build reports.

### 6.3 Known HIGH items — disclose in every pilot (do not hide)

| ID   | Item                                                                                                                                    | Location                                            | Severity | Disclosure note                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| TD-1 | Apple `id_token` decoded but **signature not verified** against Apple JWKS (`jwt.decode`, not `jwt.verify`)                             | `apps/backend/src/auth/providers/apple.ts:14-16,77` | **HIGH** | Only affects the Apple sign-in path; other providers use authenticated userinfo/Graph. Disclose; note if Apple SSO is in scope for this pilot. |
| TD-2 | Marketplace **app** install accepts **unsigned** packages when the trust store is empty (fails closed only when a signature is present) | `apps/desktop/src/main/nps/packageService.ts:184`   | **HIGH** | Integrity hash is always checked; worker-package path is fail-closed. Disclose; recommend a non-empty publisher trust store for the pilot.     |

Also carry the tracked **MEDIUM**: the rate limiter **fails open** on Redis loss
(`apps/backend/src/middleware/rateLimit.ts:37`) — already visible in Reliability
scenario 4; pair it with an alert on the `redis:"down"` signal.

---

## 7. Business evidence

**Inputs only — no numbers, no ROI, no payback are computed here.** The value model
(formula + worked example) is a **separate CDEP deliverable** — the business-value /
ROI methodology and case-study template; per `_grounding.md`, ROI is a methodology
whose worked examples are labelled hypothetical. This lists the **inputs** it consumes.

Input register — blank; fill each row's value/source at entry (baseline) and exit
(delta):

| Input                            | Source (customer-sourced unless noted)                      | Unit                  | Owner       | Value (fill) |
| -------------------------------- | ----------------------------------------------------------- | --------------------- | ----------- | ------------ |
| Incumbent tooling / license cost | customer finance                                            | currency/seat/yr      | sponsor     | —            |
| Operator deployment effort       | pilot timesheet (real hours)                                | person-hours          | deploy lead | —            |
| Ongoing ops effort               | EOSP support log + timesheet                                | person-hours/wk       | SRE         | —            |
| Infra footprint (sizing)         | capacity evidence §3 (`/metrics` RSS/heap/pool)             | vCPU/GB               | SRE         | —            |
| Auth throughput ceiling (sizing) | Argon2 cost × cores (methodology input)                     | verifies/s/core       | SRE         | —            |
| Incident / downtime baseline     | customer's current SLA + history                            | count, minutes        | sponsor     | —            |
| Migration/onboarding effort      | pilot record (real hours)                                   | person-hours          | deploy lead | —            |
| Adoption / usage counts          | `audit_log` + usage (methodology; **no fabricated scores**) | active users, actions | success mgr | —            |

Nothing here is multiplied out. Hand the completed register to the ROI methodology
deliverable; it owns the math and the labelling.

---

## 8. Reproducibility & chain-of-custody checklist

Before any pilot evidence is treated as valid, confirm all of:

- [ ] Target confirmed reachable (`/health` 200) **before** each harness run.
- [ ] `tool_git_ref` recorded (`git rev-parse HEAD`) for every harness invocation.
- [ ] `environment.json` captured for the **customer** instance (their HW, not EVP's).
- [ ] Every artifact timestamped (UTC), checksummed (`sha256`), and listed in `SHA256SUMS`.
- [ ] A custody manifest exists per artifact with `collected_by` + `witnessed_by`.
- [ ] Artifacts are append-only; a re-measure is a new file, never an overwrite.
- [ ] Every EVP reference number used for comparison is labelled _"reference floor — not this pilot."_
- [ ] The two HIGH items (TD-1, TD-2) are disclosed in the pilot record.
- [ ] No customer cell contains a projected, example, or reference number.

Completed evidence flows into the pilot scorecard (`DEPLOYMENT-QUALITY.md`), the
acceptance sign-off (`PILOT-FRAMEWORK.md`), and ultimately the
`CUSTOMER-DEPLOYMENT-REPORT.md`. Until a real pilot fills these instruments, every
table above is intentionally, honestly **blank**.
