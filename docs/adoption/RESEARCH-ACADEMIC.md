# NeuroPause — Research & Academic Enablement

> A GEAP **adoption-enablement** artifact: how a university, lab, or independent
> researcher _could_ reproduce, cite, and build on NeuroPause. It adds no runtime
> and no research findings — it is a set of actionable models, checklists, and
> templates over assets that already exist.
>
> **Honesty anchors (non-negotiable, from [`_grounding.md`](./_grounding.md)).**
> There are **no** published papers, **no** peer review, **no** citations
> received, and **no** existing research collaborations — none exist, and nothing
> here implies one does. Everything below is phrased as _how one could_ engage.
> The reproducible datasets described in §3 are **real synthetic benchmark
> fixtures**, not field data. Measured numbers come only from
> [`bench/results/`](../../bench/results/), unaltered.
>
> **License anchor:** [`LICENSE`](../../LICENSE) is **Proprietary — All Rights
> Reserved**. **Maturity anchor:** **Validated Release Candidate**
> (`ENTERPRISE-VALIDATION-REPORT.md`), version line **`1.0.0-rc.1`**. Evidence
> ladder: **L4** Validated · **L3** Measured · **L2** Implemented · **L1** Modeled
> · **L0** Proposed/Future ([NSSP README](../science/README.md)).

---

## 1. Research collaboration model

This section is a **framework** for structuring an engagement. No collaboration
exists today; the tables below describe how one _could_ be set up and what the
proprietary license implies for each mode.

### 1.1 Engagement modes (personas, not named partners)

| Mode                  | Fitting persona                      | Real asset it builds on                         | Typical output                              |
| --------------------- | ------------------------------------ | ----------------------------------------------- | ------------------------------------------- |
| Reproducibility study | Empirical software-engineering group | `bench/*` harnesses + `bench/results/*.json`    | Independent re-run + variance report        |
| Benchmark extension   | Systems / performance lab            | Benchmark Framework §9 L0 specs                 | A new harness → a new committed artifact    |
| Security analysis     | Applied-security lab                 | Open items TD-1/TD-2 (`RESEARCH-ROADMAP.md` §6) | Coordinated finding via `SECURITY.md`       |
| Formal methods        | Verification group                   | Tested invariants (`RESEARCH-ROADMAP.md` §5)    | A model + checker output for one invariant  |
| HCI / evaluation      | Human-computer-interaction lab       | Desktop perf telemetry (harness-ready, L2)      | A capture harness → device-matrix artifacts |

### 1.2 IP note (proprietary license — read carefully)

| Question                           | Position under the current license                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Can a lab read/run the code?       | Only under a **separate written agreement executed by NeuroPause** (the `LICENSE` reserves all rights; there is no general grant). |
| Can measured results be published? | Yes if the agreement permits — the _numbers and methodology_ are publishable; the _source_ is not redistributable.                 |
| Who owns findings fed back?        | Defined by the agreement; default intake is the internal/partner contribution path (§7), not a public fork.                        |
| Is there an open-source grant?     | **No.** Open source is a **proposed** future path only (`OPEN-SOURCE-STRATEGY.md`, proposed) — do not assume it.                   |

### 1.3 Engagement charter template (fill in per collaboration)

```
Collaboration: <lab / group name>            Mode (§1.1): <...>
Real assets in scope: <harnesses / datasets / doc set — cite paths>
Access basis: <executed written agreement ref>   Version pinned: 1.0.0-rc.1 @ <commit>
Publishable outputs: <measured results + methodology; NOT source>
Finding intake path (§7): <SECURITY.md | proposed CONTRIBUTING | partner channel>
Honesty constraints: no papers/peer-review claimed; evidence levels on every claim
```

---

## 2. University engagement

Three ready-to-run engagement shapes. Each cites the real asset it exercises and
its license consideration; each assumes the §1.2 written-agreement basis.

