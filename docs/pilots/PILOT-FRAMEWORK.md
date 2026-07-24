# NeuroPause — Pilot Framework (CDEP)

> The reference manual for running **one real customer pilot** end to end: how to
> scope it, deploy, validate against real signals, operate, and decide. It is a
> **blank instrument, not a record** — **no pilot has run.** Every threshold shown
> is an **"illustrative default — ratify per customer"**; every reference-floor
> number is **our** 2-vCPU EVP measurement (`docs/pilots/_grounding.md`), never a
> customer result. Roles are **role slots, not people**; no customer, deployment,
> or benchmark result is asserted anywhere below.
>
> **Builds on (does not restate):** deployment mechanics —
> `docs/validation/DEPLOYMENT-PLAYBOOKS.md` (Playbooks A–D); kit selection —
> `docs/adoption/DEPLOYMENT-PROGRAM.md`; release gates —
> `docs/guides/RELEASE-CHECKLIST.md`; executed resilience evidence —
> `docs/validation/RELIABILITY-RESULTS.md`. Readiness state and the
> Deployment/Pilot/Evidence/Feedback matrices live in
> `docs/pilots/PILOT-MATRICES.md`. This document sequences those assets into a
> gated pilot; it reprints none of them.

---

## 0. Roles and conventions

Three role slots run a pilot. Assign each to a named individual **in the charter
(§6)** — this document names none.

| Role                 | Owns                                                                          | Runs (real assets)                                                                 |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Deployment lead**  | Pilot plan, entry/exit gates, go/no-go and rollback **call**                  | This framework; charter; Playbook selection                                        |
| **SRE / operator**   | The environment; deploy, migrate, backup, harness runs, restore **execution** | Playbooks A–D, `bench/*`, `scripts/{backup,restore}-db.sh`, `/health` + `/metrics` |
| **Customer sponsor** | Business outcome; ratifies thresholds; signs acceptance                       | Success-threshold ratification; go/no-go participation                             |

A security reviewer and the customer's DBA are engaged as needed; they do not
replace the three primary slots.

**Threshold convention.** Every numeric value in §3/§4 is prefixed _illustrative
default_ and MUST be ratified in the charter before the pilot starts. An
unratified threshold is not a pass/fail line — it is a blank.

---

## 1. Pilot methodology

Five sequential phases, each with a hard exit gate. A phase does not start until
the prior gate is signed.

```
scope ──► deploy ──► validate ──► operate ──► review
  │          │           │            │           │
 entry     healthy    success      no open      exit
 criteria  + smoke    criteria     rollback     criteria
  met      pass       evaluated    trigger      met
```

| Phase        | Purpose                                                                       | Primary role              | Key real assets used                                              | Exit gate                                                    |
| ------------ | ----------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| **Scope**    | Fix goals, pick deployment kit, ratify thresholds, assign roles, sign charter | Deployment lead           | DEPLOYMENT-PROGRAM kit-selection matrix; §6 charter               | **Entry criteria (§2) met**                                  |
| **Deploy**   | Stand up the instance; migrations as a gated step                             | SRE / operator            | Playbook A/B/C/D (per kit); `db:migrate` Job                      | `/health` 200 `ok` + acceptance smoke (RELEASE-CHECKLIST §7) |
| **Validate** | Reproduce evidence in the customer's env                                      | SRE / operator            | Quality gates; `bench/*`; reliability procedures                  | **Success criteria (§3)** evaluated, results captured        |
| **Operate**  | Run the ratified pilot window under real traffic                              | SRE / operator            | `/metrics` series, `audit_log`, DEPLOYMENT-PROGRAM §7 day-2 index | No unrecovered **rollback trigger (§4)**; SLIs in budget     |
| **Review**   | Assemble evidence, sign acceptance, decide                                    | Deployment lead + sponsor | Evidence Collection Matrix; §5 decision record                    | **Exit criteria (§5) met**                                   |

**Phase × role responsibility (R = runs, A = accountable/decides, C = consulted).**

| Phase    | Deployment lead | SRE / operator | Customer sponsor        |
| -------- | --------------- | -------------- | ----------------------- |
| Scope    | A               | C              | A (ratifies thresholds) |
| Deploy   | C               | R              | C                       |
| Validate | A               | R              | C                       |
| Operate  | C               | R              | C                       |
| Review   | A               | C              | A (signs acceptance)    |

The **deployment lead calls** a rollback; the **SRE executes** it; the **sponsor
is informed** and co-signs the decision record (§4, §5).

---

## 2. Entry criteria (Scope → Deploy gate)

All boxes checked before any deploy command runs. Prerequisites are the **Ready**
rows of the Deployment Readiness Matrix (`PILOT-MATRICES.md §1`) — verified _in the
customer's environment_, not merely known to exist.

