# NeuroPause PERG — Future Vision & Long-Term Product Direction

> **What this is.** The PERG **long-term direction** document — the forward view of
> where NeuroPause goes after GA. It carries the near-term **1.x** roadmap as SemVer
> version lines grounded in the real backlog, the aspirational **2.x** vision, the
> durable principles that govern any future, and the open research questions. It is
> **governance, not engineering**: it commits no feature, sets no date, and **adds no
> runtime and no architecture.** It **activates at GA**; today it governs the **real
> backlog** (the seven open items) and the registers in
> [`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md).
>
> **Elevates, does not restate.** The _mechanics_ live in the sibling PERG docs and are
> **referenced, not re-derived**: the version policy / SemVer-breaking rules / support
> lifecycle in [`RELEASE-GOVERNANCE.md`](RELEASE-GOVERNANCE.md); the Now/Next/Later
> board, Definition of Ready, and acceptance gate in
> [`ROADMAP-GOVERNANCE.md`](ROADMAP-GOVERNANCE.md); the vision pillars, product
> principles, and decision framework in [`PRODUCT-STRATEGY.md`](PRODUCT-STRATEGY.md);
> the research-intake / experiment / prototype machinery in
> [`INNOVATION-MANAGEMENT.md`](INNOVATION-MANAGEMENT.md); the debt/risk registers and
> dependency waves in [`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md). This document
> synthesizes them into one **long-horizon** artifact — the north-star view — and adds
> nothing they already own.
>
> **Honesty banner (non-negotiable).** NeuroPause is a **Validated Release Candidate**
> (`1.0.0-rc.1`). **No GA, no post-GA release, no production fleet, no customer, and no
> completed deployment exists** (`_grounding.md`). Every version line past
> `1.0.0-rc.1` is an **illustrative proposed forward slot** (SemVer), ordered by the
> real dependency **waves** — never a dated commitment or a claimed track record
> (`RELEASE-OPERATIONS.md §1`; `RELEASE-GOVERNANCE.md §3`). Every **1.x** item is one of
> the **real** open backlog items; every **2.x** idea is **Future Vision —
> aspirational, uncommitted, no timeline, and may never ship.** No demand, metric,
> customer, or roadmap achievement is invented anywhere below.

---

## Evidence legend — every line carries exactly one label

| Label             | Meaning                                                                             | NSSP ladder                 |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------- |
| **Implemented**   | Runs in the codebase today; **a file is cited**                                     | L2                          |
| **Validated**     | Implemented **and** verified by executed tests / gates / reliability / benchmarks   | L3–L4                       |
| **Proposed**      | Committed intent, near-term, grounded in a **real backlog item** (a TD / open item) | L1 / near-term L0           |
| **Future Vision** | **Aspirational, long-term, not committed, no timeline — may never ship**            | L0 (explicitly speculative) |

> The split is **enforced, not decorative.** **1.x** items are Implemented / Validated /
> Proposed only. **2.x** items are **Future Vision** unless a real evidence artifact
> promotes one through the CDEP intake gate (`PRODUCT-EVOLUTION.md §1.3`). Nothing is
> marked done that is not truly **Implemented** with a citation (`_grounding.md` rule 3).

---

## 1. NeuroPause 1.x roadmap (grounded in the real backlog)

The 1.x line is **buildable and backlog-grounded** — every entry is either a real
capability that already runs or one of the seven governed open items. It is presented
here as **SemVer version lines** (a release-by-release forward view); the horizon board
and acceptance mechanics are owned by [`ROADMAP-GOVERNANCE.md`](ROADMAP-GOVERNANCE.md),
the version policy by [`RELEASE-GOVERNANCE.md`](RELEASE-GOVERNANCE.md).

> **These version numbers are illustrative forward slots, not history.** Only
> `1.0.0-rc.1` has shipped. `1.0.0`, `1.1.0`, `1.2.0` show **which real backlog items a
> release would carry**, ordered by dependency wave — they carry **no date and no
> claimed progress** (`RELEASE-OPERATIONS.md §1`).

