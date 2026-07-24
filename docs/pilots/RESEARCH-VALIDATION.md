# Research Validation — CDEP Field Replication & Evidence

> **Execution, not engineering. A blank instrument, not a record.** This is the
> Customer Deployment & Evidence Program (CDEP) procedure for **reproducing the EVP
> reference measurements on a customer's own hardware** during a real pilot, and for
> preparing an honest write-up of a _future_ result. It adds no runtime and no
> harness — it drives the ones that already ship. It builds on, and does not restate,
> the NSSP replication science:
> [`REPLICATION.md`](../science/frameworks/REPLICATION.md) (reproducibility vs.
> repeatability, the harness contract, the reference machine),
> [`BENCHMARK-FRAMEWORK.md`](../science/BENCHMARK-FRAMEWORK.md) (per-harness specs,
> commands, datasets), and [`EVIDENCE-GUIDE.md`](../science/manuals/EVIDENCE-GUIDE.md)
> (the L0–L4 ladder, artifact catalog, citation rules) — read those for the _why_.
>
> **BANNER — no research is published.** No paper, DOI, venue, peer review,
> citation, or external certification exists or is claimed anywhere in CDEP. The
> "Publication preparation" section is **methodology for a hypothetical future
> write-up only**. **No pilot has run**, so **every field column, delta, and
> verdict in this document is a blank to be filled during a real deployment** —
> never a claimed result. Grounding: [`_grounding.md`](./_grounding.md).

Per the anti-fabrication rules, the **only real numbers here are the EVP reference
measurements** (cited to their artifacts); a _customer's_ numbers do not exist yet.
This is the loop that turns "our reference floor" into "reproduced on their hardware."

---

## 1. Replication methodology

### 1.1 What a pilot reproduces — the EVP reference floor (real, cited)

These are **our** reference measurements on the 2-vCPU reference machine — the
floor a pilot re-derives, **not** a customer result. Values are quoted unaltered
from the artifacts with their evidence level (ladder: `EVIDENCE-GUIDE.md` §1). A
pilot does not restate these as its own; it **re-measures** them.

| Reference probe                           | Headline value (unaltered)                                           | Level | Artifact anchor              |
| ----------------------------------------- | -------------------------------------------------------------------- | ----- | ---------------------------- |
| Cold start → healthy                      | first cold **0.66 s**, warm re-boot **0.624 s**                      | L3    | `bench/results/startup.json` |
| Idle snapshot                             | RSS **117.8 MB**, heap **20.6 MB**, pool **1**                       | L3    | `startup.json`               |
| HTTP `/store/apps` (list)                 | **610 rps**, p50 **51.87**, p95 **68.51**, p99 79.77 ms              | L3    | `http-load.json`             |
| HTTP `/store/apps/:slug` (point)          | **424 rps**, p50 **72.19**, p95 **104.35** ms                        | L3    | `http-load.json`             |
| HTTP `/live` (readiness)                  | **2,103 rps**, p50 11.46, p95 35.93 ms; **0 errors** in 24,000 reqs  | L3    | `http-load.json`             |
| DB point read (by slug)                   | p50 **0.23**, p95 0.46, p99 2.37 ms; **0 errors** in 10,000          | L3    | `db-latency.json`            |
| Engine `graph.project` / `timeline.query` | **92.84** / **76.80** ms (budget 2,000)                              | L3/L4 | `intelligence-engines.json`  |
| Argon2id verify (login cost)              | p50 **19.63** ms (19456/2/1, n=50)                                   | L3    | `argon2.json`                |
| Under-load memory/pool                    | RSS **223.3 MB**, heap 57.7 MB, pool **10**                          | L3    | `metrics-under-load.json`    |
| Reliability                               | **5 PASS + 1 PARTIAL**; restart **0.46 s**; migrate re-run **0 new** | L4    | `reliability.json`           |

Carry every caveat with the number (`EVIDENCE-GUIDE.md` §4): **HTTP figures travel with
the co-located-client note** (§3.2); `offline-bundle` travels as **PARTIAL**, never PASS.