**Prerequisites (Deployment Readiness Matrix).**

- [ ] Container image builds from `apps/backend/Dockerfile` on a host with a Docker daemon.
- [ ] Chosen kit's assets present and validated: Compose (`docker-compose.prod.yml`) **or** K8s (`deploy/kubernetes/*`, `deploy/helm/neuropause-backend/*`, kubeconform strict PASS) **or** offline bundle (`scripts/build-offline-bundle.sh`).
- [ ] Migrations reviewed: forward-only, additive; re-run is idempotent (RELIABILITY-RESULTS §1).
- [ ] Config contract satisfied: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` (≥ 32 chars) set; `RUN_MIGRATIONS_ON_BOOT=false`; `SEED_STORE_ON_BOOT=false` (empty catalog — no fabricated apps).

**Environment.**

- [ ] Datastores provisioned and reachable — for Kit C, **managed/HA** Postgres + Redis behind the secret (HA is external by design).
- [ ] For K8s Ingress/HPA: ingress controller + cert-manager and/or metrics-server present, or those features left disabled (documented).
- [ ] `/metrics` network-restricted (unauthenticated by design); TLS terminates at ingress where used.

**Access.**

- [ ] SRE has cluster/host + datastore credentials to deploy, migrate, and restore.
- [ ] Roles filled in the charter (deployment lead, SRE, customer sponsor).
- [ ] Support paths acknowledged: onboarding (`docs/adoption/CUSTOMER-SUCCESS.md`), support (`docs/operations/CUSTOMER-SUPPORT.md`).

**Backup verified (non-negotiable — this is the rollback lever).**

- [ ] `scripts/backup-db.sh` produces a dump in the target environment.
- [ ] That dump is **restored into a scratch DB** and row counts compared (RELIABILITY-RESULTS §2; Playbook D.1). _A backup never restored is a hypothesis._
- [ ] Restore path and the pre-cutover backup location recorded in the charter (§6).

> **Gate:** every box above checked → Scope phase signed → Deploy may begin.

---

## 3. Success criteria (Validate gate)

Measurable, each tied to a **real tool** and a **source of truth**. The SRE runs
the tool; results are captured as pilot evidence (§5). Thresholds are illustrative
defaults to be ratified in the charter — reference-floor numbers are OUR 2-vCPU
measurements, shown only to calibrate the ratification conversation.

| #   | Criterion                             | How measured (real tool)                                                                                                                                      | Illustrative default threshold — ratify per customer                                                                                                     | Source of truth                                                     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| S1  | Quality gates green                   | `npm run typecheck && npm run lint && npm run test && npm run build`; `npm run format:check`                                                                  | typecheck **0**, lint **0** warnings, suite passes (count = this env's actual; reference floor **3,856**), build **exit 0**, no format drift             | RELEASE-CHECKLIST §2                                                |
| S2  | Production dependency posture         | `npm audit --omit=dev`                                                                                                                                        | **0** production vulnerabilities; disclosed open items acknowledged                                                                                      | RELEASE-CHECKLIST §3; ENTERPRISE-GA-REPORT                          |
| S3  | Deploy reaches healthy                | `GET /health` (200 `status:"ok"`, `components.database:"up"`, `redis:"up"`); `GET /live`; `GET /metrics` → `neuropause_backend_up 1`; `bash bench/startup.sh` | `/health` 200 within cold-start budget (reference floor **0.66 s**)                                                                                      | DEPLOYMENT-PLAYBOOKS §A/§B Verify; `bench/startup.sh`               |
| S4  | Migration integrity                   | re-run `npm run db:migrate`; inspect `schema_migrations`                                                                                                      | re-run applies **0 new**; applied count = expected (reference **12**)                                                                                    | RELIABILITY-RESULTS §1                                              |
| S5  | Backup/restore proven in-env          | `scripts/backup-db.sh` → `scripts/restore-db.sh` into scratch DB; compare row counts                                                                          | **exact row-count parity** source vs restored                                                                                                            | RELIABILITY-RESULTS §2; Playbook D.1                                |
| S6  | API latency / throughput / errors     | `node bench/http-load.mjs --base http://<host> --conc 32 --reqs 3000`                                                                                         | **0 errors**; per-scenario p95/p99 within ratified budget (reference `/store/apps` p95 **69 ms**)                                                        | `bench/http-load.mjs`; `bench/results/http-load.json` (reference)   |
| S7  | DB query latency                      | `DATABASE_URL=… node bench/db-latency.mjs`                                                                                                                    | point-read **p50 sub-ms** (reference **0.23 ms**)                                                                                                        | `bench/db-latency.mjs`; `bench/results/db-latency.json` (reference) |
| S8  | Resource / capacity headroom          | `GET /metrics`: `neuropause_backend_resident_memory_bytes`, `neuropause_pg_pool_connections{state="waiting"}` sampled under load                              | `waiting` **≈ 0 sustained** at target concurrency; RSS **< `resources.limits.memory`** (default 512Mi)                                                   | DEPLOYMENT-PROGRAM §6                                               |
| S9  | Reliability behaviours                | reliability procedures: restart; redis-down; pg-down                                                                                                          | restart → `/health` `ok` within budget (reference **0.46 s**); redis-down **serves reads** + `/health` degraded; pg-down **auto-reconnects, no restart** | RELIABILITY-RESULTS §3–5                                            |
| S10 | Acceptance smoke                      | RELEASE-CHECKLIST §7: e2e sign-in; first-traffic log scan                                                                                                     | sign-in succeeds end-to-end; **no errors** in first-traffic logs                                                                                         | RELEASE-CHECKLIST §7                                                |
| S11 | Availability _(needs external probe)_ | external blackbox probe on `/health` (**not shipped** — customer-supplied) + uptime series                                                                    | uptime target ratified per customer                                                                                                                      | PILOT-MATRICES §3 (Availability = Template, probe proposed)         |

