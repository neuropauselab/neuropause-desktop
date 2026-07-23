# NeuroPause EOSP — Site Reliability Engineering Operating Manual

> **What this is.** The SRE **execution** manual for the Enterprise Operations & Scale
> Program (EOSP): how reliability is defined, targeted, budgeted, and sized for NeuroPause.
> It adds **no runtime and no platform** — roles, cadences, formulas, and decision rules over
> the **real** observability substrate and **measured** coefficients in `_grounding.md`.
>
> **Honesty banner (non-negotiable).** There is **no production fleet** — this document states
> **no achieved uptime, MTTR, availability, or incident count**. **SLIs are _defined_** from
> the real `/metrics` + `/health` + bench surfaces. **SLOs, error budgets, and availability
> objectives are _proposed objectives, to be ratified against production data_ — never
> measurements.** Capacity math uses the **measured** coefficients; every extrapolation past
> the 2-vCPU reference is a **projection**. Incident runbooks
> (`docs/validation/OPERATIONAL-RUNBOOKS.md`) are **invoked**, not restated. Substrate of
> record: `OPERATIONS-GUIDE.md`. Evidence: `PERFORMANCE-BENCHMARKS.md`,
> `RELIABILITY-RESULTS.md` (raw `bench/results/*.json`).

## 1. SRE handbook

### Mission

Keep NeuroPause's read, auth, and dependency-health paths **available and honestly
observable** at a defined service level, and make scaling a **calculation** from the measured
coefficients rather than a guess. SRE owns SLIs/SLOs, error budgets, capacity sizing, and the
on-call discipline that drives the runbooks — the reliability contract features ship under,
not feature delivery itself.

### Operating principles

1. **Measure, don't assert.** Every SLI resolves to a real series or reproducible bench
   command; an unproducible number is not reported.
2. **Targets are proposals until production ratifies them.** No SLO is "met" — there is no
   fleet to meet it on; SLOs are review inputs, revised on first-90-days production data.
3. **The runbooks are the incident interface.** On-call executes `OPERATIONAL-RUNBOOKS.md`;
   this manual sets _when_ and _by which role_, not _how_.
4. **Capacity is arithmetic, roles not people.** Size from `_grounding.md` coefficients and
   label fleet numbers projections from the 2-vCPU floor; the model names roles, never people.

### On-call model — roles, not people

On-call is defined as a set of **roles**, staffable by any qualified operator. Rotation
cadence and headcount are an org decision; the _structure_ below is the contract.

| Role                         | Scope                                                                                                                       | Engaged when                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Primary on-call (IC-eng)** | First responder. Holds the pager; runs the matching runbook; owns the incident until stood down.                            | Every alert.                             |
| **Secondary / backup**       | Fails over if Primary does not ack within the ack window; second pair of hands on SEV1.                                     | Primary no-ack, or SEV1.                 |
| **Incident Commander (IC)**  | Declares severity, coordinates, owns comms decisions and stand-down. A _hat_, not a person — Primary may wear it on SEV2/3. | SEV1, or SEV2 past the escalation timer. |
| **Comms / Scribe**           | Maintains the incident timeline in the `audit_log` narrative + status updates; frees IC to act.                             | SEV1.                                    |

**Rotation.** Weekly Primary/Secondary rotation is the proposed default (tune to headcount).
Handoff is a checklist: open incidents, budget burn state (§4), any dependency running
degraded (Redis fail-open / PG reconnecting), and pending DR-drill (Runbook 5).

**Severity → real failure mode → first runbook.** On-call classifies against the _proven_
failure modes, not abstractions.

| Sev      | Definition                            | Real failure mode (proven behaviour)                                                           | First runbook              | Roles engaged                     |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------- |
| **SEV1** | Read path down or data-loss risk      | Postgres down **not** auto-recovering; restart **loop** (bad env); failed restore              | Runbook 2 / 3; DR guide §4 | IC + Primary + Secondary + Scribe |
| **SEV2** | Serving but degraded                  | Redis down (**fail-open** → elevated abuse risk); pool saturation / high latency (`waiting>0`) | Runbook 1 / 4              | Primary (+ IC past timer)         |
| **SEV3** | Single-signal anomaly, no user impact | RSS trending to limit; transient `waiting` spike; single 5xx blip                              | Runbook 4                  | Primary                           |