| Engagement     | What students do                                                                                                                         | Real asset                                                                                                        | Deliverable                                                   | License note                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Course use** | Reproduce a benchmark; read the evidence ladder as a case study in honest measurement                                                    | `bench/http-load.mjs`, `db-latency.mjs`, `startup.sh`; `BENCHMARK-GUIDE.md`                                       | A reproduced `bench/results/*.json` + a variance write-up     | Course access needs the written agreement; no redistribution of source in coursework |
| **Capstone**   | Answer one **L0** research question end-to-end (e.g. desktop-hardware benchmark matrix, or a forecasting prototype over recorded series) | `RESEARCH-ROADMAP.md` §1/§3; `perfRecorder.ts`, `PerfSampler.tsx` (harness-ready L2)                              | A new harness + committed artifacts moving a capability L2→L3 | Output is measurement + method; graduate it via §7                                   |
| **Lab study**  | Analyze an open security item, or formalize a tested invariant                                                                           | TD-1 Apple JWKS (`apple.ts`), TD-2 unsigned install (`packageService.ts`); invariants in `RESEARCH-ROADMAP.md` §5 | A coordinated finding or a checker output for one invariant   | Security findings route through `SECURITY.md` (§7)                                   |

**Guardrails for teaching staff.** (1) Present the platform as a _Validated
Release Candidate_, never GA. (2) Any figure a student quotes must trace to a
committed `bench/results/*.json` artifact — a number without an artifact does not
exist. (3) L0 roadmap items are _open questions_, not solved features — that is
precisely what makes them good capstones.

---

## 3. Research datasets

These are the **only** datasets. All are **deterministic synthetic benchmark
fixtures generated by code** — there is **no field data, no real user data, and
no ground-truth labels**. They are ideal for reproducibility and performance
work, and _unsuitable_ for claims about real-world user behavior.

| Dataset                                  | Source (real)                                                                             | Generation                                                                                                     | Size / shape                                                                                   | Good for                                                      | Not for                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| **Seeded 20-app store catalog**          | `apps/backend/src/db/seeds/0001_store_seed.sql`, applied by `apps/backend/src/db/seed.ts` | Plain SQL `INSERT`s, slug-based lookups, idempotent clean re-seed (`reset:true`)                               | **20 apps · 40 versions · 14 categories** (+ orgs, developers, reviews, collections, featured) | HTTP/DB benchmark inputs; store-query experiments             | Market/adoption inference (it is a fixture, not a real store)   |
| **Deterministic 5,000-entity workspace** | `buildEntities(5000)` in `apps/desktop/src/main/__bench__/performance.test.ts`            | **No RNG**; fields from index `i`; fixed base clock `2026-01-01`, `NOW=2026-02-10T18:00:00Z`; kind by `i % 10` | **5,000 `UnifiedEntity`** across project/task/document/message/calendar                        | Engine hot-path timing; reproducible-output studies           | User-behavior or ML-training claims (no real signal, no labels) |
| **Recorded measurement artifacts**       | `bench/results/*.json` (9 files)                                                          | Emitted by the harnesses above, committed alongside code                                                       | Latency percentiles, cold-start, engine timings, Argon2 cost, reliability/deploy evidence      | Re-analysis, cross-run comparison, meta-studies of the method | Any topology other than the one recorded (§4.3)                 |

**Determinism guarantee (why these are _reproducible_, not merely repeatable).**
Both fixtures are pure functions of their size input: the same `N` rebuilds the
identical workspace, and re-seeding truncates then re-inserts the same 20-app
catalog. So _outputs_ match exactly across hosts; only _timings_ vary (§4.2).
Verified by the reliability backup-restore row counts (applications 20, versions
40, categories 14 — `reliability.json`).

**Honest limits.** Single synthetic topology; one reference machine; no external
validity to production workloads. State this in any write-up.

---

## 4. Reproducibility guidelines

Built directly on NSSP [`REPLICATION.md`](../science/frameworks/REPLICATION.md)
and [`BENCHMARK-GUIDE.md`](../science/manuals/BENCHMARK-GUIDE.md). Follow these to
independently reproduce the measured baseline.

### 4.1 Two words, kept distinct

- **Reproducibility** = same inputs → same **outputs** (workspace content, engine
  results, manifest digests). Achievable bit-exact.