**Notes.** S11 is honestly gated: the repo ships `/health` and counts, **not** an
uptime probe or latency histograms — an external probe + Prometheus recording rules
are the customer's to add (DEPLOYMENT-PROGRAM §6). Any criterion may be ratified
**N/A** in the charter with a written rationale; N/A is a decision, not a silent skip.

---

## 4. Rollback criteria (Operate gate)

A rollback trigger is a **real observed signal**, not a hunch. When one fires, the
deployment lead calls it, the SRE executes the recovery path below, and the
decision is recorded.

| Trigger                              | Detected by (real signal)                                                                                                                                                                                                            | Default response                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Deploy-introduced dependency failure | `/health` `status:"degraded"` with `components.database:"down"` **persisting beyond the auto-recovery window** and **not** explained by an external managed-datastore outage (contrast the auto-reconnect in RELIABILITY-RESULTS §5) | Data-side restore (below) + re-point prior image tag                                                |
| Acceptance gate failed at cutover    | S1–S3 or S10 red: gates not green, `/health` never returns 200 `ok`, or smoke sign-in fails                                                                                                                                          | Halt cutover; if already cut over, restore                                                          |
| Data-integrity failure               | migrate Job **fails** (blocks the rollout **by design** — Playbook D.2), or S5 row-count mismatch, or a post-migrate consistency check red                                                                                           | Restore pre-upgrade dump; forward-only migrations mean a restore reverts **schema + data together** |
| Reliability regression               | restart does **not** return `/health` to `ok`; redis-down does **not** fail open (reads 5xx); pg-down does **not** auto-reconnect                                                                                                    | Restore + re-point                                                                                  |
| Saturation not clearable by scaling  | `neuropause_pg_pool_connections{state="waiting"}` sustained-positive **and** `neuropause_http_requests_total{status=~"5.."}` climbing, unresolved by scale-out                                                                       | **Scale first** (DEPLOYMENT-PROGRAM §6); rollback only if the regression is deploy-introduced       |