### 1.1 The Validated-RC foundation (what 1.x builds on)

`1.0.0-rc.1` is a _Release Candidate_, not a beta, because the core is already real.
1.x closes the bounded gaps **around** this foundation — it does not rebuild it.

| Capability                                                  | Label           | Evidence (cited)                                                                                                      |
| ----------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Core platform (desktop shell + Node/Postgres/Redis backend) | **Validated**   | 3,856 tests / 441 files, build exit 0, 0 prod vulns (`ENTERPRISE-GA-REPORT.md §2`)                                    |
| Auth — backend-brokered PKCE / RFC 8252                     | **Validated**   | PKCE + refresh rotation & reuse detection (SHA-256), Argon2id, Keychain `safeStorage`, tested                         |
| Fail-closed IPC + RBAC                                      | **Validated**   | startup invariant `assertAllChannelsClassified` (`runtimeAuthz.ts`); Zod contract totality (`contracts.ts`)           |
| Supply-chain signing                                        | **Implemented** | Ed25519 manifest signing; integrity hash always checked (`packageService.ts`)                                         |
| Deployment (Docker / K8s / Helm / offline)                  | **Validated**   | strict `kubeconform` + `shellcheck` green (`deploy-validation.yml`)                                                   |
| Reliability / data-side recovery                            | **Validated**   | backup/restore PASS row-for-row; restart 0.46 s; zero-downtime rollout (`RELIABILITY-RESULTS.md §2`)                  |
| Observability substrate                                     | **Implemented** | `/metrics`, `/health`, append-only `audit_log` (`0001_init.sql:50`)                                                   |
| Release discipline                                          | **Implemented** | SemVer + Conventional Commits + Keep a Changelog (`CONTRIBUTING.md`, `CHANGELOG.md`); `backend-ci`, `windows-release` |

### 1.2 The 1.x version lines (the seven open items + hardening)

Each row below is **Proposed** — committed intent, grounded in a real backlog ID, and
**not yet done**. It retires only when its criterion is **green in CI**
(`GOVERNANCE-MATRICES.md §3`); no row here is claimed shipped.