**Escalation.** SEV2 unresolved past the escalation timer → declare IC and re-grade toward
SEV1. Restart loops are **upstream** (bad `DATABASE_URL`/`REDIS_URL`/missing
`JWT_ACCESS_SECRET`) — check env before blaming the app (Runbook 3, step 3).

### Toil budget

**Toil** = manual, repetitive, automatable operational work that scales with load and
carries no lasting value. Proposed cap: **≤ 50 % of any on-call role's time** (industry
standard); sustained breach is a staffing/automation signal, not a hero opportunity.

The platform's **honest gaps** (`OPERATIONS-GUIDE.md` "Known Operational Gaps") are the
current structural toil sources — each has an owned reduction path:

| Toil source (real gap)           | Manual work today                          | Reduction path (proposed wiring)                                                   |
| -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| **No alert routing/paging**      | Human eyes on `/metrics` & `/health`       | Prometheus **recording + alerting rules** over the real series → Alertmanager (§4) |
| **No latency histogram**         | Re-run `http-load.mjs` to quantify latency | External **blackbox probe** on `/health` + recording rules (Runbook 4)             |
| **No capacity forecasting**      | Manual sizing per event                    | Forecast **externally** over the `/metrics` time-series (§6 formulas as inputs)    |
| **No backup scheduler in-stack** | Operator runs `backup-db.sh`               | External **cron / systemd timer**; RPO = age of last dump (Runbook 5)              |
| **No log rotation**              | Disk-watch on `audit.log`/`crashes.log`    | Container logging driver / `logrotate`                                             |

Toil-reduction items feed the improvement backlog; closing the alert-routing gap is the
highest-leverage item (it eliminates the largest standing manual watch).

## 2. Service Level Indicators (SLIs)

SLIs are **defined from the real substrate only**. Two structural facts constrain them:
`/metrics` exposes **request counts by method+status, with no latency histogram**; and
**component health (`database`/`redis` up/down) lives only in the `/health` JSON body, not
in `/metrics`** — and `neuropause_backend_up` is a static gauge that stays `1` while the
process serves (it drops out only when the process is unscrapable). Anything below that
depends on `/health` component state or on latency therefore requires an **external
blackbox probe** (absent in-stack; proposed).

| SLI                                 | Source: real `/metrics` series / `/health` / bench                             | Measurement method                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Readiness availability**          | `GET /health` HTTP `200` vs `503` (blackbox probe — _external, proposed_)      | good = 200; `SLI = Σ good_probes / Σ probes` over window                               |
| **Process liveness**                | `neuropause_backend_up` (scrape success), `GET /live`                          | fraction of scrape intervals with `up==1` and scrape succeeding                        |
| **Request success rate**            | `neuropause_http_requests_total{status}`                                       | `1 − ( Σ rate(status=~"5..") / Σ rate(all) )`                                          |
| **DB dependency health**            | `GET /health` `components.database` (blackbox JSON — _external, proposed_)     | fraction of probes with `database=="up"`                                               |
| **Redis dependency health**         | `GET /health` `components.redis` (blackbox JSON — _external, proposed_)        | fraction of probes with `redis=="up"`                                                  |
| **Pool-saturation (latency proxy)** | `neuropause_pg_pool_connections{state="waiting"}`                              | fraction of scrapes with `waiting==0`; sustained `>0` = queuing (Runbook 4)            |
| **Read latency p95**                | bench `http-load.mjs` + blackbox probe (_no in-app series_)                    | external p95 per route; app ships **counts only** — latency is measured, never scraped |
| **Auth throughput headroom**        | Argon2id verify bench (~50 verifies/s/core) + login request counts             | `observed_login_rps / (cores × 50)` (Argon2-bound; §6)                                 |
| **Restart recovery time**           | `neuropause_backend_uptime_seconds` (reset→climb) + reliability bench (0.46 s) | time from process-down to `/health` 200; detect restarts via uptime-gauge drop         |
| **Memory headroom**                 | `neuropause_backend_resident_memory_bytes` vs container limit                  | `RSS / limits.memory`                                                                  |

> Provenance: request-success and pool signals come from the **real scrape**; availability
> and dependency SLIs require the **blackbox probe** the platform does not ship (_external,
> proposed_); latency SLIs come from the **bench harness** — no histogram exists
> (`OPERATIONS-GUIDE.md`, "No latency histogram").

## 3. Service Level Objectives (SLOs)

