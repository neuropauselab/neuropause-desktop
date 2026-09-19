# NeuroPause — Product Intelligence (Deployment Knowledge Base)

The CDEP knowledge-base deliverable: the loop that turns **real deployment and
operational evidence** into product decisions. It is **execution, not
engineering** — it adds no runtime and no platform, and it stores knowledge; it
does not generate it. Evidence is produced by the real harnesses at pilot time
(`_grounding.md`; Evidence Collection Matrix in `PILOT-MATRICES.md`).

This document is **structure + real seed + growth templates**, in two strict classes:

- **REAL SEED** — proven _platform_ behaviors, known _platform_ failure modes, and
  validated _platform_ topologies. These are safe to assert today because they were
  executed or are tracked in a real report. Every seed row cites its source.
- **GROWTH TEMPLATE** — customer- and deployment-specific entries. These are
  **empty instruments** a real pilot fills. **No pilot has run**, so every growth
  slot below is blank; any row shown is a labelled placeholder, never a claimed result.

**Build-on, don't restate.** Topologies live in
`docs/validation/REFERENCE-ARCHITECTURES.md`; executed reliability evidence in
`docs/validation/RELIABILITY-RESULTS.md`; incident procedures in
`docs/validation/OPERATIONAL-RUNBOOKS.md`; run mechanics in
`docs/validation/DEPLOYMENT-PLAYBOOKS.md`; the ops operating model in
`docs/operations/*`. This KB **indexes and links** them — it does not duplicate them.

> **Maturity anchor.** Validated Release Candidate; no production fleet; no completed
> customer deployment (`_grounding.md`). Seed numbers are the **2-vCPU reference
> floor**, not a customer result — a pilot re-measures on the customer's hardware.

---

## 1. Deployment knowledge-base structure

One **entry per completed pilot deployment**. An entry is a factual record whose
every asserted number resolves to a linked artifact produced by a real harness. No
entry may narrate a deployment that did not run.

### 1.1 Entry schema

| Field               | Meaning                                                                                | Source at pilot time  | Required |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------- | -------- |
| `entry_id`          | `KB-NNN`, assigned at pilot exit                                                       | KB sequence           | yes      |
| `pilot_ref`         | Link to the pilot record (a `PILOT-FRAMEWORK.md` instance)                             | Pilot exit record     | yes      |
| `context`           | Segment/persona, scale, constraints — **roles/segments only, never a named customer**  | Pilot charter         | yes      |
| `topology`          | Which reference architecture (1 · single-node / 2 · K8s / 3 · air-gapped) + deviations | §5 + as-deployed      | yes      |
| `configuration`     | Flags, resource limits, replica count, datastore mode actually used                    | As-deployed manifests | yes      |
| `evidence_links`    | Paths to harness outputs captured on the customer instance (see below)                 | Evidence bundle       | yes      |
| `patterns_observed` | Pattern-catalog IDs confirmed, or new candidates                                       | §2                    | yes      |
| `failure_modes_hit` | Failure-mode IDs encountered, or new signatures                                        | §4                    | yes      |
| `lessons`           | What held, what surprised, what to change — routes to the improvement loop             | Interviews + RCA      | yes      |
| `status`            | `draft` → `evidence-verified` → `published`                                            | KB workflow           | yes      |
| `owner_role`        | Deployment lead (a **role**, not a person)                                             | Pilot roster          | yes      |

**Evidence links** may reference **only** artifacts a real generator produced against
the customer's instance — API load JSON (`bench/http-load.mjs`), DB latency
(`bench/db-latency.mjs`), cold-start/`/metrics` snapshot (`bench/startup.sh`),
reliability pass/fail (the `RELIABILITY-RESULTS.md` procedures), `/health` + `/metrics`
captures, and `audit_log` extracts. A number that appears in no linked artifact does
not go in the entry.

### 1.2 How an entry is created (post-pilot)

1. **During the pilot — collect, don't write.** The real harnesses emit evidence into
   the pilot's evidence bundle per the Evidence Collection Matrix. The KB is untouched.
2. **At exit — draft.** The deployment lead drafts the entry from the pilot exit record:
   `context`, `topology`, `configuration` from what was actually deployed;
   `evidence_links` from the bundle.