- **Repeatability** = re-run **variance** of a _measured_ timing. Reported as
  percentiles (p50/p90/p95/p99/max), never as a single "true" number.

### 4.2 Prerequisites and commands (run from repo root)

| Step                       | Command                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Install (hoists `pg`)      | `npm install`                                                                                     |
| Infra up                   | `docker compose up -d` (postgres:16-alpine, redis:7-alpine, qdrant)                               |
| Migrate (12, forward-only) | `npm run db:migrate`                                                                              |
| Seed catalog (20/40/14)    | `cd apps/backend && npx tsx src/db/seed.ts`                                                       |
| Build backend              | `npm run build -w @neuropause/backend`                                                            |
| **H3** cold start          | `bash bench/startup.sh` → `startup.json`                                                          |
| **H1** HTTP load           | `node bench/http-load.mjs --conc 32 --reqs 3000 --warmup 300 --json bench/results/http-load.json` |
| **H2** DB latency          | `DATABASE_URL=... node bench/db-latency.mjs --iters 2000 --json bench/results/db-latency.json`    |
| **H4** engines             | `cd apps/desktop && npx vitest run src/main/__bench__/performance.test.ts`                        |

### 4.3 Record the environment, honor the caveat

Every run must record its machine, mirroring `bench/results/environment.json`
(reference: Intel Xeon @ 2.10 GHz **2 vCPU**, ~8 GB, Node **v22.22.2**, Ubuntu
24.04.4, Postgres **16.13**, Redis **7.0.15**, captured **2026-07-18**). The
**co-located-client caveat** is load-bearing: the H1 client shares the two cores
with the backend, so HTTP latency/throughput are a **conservative lower bound**,
not best-case. H2 (direct `pg`), H4 (in-process), and Argon2 have no such
contention.

### 4.4 Reproducibility checklist

- [ ] Infra migrated **and** seeded (`SELECT count(*) FROM applications` = 20).
- [ ] Harness ran against real infra; artifact **written** to `bench/results/`.
- [ ] `errors` field is `0` before any "0 errors" statement.
- [ ] Environment recorded; co-located caveat stated for HTTP figures.
- [ ] Cold vs warm reported as **two** figures, neither derived from the other.
- [ ] Every quoted number transcribed **unaltered** and labelled **L3/L4**.

---

## 5. Citation guidelines

Cite NeuroPause as **software and technical reports**, never as a paper — no
paper, DOI, or peer-reviewed venue exists. Do **not** invent a DOI; if the owner
later archives a snapshot (e.g. via an archival service), add the minted DOI then.

### 5.1 `CITATION.cff` template (drop-in; file does not yet exist)

```yaml
cff-version: 1.2.0
message: 'If you reproduce or build on NeuroPause, cite it as software.'
title: 'NeuroPause'
abstract: 'Electron+backend platform; reproducible benchmark harnesses & fixtures.'
type: software
version: '1.0.0-rc.1' # release-candidate line the artifacts describe
date-released: 2026-07-18 # matches bench/results/environment.json capture
license: LicenseRef-Proprietary # LICENSE = All Rights Reserved (not an SPDX OSI id)
# doi:                          # none assigned — leave blank; do not fabricate
repository: '<internal/partner repository reference>'
authors:
  - name: 'NeuroPause'
```

### 5.2 BibTeX (software + report, not `@article`)

```bibtex
@software{neuropause_2026,
  title   = {NeuroPause},
  version = {1.0.0-rc.1},
  year    = {2026},
  note    = {Validated Release Candidate; proprietary license. No DOI assigned.
             Reproduced against bench/results/ at commit <SHA>.}
}
@techreport{neuropause_benchmarks_2026,
  title  = {NeuroPause Performance Benchmarks},
  year   = {2026},
  note   = {docs/validation/PERFORMANCE-BENCHMARKS.md; artifacts in bench/results/.}
}
```

### 5.3 Citing a specific artifact, report, or framework

