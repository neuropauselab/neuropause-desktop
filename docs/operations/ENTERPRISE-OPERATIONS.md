# NeuroPause EOSP — Enterprise Operations Manual (operating cadence)

> **What this is.** The **operating cadence** for running NeuroPause as a software
> business at scale: the recurring daily / weekly / monthly / quarterly rhythm of
> tasks an operator executes, plus the **capacity procedure** and **operational KPI
> definitions** that rhythm produces. It is **execution, not architecture** — it adds
> **no runtime and no platform**, and it is the _calendar_ that **uses** the day-2
> signals catalogued in `docs/guides/OPERATIONS-GUIDE.md`, never a re-explanation of them.
>
> **Honesty banner (non-negotiable).** There is **no production fleet**, so this manual
> states **no achieved uptime, MTTR, availability, backup rate, or KPI value** — every
> KPI is a **definition + how-to-measure** over the real `/metrics` / `/health` /
> `audit_log` substrate, and every target is a **proposed objective, to be ratified
> against production data**. Capacity uses the **measured** coefficients in
> `_grounding.md`; every fleet number is a **projection from the 2-vCPU reference
> measurement**. Platform maturity: **Validated Release Candidate**
> (`ENTERPRISE-VALIDATION-REPORT.md`), run by an **implied/target org** — **roles, never people**.

## How to use this manual

Each cadence is a checklist — **owning role**, **real signal/command**, **pass condition** —
routing failures to a runbook, never improvisation. This manual **extends, does not restate**, five assets:

| Asset                                                                        | This manual uses it for                                                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docs/guides/OPERATIONS-GUIDE.md`                                            | the `/health` / `/metrics` / dashboard signals every check reads (§Monitoring, §Metrics)                         |
| `docs/validation/OPERATIONAL-RUNBOOKS.md`                                    | the incident procedure a failed check invokes (Runbooks 1–5)                                                     |
| `docs/operations/SRE.md`                                                     | the reliability **contract** the cadence serves — SLIs/SLOs, error budgets, on-call roles, capacity math (§2–§6) |
| `docs/guides/DISASTER-RECOVERY-GUIDE.md`, `docs/guides/RELEASE-CHECKLIST.md` | backup/restore and release-gate steps invoked on cadence                                                         |

**Cadence at a glance.**

| Cadence       | Primary purpose                                                       | Owning role         | Anchor signals / assets                                  |
| ------------- | --------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- |
| **Daily**     | health sweep, saturation & audit watch, backup freshness              | Primary on-call     | `/health`, `/metrics`, `audit_log`, `./backups`          |
| **Weekly**    | restore drill, trend review, security/dep posture, on-call handoff    | Ops lead + SRE      | `/metrics` trends, Runbook 5, `npm audit`, risk register |
| **Monthly**   | capacity review, full DR drill, compliance evidence, access review    | SRE + Security lead | §Capacity procedure, DR §8, EVP vertical packs           |
| **Quarterly** | SLO ratification, capacity re-baseline, DR exercise, security posture | Ops lead (chairs)   | SRE.md §3–§6, bench harness, GA risk register            |

---

## Daily operations handbook

A ~15-minute standing sweep by the **Primary on-call** at start of day and after any deploy;
every step names the **real** signal it reads. The platform ships **no native paging**
(`OPERATIONS-GUIDE.md` gaps), so until Prometheus/Alertmanager wiring (SRE.md §4) exists, **this sweep is the watch**.

### 1. Backend readiness & dependency health — `GET /health`

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<host>/health          # expect 200
curl -s http://<host>/health | jq '.status, .components'               # "ok", db+redis "up"
```

- **Pass:** HTTP `200`, `status:"ok"`, `components.database:"up"`, `components.redis:"up"`
  (`components` live **only** in the `/health` body, not in `/metrics`).