3. **Verify — provenance gate.** SRE confirms every `evidence_link` resolves to a real
   artifact and every asserted value appears in a linked file. Unverifiable claims are
   struck. Status → `evidence-verified`.
4. **Promote to catalogs.** A recurring behavior becomes a **pattern** growth entry (§2);
   a new failure signature becomes a **failure-mode** growth entry (§4). Each cites this
   entry as its source.
5. **Route lessons.** `lessons` feed the improvement loop (Operational Feedback Matrix →
   `docs/operations/CONTINUOUS-IMPROVEMENT.md` lessons/backlog).
6. **Publish gate.** Status → `published` **only** after step 3 passes. Until then the
   entry is unpublished (anti-fabrication rules 4–5: nothing publishes until a real
   deployment fills it and its evidence resolves).

### 1.3 Entry quality bar (the provenance gate, step 3)

An entry advances from `draft` to `evidence-verified` only if **every** box is true.
This is the single guard against a KB entry drifting into fabrication.

- [ ] **No named customer** — `context` is a segment/persona/scale only.
- [ ] **Every number is linked** — each asserted figure appears in a referenced
      `evidence_link` artifact (produced by a real harness on the customer instance).
- [ ] **Every link resolves** — no dangling or placeholder paths remain.
- [ ] **Topology matches as-deployed** — `topology`/`configuration` reflect the real
      manifests, not the reference default.
- [ ] **Reference vs customer is labelled** — any 2-vCPU seed number cited for comparison
      is marked "reference floor," never presented as the customer's measurement.
- [ ] **Catalog cross-refs exist** — `patterns_observed`/`failure_modes_hit` point at
      real §2/§4 IDs or explicitly flag a new candidate.

### 1.4 Blank entry template

```
# KB-NNN  ·  TEMPLATE — do not fill until a real pilot exit
pilot_ref:        ‹link to PILOT-FRAMEWORK instance›
context:          ‹segment / persona / scale / constraints — NO named customer›
topology:         ‹Arch 1 | 2 | 3›  deviations: ‹…›
configuration:    ‹replicas | resource limits | datastore mode | flags (SEED_STORE_ON_BOOT=false, RUN_MIGRATIONS_ON_BOOT=false)›
evidence_links:
  - performance:  ‹path to bench/http-load + db-latency + startup output›
  - reliability:  ‹path to executed reliability procedure results›
  - health:       ‹path to /health + /metrics captures›
  - security:     ‹path to control inventory + npm audit + audit_log extract›
patterns_observed:  ‹PAT-xx confirmed | new candidate›
failure_modes_hit:  ‹FM-xx | new signature›
lessons:          ‹what held / what surprised / change requests → improvement loop›
status:           draft            # draft → evidence-verified → published
owner_role:       deployment lead  # role, not a person
```

---

## 2. Operational pattern catalog

A pattern is a **reproducible platform behavior**. The six seed patterns below are
**REAL** — each was executed against the live backend and recorded in
`docs/validation/RELIABILITY-RESULTS.md` (2026-07-18) or the EVP reference bench. They
are safe to assert as platform properties. A pilot **re-confirms** each on the
customer's hardware by running the cited harness; that re-confirmation is a growth entry.

### 2.1 Seed patterns (real — proven)

| ID         | Pattern (behavior)                                                                                                           | Condition / trigger               | Real evidence (executed)                                                                 | Re-confirm at pilot                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **PAT-01** | **PG pool auto-scales 1 → 10** and holds; RSS grows ~117 → ~213 MB under load                                                | 24k-request read load, 2-vCPU ref | `neuropause_pg_pool_connections{state}`; `OPERATIONAL-RUNBOOKS.md §4`; `bench/results/*` | `bench/http-load.mjs` + watch pool gauges        |
| **PAT-02** | **Redis-down fail-open** — reads keep serving 200; rate limiter fails open; process never crashes                            | Redis unreachable                 | `RELIABILITY-RESULTS.md §4` (`redis-down-fail-open`, PASS); `rateLimit.ts:37`            | reliability procedure 4                          |
| **PAT-03** | **PG-down degrade + auto-reconnect** — process survives, DB reads fail fast (clean 500), pool self-heals with **no restart** | Postgres lost then restored       | `RELIABILITY-RESULTS.md §5` (`db-down-degradation-autorecover`, PASS)                    | reliability procedure 5                          |
| **PAT-04** | **Sub-second restart recovery — 0.46 s** to healthy (cold start 0.66 s)                                                      | SIGTERM / rollout / recycle       | `RELIABILITY-RESULTS.md §3` (`backend-restart-recovery`, PASS)                           | reliability procedure 3                          |
| **PAT-05** | **Forward-only idempotent migrations** — 12 migrations; re-run applies **0 new**                                             | Every deploy invokes `db:migrate` | `RELIABILITY-RESULTS.md §1` (`migration-idempotency`, PASS)                              | `npm run db:migrate` (re-run)                    |
| **PAT-06** | **Backup/restore exact** — `pg_dump`→`pg_restore` restores **row-for-row** (20/40/14)                                        | DR drill / pre-upgrade            | `RELIABILITY-RESULTS.md §2` (`backup-restore`, PASS)                                     | reliability procedure 2 + `scripts/backup-db.sh` |

