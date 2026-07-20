# NeuroPause — Operational Runbooks

Incident runbooks for the backend (`apps/backend`), each grounded in a **real reliability
result executed this program** (`docs/validation/_grounding.md`; raw evidence in
`bench/results/reliability.json`). Every runbook follows one shape:

> **Symptom → Signal (a real `/health` field or `/metrics` series) → Action → Verification.**

Signals name only endpoints and series that exist in source: `/live` (`app.ts:84`), `/health`
(`app.ts:88`), `/metrics` (`app.ts:99`). This complements the day-2 reference in
`docs/guides/OPERATIONS-GUIDE.md` and the recovery detail in
`docs/guides/DISASTER-RECOVERY-GUIDE.md`; it does not duplicate them.

**Signal cheat-sheet.**

| Signal | Meaning |
|---|---|
| `GET /health` → `components.database` = `"up"\|"down"` | Postgres reachability (parallel ping) |
| `GET /health` → `components.redis` = `"up"\|"down"` | Redis reachability (parallel ping) |
| `GET /health` HTTP status `200` / `503` | overall `ok` / `degraded` |
| `GET /live` → `{status:"alive"}` | process is up (no dependency checks) |
| `neuropause_backend_up` | gauge, `1` while the process serves |
| `neuropause_pg_pool_connections{state="total\|idle\|waiting"}` | live `pg` pool gauges |
| `neuropause_http_requests_total{method,status}` | request counter (drives rate/error math) |

> **No latency series exists.** `/metrics` records request **counts** by method+status only —
> there is no histogram/`_bucket` or per-route latency (`OPERATIONS-GUIDE.md`). Latency is
> inferred from pool saturation and measured externally (see Runbook 4).

---

## Runbook 1 — Redis down

**Proven behavior (reliability scenario `redis-down-fail-open`, PASS):** Redis stopped →
`/store/apps` served **200 × 5** (fail-open) → `/health` reported **`degraded` / `redis:down`**
→ **no crash**. The rate limiter **fails open** when Redis is unavailable — a deliberate
availability choice (`_grounding.md`).

**Symptom.** Sign-in/OAuth-flow hiccups or rate-limit-bypass alerts; readiness flapping while
the API still answers reads.

**Signal.**
- `GET /health` → HTTP **503**, `components.redis: "down"`, `components.database: "up"`,
  `status: "degraded"`.
