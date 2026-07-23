# NeuroPause Scientific & Standards Program (NSSP) — Documentation Index

> **What this is.** The NSSP is a **formalization layer** placed *over the
> NeuroPause platform that already exists*. It is not new engineering, not a
> redesign, and not a product roadmap. It reads the implemented codebase and
> describes — in the vocabulary of a scientific & standards program — what the
> platform observes, measures, validates, assures, and standardizes today, and
> what it only *proposes* for tomorrow. No system documented here was built by
> this program; every system documented here is **mapped**, never duplicated.
>
> The shared source of truth for every NSSP document is
> [`_grounding.md`](./_grounding.md) (the real inventory + the evidence ladder)
> and [`SCIENTIFIC-MATRICES.md`](./SCIENTIFIC-MATRICES.md) (the five reconnaissance
> matrices). Where any document here and the grounding disagree, the grounding wins.

---

## 1. The Honesty Charter (non-negotiable)

These rules bind every document in this program. They are reproduced here, at the
front door, because they are the reason the program is credible.

1. **Never claim scientific proof without evidence.** A claim is only as strong as
   the artifact it cites.
2. **Never claim international-standard conformance.** NeuroPause holds **no**
   ISO/IEC/NIST certification. The program records *adoption* of external standards
   and *formalization* of internal conventions — never conformance or certification.
3. **Never invent** benchmark numbers, peer review, certifications, published
   papers, or experimental results. Measured numbers come only from
   [`bench/results/`](../../bench/results/) or the EVP/GA reports, unaltered.
4. **Never invent implementation that does not exist.** If it is not in the code,
   it is labelled **Proposed (L0)** or **Modeled (L1)** — never asserted as fact.
5. **Every concept carries an evidence level (L0–L4)** with a real citation for L2
   and above.
6. **Never duplicate or redesign existing systems** — map to them (the
   "Sub-Agent-9 discipline"). The frameworks are *read models* over the codebase.
7. **Terminology is consistent** — every term is defined once, authoritatively, in
   the [Glossary](./manuals/GLOSSARY.md), and reused everywhere.

> A framework **may propose freely (L0)**, but may only **claim** what a cited
> artifact supports (L2+). That single sentence is the composite honesty rule.

---

## 2. The Evidence Ladder

Every concept, row, and claim in the NSSP is tagged with one of five levels.

| Level | Name | Meaning | How it is cited |
|---|---|---|---|
| **L4** | **Validated** | Implemented **and** verified by executed tests / gates / reliability runs with recorded evidence | test file + gate output or `bench/results/*.json` |
| **L3** | **Measured** | Implemented **and** carrying real recorded measurements / telemetry | metric series / `bench/results/*.json` |
| **L2** | **Implemented** | Exists and runs in the codebase; not independently measured or validated *as a scientific claim* | source file path |
| **L1** | **Modeled** | Schema / types / surfaces exist and are tested, but are not wired to a live external system or execution | type file path |
| **L0** | **Proposed / Future Research** | A model or concept defined *by this framework*; not yet in code | none — explicitly labelled |