> **PROPOSED OBJECTIVES — NOT MEASUREMENTS.** Every target below is a _proposed objective,
> to be ratified against production data._ No production fleet exists; none of these is
> "achieved". Targets are deliberately set **above** the measured conservative floor because
> the bench ran on a **2-vCPU shared container with a co-located load client** — a _lower
> bound_ (`PERFORMANCE-BENCHMARKS.md`, "Reading these numbers honestly").

| SLI                                    | Proposed SLO (to be ratified)                        | Basis for the proposal                                 |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Readiness availability                 | **99.9 %** of `/health` probes = 200 / 30-day window | proven degrade-and-recover + 0.46 s restart (§5)       |
| Request success rate                   | **≥ 99.9 %** non-5xx / 30-day window                 | bench: **0 errors across 24,000 requests**             |
| DB dependency health                   | **≥ 99.95 %** `database=="up"`                       | PG auto-reconnects with no backend restart (Runbook 2) |
| Redis dependency health                | **≥ 99.9 %** `redis=="up"`                           | fail-open preserves reads during outage (Runbook 1)    |
| Pool-saturation                        | `waiting==0` for **≥ 99 %** of scrapes               | measured pool auto-scales 1→10 before queuing          |
| Read latency p95 (`/store/apps`)       | **≤ 150 ms** at reference load                       | measured floor **68.5 ms** (2-vCPU, co-located)        |
| Read latency p95 (`/store/apps/:slug`) | **≤ 250 ms** at reference load                       | measured floor **104.4 ms** (heaviest read path)       |
| Restart recovery                       | `/health` 200 **≤ 5 s** after process up             | proven **0.46 s** + probe interval (Runbook 3)         |

Latency targets carry ~2× headroom over the measured floor because that floor is a conservative
lower bound; ratification on off-box production hardware should **tighten** them, not relax them.

## 4. Error budgets

**Definition.** An error budget is the complement of an SLO — the allowed unreliability
over a window. It converts a _proposed_ SLO into a spend that on-call and delivery share.

```
error_budget            = 1 − SLO
budget_minutes / window = window_minutes × (1 − SLO)
budget_events  / window = total_events   × (1 − SLO)
burn_rate               = observed_bad_ratio / (1 − SLO)
budget_consumed(window) = burn_rate × (window / SLO_period)
```

**Budget arithmetic for candidate SLO levels (30-day window).** _Reference math for what a
target would permit — not a claim of achieved downtime._

| Proposed SLO | Error budget | Budget / 30 days | Budget / 7 days |
| ------------ | ------------ | ---------------- | --------------- |
| 99.5 %       | 0.5 %        | 3 h 36 m         | 50.4 m          |
| 99.9 %       | 0.1 %        | **43.2 m**       | 10.1 m          |
| 99.95 %      | 0.05 %       | 21.6 m           | 5.0 m           |

**Burn-rate alerting policy (multi-window, over the real substrate).** Alert on the _rate_
of budget consumption, not raw error count. Thresholds shown for a 99.9 % request-success
SLO (budget = 0.1 %); the page fires only when **both** the long and short windows are hot,
which suppresses single-blip noise.

| Tier       | Long / short window | Burn rate   | Budget consumed | Action               |
| ---------- | ------------------- | ----------- | --------------- | -------------------- |
| **Fast**   | 1 h / 5 m           | ≥ **14.4×** | ~2 % in 1 h     | **Page** Primary     |
| **Medium** | 6 h / 30 m          | ≥ **6×**    | ~5 % in 6 h     | **Page** Primary     |
| **Slow**   | 24 h / 2 h          | ≥ **3×**    | ~10 % in 24 h   | **Ticket** (backlog) |

Fast-burn condition, expressed on the **real counter** (5xx ratio ≥ 14.4 × 0.001 = 1.44 %):

```promql
# PAGE (fast burn) — both windows must exceed 14.4× the budget rate
  ( sum(rate(neuropause_http_requests_total{status=~"5.."}[1h]))
    / sum(rate(neuropause_http_requests_total[1h])) ) > (14.4 * 0.001)
and
  ( sum(rate(neuropause_http_requests_total{status=~"5.."}[5m]))
    / sum(rate(neuropause_http_requests_total[5m])) ) > (14.4 * 0.001)
```

**Alert sources — real scrape vs external/proposed.** The burn-rate math above runs entirely
on the **real** `/metrics` counter. Dependency and availability alerts do **not** — they
depend on `/health` component state, which is **not** in `/metrics`.