- `neuropause_backend_up` stays **1** (process healthy) — the service did **not** crash.
- Data reads (e.g. `/store/apps`) still return **200**.

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' http://<host>/health   # 503
$ curl -s http://<host>/health | jq '.components'                 # {"database":"up","redis":"down"}
$ curl -s -o /dev/null -w '%{http_code}\n' http://<host>/store/apps # 200 (fail-open)
```

**Action.**
1. Do **not** restart the backend — it survives a Redis outage by design.
2. Restore Redis: Compose `docker compose -f docker-compose.prod.yml up -d redis`; K8s — repair
   the managed Redis / endpoint behind `REDIS_URL`.
3. Because the limiter fails open, treat the window as **elevated abuse risk**: watch
   `neuropause_http_requests_total` for anomalous request-rate spikes and, if exposed to
   untrusted traffic, throttle upstream (WAF/ingress) until Redis returns.

**Verification.**

```bash
$ curl -s http://<host>/health | jq '.status, .components.redis'  # "ok", "up"
$ curl -s -o /dev/null -w '%{http_code}\n' http://<host>/health   # 200
```

`/health` returns **200 / `ok`** with `redis:"up"` once the ping succeeds; no backend restart
required.

---

## Runbook 2 — Postgres down

**Proven behavior (reliability scenario `db-down-degradation-autorecover`, PASS):** Postgres
stopped → process **survived** → `/health` **`degraded` / `database:down`** → DB-dependent read
returned a **clean 500** → on Postgres restart the pool **auto-reconnected without a backend
restart** → `/health` back to `ok`.

**Symptom.** Store/auth read paths return 500; readiness fails; process stays up.

**Signal.**
- `GET /health` → HTTP **503**, `components.database: "down"` (with `redis` possibly still
  `"up"`), `status: "degraded"`.
- `neuropause_backend_up` stays **1** — no crash.
- `neuropause_pg_pool_connections{state="total"}` collapses toward `0` as connections drop.

```bash
$ curl -s http://<host>/health | jq '.components.database'        # "down"
$ curl -s http://<host>/metrics | grep neuropause_pg_pool_connections
```

**Action.**
1. Do **not** restart the backend — auto-reconnect is proven; a restart only adds the
   **0.46 s** cold path (Runbook 3) for no benefit.
2. Restore Postgres behind `DATABASE_URL`: Compose
   `docker compose -f docker-compose.prod.yml up -d postgres`; K8s — recover the managed
   instance / failover.
3. The K8s readiness probe drains the unhealthy pod automatically (503 on `/health`), so no
   traffic is routed to a pod that cannot reach the DB (`backend.yaml:155-162`).

**Verification.**

```bash
$ curl -s http://<host>/health | jq '.status, .components.database'   # "ok", "up"
$ curl -s http://<host>/metrics | grep 'neuropause_pg_pool_connections{state="total"}'  # climbs back
```

The pool re-establishes with **no backend restart**; `/health` returns **200 / `ok`**. If the
outage coincided with a migration, see `DISASTER-RECOVERY-GUIDE.md §4`.

---

## Runbook 3 — Backend restart / recovery

**Proven behavior (reliability scenario `backend-restart-recovery`, PASS):** SIGTERM → down →
restart → **healthy in 0.46 s**. (Cold start from scratch → healthy is **0.66 s**,
`_grounding.md`.)

**Symptom.** Pod/container recycle (OOM, node drain, rollout, crash), or a planned restart.

**Signal.**
- During the gap: `/live` and `/health` unreachable / connection refused.
- After: `/live` → `{status:"alive"}` first, then `/health` → `200 ok` once Postgres+Redis
  pings pass; `neuropause_backend_uptime_seconds` resets toward `0`.

```bash
$ curl -s http://<host>/live | jq '.uptime'          # small, climbing
$ curl -s http://<host>/metrics | grep neuropause_backend_uptime_seconds
```

**Action.**
1. Let the orchestrator restart it. The container `HEALTHCHECK` probes `/live`
   (`Dockerfile:51-52`); K8s `livenessProbe` `/live` + `readinessProbe` `/health` gate traffic
   (`backend.yaml:147-162`).
2. For a manual restart: Compose
   `docker compose -f docker-compose.prod.yml restart backend`; K8s
   `kubectl -n neuropause rollout restart deploy/neuropause-backend`.
3. If restarts **loop**, the cause is upstream (bad `DATABASE_URL`/`REDIS_URL`/missing
   `JWT_ACCESS_SECRET` — the backend refuses to start without them) — check env before blaming
   the app.

**Verification.**

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' http://<host>/health    # 200 within ~1s of process up
```

Expect `/health` **200** within roughly the measured **0.46 s** recovery (plus probe interval)
on the reference env. A rolling update stays zero-downtime: `maxUnavailable: 0` keeps old pods
serving until new pods pass readiness (`backend.yaml:107-162`).

---

## Runbook 4 — High latency

**Grounding.** Reference-env HTTP load (concurrency 32, 24,000 requests, **0 errors**) measured
p50s of `/health` 22 ms, `/store/apps` 52 ms (p99 80 ms), point-read `/store/apps/:slug` 72 ms
(p99 118 ms); direct DB point read is sub-ms (p50 **0.23 ms** / p95 **0.46 ms**). "DB is
sub-ms; app-layer + 2-vCPU contention dominates HTTP latency" (`_grounding.md`). The `pg` pool
auto-scales **1 → 10** and RSS grows **117 → 213 MB** under the 24k-request load.

**Symptom.** Client-observed slow responses; rising p95/p99 on your external probe.

**Signal.** `/metrics` exposes **no latency series** — infer from saturation and derive rates:
- `neuropause_pg_pool_connections{state="waiting"}` **> 0** and sustained → requests are queued
  waiting for a DB connection (the primary saturation signal).
- `neuropause_pg_pool_connections{state="total"}` pinned at the pool max with `idle`≈`0`.
- `neuropause_http_requests_total{status=~"5.."}` climbing → errors, not just latency.
- `neuropause_backend_resident_memory_bytes` trending toward the container limit.

```bash
$ curl -s http://<host>/metrics | grep -E 'pg_pool_connections|http_requests_total|resident_memory'
```

**Action.**
1. **Confirm it's the app tier, not the DB.** Run the DB harness — if it stays sub-ms, the
   bottleneck is app/CPU/pool, not Postgres:
   ```bash
   $ DATABASE_URL=... node bench/db-latency.mjs        # expect p50 ~0.23ms / p95 ~0.46ms
   ```
2. **Reproduce the HTTP profile** to quantify current latency (no in-app series exists):
   ```bash
   $ node bench/http-load.mjs --base http://<host> --conc 32 --reqs 3000
   ```
