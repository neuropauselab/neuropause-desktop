# Evidence Guide — NeuroPause Scientific & Standards Program

> **The operating manual for evidence in the NSSP.** It defines how evidence is
> **produced**, **recorded**, **levelled** (L0–L4), and **preserved**; catalogs
> every real artifact under `bench/results/`; states the rules for citing evidence
> in any NeuroPause document; and gives the procedure to re-verify a claim. This is
> a *formalization* manual — it describes the evidence the existing platform
> already generates. It invents no numbers. The ladder it uses is defined in
> [`_grounding.md`](../_grounding.md) and applied across
> [`SCIENTIFIC-MATRICES.md`](../SCIENTIFIC-MATRICES.md); the replication mechanics
> are in [`frameworks/REPLICATION.md`](../frameworks/REPLICATION.md).

---

## 1. The evidence ladder (canonical)

| Level | Name | Meaning | How it is cited |
|---|---|---|---|
| **L4** | Validated | Implemented **and** verified by executed tests/gates/reliability runs with recorded evidence | test file + `bench/results/*.json` or gate output |
| **L3** | Measured | Implemented **and** has real recorded measurements | metric series / `bench/results/*.json` |
| **L2** | Implemented | Exists and runs in the codebase; not independently measured as a scientific claim | source file path |
| **L1** | Modeled | Schema/types exist and are tested, but not wired to live execution | type file path |
| **L0** | Proposed | Defined by a framework; not yet in code | none — labelled *Proposed / Future Research* |

**The composite honesty rule:** a framework may *propose* freely (L0), but may only
*claim* what a cited artifact supports (L2+).

---

## 2. The evidence lifecycle — produce → record → level → preserve

1. **Produce.** A **harness** drives the real platform and times it: the load and
   latency harnesses (`bench/http-load.mjs`, `bench/db-latency.mjs`), the cold-start
   script (`bench/startup.sh`), and the deterministic engine bench
   (`apps/desktop/src/main/__bench__/performance.test.ts`). Each obeys the same
   contract — **warm up, measure a fixed sample, report percentiles** (see
   REPLICATION.md §3).
2. **Record.** The harness writes a JSON **artifact** to `bench/results/`,
   embedding its run parameters, its results, and a provenance `note`. Latency
   artifacts use the uniform `{mean_ms,p50_ms,p95_ms,p99_ms,max_ms}` primitive.
3. **Level.** The claim built on the artifact is tagged L3 (a recorded
   measurement) or L4 (a measurement backed by an executed pass/fail gate or
   reliability run). Code that merely exists is L2; type-only models are L1;
   framework proposals are L0.
4. **Preserve.** The harness and its artifact are committed **together with the
   source they measure**, so one checkout holds code, harness, and last
   measurement at a single revision (REPLICATION.md §9).

---

## 3. Artifact catalog — every file in `bench/results/`

| Artifact | Produced by | Key recorded values (unaltered) | Level |
|---|---|---|---|
| `environment.json` | Documented environment capture | Xeon @2.10 GHz **2 vCPU**, ~**8 GB**, Node **22.22.2**, PG **16.13**, Redis **7.0.15**; captured 2026-07-18; co-located-client note | **L3** |
| `startup.json` | `bench/startup.sh` | cold boot **0.66 s**, warm reboot **0.624 s**; idle RSS **117.8 MB**, heap **20.6 MB**, pool 1 | **L3** |
| `http-load.json` | `bench/http-load.mjs` | conc 32, 3000 reqs × 8 scenarios = **24,000 reqs, 0 errors**; `/live` **2,102.96 rps**; store list p50 **51.87 ms** | **L3** |
| `db-latency.json` | `bench/db-latency.mjs` | 2000 × 5 = **10,000 queries, 0 errors**; point read p50 **0.23** / p95 0.46 / p99 2.37 ms | **L3** |
| `intelligence-engines.json` | `__bench__/performance.test.ts` | 5,000 entities, budget 2000 ms; `graph.project` **92.84 ms**, `timeline.query` 76.80 ms | **L3 / L4** |
| `argon2.json` | Argon2 auth-cost micro-bench | `argon2id` 19456/2/1, n = 50; hash p50 **19.66 ms**, verify p50 19.63 ms | **L3** |
| `metrics-under-load.json` | `/metrics` scrape after a load burst | RSS **223.3 MB**, heap 57.7 MB, pool total **10**, `GET_200` 8,000 | **L3** |
| `reliability.json` | Documented reliability/chaos procedures | **5 PASS + 1 PARTIAL**; restart recovery **0.46 s**; migration re-run 0 new | **L4** |
| `deployment.json` | `kubernetes-validate` / `shellcheck` / `yamllint` | k8s strict **PASS ×2**, shellcheck **CLEAN**, yamllint clean (cosmetic only) | **L4** |