### 1.2 Re-running the harnesses on customer hardware (protocol)

Reference commands are in `BENCHMARK-FRAMEWORK.md` §4 and re-verification in
`EVIDENCE-GUIDE.md` §5; a pilot runs them **unmodified** against its deployed instance.
Prerequisites: a deployed backend (GEAP `DEPLOYMENT-PROGRAM.md` /
`docs/validation/DEPLOYMENT-PLAYBOOKS.md`), migrated + seeded DB, and Redis.

| Step | Action (real asset)                                                                       | Field output              |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------- |
| P0   | Deploy per playbook; `npm run db:migrate` (12 forward-only)                               | running instance          |
| P1   | Seed catalog: `npx tsx apps/backend/src/db/seed.ts` (deterministic 20-app)                | comparable dataset (§3.4) |
| P2   | Capture environment (§1.3) → `field/environment.json`                                     | env record                |
| P3   | `bash bench/startup.sh` → `field/startup.json`                                            | cold/warm start           |
| P4   | `node bench/http-load.mjs --conc 32 --reqs 3000 --warmup 300 --json field/http-load.json` | HTTP latency/rps          |
| P5   | `DATABASE_URL=… node bench/db-latency.mjs --iters 2000 --json field/db-latency.json`      | DB latency                |
| P6   | run H1 burst → `curl -s <base>/metrics` → record gauges                                   | under-load RSS/pool       |
| P7   | engine bench (Vitest `performance.test.ts`) — if desktop in scope                         | engine timings            |
| P8   | reliability procedures (`docs/validation/RELIABILITY-RESULTS.md`)                         | pass/fail per scenario    |

Each `.mjs` harness is dependency-free and self-aborting (`http-load.mjs` exits `2` on a
failed `/health` pre-flight; `db-latency.mjs` exits `2` without `DATABASE_URL`) — so a
field run **claims nothing** unless the target is genuinely up.

### 1.3 Environment capture — the field reference record

A field number is meaningless without its machine profile (`REPLICATION.md` §5). The
pilot captures its own record, mirroring `bench/results/environment.json`, **before** any
harness run. **Blank template — fill at pilot time:**

| Facet                                    | Reference (2-vCPU)     | Field capture |
| ---------------------------------------- | ---------------------- | ------------- |
| CPU model / vCPUs                        | Xeon @2.10 GHz / **2** | ____          |
| Memory                                   | ~8 GB                  | ____          |
| Node runtime                             | v22.22.2               | ____          |
| OS                                       | Ubuntu 24.04.4 LTS     | ____          |
| Postgres / Redis                         | 16.13 / 7.0.15         | ____          |
| **Topology** (client on/off-box)         | **co-located**         | ____          |
| Deploy target (k8s/helm/bare/air-gapped) | single container       | ____          |
| Captured (date)                          | 2026-07-18             | ____          |

### 1.4 The evidence ladder applied to _pilot_ evidence

The ladder is defined in `EVIDENCE-GUIDE.md` §1. Applied to evidence **a pilot
collects**, level attaches to the field artifact exactly as it does to a reference
artifact — with one honest boundary: a single pilot site is still **one topology**.

| Pilot evidence                                | Becomes                    | Because                                                    | Honest ceiling                         |
| --------------------------------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------------------- |
| Committed field `*.json` from a harness run   | **field-L3 (Measured)**    | real recorded measurement on customer hardware             | one site — not independent replication |
| Field reliability run with recorded pass/fail | **field-L4 (Validated)**   | executed gate with evidence                                | scenario coverage = reference set only |
| A projected/expected field number             | **L1 Modeled at best**     | not measured; never present as data                        | must stay labelled hypothetical        |
| "Reproduced across N pilot sites"             | still **L0 → discharging** | cross-environment replication is L0 (`REPLICATION.md` §11) | not peer review; not a publication     |

A pilot **advances** the L0 "cross-environment replication" proposal (`REPLICATION.md`
§11) by producing the first off-reference measurements — but N sites of field-L3 is
aggregated field evidence, **not** peer review and **not** a published result.

---