- **Fail → runbook:** `503` + `database:"down"` → **Runbook 2**; `redis:"down"` →
  **Runbook 1** (reads still serve — fail-open — but the rate limiter is disabled, so
  treat as elevated abuse risk).

### 2. Process & resource sweep — `GET /metrics`

Scrape once and read the six shipped series (`OPERATIONS-GUIDE.md` §Metrics):

```bash
curl -s http://<host>/metrics | grep -E \
  'neuropause_backend_up|uptime_seconds|resident_memory_bytes|pg_pool_connections|http_requests_total'
```

| Series                                            | Daily read                                           | Pass / escalate                                          |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `neuropause_backend_up`                           | scrape succeeds, gauge `1`                           | scrape failure = process gone → Runbook 3                |
| `neuropause_backend_uptime_seconds`               | no unexpected reset since yesterday                  | reset = unplanned restart → investigate env (Runbook 3)  |
| `neuropause_pg_pool_connections{state="waiting"}` | **`0`**                                              | sustained `>0` = pool queuing / latency → **Runbook 4**  |
| `neuropause_backend_resident_memory_bytes`        | well under `limits.memory` (chart default **512Mi**) | trending to limit → §Capacity memory trigger / Runbook 4 |
| `neuropause_http_requests_total{status=~"5.."}`   | 5xx ratio flat vs baseline                           | rising ratio → Runbook 4; if it burns budget, SRE.md §4  |

> `neuropause_backend_up` is a **static `1`** while the process serves — it proves
> liveness only by scrape success. There is **no latency series**; latency is inferred
> from the `waiting` gauge and measured out-of-band (Runbook 4).

### 3. `audit_log` review — security event watch

The append-only `audit_log` table (`0001_init.sql:50-60`: `id, user_id, action, detail
JSONB, ip, created_at`; indexed on `action`/`user_id`) records the **successful auth
lifecycle**. Review the trailing day:

```sql
SELECT action, count(*), count(DISTINCT ip) FROM audit_log
WHERE created_at > now() - interval '24 hours' GROUP BY action ORDER BY 2 DESC;
```

- **Real actions** (`auth/router.ts`): `auth.email.login`/`register`,
  `auth.oauth.login`/`register`, `auth.logout`; `detail` carries `provider` / `email` /
  a 12-char `tokenHash` prefix, `ip` is the client address.
- **Watch for:** registration or login volume spikes, unusual `ip` fan-out on one path,
  logout without a matching prior login.
- **Honest limits (do not over-read this signal):** (a) **only successful** auth events
  are rows — **failed logins / lockouts are not in `audit_log`**; find those in pino
  request logs (`x-request-id`). (b) Writes are **fire-and-forget** — a failed insert is
  logged and swallowed (`audit.ts:23-25`), so a missing row is not proof of no event.
  Reconcile anomalies against pino.

### 4. Backup freshness — RPO watch

The backend backup (`scripts/backup-db.sh`) is **operator/cron-run and keeps the 14
most recent** dumps; **no scheduler ships in-stack**, so **backend RPO = age of the
last successful dump** (`DISASTER-RECOVERY-GUIDE.md §2.2, §6`).

```bash
ls -lt backups/neuropause-db-*.sql.gz | head -1      # newest dump — confirm < 24h old
tail -n 3 backups/backup.log                         # confirm last cron run exited 0
```

- **Pass:** newest dump `< 24h` old, non-zero size; the nightly cron
  (`30 2 * * * … scripts/backup-db.sh >> backups/backup.log 2>&1`, `DEPLOYMENT.md §5`)
  logged a clean run. Desktop stores are covered separately by the 24h/keep-10
  `BackupManager` (`DISASTER-RECOVERY-GUIDE.md §2.1`).
- **Fail:** stale/missing dump → run `scripts/backup-db.sh` now and fix the timer.

**Daily sign-off (one line in the on-call log):** ☐ `/health` 200 ☐ `/metrics` clean
(no reset, `waiting==0`, RSS margin, 5xx flat) ☐ `audit_log` reviewed ☐ backup `< 24h`.
Any unchecked box carries its runbook/escalation from the steps above.