Two artifacts describe capture that is not a standalone `bench/` script:
`argon2.json` records the deliberately CPU-bound password-KDF cost (a separate
low-RPS harness, by design, from `http-load.mjs`); `metrics-under-load.json` is a
`/metrics` snapshot taken *after* a `bench/http-load.mjs` burst — its own `note`
states it is reproducible by re-running the load harness then scraping `/metrics`.

---

## 4. Rules for citing evidence in any NeuroPause document

1. **Every L2+ claim carries an anchor** — a real file or artifact path. No anchor,
   no claim.
2. **State the level next to the claim** (e.g. "cold start 0.66 s — **L3**,
   `startup.json`"). A number without a level is not admissible.
3. **Quote artifacts unaltered**, with units. Never round a measurement into a
   rosier figure or drop the `errors` count.
4. **Carry the caveat with the number.** HTTP figures travel with the
   co-located-client note; `offline-bundle` travels as **PARTIAL**, never PASS.
5. **Label L0/L1 plainly** as *Proposed* or *Modeled*; never present a proposal or
   a type-only model as a measured fact.
6. **Distinguish "the platform does X" (cite a file) from "the framework proposes
   X" (label L0).** This is the core discipline of the whole program.
7. **Never fabricate** benchmark numbers, peer review, certifications, published
   papers, or international-standard conformance. Absent evidence is stated as
   absent (matrices §2, final row).
8. **Prefer the strongest available anchor.** If a claim has both a source file
   (L2) and a recorded run (L3/L4), cite the run.

---

## 5. How to re-verify a claim

Any L3/L4 claim can be independently re-derived. Prerequisites: a checkout, a
migrated Postgres + Redis reachable via `apps/backend/.env`, and a production
backend build.

| Claim class | Command / procedure | Compare against |
|---|---|---|
| HTTP latency / throughput | `node bench/http-load.mjs --json bench/results/http-load.json` (pre-flight `/health` guard aborts if the backend is down) | `http-load.json` |
| DB query latency | `DATABASE_URL=… node bench/db-latency.mjs --json bench/results/db-latency.json` | `db-latency.json` |
| Cold-start + idle metrics | `bash bench/startup.sh` | `startup.json` |
| Under-load memory / pool | re-run the load harness, then scrape `/metrics` | `metrics-under-load.json` |
| Engine hot-path timings | run the `__bench__/performance.test.ts` suite (Vitest) — it prints the timing table and enforces the 2000 ms budget | `intelligence-engines.json` |
| Migration idempotency | run `migrate.ts` twice; the second run applies 0 files | `reliability.json` (`migration-idempotency`) |
| Deployment validity | `kubernetes-validate` (strict) + `shellcheck` on `deploy/` and `scripts/` | `deployment.json` |

**Reproducibility vs. repeatability when comparing.** Expect *outputs* to match
exactly (engine results, manifest digests, migration no-op) and *timings* to fall
within a repeatability envelope, not to match to the millisecond (REPLICATION.md
§§1–2). A re-run whose percentiles sit near the recorded values — with the same
`errors` count — confirms the claim; identical decimals are neither expected nor
required.

---

## 6. Absent evidence — stated honestly

The following are **not** in evidence and must never be cited as if they were:
independent/third-party replication, multi-host benchmarking, peer review,
published papers, coverage instrumentation, per-PR desktop or macOS release CI, and
any international-standard (ISO/IEC/NIST) *conformance* or certification. These are
tracked as **L0** or as explicit gaps in the matrices; a NeuroPause document may
note them as future work but may never imply they exist.

## Reading note

This guide is the shared evidence contract behind every NSSP framework. When a
document cites a number, the reader should be able to open the named artifact, see
the same value and caveat, and re-run the named harness to reproduce it. Evidence
that cannot survive that round-trip does not belong in a NeuroPause claim.
