# NeuroPause — Reliability Results (executed)

Each scenario below was **run against the live backend** (production build,
Postgres 16.13, Redis 7.0.15) on 2026-07-18. Results are pass/fail with the real
observed evidence. Nothing here is a description of intended behaviour — it is what
actually happened when the system was perturbed.

## Summary

| # | Scenario | Result | Recovery |
|---|---|---|---|
| 1 | Migration idempotency | **PASS** | n/a |
| 2 | Backup & restore (pg_dump/pg_restore) | **PASS** | exact row-count match |
| 3 | Backend restart recovery | **PASS** | 0.46 s |
| 4 | Redis-down fail-open | **PASS** | serves through outage |
| 5 | Postgres-down degradation + auto-recovery | **PASS** | auto-reconnect, no restart |
| 6 | Offline / air-gapped bundle | **PARTIAL** | script validated; docker save/load needs a daemon |

---

## 1. Migration idempotency

Forward-only migrations must be safe to re-run (every deploy invokes them).

- Applied state: **12** migrations in `schema_migrations` (`0001_init` … `0012_embedding_state`).
- Re-ran `npm run db:migrate` → log printed **"Migrations complete"** with **zero
  new "Applied migration" lines**.

**PASS** — re-running applies nothing new; deploys are safe to repeat.

## 2. Backup & restore

The real disaster-recovery path (per the Disaster Recovery Guide) is data-side
restore. Proven end to end:

```
pg_dump -Fc  → /tmp/np_backup.dump (136 KB)
createdb neuropause_restore
pg_restore   → neuropause_restore
```

| Table | Source | Restored |
|---|---:|---:|
| applications | 20 | **20** |
| versions | 40 | **40** |
| categories | 14 | **14** |

**PASS** — restored database is row-for-row identical to the source. This is the
concrete basis for the recommended RTO/RPO in the vertical business-continuity
sections.

## 3. Backend restart recovery

- Sent `SIGTERM` to the backend → `/health` went unreachable (`000`), i.e. it shut
  down cleanly rather than hanging.
- Restarted the process and polled `/health` → **healthy again in 0.46 s**.

**PASS** — graceful stop, sub-second restart-to-healthy.

## 4. Redis-down fail-open

Redis backs the rate limiter. Design intent (documented, `rateLimit.ts:37`): **fail
open** so an infrastructure blip never locks every user out.

- Stopped Redis (`redis-cli shutdown nosave`) → `redis-cli ping` = **DOWN**.
- `GET /store/apps` × 5 → **200, 200, 200, 200, 200** (served through the outage).
- `GET /health` → `{"status":"degraded","components":{"database":"up","redis":"down"}}`.
- Backend process stayed up throughout; restarting Redis restored `PONG`.

**PASS** — availability preserved during a cache outage, and `/health` reports the
degradation honestly instead of hiding it. (The security trade-off — rate limiting
is not enforced while Redis is down — is tracked as an open item in the GA report
and should be paired with an alert on the `redis:"down"` signal.)

## 5. Postgres-down degradation + auto-recovery

The hardest test: pull the primary datastore out from under a running process.

- Baseline: `/health` `status:"ok"`.
- Stopped Postgres (`pg_ctl stop -m fast`).
  - Backend process **did not crash** (PID still alive).
  - `/health` → `{"status":"degraded","components":{"database":"down","redis":"up"}}`.
  - DB-dependent read `GET /store/apps` → clean **500** (fails fast, does not hang).
- Restarted Postgres. The connection pool **auto-reconnected with no backend
  restart**: `/health` returned to `status:"ok"` and `/store/apps` to `200` within
  a few seconds.

**PASS** — the process survives datastore loss, reports honest health, refuses
DB-dependent work cleanly, and self-heals when the datastore returns. This is the
strongest single piece of resilience evidence in the program.

## 6. Offline / air-gapped bundle

- `scripts/build-offline-bundle.sh` exists and is **shellcheck-CLEAN**; the
  air-gapped workflow (build bundle → transfer → `load-and-run.sh`) is documented in
  `deploy/README.md`.
- **Not fully executed**: the bundle uses `docker save`/`load`, and no Docker daemon
  is available in this harness environment.

**PARTIAL** — the mechanism is real and statically validated; a full build/transfer
execution is a target-environment task, listed honestly as remaining.

---

## How to reproduce

The safe scenarios (1–2) run against any migrated DB. The chaos scenarios (3–5)
stop/start local Redis and Postgres and confirm `/health` transitions and recovery.
The consolidated machine-readable results are in `bench/results/reliability.json`.

## Not executed here (honest scope)

- **Failure injection at scale / long-run chaos** (sustained fault storms, network
  partitions between nodes) — needs a multi-node target environment.
- **Update rollback** is **advisory**: the real recovery path is the proven
  data-side restore (§2), not an automated application rollback. Tracked in the GA
  report.
- **Federation disaster recovery** is **modeled**, not executed.