The five levels map to the program's five buckets: **L4 = Validated · L3 = Measured
· L2 = Implemented · L1 = Modeled · L0 = Proposed/Future**. The
[Evidence Guide](./manuals/EVIDENCE-GUIDE.md) is the operational manual for applying
them; the [Evidence Matrix](./SCIENTIFIC-MATRICES.md#2-evidence-matrix) records what
*kind* of evidence backs each class of claim.

---

## 3. What the platform actually is (one paragraph)

NeuroPause is an npm-workspaces monorepo: shared libraries in
[`packages/*`](../../packages) (`shared`, `sdk`, `cli`) and applications in
[`apps/*`](../../apps) (`backend`, `desktop`). The **desktop** app is an
Electron + React + TypeScript client with a hardened main/preload/renderer split;
the **backend** is an Express + Postgres + Redis service exposing `/health`,
`/live`, and Prometheus `/metrics`. The two agree on a single **Zod IPC contract**
in `packages/shared`. New capabilities are added as reuse-only **lenses** — pure
derivations over data the platform already produces — not as new engines. The
[Engineering Handbook](./manuals/ENGINEERING-HANDBOOK.md) is the full account.

---

## 4. Documentation Map

All paths are relative to `docs/science/`. Documents marked *authored by sibling
work* are produced concurrently and cited here as the canonical location.

### 4.1 Foundations (read these first)

| Document | Purpose |
|---|---|
| [`_grounding.md`](./_grounding.md) | The real inventory + evidence ladder. Authoring anchor for the whole program. |
| [`SCIENTIFIC-MATRICES.md`](./SCIENTIFIC-MATRICES.md) | Five reconnaissance matrices: Capability, Evidence, Measurement, Validation, Standards. |
| [`README.md`](./README.md) | This index and the Honesty Charter. |

### 4.2 The Eight Frameworks

Each framework formalizes one scientific facet of the platform. Each is a *read
model* over real code, carrying evidence levels on every concept.

| # | Framework | Formalizes | Dominant evidence |
|---|---|---|---|
| 1 | [Ontology](./frameworks/ONTOLOGY.md) | The platform's vocabulary — entities, relations, lifecycle | L2 / L1 |
| 2 | [Observation](./frameworks/OBSERVATION.md) | Signals, telemetry, health, audit trail | L3 / L2 |
| 3 | [Measurement](./frameworks/MEASUREMENT.md) | Metrics, percentiles, KPIs, benchmark artifacts | L3 / L2 |
| 4 | [Validation](./frameworks/VALIDATION.md) | Tests, gates, reliability, continuous-validation model | L4 / L2 |
| 5 | [Assurance](./frameworks/ASSURANCE.md) | RBAC, crypto primitives, fail-closed enforcement, open items | L4 / L2 |
| 6 | [Prediction](./frameworks/PREDICTION.md) | Scenario simulation, process mining, AI reasoning | **L0 / L1** (no forecasting engine exists) |
| 7 | [Replication](./frameworks/REPLICATION.md) | Reproducible harnesses, recorded artifacts, migrations | L3 / L2 |
| 8 | [Standards](./frameworks/STANDARDS.md) | Adopted external standards + formalized internal conventions | Adoption, **not** conformance |

### 4.3 Matrices & Benchmark Framework

| Document | Purpose |
|---|---|
| [`REFERENCE-IMPLEMENTATION-MATRIX.md`](./REFERENCE-IMPLEMENTATION-MATRIX.md) | Maps every framework concept to the exact file(s) that implement it. |
| [`BENCHMARK-FRAMEWORK.md`](./BENCHMARK-FRAMEWORK.md) | The measurement methodology: harnesses, environment, what is and is not measured. |
| [`SCIENTIFIC-MATRICES.md`](./SCIENTIFIC-MATRICES.md) | The five backbone matrices (also listed under Foundations). |

### 4.4 Manuals — the practitioner's shelf

| Manual | For |
|---|---|
| [Glossary](./manuals/GLOSSARY.md) | Authoritative, single-definition term reference. Start here for any word. |
| [Engineering Handbook](./manuals/ENGINEERING-HANDBOOK.md) | How NeuroPause is engineered: architecture, the lens pattern, contracts, gates, evidence discipline. |
| [Reference Guide](./manuals/REFERENCE-GUIDE.md) | Terse quick-reference: commands, endpoints, file locations, metric catalog, RBAC naming. |
| [Measurement Manual](./manuals/MEASUREMENT-MANUAL.md) | How to run and read measurements. |
| [Validation Manual](./manuals/VALIDATION-MANUAL.md) | How the test/gate/reliability hierarchy works. |
| [Assurance Manual](./manuals/ASSURANCE-MANUAL.md) | How the security & governance controls are operated. |
| [Evidence Guide](./manuals/EVIDENCE-GUIDE.md) | How to assign and defend an evidence level. |
| [Standards Manual](./manuals/STANDARDS-MANUAL.md) | The adopted standards + internal conventions, formalized. |
| [Benchmark Guide](./manuals/BENCHMARK-GUIDE.md) | How to reproduce every benchmark. |
| [Research Roadmap](./manuals/RESEARCH-ROADMAP.md) | Honest open questions and L0/Future opportunities — no fabricated timelines. |

---

## 5. How to read the NSSP

- **To understand a claim**, find its evidence level. L2+ carries a file you can
  open; L0/L1 is explicitly a proposal or a model, not a fact.
- **To trust a number**, trace it to [`bench/results/`](../../bench/results/) or a
  named report. If a number has no such trace, it is not in this program.
- **To find where something lives in code**, use the
  [Reference Implementation Matrix](./REFERENCE-IMPLEMENTATION-MATRIX.md).
- **To learn a term**, use the [Glossary](./manuals/GLOSSARY.md) — never infer a
  definition from context.
- **To separate today from tomorrow**, the [Research Roadmap](./manuals/RESEARCH-ROADMAP.md)
  holds everything the platform does *not* yet do, stated plainly.

---

## 6. Honesty ledger (what the NSSP does not claim)

Reproduced from the grounding so it is impossible to miss:

- **No** peer review, published papers, or external scientific validation.
- **No** international-standard certification (ISO / IEC / NIST or any other).
- **No** statistical forecasting / time-series / ML-prediction engine exists;
  Prediction science is predominantly **Proposed (L0)**, grounded on the
  scenario, simulation, and AI-reasoning surfaces that *do* exist.
- **No** distributed tracing, alert routing, or capacity forecasting in the
  observability layer (a documented Day-2 absence).
- **Known open security items** are stated, not hidden: Apple `id_token` not yet
  JWKS-verified, and unsigned marketplace-app install when the trust store is
  empty. Both are tracked in [`ENTERPRISE-GA-REPORT.md`](../../ENTERPRISE-GA-REPORT.md)
  and carried forward in the [Research Roadmap](./manuals/RESEARCH-ROADMAP.md).

The program's worth is precisely that this ledger is short, specific, and true.