---

## Weekly operations

**Chair:** Ops lead + SRE (~45 min). **Agenda** — prove recoverability, convert `/metrics`
into capacity signal, refresh security posture:

1. **Backup-restore drill (Runbook 5).** Restore the latest dump into a **scratch** target;
   confirm **row counts match** (`applications`/`versions`/`categories`) — the proven pass
   criterion ("a backup you have never restored is a hypothesis", `DR §8.5`). Not on prod.
2. **Metrics trend review.** Record the week's `/metrics` peaks —
   `pg_pool_connections{state="total"}`, `resident_memory_bytes`, request volume
   (`http_requests_total`), 5xx ratio — the **inputs** to the monthly capacity review.
3. **On-call handoff.** Run the SRE.md §1 handoff checklist (open incidents, budget burn,
   dependencies degraded, pending DR drill) — SRE.md owns the **structure**; this cadence
   ensures the handoff **happens**.
4. **Dependency & security posture.** `npm audit --omit=dev` vs the **0-production-vuln**
   baseline; walk the GA **risk register** (`ENTERPRISE-GA-REPORT.md`), priority on the two
   **HIGH** items — Apple `id_token` not JWKS-verified, and marketplace accepting **unsigned
   packages when the trust store is empty** (confirm it is populated). New advisory → triage.
5. **Log hygiene.** Desktop `audit.log` / `crashes.log` and backend stdout ship **no
   rotation** (gap #4) — confirm external `logrotate` / Docker `json-file` `max-size` bounds them.

### Weekly checklist

| #   | Task                           | Owner             | Evidence of done                     |
| --- | ------------------------------ | ----------------- | ------------------------------------ |
| 1   | Restore drill into scratch     | SRE               | row-count match logged (Runbook 5)   |
| 2   | Trend review → capacity inputs | Ops lead          | peak pool / RSS / rps / 5xx recorded |
| 3   | On-call handoff                | Primary/Secondary | SRE.md handoff checklist signed      |
| 4   | `npm audit --omit=dev` diff    | Security lead     | 0 prod advisories, or triage ticket  |
| 5   | Log-size / rotation check      | Ops lead          | `audit.log` / `crashes.log` bounded  |
| 6   | Release-train status           | Release manager   | next release gate state known        |

---

## Monthly operations

**Chair:** SRE + Security lead (~90 min). **Agenda** — turn trend data into capacity
decisions, exercise DR end-to-end, refresh compliance evidence and access:

1. **Capacity review.** Run the §Capacity procedure against the month's **measured**
   peak read-rps, pool, and RSS; decide whether any trigger threshold is crossed (add
   replica / add DB capacity / raise memory limit) and record the projection basis.
2. **Full DR drill.** Restore into a **throwaway environment** and verify `/health`
   returns `ok` after a backend restart (`DISASTER-RECOVERY-GUIDE.md §8.5`). Re-affirm
   the honest **RPO/RTO** (DR §6): whole-dump only, **no PITR/WAL** in-repo.
3. **Compliance evidence cadence.** Refresh the EVP vertical-pack **self-assessment
   mappings** (SOC 2 / PCI / HIPAA / NIST, `docs/validation/verticals/*`) — **readiness /
   audit-preparation only, not certified; no audit has occurred.**
4. **Access & permission review.** Operator surfaces are **RBAC-gated IPC**
   (`OPERATIONS-GUIDE.md`); review `org:manage` / `observability:read` holders and
   reconcile against `audit_log` `user_id` activity.
5. **Migration & patch inventory.** Confirm `schema_migrations` matches the shipped set
   (**12** forward-only backend migrations); review dependency currency.
6. **Toil review.** Flag any on-call role over the SRE.md proposed **≤50% toil** cap;
   the standing gaps (no alert routing/rotation) are the known toil sources with owned
   reduction paths (SRE.md §1) — track, do not hero.

### Monthly checklist

| #   | Task                               | Owner         | Evidence of done                               |
| --- | ---------------------------------- | ------------- | ---------------------------------------------- |
| 1   | Capacity review + trigger decision | SRE           | sizing sheet + decision recorded               |
| 2   | Full DR drill (scratch env)        | SRE           | `/health` `ok` post-restore                    |
| 3   | Compliance evidence refresh        | Security lead | vertical-pack mappings current (not certified) |
| 4   | RBAC / access reconciliation       | Security lead | `org:manage` holders vs `audit_log`            |
| 5   | Migration + dependency inventory   | Ops lead      | `schema_migrations`=12; audit diff             |
| 6   | Toil assessment                    | Ops lead      | per-role toil % vs 50% cap                     |

---

## Quarterly reviews

Three chartered reviews, each a fixed agenda + checklist, chaired by the **Ops lead** —
they ratify the proposals the lower cadences operate under and re-baseline the measured
inputs. Roles only; no individuals.

### Q-Review A — Reliability & SLO ratification

**Agenda.** (1) Review the SRE.md **proposed** SLOs (§3) and error-budget policy
(§4) against the **first-90-days production data**, _once it exists_ — until then
every SLO remains an **unratified proposal**, not a track record. (2) Walk the
quarter's incidents against the runbook that handled each; note runbook gaps. (3)
Re-affirm the availability objective's honest caveats (HPA-under-load unmeasured;
federation DR modeled; rollback advisory — SRE.md §5).