| Alert                                | Signal                                                           | Source status                                   |
| ------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------- |
| Fast/medium/slow budget burn         | `neuropause_http_requests_total{status=~"5.."}` ratio            | **Real scrape**                                 |
| Pool saturation (latency proxy)      | `neuropause_pg_pool_connections{state="waiting"} > 0` sustained  | **Real scrape**                                 |
| Memory pressure                      | `neuropause_backend_resident_memory_bytes` → limit               | **Real scrape**                                 |
| Process gone / unscrapable           | `up == 0` (scrape failure; `backend_up` is otherwise static `1`) | **Real scrape**                                 |
| Unexpected restart                   | `neuropause_backend_uptime_seconds` drop                         | **Real scrape**                                 |
| Readiness 503 / DB-down / Redis-down | `/health` status + `components.*`                                | **External blackbox probe — ABSENT / proposed** |

> **Alert routing is absent (honest).** The platform ships **no native alerting or paging**
> (`OPERATIONS-GUIDE.md`; `_grounding.md`). The rules above are **proposed wiring over the
> real substrate** — Prometheus recording/alerting rules + **Alertmanager** for routing, plus
> a **blackbox exporter** on `/health` for the dependency/availability signals that
> `/metrics` cannot express. Until that wiring exists, these SLIs are watched **manually**
> (a standing toil item, §1). Do not assume the runbooks are auto-invoked — they are not.

## 5. Availability objectives (proposed)

> **Proposed objective, to be ratified against production data.** No production fleet exists,
> so **no availability has been achieved or can be reported.** The objective below is a
> target grounded in _proven recovery behaviour_, not an observed uptime figure.

The proposal rests on four **proven** resilience results (`RELIABILITY-RESULTS.md`), not on
aspiration:

| Proven building block                               | Observed behaviour                                                                           | Availability implication              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Restart recovery** (scenario 3, PASS)             | SIGTERM → healthy in **0.46 s**                                                              | recycles cost sub-second, not minutes |
| **Postgres degrade-and-recover** (scenario 5, PASS) | process survives DB loss; pool **auto-reconnects, no restart**                               | DB blips ≠ backend outage; self-heals |
| **Redis fail-open** (scenario 4, PASS)              | reads served **through** the outage; `/health` degrades honestly                             | cache loss ≠ read outage              |
| **Zero-downtime rolling update**                    | `maxUnavailable: 0` keeps old pods serving until new pass readiness (`backend.yaml:107-162`) | deploys need not spend budget         |

**Proposed objective.** Ratify a **99.9 %** readiness-availability SLO (§3) for the backend
read path, giving the **43.2 min / 30-day** error budget (§4). Rationale: the dominant
recovery paths are **sub-second to few-seconds** and **self-healing without operator action**,
so the budget is spent by _rare_ long-tail events (restart loops from bad env, unrecovered DB
loss, correlated dependency failure), each with an owned runbook.

**Honest caveats.** (1) This is a **target**, not a track record. (2) HPA under load is
**not measured** — the `optional.yaml` HPA (CPU-based, **min 2 / max 6 @ 70 %**) exists in
config but its live scale-up behaviour is a **projection** (`_grounding.md`; GA report). (3)
Multi-region **federation DR is modeled, not failover** — do not fold it into an availability
claim (Runbook escalation notes; `DISASTER-RECOVERY-GUIDE.md §7.1`). (4) App-binary rollback
is **advisory**; real recovery is data-side (Runbook 5).

## 6. Capacity management

All sizing starts from the **measured** coefficients (`bench/results/*.json`); every fleet
number is a **projection from the 2-vCPU reference measurement**. That reference is a **shared
2-vCPU container with a co-located load client at 0 errors** — a **conservative floor**, so
dedicated off-box hardware does better and these projections **over-provision on purpose**.

### Measured coefficients (reference: 2 vCPU, 8 GB, Node 22, PG 16, Redis 7)

| Coefficient (measured)    | Value                                                    | Sizing use                 |
| ------------------------- | -------------------------------------------------------- | -------------------------- |
| DB-backed read throughput | **400–600 rps/replica** (`/store/apps` 610, `:slug` 424) | per-replica read floor     |
| Heaviest read path p95    | **104 ms** (`/store/apps/:slug`)                         | latency headroom           |
| RSS under 24k-req load    | **≈ 213–223 MB** (idle 117)                              | per-replica memory         |
| pg pool under load        | **auto-scales 1 → 10**                                   | DB connections per replica |
| Argon2id verify           | **p50 19.6 ms → ~50 verifies/s/core**                    | login throughput bound     |
| Restart → healthy         | **0.46 s** (cold 0.66 s)                                 | rollout / recycle budget   |