> These are the **reference floor**. Absolute numbers (0.46 s, 1→10, 610 rps) are 2-vCPU
> measurements; a pilot's re-confirmation records the customer-hardware figures as a
> growth entry — the _behavior_ is asserted, the _customer number_ is produced, never assumed.

### 2.2 Growth slots — customer-confirmed patterns (empty)

Filled only when a pilot's evidence shows a behavior worth cataloguing. **Empty — awaiting first pilot.**

| ID        | Pattern (behavior)                   | Environment           | Evidence link (customer instance) | Source entry |
| --------- | ------------------------------------ | --------------------- | --------------------------------- | ------------ |
| `PAT-C01` | `‹placeholder — not a real pattern›` | `‹customer topology›` | `‹harness output path›`           | `‹KB-NNN›`   |

**Promotion rule.** A customer observation is promoted to a `PAT-Cxx` growth entry only
when it is (a) reproducible via a cited harness and (b) seen in **≥ 2 independent pilots**
or explains a seed pattern's behavior on different hardware. A one-off, unreproduced
observation stays in its source entry's `lessons`, not the catalog.

```
# PAT-CNN  ·  TEMPLATE — do not fill until a real pilot confirms it
behavior:      ‹what the platform reproducibly does›
condition:     ‹trigger / load / environment›
evidence:      ‹path to customer-instance harness output that shows it›
reproduce:     ‹exact harness + flags to re-run it›
source_entry:  ‹KB-NNN›
status:        candidate         # candidate → confirmed (≥2 pilots)
```

---

## 3. Best practices

Platform-invariant practices derived from the **real quality gates**, the **deployment
playbooks**, the **configuration contract**, and the **backup-first** upgrade rule. These
are safe to assert; customer-specific _tuning_ (pool sizes, replica counts, resource
limits) is produced per pilot and stored as a growth entry, not asserted here.

| Practice                             | Rule (do this)                                                                                                   | Real basis                                                            | Enforced at         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| **Gate every build**                 | typecheck 0 · lint 0 · **3,856** tests · build 0 · `npm audit --omit=dev` 0 prod vulns before promoting          | `DEPLOYMENT-PLAYBOOKS.md §A`; `_grounding.md`                         | Acceptance / CI     |
| **Validate manifests first**         | `helm lint` + `kubeconform -strict` (recorded **PASS**, k8s 1.29) before `kubectl apply`                         | `DEPLOYMENT-PLAYBOOKS.md §B.0`                                        | Pre-apply           |
| **Migrations as a gated step**       | `RUN_MIGRATIONS_ON_BOOT=false`; run the one-off migrate Job so a bad migration blocks the rollout                | `REFERENCE-ARCHITECTURES.md` Arch 2; `DEPLOYMENT-PLAYBOOKS.md §D.2`   | Deploy / upgrade    |
| **Backup-first upgrade**             | Take a **verified** `pg_dump` and prove restore into a scratch DB **before** touching prod                       | `DEPLOYMENT-PLAYBOOKS.md §D.1`; `RELIABILITY-RESULTS.md §2`           | Pre-upgrade         |
| **Empty catalog in prod**            | `SEED_STORE_ON_BOOT=false` — store starts empty; no fabricated apps/ratings                                      | `REFERENCE-ARCHITECTURES.md`; `DEPLOYMENT-PROGRAM.md` config contract | Every prod manifest |
| **Secrets out-of-band**              | Create the Secret separately; backend refuses to start without `DATABASE_URL`/`REDIS_URL`/`JWT_ACCESS_SECRET`≥32 | `DEPLOYMENT-PLAYBOOKS.md §B.2`                                        | Deploy              |
| **Restrict `/metrics`**              | Unauthenticated by design — loopback bind (Compose) or NetworkPolicy/scrape-only (K8s)                           | `REFERENCE-ARCHITECTURES.md` telemetry plane                          | Every architecture  |
| **Don't restart on dependency loss** | Redis/PG auto-recovery is proven; a restart only adds the 0.46 s cold path                                       | `OPERATIONAL-RUNBOOKS.md §1–§2`                                       | Incident response   |
| **Pair fail-open with an alert**     | Alert on `components.redis:"down"` to close the rate-limit-bypass window                                         | `RELIABILITY-RESULTS.md §4`; `OPERATIONAL-RUNBOOKS.md §1`             | Monitoring wiring   |
| **Schedule backups externally**      | No scheduler ships — cron/systemd-timer `backup-db.sh`; RPO = age of last dump                                   | `OPERATIONAL-RUNBOOKS.md §5`                                          | Ops setup           |