**Checklist.** ☐ SLO targets reviewed vs data (or explicitly "no fleet yet") ☐ error-budget policy still matches real 5xx counter ☐ runbook gaps ticketed ☐ availability caveats re-stated verbatim.

### Q-Review B — Capacity & cost re-baseline

**Agenda.** (1) **Re-run the bench harness** (`bench/http-load.mjs`, `db-latency.mjs`,
Argon2 microbench) on production-like hardware to **re-measure** the coefficients —
the current floor is a **2-vCPU co-located** conservative bound (`PERFORMANCE-BENCHMARKS.md`).
(2) Update the §Capacity projections and the sizing worksheet with the new floor.
(3) Feed forecasting **externally** over the `/metrics` time-series (e.g. Prometheus
`predict_linear`) — the platform ships **no capacity forecasting** (gap #3).

**Checklist.** ☐ coefficients re-measured on target hardware ☐ replica/DB/auth/memory projections updated ☐ external forecast refreshed ☐ HPA (min 2 / max 6 @ 70% CPU) scale-up validated or still flagged unmeasured.

### Q-Review C — DR & security posture

**Agenda.** (1) DR: audit off-host/PITR posture against `DISASTER-RECOVERY-GUIDE.md
§8`; confirm dumps land in a separate failure domain; review whole-dump RPO/RTO. (2)
Security: burn down the GA **risk register** — priority on the two **HIGH** items
(Apple JWKS, unsigned-package install); refresh the **readiness mappings** (still
**not certified**). (3) Confirm the **quality baseline** holds: typecheck 0, lint 0,
**3,856 tests**, build 0, 0 production npm-audit vulns.

**Checklist.** ☐ off-host + PITR posture reviewed ☐ HIGH-risk items status-changed or re-owned ☐ readiness mappings current (not certified) ☐ quality gates re-run green.

---

## Capacity planning

Capacity is a **calculation from measured coefficients**: the monthly review runs the
procedure, the daily sweep watches the triggers. Full sizing **derivations** (auth,
DB-connection, memory) live in **SRE.md §6**; this section is the **operating procedure** +
**trigger thresholds** over real `/metrics`, with one worked example so it is self-executable.

> **Projection banner.** Coefficients below are **measured** (`bench/results/*.json`,
> `_grounding.md`); every **fleet** number is a **projection from the 2-vCPU reference
> measurement** — a shared 2-vCPU container with a **co-located** load client at **0
> errors**, i.e. a **conservative floor**. Off-box hardware does better; these
> projections **over-provision on purpose**, trimmed once production throughput is seen.

### Measured coefficients (reference: 2 vCPU, 8 GB, Node 22, PG 16, Redis 7)

| Coefficient (measured)    | Value                                                    | Sizing use                 |
| ------------------------- | -------------------------------------------------------- | -------------------------- |
| DB-backed read throughput | **400–600 rps/replica** (`/store/apps` 610, `:slug` 424) | per-replica read floor     |
| Heaviest read p95         | **104 ms** (`/store/apps/:slug`)                         | latency headroom           |
| RSS under 24k-req load    | **≈ 213–223 MB** (idle 117)                              | per-replica memory         |
| pg pool under load        | **auto-scales 1 → 10**                                   | DB connections per replica |
| Argon2id verify           | **p50 19.6 ms → ~50 verifies/s/core**                    | login throughput bound     |
| Restart → healthy         | **0.46 s** (cold 0.66 s)                                 | rollout / recycle budget   |

### Sizing procedure (executable)

1. **Measure the peak** DB-read rps from the trend (`rate(neuropause_http_requests_total[5m])`
   at peak) — do **not** guess.
2. **Divide by the read floor** `R_floor = 500 rps/replica` (mid of the measured 400–600
   band): `replicas_serving = ceil(peak_read_rps / 500)`; **add N+1** for one pod loss /
   rolling update → `replicas_total = replicas_serving + 1`.
3. **Size DB connections:** `fleet_db_conns = replicas_total × 10`; require Postgres
   `max_connections ≥ fleet_db_conns + ~20 reserve`.
4. **Check auth separately** — login is Argon2-bound (~50 verifies/s/core), **independent
   of read capacity**; size per SRE.md §6 if a login surge dominates.
5. **Size memory:** `fleet_RSS ≈ replicas_total × 230 MB`; keep `limits.memory` (chart
   default **512Mi**) unless RSS trends toward it.

**Worked replica example (projection).** Peak of **2,000 rps** DB-backed reads →
`ceil(2000/500)=4` serving + 1 = **5 replicas**; `5×10=50` DB conns + ~20 reserve →
**`max_connections ≥ ~70`** (PG default 100 suffices below ~8 replicas; beyond that,
prefer **pgbouncer** transaction mode — SRE.md §6). Treat **5** as a safe upper bound,
trimmed once real throughput is observed.

### Trigger thresholds (watch on the daily/weekly sweep → act on cadence)

| Trigger signal (real `/metrics`/bench)                 | Threshold                    | Action (labelled projection)                                             |
| ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------ |
| `pg_pool_connections{state="waiting"}` sustained `> 0` | any sustained queuing        | pool is the constraint → **add a replica** (or raise pod CPU); Runbook 4 |
| Peak read-rps / (replicas × 500)                       | **> 0.7** sustained          | approaching read floor → **scale out** by one before saturation          |
| `resident_memory_bytes` / `limits.memory`              | **> 0.7** of 512Mi           | **raise `limits.memory`** or scale out (Runbook 4)                       |
| `replicas_total × 10` vs PG `max_connections − 20`     | crosses **~8 replicas**      | **raise `max_connections`** or introduce **pgbouncer**                   |
| Observed logins/s vs `cores × 50`                      | approaching the Argon2 bound | **size auth separately** (SRE.md §6); Argon2 cost is tunable             |

> The shipped HPA (`optional.yaml`, **min 2 / max 6 @ 70% CPU**) **brackets** the worked
> example, but its **live scale-up under load is unmeasured** (`_grounding.md`; GA report)
> — provision the steady-state count explicitly and treat the HPA as a backstop, not the
> plan. Re-baseline coefficients each quarter (Q-Review B).

---

## Operational KPIs

> **Definitions, not values.** Every row is a **KPI definition + how-to-measure** over
> the **real** substrate, with a **proposed** target objective. **No current value,
> rate, or achievement is stated or implied** — none can be; there is no production
> fleet. The **reliability** SLIs/SLOs (availability, success rate, latency, dependency
> health) are defined and targeted in **SRE.md §2–§3** and **not restated here**; these
> are the complementary **operational-discipline and capacity** measures.

| KPI                                | Definition / how to measure                                             | Real source                                                  | Proposed target (objective)                  |
| ---------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| **Backup freshness (RPO age)**     | `now − timestamp(newest successful dump)`                               | `backups/neuropause-db-*.sql.gz` mtime + `backup.log`        | dump age **≤ 24h**                           |
| **Restore-drill success**          | fraction of drills where restored **row counts match** source           | Runbook 5 drill log (`applications`/`versions`/`categories`) | **100%**; **≥ 1 drill / week**               |
| **Audit-review coverage**          | business days the `audit_log` last-24h query was run / days in window   | `audit_log` review log                                       | **100%** of business days                    |
| **Pool-saturation incidence**      | scrapes with `pg_pool_connections{state="waiting"} > 0` / total scrapes | `/metrics`                                                   | ratio **→ 0** (ties to SRE.md pool SLO)      |
| **Memory-headroom margin**         | `1 − resident_memory_bytes / limits.memory`                             | `/metrics` + chart limit (512Mi)                             | keep **≥ 0.3**; act below                    |
| **Read-capacity utilization**      | peak DB-read rps / (replicas × 500 floor)                               | `rate(http_requests_total)` + replica count                  | **scale-out at > 0.7** sustained             |
| **DB-connection utilization**      | fleet pool peak / Postgres `max_connections`                            | `pg_pool_connections{state="total"}` × replicas              | **pooler/raise beyond ~8 replicas**          |
| **Unplanned-restart rate**         | count of `uptime_seconds` gauge resets / window                         | `/metrics` uptime gauge drop                                 | unplanned restarts **→ 0**; investigate each |
| **Release-gate adherence**         | releases shipped with **all** RELEASE-CHECKLIST gates green / total     | RELEASE-CHECKLIST + CI gate output                           | **100%**                                     |
| **Production dependency currency** | open `npm audit --omit=dev` advisories                                  | `npm audit --omit=dev` (baseline 0)                          | **0** production advisories                  |
| **Log-disk hygiene**               | on-host size of `audit.log` / `crashes.log` vs configured cap           | host filesystem (no in-stack rotation)                       | rotation configured; size **bounded**        |

Each KPI resolves to a real series, file, or reproducible command; one that cannot be so
measured is not reported. Targets tighten only against production data — **inputs to the quarterly reviews**, not dashboard scores.

---

## Provenance & scope

- **Measured (real):** coefficients, latency floors, reliability outcomes, quality
  baseline — `PERFORMANCE-BENCHMARKS.md`, `RELIABILITY-RESULTS.md`, `_grounding.md`.
  **Defined (real substrate):** every daily signal and KPI — `/health`, `/metrics`,
  `/live`, `audit_log`, the backup scripts.
- **Proposed (to be ratified):** all KPI targets, capacity triggers, and every fleet
  projection from the 2-vCPU floor. **No achieved uptime, MTTR, backup rate, or KPI
  value appears anywhere in this manual** — no production fleet exists.
- **Extended, not restated:** `OPERATIONS-GUIDE.md` (signals), `OPERATIONAL-RUNBOOKS.md`
  (incidents), `SRE.md` (SLIs/SLOs/budgets/on-call/capacity math),
  `DISASTER-RECOVERY-GUIDE.md` + `RELEASE-CHECKLIST.md` (DR + release gates). **Absent /
  external:** alerting, paging, tracing, forecasting, log rotation — watched manually
  until that **proposed** wiring exists. This manual adds **no runtime, no architecture**.