### Worked example — replica sizing (projection)

Plan against the **blended read floor** `R_floor = 500 rps/replica` (mid of the measured
400–600 band, safe for mixed list + point-read traffic).

```
replicas_serving = ceil( peak_read_rps / R_floor )      # R_floor = 500 rps  (measured 400–600)
replicas_total   = replicas_serving + 1                 # N+1: survive one pod loss / rolling update
```

**Given** a projected peak of **2,000 rps** of DB-backed store reads:

```
replicas_serving = ceil(2000 / 500) = 4
replicas_total   = 4 + 1            = 5 replicas
```

→ **5 backend replicas (projection).** Because 500 rps is a conservative floor, real headroom
is higher; treat 5 as a safe upper bound to be trimmed once production throughput is observed.
Note the shipped HPA (min 2 / max 6 @ 70 % CPU) **brackets** this range — but its scale-up
under load is unmeasured (§5), so provision the steady-state count explicitly rather than
relying on the HPA.

### DB connection sizing (projection)

Each replica's pool peaks at **10** connections (measured). Fleet peak and the pooler
threshold follow directly:

```
fleet_db_connections_peak = replicas_total × 10
reserve                   = migrations + admin + backup + replication      # budget ~20
require: postgres max_connections ≥ fleet_db_connections_peak + reserve
```

**For 5 replicas:** `5 × 10 = 50` connections + ~20 reserve → **max_connections ≥ ~70**.
Postgres 16 default `max_connections = 100`, so the **pooler threshold** is:

```
replicas_before_default_exhausted = floor( (100 − reserve) / 10 ) = floor(80/10) = 8 replicas
```

**Decision rule:** beyond **~8 replicas**, either raise `max_connections` (costs backend RAM
per slot) or, preferred, introduce **pgbouncer (transaction mode)** and size its pool to the
fleet peak. Below 8 replicas the default Postgres suffices.

### Auth throughput sizing (projection)

Login is **CPU-bound on Argon2id (~50 verifies/s/core)** and is **independent of read
capacity** — a fleet sized for reads can still be **auth-bound** during a login storm (e.g. a
Monday-morning SSO surge). Size it **separately**.

```
max_logins_per_sec ≈ auth_core_equivalents × 50
# budget ~1 core-equivalent per 2-vCPU replica for auth (other core serves reads/I/O)
replicas_for_auth  = ceil( peak_logins_per_sec / 50 )
replicas_total     = max( replicas_serving_reads , replicas_for_auth ) + 1
```

**Given** a projected peak of **300 logins/s**:

```
replicas_for_auth = ceil(300 / 50) = 6
replicas_total    = max(4, 6) + 1  = 7 replicas   # auth-bound, not read-bound
```

→ the login surge, **not** read volume, sets the floor at **7 replicas (projection)**. Argon2
cost is **tunable** (`memoryCost 19,456 KiB, timeCost 2, parallelism 1`): raising it hardens
against brute force but **lowers verifies/s/core** — capacity and security trade directly, so
any parameter change re-runs this sizing.

### Memory sizing (projection)

Per replica ≈ **230 MB RSS** under load (heap ~70 MB); `fleet_RSS_peak ≈ replicas_total × 230 MB`.
Keep `resources.limits.memory` (chart default **512Mi**, `backend.yaml:167-169`) — it clears the
working set with headroom (5 replicas → **~1.15 GB** projected). Alert on `resident_memory_bytes`
trending toward the per-pod limit (§4); then raise the limit or scale out (Runbook 4).

## Provenance & scope

- **Measured** (real): coefficients, latency floors, reliability outcomes — `PERFORMANCE-BENCHMARKS.md`,
  `RELIABILITY-RESULTS.md`, `_grounding.md`, `bench/results/*`. **Defined** (real substrate):
  all SLIs — `/metrics`, `/health`, `/live`, bench harness.
- **Proposed** (to be ratified): all SLOs, error budgets, availability objectives, and every
  fleet projection from the 2-vCPU floor. **No achieved uptime/MTTR/availability appears
  anywhere in this document — no production fleet exists.**
- **Incident execution:** `OPERATIONAL-RUNBOOKS.md` — invoked, not restated. **Absent / external:**
  alerting, paging, blackbox probing, tracing, forecasting — proposed wiring, not shipped platform.