---

## 4. Common failure modes

Seeded **only** with real, known items: the executed reliability behaviors and the tracked
GA-report risks (`ENTERPRISE-GA-REPORT.md`; `_grounding.md`). Each carries a **detection
signal** (a real `/health` field, `/metrics` series, or config check) and a **mitigation**
from a real runbook/playbook. Severities are from the GA risk register.

### 4.1 Seed failure modes (real — known)

| ID        | Failure mode                                                                    | Detection signal (real)                                                                        | Mitigation                                                                                       | Residual risk                                                                          | Severity |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------- |
| **FM-01** | Redis down → rate limiter **fails open**                                        | `/health` **503**, `components.redis:"down"`; `neuropause_backend_up` stays 1; reads still 200 | `OPERATIONAL-RUNBOOKS.md §1`: don't restart; restore Redis; throttle upstream                    | Rate limiting not enforced during the window — **alert gap**: add `redis:"down"` alert | MEDIUM   |
| **FM-02** | Postgres down → degrade                                                         | `/health` **503**, `components.database:"down"`; `pg_pool_connections{state="total"}`→0        | `OPERATIONAL-RUNBOOKS.md §2`: don't restart (auto-reconnect proven); restore PG                  | None once restored; process survives                                                   | MEDIUM   |
| **FM-03** | Marketplace app install accepts **unsigned** packages when trust store is empty | Config/trust-store review (not a runtime metric)                                               | Populate the trust store / signing config; gate installs before enabling                         | Untrusted package execution if shipped empty — **tracked blocker**                     | **HIGH** |
| **FM-04** | Apple `id_token` **not JWKS-verified**                                          | Auth path review — `apps/backend/src/auth/providers/apple.ts`                                  | Verify Apple `id_token` against JWKS **before** enabling the Apple provider in a pilot           | Token-forgery exposure on Apple sign-in — **tracked blocker**                          | **HIGH** |
| **FM-05** | Bad upgrade — app-binary rollback is **advisory only**                          | Failed post-upgrade `/health`/smoke; `autoUpdater.allowDowngrade=false`                        | `DEPLOYMENT-PLAYBOOKS.md §D.4`: **data-side restore** of pre-upgrade dump + re-point image tag   | Whole-dump only — **no PITR/WAL**; recover to a specific dump                          | MEDIUM   |
| **FM-06** | Pool saturation / high latency                                                  | `pg_pool_connections{state="waiting"}` **> 0** sustained; `total` pinned, `idle`≈0             | `OPERATIONAL-RUNBOOKS.md §4`: confirm DB sub-ms, scale out (HPA cpu 70%, 2→6) or raise CPU       | HPA live scale-up under load **not yet measured** (proposed)                           | MEDIUM   |
| **FM-07** | Restart loop                                                                    | `/live`/`/health` never stabilize; process refuses to start                                    | `OPERATIONAL-RUNBOOKS.md §3`: check env — missing `DATABASE_URL`/`REDIS_URL`/`JWT_ACCESS_SECRET` | Upstream config, not the app                                                           | LOW      |