## 2. Field validation

**Protocol (per harness): run → capture artifact → compare to reference floor → record
delta with environment context → verdict.** Comparison obeys the
reproducibility-vs-repeatability rule (`EVIDENCE-GUIDE.md` §5): **outputs must match
exactly** (errors, migration no-op, restore row counts); **timings** need only sit within
a repeatability envelope for the declared topology — identical decimals are not required.

### 2.1 Acceptance rule (what "reproduced" means)

| Dimension           | Field acceptance condition                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrity (outputs) | field `errors` = 0 (HTTP + DB); migrate re-run = 0 new; restore row counts match (apps 20 / versions 40 / categories 14) — **must be exact**  |
| Latency (timings)   | within envelope for topology class; **worse HTTP is expected off a busier box, better HTTP is expected off-box** (§3.2) — record, don't "fix" |
| Reliability         | same 5 PASS; `offline-bundle` PARTIAL unless a Docker daemon proves save/load                                                                 |
| Provenance          | field `environment.json` captured; caveats carried                                                                                            |

### 2.2 Blank comparison template (reference filled, field blank)

**Do not pre-fill the field columns.** Each `____` is filled by the P3–P8 run at a
real pilot; a delta is `field − reference`; verdict uses §2.1.

**HTTP load** — `http-load.mjs` → `http-load.json` (conc 32, 3,000 reqs/scenario):