**The real recovery path (why S5 and §2's backup gate are mandatory).**
Application-binary rollback is **advisory only** — `autoUpdater.allowDowngrade=false`
and migrations are forward-only, so there is **no automated app rollback** and **no
`down` migration**. The one real lever is **data-side restore**, then a manual image
re-point — the full sequence is Playbook D.4 (do not restate here):

```
scripts/restore-db.sh backups/neuropause-db-YYYYMMDD-HHMMSS.sql.gz   # destructive; prompts 'yes'; ON_ERROR_STOP=1
# then re-point at the prior image tag (helm --set image.tag=<previous> / Compose), restart, verify /health
```

Limits, stated plainly: whole-dump restore only — **no PITR/WAL in-repo** — so you
recover to a specific dump, never an arbitrary moment. **This is impossible without
the verified pre-cutover backup from §2** — which is exactly why that box is
non-negotiable.

**Rollback decision record (fill at trigger time; attach to §5).**

| Field                                                                | Value  |
| -------------------------------------------------------------------- | ------ |
| Trigger fired (row above)                                            | ______ |
| Signal evidence (`/health` JSON, `/metrics` sample, gate/log output) | ______ |
| Decided by (deployment lead)                                         | ______ |
| Executed by (SRE)                                                    | ______ |
| Backup file restored                                                 | ______ |
| Prior image tag re-pointed to                                        | ______ |
| Post-restore `/health` result                                        | ______ |
| Sponsor informed (time)                                              | ______ |

---

## 5. Exit criteria (Review gate → go/no-go)

The pilot closes only when evidence is complete, acceptance is signed, and a
decision is recorded. Nothing here fabricates a result — each row is either a real
captured output or a ratified N/A.

**5.1 Evidence complete** — one row per Evidence Collection Matrix class
(`PILOT-MATRICES.md §3`); each produced by its **Ready tool** against the
customer's instance, or marked ratified-N/A.

- [ ] **Performance** — `bench/http-load.mjs` + `db-latency.mjs` + `startup.sh` JSON captured in-env (S3/S6/S7).
- [ ] **Reliability** — restart / redis-down / pg-down procedures: pass/fail recorded (S9).
- [ ] **Availability / health** — `/health` + `/live` + external probe uptime series, or ratified N/A (S11).
- [ ] **Resource / capacity** — `/metrics` RSS/heap/pool series captured under load (S8).
- [ ] **Security** — control inventory + `npm audit --omit=dev` + `audit_log` sample; open items disclosed (S2).
- [ ] **Migration / data integrity** — `db:migrate` idempotency + backup/restore row-count proof (S4/S5).
- [ ] **Business** — ROI methodology inputs **customer-sourced** (no fabricated numbers; value model only).
- [ ] **Acceptance** — success-criteria scorecard + gate output assembled (S1/S10).

**5.2 Acceptance signed.**

- [ ] Every §3 criterion is **met** or **waived with written rationale** (sponsor-approved).
- [ ] Acceptance scorecard signed by the **customer sponsor** (instrument: `DEPLOYMENT-QUALITY.md`).
- [ ] Open items and disclosed limitations (e.g. Apple `id_token` JWKS, unsigned-install-when-trust-store-empty, no alerting/tracing) acknowledged in writing.

**5.3 Go/no-go decision record (blank).**

| Field                                                                                       | Value                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Decision                                                                                    | ☐ Go to production ☐ Extend pilot ☐ No-go |
| Decided by (deployment lead + customer sponsor)                                             | ______ / ______                           |
| Date                                                                                        | ______                                    |
| Evidence references (5.1 artifacts)                                                         | ______                                    |
| Unmet criteria + disposition                                                                | ______                                    |
| Rollback events during pilot (§4 records)                                                   | ______                                    |
| Feedback routed to product (instruments: `CUSTOMER-FEEDBACK.md`, `OPERATIONAL-LEARNING.md`) | ______                                    |

> **Gate:** 5.1 complete + 5.2 signed + 5.3 recorded → pilot closed.

---

## 6. Pilot charter (one page — blank template)

Fill this **before** the Scope gate. It is the single page that binds roles,
thresholds, and the rollback lever. All values blank; pre-filled thresholds are
_illustrative default — ratify per customer._

```
NEUROPAUSE PILOT CHARTER

Pilot ID: __________________________        Charter date: ______________
Platform maturity anchor: Validated Release Candidate (no production fleet)

1. SCOPE & GOALS
   Business goal(s): ________________________________________________
   In scope: _______________________________________________________
   Out of scope: ___________________________________________________
   Pilot window (start → end): _____________________________________

2. ROLES (role slots — name one person each; this doc names none)
   Deployment lead: ________________________________________________
   SRE / operator: _________________________________________________
   Customer sponsor: _______________________________________________
   Security reviewer / DBA (as needed): ____________________________

3. DEPLOYMENT
   Kit (A dev / B single-node / C K8s / D air-gapped): ______________
   Datastores (managed HA? Y/N): ___________________________________
   Environment / topology notes: ___________________________________

4. RATIFIED SUCCESS THRESHOLDS  (from §3 — replace illustrative defaults)
   S1 gates ______  S2 audit ______  S3 cold-start ______  S4 migrate ______
   S5 restore ______  S6 API p95/p99 + errors ______  S7 DB p50 ______
   S8 pool waiting / RSS ______  S9 restart / degrade ______
   S10 smoke ______  S11 uptime (+ external probe? Y/N) ______

5. ROLLBACK LEVER  (must be verified before cutover — §2/§4)
   Pre-cutover backup taken & restored to scratch DB (Y/N): _________
   Backup location: ________________________________________________
   Prior image tag to re-point to: _________________________________

6. EVIDENCE PLAN  (which harness produces each Evidence Collection class)
   Performance ☐  Reliability ☐  Availability ☐  Resource ☐
   Security ☐  Migration/integrity ☐  Business ☐  Acceptance ☐

7. SIGN-OFF
   Entry criteria (§2) met — Deployment lead: __________  Date: ______
   Acceptance (§5.2) — Customer sponsor: ______________  Date: ______
   Go/no-go (§5.3) recorded: ☐
```

---

_This framework asserts no pilot, customer, deployment, or benchmark result. Every
pass/fail line is produced by a real tool named above (quality gates, `/health`
`components`, the `bench/*` harnesses, the reliability procedures) at pilot time;
every numeric threshold is an illustrative default to be ratified per customer._