3. **If `waiting > 0`:** the pool is the constraint — scale out (K8s HPA is CPU-based, min 2 /
   max 6 at 70%, `optional.yaml:19-27`; `kubectl -n neuropause get hpa`) or raise pod
   CPU/replicas. On the reference 2-vCPU env, CPU contention is the documented dominant factor.
4. **If memory trends to the limit:** raise `resources.limits.memory` (default 512Mi,
   `backend.yaml:167-169`) or scale out.

**Verification.**

```bash
$ curl -s http://<host>/metrics | grep 'pg_pool_connections{state="waiting"}'  # back to 0
```

Waiting count returns to **0** and your external p95 probe recovers toward the reference
figures. For real latency SLOs, add a blackbox probe on `/health` and Prometheus recording
rules — the app ships counts, not histograms (`OPERATIONS-GUIDE.md` "Known Operational Gaps").

---

## Runbook 5 — Backup & restore drill

**Proven procedure (reliability scenario `backup-restore`, PASS):** `pg_dump -Fc` (136 KB) →
fresh DB → `pg_restore` → **row counts match exactly** (applications 20, versions 40,
categories 14). Run this as a **scheduled drill**, not only during an incident — "a backup you
have never restored is a hypothesis" (`DISASTER-RECOVERY-GUIDE.md §8.5`).

**Symptom / trigger.** Scheduled DR drill; pre-upgrade safety (`DEPLOYMENT-PLAYBOOKS.md §D.1`);
data-corruption recovery.

**Signal.** Success = restored **row counts match** the source; `restore-db.sh` uses
`psql -v ON_ERROR_STOP=1`, so any SQL error **aborts** rather than leaving a partial restore
(`restore-db.sh:31-33`).

**Action — shipped Compose scripts.**

```bash
# 1. Create a compressed dump (keeps the most recent 14)
$ scripts/backup-db.sh
#   → docker compose exec -T postgres pg_dump --clean --if-exists --no-owner --no-privileges | gzip
#     → backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz

# 2. Prove restorability into a SCRATCH target before trusting it (drill = custom-format variant)
$ pg_dump -Fc "$DATABASE_URL" -f /tmp/drill.dump
$ createdb neuropause_drill
$ pg_restore -d neuropause_drill /tmp/drill.dump

# 3. Compare row counts source vs restored (the proven pass criterion)
$ psql "$DATABASE_URL"       -c "select count(*) from applications;"   # e.g. 20
$ psql neuropause_drill      -c "select count(*) from applications;"   # must match
```

**Action — real restore (destructive; confirmation-gated).**

```bash
$ scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz
#   prints a warning, requires typing 'yes'; the dump is --clean --if-exists so it
#   drops+recreates objects (overwrites the current DB). After it finishes, restart
#   the backend so pooled connections re-establish.
```

**Verification.**

```bash
$ psql "$DATABASE_URL" -c "select count(*) from applications;"   # matches the pre-restore source
$ curl -s http://<host>/health | jq '.status'                   # "ok" after backend restart
```

**Honest limits.** Whole-dump only — **no PITR/WAL** in-repo, so recovery lands on a specific
dump, never an arbitrary point between dumps. Redis holds cache/session state (append-only AOF)
and has **no dedicated backup** — treat it as reconstructible, not a system of record
(`DISASTER-RECOVERY-GUIDE.md §2.2`, §3.2). Schedule `backup-db.sh` externally (cron / systemd
timer) — no scheduler ships with the stack, so your backend RPO equals the age of the last
operator-run dump (`DISASTER-RECOVERY-GUIDE.md §6`).

---

## Escalation notes (what the platform does NOT do — do not wait on it)

Per `OPERATIONS-GUIDE.md` "Known Operational Gaps", these are **absent** and must come from
external tooling — none of the runbooks above should assume them:

- **No native alerting/paging.** Author alert rules on the shipped series in **Prometheus +
  Alertmanager** — e.g. `neuropause_backend_up == 0`, 5xx ratio from
  `neuropause_http_requests_total{status=~"5.."}`, pool saturation from
  `neuropause_pg_pool_connections{state="waiting"}`, plus a blackbox probe on `/health`.
- **No distributed tracing, no capacity forecasting, no log rotation** — supply
  OTel Collector, external forecasting over the metric time-series, and logrotate / the Docker
  logging driver respectively.
- **Federation multi-region DR is MODELED** — not failover (`DISASTER-RECOVERY-GUIDE.md §7.1`).
- **App-binary rollback is advisory** — real recovery is data-side (Runbook 5 +
  `DEPLOYMENT-PLAYBOOKS.md §D.4`).