| Scenario                             | Ref p50 (ms) | Ref p95 (ms) | Ref rps | Field p50 | Field p95 | Field rps | Field errors | Δ / verdict |
| ------------------------------------ | -----------: | -----------: | ------: | --------: | --------: | --------: | -----------: | ----------- |
| `GET /live`                          |        11.46 |        35.93 |    2103 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /metrics`                       |        15.96 |        35.39 |    1789 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /store/apps`                    |        51.87 |        68.51 |     610 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /store/apps?q=ai&sort=trending` |        49.10 |        68.20 |     639 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /store/featured`                |        59.90 |        75.45 |     529 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /store/categories`              |        19.05 |        32.86 |    1559 |      ____ |      ____ |      ____ |         ____ | ____        |
| `GET /store/apps/:slug`              |        72.19 |       104.35 |     424 |      ____ |      ____ |      ____ |         ____ | ____        |

**Database latency** — `db-latency.mjs` → `db-latency.json` (2,000 iters/shape):

| Query shape                 | Ref p50 (ms) | Ref p95 (ms) | Ref p99 (ms) | Field p50 | Field p95 | Field p99 | Field errors | Δ / verdict |
| --------------------------- | -----------: | -----------: | -----------: | --------: | --------: | --------: | -----------: | ----------- |
| point read (by slug)        |         0.23 |         0.46 |         2.37 |      ____ |      ____ |      ____ |         ____ | ____        |
| filtered list (limit 24)    |         0.16 |         0.26 |         0.67 |      ____ |      ____ |      ____ |         ____ | ____        |
| aggregate (count by status) |         0.12 |         0.17 |         0.23 |      ____ |      ____ |      ____ |         ____ | ____        |
| join (app + latest version) |         0.24 |         0.38 |         0.55 |      ____ |      ____ |      ____ |         ____ | ____        |
| index probe (`SELECT 1`)    |         0.06 |         0.10 |         0.13 |      ____ |      ____ |      ____ |         ____ | ____        |

**Startup / resource / reliability** — `startup.sh`, `/metrics`, reliability run:

| Probe                                  | Reference (unaltered)              | Field       | Δ / verdict |
| -------------------------------------- | ---------------------------------- | ----------- | ----------- |
| cold start → healthy                   | 0.66 s (cold) / 0.624 s (warm)     | ____ / ____ | ____        |
| idle RSS / heap / pool                 | 117.8 MB / 20.6 MB / 1             | ____        | ____        |
| under-load RSS / pool                  | 223.3 MB / 10                      | ____        | ____        |
| migration idempotency                  | 12 applied; re-run 0 new (PASS)    | ____        | ____        |
| backup/restore row counts              | apps 20 / vers 40 / cats 14 (PASS) | ____        | ____        |
| restart recovery                       | 0.46 s (PASS)                      | ____        | ____        |
| Redis-down fail-open / PG-down degrade | PASS / PASS                        | ____        | ____        |

**Engine hot paths** (desktop in scope) — `performance.test.ts` → `intelligence-engines.json`:

| Hot path            | Ref (ms) | Field | Δ / verdict |     | Hot path                   | Ref (ms) | Field | Δ / verdict |
| ------------------- | -------: | ----: | ----------- | --- | -------------------------- | -------: | ----: | ----------- |
| `graph.project`     |    92.84 |  ____ | ____        |     | `timeline.query`           |    76.80 |  ____ | ____        |
| `memory.index`      |    74.37 |  ____ | ____        |     | `search.index`             |    55.91 |  ____ | ____        |
| `briefing.generate` |    24.34 |  ____ | ____        |     | `recommendations.generate` |    17.13 |  ____ | ____        |
| `memory.project`    |    13.66 |  ____ | ____        |     | `memory.recall`            |     4.43 |  ____ | ____        |

### 2.3 Delta record (one per harness, filled at pilot time)

```
harness:        <http-load | db-latency | startup | engines | reliability>
field artifact: field/<name>.json     ref artifact: bench/results/<name>.json
environment:    <link to §1.3 field capture>   topology: <co-located | off-box>
integrity:      field errors=____  (ref 0)     outputs match? <Y/N — must be Y>
timing verdict: <within-envelope | faster off-box | slower — investigate>
caveats/notes:  <co-located note; offline-bundle PARTIAL if applicable — NOT a published result>
```

---

## 3. Measurement consistency

Controls that make a field run comparable to the reference and to other sites. The
harness contract (warmup → fixed sample → percentiles) is specified in `REPLICATION.md`
§3 / `BENCHMARK-FRAMEWORK.md` §3; the pilot's job is to **lock it, not change it.**

### 3.1 Locked parameters (do not vary — comparability depends on it)

| Control                       | Locked value                        | Why it must not move                            |
| ----------------------------- | ----------------------------------- | ----------------------------------------------- |
| HTTP warmup / measured / conc | 300 / 3,000 / 32                    | percentile stability + identical load shape     |
| DB warmup / iters             | 100 / 2,000 per shape               | same tail-sampling resolution                   |
| Percentile estimator          | nearest-rank `ceil((p/100)·n)−1`    | cross-harness/site comparability                |
| Latency measurement           | full body drained (`arrayBuffer()`) | includes transfer, not just TTFB                |
| Engine dataset / budget       | 5,000 entities / 2,000 ms           | deterministic workspace, fixed guard            |
| Argon2 params                 | 19456 / 2 / 1                       | production work factor, not a tunable-for-bench |

Changing any locked value produces a number that **cannot** be compared to the reference
floor; if a site must change one (e.g. hardware can't sustain conc 32), record it as a
**new baseline for that site**, not a delta against reference.

### 3.2 Co-location caveat & topology declaration (load-bearing)

The reference HTTP figures used a **co-located load client** on 2 shared vCPUs
(`environment.json` note; `REPLICATION.md` §5), so they are a **conservative lower
bound** — a customer running the client **off-box** should legitimately see **better**
HTTP latency and throughput, a _match_ not an anomaly. DB, engine, and Argon2 benches
have **no** HTTP-client contention and are directly comparable. Every field HTTP
comparison **must declare its topology**; deltas are interpretable only **within the
same topology class.** Never restate reference HTTP numbers as best-case.

### 3.3 Cross-site comparability checklist

| #   | Check                                                                             | State |
| --- | --------------------------------------------------------------------------------- | ----- |
| 1   | Same deterministic seed catalog (§3.4) loaded                                     | ____  |
| 2   | Locked parameters (§3.1) unmodified                                               | ____  |
| 3   | Environment (§1.3) captured, incl. topology                                       | ____  |
| 4   | Cold **and** warm start both captured                                             | ____  |
| 5   | `errors` count recorded (not just percentiles)                                    | ____  |
| 6   | Gauges scraped **per-run** (stateful); caveats carried (co-located note; PARTIAL) | ____  |

### 3.4 Seed-data control

H1/H2 read the deterministic 20-app catalog (`apps/backend/src/db/seeds/0001_store_seed.sql`
via `seed.ts`; `BENCHMARK-FRAMEWORK.md` §5.1). A pilot **must** load the same catalog
(P1) so `/store/*` and the DB shapes hit an identical row set — otherwise latency deltas
conflate _data_ with _hardware_. `SEED_STORE_ON_BOOT=false` in production; seed
explicitly for the benchmark, then compare.

---

## 4. Publication preparation

> **BANNER (repeat): no paper, DOI, venue, peer review, or citation exists or is being
> claimed.** This section is **preparation methodology for a hypothetical future
> write-up only**. Nothing below asserts any result has been published, reviewed, or
> accepted anywhere. A future write-up would be an **internal evidence report**, not a
> peer-reviewed publication, unless and until real external review happens — it has not.

### 4.1 Structure of a future honest write-up

| Section             | Contents (honest)                                             | Must NOT contain                        |
| ------------------- | ------------------------------------------------------------- | --------------------------------------- |
| Abstract            | what was reproduced, on what topology, with what deltas       | any "peer-reviewed" / "published" claim |
| Methods             | harness contract + locked params (§3.1), by reference to NSSP | invented apparatus                      |
| Environment         | the §1.3 field record(s), verbatim                            | omitted topology                        |
| Results             | field artifacts + §2.2 tables, unaltered, with `errors`       | rounded-rosy numbers; dropped caveats   |
| Threats to validity | single/few topologies, co-location, PARTIAL offline-bundle    | claims of independence not held         |
| Reproducibility     | the package (§4.2)                                            | "trust us" without artifacts            |

### 4.2 Reproducibility package (what ships with any write-up)

A claim is reproducible only once its artifact is committed (`BENCHMARK-FRAMEWORK.md`
§7). The package **is the evidence** — no prose substitutes for it:

- The **harnesses**, unmodified: `bench/http-load.mjs`, `bench/db-latency.mjs`,
  `bench/startup.sh`, `apps/desktop/src/main/__bench__/performance.test.ts`.
- The **reference + field artifacts**: `bench/results/*.json` (floor) and committed `field/*.json` (P3–P8).
- The **environment records** (§1.3) for reference and each field site.
- The **delta records** (§2.3), completed §2.2 tables, and the P0–P8 commands + locked params (§3.1).

### 4.3 Honesty gates before anything is written up

| Gate                   | Requirement                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| G1 — real runs only    | every field number traces to a committed `field/*.json`; no projected value in a results table           |
| G2 — level stated      | each claim carries L3/L4 and its anchor (`EVIDENCE-GUIDE.md` §4)                                         |
| G3 — caveats intact    | co-located note + `offline-bundle` PARTIAL carried, never dropped                                        |
| G4 — no research claim | no DOI, venue, peer review, citation, or certification asserted                                          |
| G5 — scope stated      | "N pilot sites, single vendor-run" — not "independently replicated" unless a third party actually did it |

### 4.4 What must never appear

Fabricated customer names or deployment records; a projected number in a measured
column; a rounded-improved figure; a dropped `errors` count or caveat; the words
"published", "peer-reviewed", "DOI", "citation", or any venue; `offline-bundle` as PASS;
or "independently replicated" absent a real independent party. Absent evidence is stated
as absent (`EVIDENCE-GUIDE.md` §6), never implied present.

---

## Reading note

This is the customer-side mirror of NSSP replication: `REPLICATION.md` and
`BENCHMARK-FRAMEWORK.md` establish that the harnesses are re-runnable and the reference
floor is real; CDEP **re-runs them on the customer's hardware and records the deltas
honestly.** Until a pilot does that, every field column here is blank — a template, not
a result. The strongest honest claim is "the reference is reproducible, and here is how
a pilot proves it on their box" — not that any result has been reproduced, published, or
reviewed. It has not.