> **Detection depends on external wiring.** The platform ships the signals, not the alerting —
> no native alerting/paging/tracing (`OPERATIONAL-RUNBOOKS.md` escalation notes). Author alert
> rules on the real series (Prometheus + Alertmanager + a `/health` blackbox probe). Federation
> multi-region DR is **modeled**, not failover — do not enter it as a recovery capability.

### 4.2 Growth slots — customer-observed failure modes (empty)

A pilot that hits a failure not in §4.1 records it here with its real signal + mitigation.
**Empty — awaiting first pilot.**

| ID       | Failure mode                         | Detection signal (real)             | Mitigation           | Source entry |
| -------- | ------------------------------------ | ----------------------------------- | -------------------- | ------------ |
| `FM-C01` | `‹placeholder — not a real failure›` | `‹real /health or /metrics signal›` | `‹runbook / action›` | `‹KB-NNN›`   |

**Admission rule.** A `FM-Cxx` entry is admitted only if its detection signal names a **real**
`/health` field, `/metrics` series, `audit_log` record, or config check — a failure with no
observable signal on the shipped substrate is a monitoring gap to file, not a catalog entry.

```
# FM-CNN  ·  TEMPLATE — do not fill until a real pilot hits it
failure_mode:  ‹what went wrong›
signal:        ‹real /health field | /metrics series | audit_log | config check›
mitigation:    ‹runbook/playbook action that resolved it›
residual_risk: ‹what remains after mitigation›
severity:      ‹per pilot RCA — map to GA risk register where applicable›
source_entry:  ‹KB-NNN›
```

---

## 5. Reference architectures

The three **validated** topologies, linked not restated — full detail in
`docs/validation/REFERENCE-ARCHITECTURES.md`. A pilot records which base architecture it
used and any deviations as a KB entry (§1), keeping this catalog the canonical topology map.

### 5.1 Validated topologies (real)

| #                                     | Topology (one line)                                                   | Validation status                                  | Primary evidence                 | Detail                              |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------- | ----------------------------------- |
| **1 · Single-node / dev**             | API + Postgres + Redis on one host via Compose (loopback `/metrics`)  | Real, operational                                  | `docker-compose.prod.yml`        | `REFERENCE-ARCHITECTURES.md` Arch 1 |
| **2 · Kubernetes + managed PG/Redis** | Stateless backend (2→6 HPA), managed HA datastores, gated migrate Job | Manifests **kubeconform strict PASS** (k8s 1.29)   | `bench/results/deployment.json`  | `REFERENCE-ARCHITECTURES.md` Arch 2 |
| **3 · On-prem / air-gapped**          | Arch 1 delivered offline via `build-offline-bundle.sh`                | Script **shellcheck CLEAN**; save/load **PARTIAL** | `bench/results/reliability.json` | `REFERENCE-ARCHITECTURES.md` Arch 3 |

> **Modeled or absent across all three** (never enter as a customer capability): enterprise
> SAML/SCIM SSO; federation multi-region DR/failover; blue-green/canary; PITR/WAL (belongs to
> managed Postgres); native alerting/tracing/capacity-forecasting. App-binary rollback is
> **advisory** — real recovery is data-side (§4 FM-05).

### 5.2 Growth slots — customer architecture variants (empty)

Each pilot maps to one base architecture and records its deviations + evidence. **Empty — awaiting first pilot.**

| Variant ID | Base | Deviations from reference | Validation evidence (customer instance) | Source entry                         |
| ---------- | ---- | ------------------------- | --------------------------------------- | ------------------------------------ |
| `ARCH-C01` | `‹1  | 2                         | 3›`                                     | `‹placeholder — not a real variant›` | `‹harness output path›` | `‹KB-NNN›` |

---

## Reading note

**Seed = real and platform-invariant** (proven behaviors, tracked failure modes, validated
topologies) — safe to assert, each cited to a real report. **Growth = template and
pilot-filled** — every customer/deployment slot is blank until a real pilot exit fills it and
its evidence links resolve. The KB feeds the product loop (entries → pattern/failure-mode
promotion → `docs/operations/CONTINUOUS-IMPROVEMENT.md` and the final
`CUSTOMER-DEPLOYMENT-REPORT.md`). Nothing here asserts a customer, a deployment, or a customer
benchmark — only the structure to capture them honestly when a pilot runs.