| To cite…                  | Cite this                                     | Also record                                          |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| A measured number         | `bench/results/<name>.json`                   | version `1.0.0-rc.1`, commit SHA, `environment.json` |
| The methodology           | `docs/science/BENCHMARK-FRAMEWORK.md`         | harness id (H1–H4, P1–P2)                            |
| The reproducibility model | `docs/science/frameworks/REPLICATION.md`      | evidence level of the claim                          |
| An open question          | `docs/science/manuals/RESEARCH-ROADMAP.md` §n | that it is **L0 Proposed**                           |

**Rule:** a citation to a number is incomplete without version + commit +
environment. Pin all three; artifacts currently carry a capture _date_, not yet a
commit SHA (that stamping is L0-Proposed, `REPLICATION.md` §8) — record the SHA
yourself.

---

## 6. Publication preparation

**No paper exists.** This is a checklist for turning a reproduced run into an
honest write-up (a report, a reproducibility appendix, or a submission the _owner_
might later choose to make) — not evidence that one has been written or reviewed.

### 6.1 Pre-write checklist

- [ ] **Claim ↔ evidence.** Every claim carries an L0–L4 level; L2+ names a real
      file, L3/L4 names a `bench/results/*.json` artifact.
- [ ] **Method by reference.** Describe harness, warmup, sample size, percentile
      estimator (`idx = ceil((p/100)·n) − 1`) — cite `BENCHMARK-FRAMEWORK.md`.
- [ ] **Environment disclosed.** Full `environment.json` profile + the
      co-located-client caveat in the methods section.
- [ ] **Caveats up front.** Single topology, synthetic fixtures, no field data,
      no independent replication yet (`REPLICATION.md` §11).
- [ ] **No overclaim.** Not GA; no peer review; no certification; no forecasting
      engine. L0 items framed as _open questions_.
- [ ] **Artifacts available.** Reproduction commands (§4.2) + the exact artifacts.

### 6.2 Reproducibility-appendix template

```
Software: NeuroPause 1.0.0-rc.1 @ commit <SHA>
Environment: <paste bench/results/environment.json>
Commands: <the §4.2 steps actually run>
Artifacts: <bench/results/*.json produced, with errors=0 confirmation>
Caveats: co-located client (HTTP = conservative lower bound); synthetic fixtures;
         single 2-vCPU topology; timings are repeatability envelopes, not exact.
Evidence levels: <per-claim L0–L4 table>
```

---

## 7. Scientific contribution workflow

How an external finding feeds **back**. Given the proprietary license and the
absent `CONTRIBUTING.md` (a **proposed** artifact; see the sibling
`COMMUNITY-GOVERNANCE.md`, proposed), intake today is internal/partner plus the
existing security channel.

### 7.1 Intake by finding type

| Finding                                | Intake path                                                    | Required evidence to be accepted                              |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Security issue (e.g. on TD-1/TD-2)     | Root [`SECURITY.md`](../../SECURITY.md) coordinated disclosure | Repro steps against pinned version                            |
| Reproduction (confirm/refute a number) | Proposed `CONTRIBUTING` / partner channel                      | A committed `bench/results/*.json` + `environment.json`       |
| New harness / benchmark (an L0 spec)   | Same                                                           | Harness in `bench/`, artifact in `bench/results/`, §6 caveats |
| Answered L0 research question          | Same, tied to `RESEARCH-ROADMAP.md`                            | The artifact that lifts it one rung                           |

### 7.2 Graduation ladder (how a finding changes the record)

A finding never changes a claim by assertion — only by climbing the ladder with
evidence (`RESEARCH-ROADMAP.md` §8):

`L0` propose → `L1` tested type/model → `L2` wired & runs → `L3` recorded
measurement (`bench/results/`) → `L4` executed test/gate/reliability run.

When a contributed artifact lifts a capability a rung, the relevant NSSP framework
is updated to that level and the roadmap drops the item. The contribution's worth
is the _evidence_, not the claim.

---

## Reading note

This artifact is enablement, not architecture: it maps how a lab, course, or
independent researcher _could_ reproduce, cite, and contribute — built on the real
harnesses (`bench/*`), the real fixtures (§3), and the NSSP replication science.
It claims **no** papers, **no** peer review, **no** received citations, and **no**
existing collaborations, because none exist. The honesty is the point: propose
freely at L0, but claim only what a committed artifact supports at L3+.