| Line         | Item (Proposed)                                    | Backlog ID · severity              | Evidence anchor (what's real today)                                                               | Gate role                           |
| ------------ | -------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **1.0.0 GA** | Apple `id_token` **JWKS verification**             | TD-1 · **HIGH**                    | seam + `HARDENING TODO` exist in `apps/backend/src/auth/providers/apple.ts`                       | **Strict GA blocker**               |
| **1.0.0 GA** | **Signed / trusted** marketplace install           | TD-2 · **HIGH**                    | unsigned+empty-trust-store bypass at `packageService.ts:184`                                      | **Strict GA blocker**               |
| **1.0.0 GA** | **Per-PR desktop CI**                              | TD-4a · Medium                     | only `backend-ci`/`windows-release` exist; no per-PR desktop gate                                 | Release-quality (safe GA iteration) |
| **1.0.0 GA** | **macOS release automation**                       | TD-4b · Medium                     | mac packaging is manual (`LAUNCH-02-MAC-PACKAGING.md`)                                            | Signed GA build                     |
| **1.1.0**    | **Alerting + tracing** (+ capacity baseline)       | TD-6 · Medium                      | wires over the real `/metrics`; folds in the TD-3 fail-open alert                                 | Recommended pre-GA (day-2)          |
| **1.1.0**    | **Automated, tested** update rollback              | TD-5 · Medium                      | advisory `pickRollbackTarget` (`appUpdater.ts`); data-side restore stays the real lever (ADR-001) | Recommended pre-GA                  |
| **1.1.0**    | **Target-hardware** desktop benchmarks             | Val §10 · GA-gating validation gap | renderer perf harness ready (`perfMetrics.ts`); not yet captured on a hw matrix                   | Recommended pre-GA                  |
| **1.2.0**    | Renderer **E2E / a11y** + coverage instrumentation | TD-7 · Medium                      | no renderer E2E/a11y suite; no coverage instrument                                                | Hardening (non-gating)              |
| **1.2.0**    | Renderer **bundle trim** (930 KB chunk)            | TD-8 · Low–Med                     | one 930 KB renderer chunk; route-split/trim under budget                                          | Hardening (non-gating)              |
| **1.2.0**    | Remaining admin-scope UI; FNV-1a hash review       | TD-9, TD-10 · Low                  | partial admin scopes; FNV-1a in one non-security path                                             | Opportunistic (nice-to-have)        |

> **Critical path to GA** (`GOVERNANCE-MATRICES.md §2, §4`): close **TD-1** and **TD-2**
> (both HIGH, the only strict blockers) and stand up the release-engineering path
> (**TD-4a → TD-4b**). The **1.1.0** items are marked _Recommended_ pre-GA — the Release
> Manager may pull any of them into the `1.0.0` scope, or ship them as the first
> post-GA line; either way they are **Proposed, not done.** Wave order:
> **W1** {TD-1, TD-2, TD-4a} → **W2** {TD-4b, TD-6, TD-5} → **W3** {benchmarks}
> (`GOVERNANCE-MATRICES.md §4`). No item carries a date; ordering is waves, not calendar.

### 1.3 The RC→GA milestone (the one real near-term north star)

The whole purpose of the 1.x line is to convert the **bounded, documented RC gaps** into
a defensible GA and then harden around it — nothing more speculative. The next real
milestone is therefore **not a market event** but the **`1.0.0-rc.1` → `1.0.0` gate**:
the two HIGH security items closed and green in CI, plus the release-engineering path
that produces a **signed** desktop build (`GOVERNANCE-MATRICES.md §2`;
`RELEASE-GOVERNANCE.md §8`). Until that gate passes with no open blocker, the honest
status line stays **Validated Release Candidate** — the `-rc` suffix is dropped by the
checklist, never by intent (`RELEASE-OPERATIONS.md §1`). 1.1.0 and 1.2.0 then retire the
remaining medium/low debt; **none of these lines is claimed reached.**

---

## 2. NeuroPause 2.x vision (Future Vision — uncommitted)

> ### ⚠️ FUTURE VISION — READ THIS FIRST
>
> Everything in §2 is **aspirational and not committed.** There is **no timeline, no
> sequencing promise, and no guarantee any of it ships** — several items may never be
> built. Each is an **honest extrapolation of a real gap that exists today**, labelled
> **Future Vision (L0)** and paired with its **true present state**. Nothing here is on
> the committed roadmap. A 2.x idea joins the _committed_ line **only** when a real
> evidence artifact admits it through the CDEP intake gate (`PRODUCT-EVOLUTION.md §1.3`)
> — a gate that is **blank today** (no pilot has run). **No customer, market, demand, or
> adoption claim is made anywhere in this section.**

Each theme below extends a **real surface at its honest state** — never a fabricated
capability. In the evolution matrix these sit **Parked** (`ROADMAP-GOVERNANCE.md §1.4`):
no wave, no horizon, no date.

| 2.x theme                                | State **today** (real, cited)                                                                                                                                                                                                   | Future-Vision direction (uncommitted; may never ship)                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Live federation**                      | **Modeled only** — `federation/dr/drStore.ts` is a modeled DR screen; **no second cluster, no cross-region replication** (`DISASTER-RECOVERY-GUIDE.md §7.1`).                                                                   | A real federated control/data plane with cross-cluster orchestration and _tested_ DR failover — designed **only if/when** a real requirement grounds it.                                                                                         |
| **Multi-region operations**              | **Single-region** — every deployment is one independent cluster + managed datastore (`REFERENCE-ARCHITECTURES.md`). Per-region parameterization is **proposed in EOSP** (`GLOBAL-SCALING.md §1`), not run; no region is "live." | Active multi-region operation — regional routing, data-residency automation, cross-region capacity — built on the **existing** helm/offline flow, **no new architecture**.                                                                       |
| **Internationalization (i18n)**          | **Absent** — NeuroPause is **English-only**; **no i18n framework in any `package.json`**; only _incidental_ `Intl` formatting (`lib/format.ts`) (`GLOBAL-SCALING.md §2.1`).                                                     | A real i18n layer — externalized catalogs, locale selection, translated content — following the proposed P-ladder (`GLOBAL-SCALING.md §2`).                                                                                                      |
| **Statistical prediction / forecasting** | **No engine (L0)** — the wired surfaces (`capacityScheduler.ts`, `enterpriseDecisionEngine.ts`) and the scenario / mining / reasoning layers are **deterministic**, not forecasts (`PREDICTION.md` honesty banner).             | A statistical/learned **forecasting layer over the existing deterministic projections**, validated by a hold-out protocol **before any accuracy is claimed** — never a number asserted in advance.                                               |
| **Deeper observability**                 | `/metrics` + `/health` + `audit_log` + provenance traces exist (L2/L3); **alerting/tracing (TD-6) is near-term Proposed** (1.1.0), not built.                                                                                   | Full telemetry-driven maturity — burn-rate SLOs _firing_, distributed request tracing, capacity forecasting, ops maturity above **Defined** — **structurally gated on a production fleet that does not exist** (`CONTINUOUS-IMPROVEMENT.md §1`). |
| **Ecosystem growth**                     | Package/marketplace pipeline is **Implemented** (`packageService.ts`) with Ed25519 signing; catalog ships **empty** (`SEED_STORE_ON_BOOT=false`); signed-install enforcement (TD-2) is Proposed (1.0.0).                        | A broader third-party publisher / partner ecosystem with a **trust, curation, and review** model on the signed-package substrate. **No demand, adoption, or catalog size is asserted.**                                                          |

> **How a 2.x idea becomes real.** It does not graduate by assertion. It climbs the NSSP
> evidence ladder — **L0 → L1** (a tested type/model) **→ L2** (wired + cited) **→ L3**
> (recorded measurement) **→ L4** (executed test/gate) (`RESEARCH-ROADMAP.md §8`) — and
> it joins the _committed_ roadmap only after a real CDEP evidence artifact admits it.
> Until **both** happen, it stays here: **unbuilt, uncommitted, and honestly labelled.**
> Federation is "designed when demanded" in the sense of a _cited requirement_, never a
> fabricated market signal.

**Why these six, and not a wishlist.** Each theme is a gap the **real** evolution matrix
already records at its honest level — federation _modeled_, multi-region _single-region
today_, i18n _absent_, prediction _L0 / no engine_, observability _TD-6 proposed_,
ecosystem _TD-2 open on an implemented pipeline_ (`GOVERNANCE-MATRICES.md §1`). The 2.x
vision is thus an **extrapolation of documented gaps**, not an invented product line: no
new capability category is conjured, and nothing is promised. If a gap is not real and
cited, it does not appear here.

---

## 3. Platform evolution principles (durable — govern any future)

These invariants bind 1.x, 2.x, and anything not yet imagined. They elevate the product
principles in [`PRODUCT-STRATEGY.md §2`](PRODUCT-STRATEGY.md) into the **evolution-facing**
constraints of the program; they are the standing rules a future maintainer inherits.

1. **Reuse-only — no duplicate architecture.** Every future capability, near or far, is
   built by **reusing the existing runtime, contracts, deployment, and security
   substrate** — never by standing up a parallel stack. PERG itself adds no runtime and
   no architecture (`_grounding.md`); the same rule binds what it governs. Multi-region
   reuses the parameterized helm/offline flow; a forecasting layer sits _over_ the
   deterministic projections that already run; ecosystem growth extends the
   signed-package pipeline. The test for any proposal — _what real surface does this
   reuse?_ If the honest answer is "a new architecture," the default answer is **no**,
   pending a reuse-first RFC + ARB review (`PRODUCT-STRATEGY.md §5.2`).

2. **Evidence before claim.** The four-way label is the contract with the reader. A
   capability is **Implemented** only with a cited file, **Validated** only with an
   executed test/gate/benchmark; **Proposed** and **Future Vision** carry no such claim
   by construction. Nothing graduates by assertion — it climbs the L0→L4 ladder with an
   artifact per rung (`RESEARCH-ROADMAP.md §8`). No metric, accuracy, or "shipped" is
   ever stated without the run that backs it (`_grounding.md` rules 2–3).

3. **Secure-by-default.** New surfaces **inherit** the platform's defaults; they do not
   opt out of them: fail-closed IPC + RBAC (`runtimeAuthz.ts`), backend-brokered PKCE,
   Ed25519 supply-chain signing, secure-by-default Electron, append-only audit. A
   privileged channel with no classification **cannot ship** (`assertAllChannelsClassified`).
   **HIGH security items gate GA** (TD-1, TD-2) — security is a release gate, never a
   backlog preference or a schedule trade.

4. **Honesty mandate.** The program states its true maturity — **Validated Release
   Candidate, not GA** — and never inflates it. No fabricated customer, metric, demand,
   or roadmap achievement (`_grounding.md` rules 1–3). A gap is **disclosed** — a
   Proposed item with an owner and a tracking ID — never papered over; a known limitation
   goes in the changelog rather than a silent omission (`RELEASE-OPERATIONS.md §2`).
   "Ready to ship" is the end of a checklist, never an assumption; empty-by-default beats
   seeded data that could be mistaken for real (`SEED_STORE_ON_BOOT=false`, PR-8
   eliminated).

5. **Backward-compatibility discipline.** Evolution respects the contract with existing
   deployments. **SemVer** is literal: additive `feat` is a MINOR; a breaking change is a
   **MAJOR** with migration notes and a deprecation announced **≥ 1 cycle ahead**
   (`RELEASE-GOVERNANCE.md §2`; `ROADMAP-GOVERNANCE.md §5`). The governed contract
   surfaces — the IPC channel map and the SDK/REST `ApiVersion` — are never broken
   silently. Database migrations are **forward-only**, with **data-side restore** (not
   schema un-apply) as the sanctioned recovery (ADR-001; `RELEASE-OPERATIONS.md §4`).
   Compatibility is broken **deliberately and announced**, or not at all.

> **Precedence.** When principles pull against each other, **honesty (4) and
> security (3) win** — NeuroPause ships _less_, labelled truthfully, before it ships
> _more_, labelled falsely or insecurely (`PRODUCT-STRATEGY.md §2`).

---

## 4. Long-term research opportunities (NSSP — Future Vision, no results claimed)

> These are the program's **honest open questions** (`RESEARCH-ROADMAP.md`) — everything
> the platform does **not** yet do. Each is **Future Vision (L0)**. **No result,
> accuracy, or proof is claimed:** a research item's presence here _is_ the claim that it
> is unbuilt. The intake / experiment / prototype machinery that would govern any of
> these lives in [`INNOVATION-MANAGEMENT.md`](INNOVATION-MANAGEMENT.md) — referenced, not
> restated.

| Research opportunity                                      | Nearest real surface **today** (cited)                                                                                                                                                                              | What would earn a claim (still L0)                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statistical prediction & predictive capacity planning** | Deterministic `capacityScheduler.ts` + `enterpriseDecisionEngine.ts`, wired at runtime (`runtimeCore.ts:1792`) — L2, rule-based, **not** forecasting                                                                | A forecasting component over the measured series (`bench/results/*.json`, `/metrics`, KPI outputs), a defined target/horizon, and a **hold-out evaluation (MAPE/MAE) recorded before any accuracy is stated** (`RESEARCH-ROADMAP.md §1–2`)                             |
| **Formal verification of invariants**                     | Strong **tested** invariants — `assertAllChannelsClassified` (`runtimeAuthz.ts`), Zod contract totality (`contracts.ts`), migration idempotency (`reliability.json`), RBAC coverage (`RUNTIME_CHANNEL_PERMISSIONS`) | A formal statement of a chosen invariant, a model/type-level encoding, and a checker producing a verifiable artifact — reported as _verified against model X_, **never an unqualified proof** (`RESEARCH-ROADMAP.md §5`)                                               |
| **Observability science**                                 | `/metrics` (L3), `/health`, append-only `audit_log`, provenance traces (`traceBuilders.ts`, L2) — signals exist; alerting/tracing do not                                                                            | Alert rules with measured **precision/recall on real incidents**, a distributed-tracing layer threaded through the request + IPC path, and a capacity baseline — the research is in **thresholds and detection quality**, not new telemetry (`RESEARCH-ROADMAP.md §4`) |
| **Desktop-hardware performance science**                  | Renderer perf telemetry **harness-ready** (`perfMetrics.ts`, `PerfSampler.tsx`, L2); engine hot-path bench recorded (L3)                                                                                            | Recorded artifacts across a **hardware matrix** with reported percentiles per device class — moves renderer metrics **L2 → L3** (`RESEARCH-ROADMAP.md §3`); its near-term seed is the 1.1.0 benchmark item                                                             |

> **The discipline.** Research graduates off this list **only** by climbing the ladder
> with a cited artifact — never by assertion. The honesty rule is absolute: **the
> program never claims a proof, a forecast accuracy, or a measured result it has not
> recorded** (`_grounding.md`; `RESEARCH-ROADMAP.md §8`). An item stays here — unbuilt
> and honestly labelled — until its research question is answered with evidence.

---

## Reading note

This is the **long-horizon** PERG artifact — the north-star view, not the operating
plan. Read it **with** its siblings: the committed board and its mechanics in
[`ROADMAP-GOVERNANCE.md`](ROADMAP-GOVERNANCE.md), the version and support policy in
[`RELEASE-GOVERNANCE.md`](RELEASE-GOVERNANCE.md), the strategy and decision framework in
[`PRODUCT-STRATEGY.md`](PRODUCT-STRATEGY.md), and the research machinery in
[`INNOVATION-MANAGEMENT.md`](INNOVATION-MANAGEMENT.md). Where this document and a sibling
overlap, the sibling owns the mechanics and this one owns the **forward view**. The four
labels are the throughline across all of them: **1.x is buildable and backlog-grounded;
2.x is Future Vision; research is L0 until an artifact says otherwise.**

---

## Provenance & scope

- **Real (cited):** the Validated-RC foundation (3,856 tests, build 0, 0 prod vulns,
  deployment + reliability gates) and the security primitives (PKCE/RFC 8252, Argon2id,
  Ed25519, fail-closed IPC); the seven open items with severities and dependency waves
  (`GOVERNANCE-MATRICES.md §2–4`; `CONTINUOUS-IMPROVEMENT.md §2`; `ENTERPRISE-GA-REPORT.md
§8` TD-1…TD-10); the SemVer/train version scheme (`RELEASE-OPERATIONS.md §1`,
  `RELEASE-GOVERNANCE.md §1–2`); the deterministic surfaces, modeled federation,
  single-region reality, absent i18n, and L0 prediction status
  (`PREDICTION.md`, `GLOBAL-SCALING.md`, `DISASTER-RECOVERY-GUIDE.md §7.1`); the NSSP
  research questions (`RESEARCH-ROADMAP.md`).
- **Governance (this document):** the SemVer version-line synthesis of the real backlog
  by dependency wave, the durable evolution principles, and the long-horizon 2.x /
  research view — **forward vision over the real substrate; no runtime, no architecture
  added.** Mechanics are deferred to the sibling PERG docs, not restated.
- **Future Vision / absent (honest):** live federation (modeled), multi-region
  (single-region today), i18n (absent), a forecasting engine (L0), telemetry-driven
  maturity (no fleet), and ecosystem growth — **each aspirational, uncommitted, and may
  never ship.**
- **No customer, demand, metric value, budget, date, or roadmap achievement is invented
  anywhere.** Roles, never people. Only `1.0.0-rc.1` has shipped; the platform is a
  **Validated Release Candidate**.
