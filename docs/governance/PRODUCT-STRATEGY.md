# NeuroPause PERG — Product Strategy & Evolution Governance

> **What this is.** The **product-strategy charter** of the Product Evolution &
> Release Governance Program (PERG): the standing vision, the product principles, the
> decision framework, the feature-acceptance law, and the innovation intake that
> govern how NeuroPause _evolves_ after GA. It is **governance, not engineering** — it
> **adds no runtime and no architecture.** It **activates at GA**; today it governs the
> **real backlog** (the seven open items) and the registers in
> [`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md).
>
> **Elevates, does not restate.** The evidence-scoring rubric and ADR machinery are
> owned by CDEP [`PRODUCT-EVOLUTION.md`](../pilots/PRODUCT-EVOLUTION.md); the backlog,
> waves, and maturity model by EOSP
> [`CONTINUOUS-IMPROVEMENT.md`](../operations/CONTINUOUS-IMPROVEMENT.md); the RFC /
> roles / release-gate machinery by [`GOVERNANCE.md`](../../GOVERNANCE.md) +
> [`COMMUNITY-GOVERNANCE.md`](../adoption/COMMUNITY-GOVERNANCE.md); the research intake
> by NSSP [`RESEARCH-ROADMAP.md`](../science/manuals/RESEARCH-ROADMAP.md). This
> document **references** them and adds the strategy layer on top; it does not
> re-derive them.
>
> **Honesty banner (non-negotiable).** The platform is a **Validated Release
> Candidate** (`1.0.0-rc.1`). **No GA, no post-GA release, no customer, no production
> fleet, no adoption exists.** Every capability below carries exactly one label —
> **Implemented** (runs today, cited) · **Validated** (verified by gates/tests/benches)
> · **Proposed** (committed, near-term, backlog-grounded) · **Future Vision**
> (aspirational, uncommitted, no timeline). **No traction, metric, customer, or
> roadmap achievement is invented.** Roles and boards, never named people.

---

## 1. Vision evolution

The standing vision is fixed; what moves is the **evidence label** on each thread of
it. NeuroPause is an **AI Operating Layer for the desktop** — a native macOS workspace
for **discovering, launching, connecting, and remembering** your AI tools; _not a
chatbot_ ([`README.md`](../../README.md)). That sentence is a **product invariant**: it
changes only by a superseding ADR (§3), never by drift.

### 1.1 Vision realized vs. vision proposed (honest, no invented traction)

Each pillar of the vision maps to a real surface at its **honest** state and a
**governed next direction** — never to an adoption or demand claim.

| Vision pillar (README verb)             | What it means                             | State today                 | Evidence                                                              | Governed direction                                                                                   |
| --------------------------------------- | ----------------------------------------- | --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Discover** — a place to find AI tools | Marketplace / package catalog             | **Implemented**             | pipeline runs; catalog ships **empty** (`SEED_STORE_ON_BOOT=false`)   | **Proposed:** signed-install trust (TD-2, High)                                                      |
| **Launch** — run & host tools           | Desktop runtime (Electron + renderer)     | **Validated**               | 3,856 tests, build 0, EVP measured                                    | **Proposed:** per-PR desktop CI + macOS release automation (TD-4)                                    |
| **Connect** — link accounts & tools     | OAuth/PKCE + connectors                   | **Validated / Proposed**    | PKCE (RFC 8252) validated; Apple JWKS **Proposed** (TD-1, High)       | **Proposed:** close TD-1; **Future Vision:** live multi-connector execution proof (needs live creds) |
| **Remember** — where AI work lives      | Intelligence / memory / knowledge engines | **Implemented / Validated** | engines wired; deterministic engine bench recorded (`bench/results/`) | **Future Vision:** statistical forecasting engine (NSSP L0 — none exists)                            |
| **Operating layer** — cross-org fabric  | Federation, multi-region, i18n            | **Future Vision**           | modeled only                                                          | design when a real requirement demands it (2.x)                                                      |

### 1.2 How the vision is measured (the anti-traction rule)

- **Vision progress = capability maturity, never adoption.** Advancement is a label
  moving up the four-way ladder (Proposed → Validated) with a citation — **not** a
  user, revenue, or customer number. No such number exists; asserting one is
  fabrication (`_grounding.md` rules 1–2).
- **1.x is buildable; 2.x is Future Vision.** Anything on the near-term line is
  Implemented / Validated / Proposed and backlog-grounded. Federation, multi-region /
  i18n, and forecasting are **Future Vision** — carried without a timeline until real
  evidence grounds them (§5).
- **The RC→GA gate is the next real milestone**, not a market event: it is gated on
  closing TD-1 and TD-2 (both High) plus release-engineering TD-4
  ([`GOVERNANCE-MATRICES.md` §2](GOVERNANCE-MATRICES.md)).

---

## 2. Product principles

Five principles, each **derived from a load-bearing choice already in the platform**
and each paired with an **actionable governing rule** — not a slogan.

| #      | Principle                                  | The real load-bearing choice                                                                                                                               | Evidence (label)                                                                          | The governing rule (actionable)                                                                                                                               |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | **Authenticity — no fabrication**          | Catalog ships empty; seed tests assert empty; demo-data risk (PR-8) eliminated                                                                             | `SEED_STORE_ON_BOOT=false` (**Implemented**)                                              | Any claim/roadmap row without a four-way label **and** a citation for Implemented/Validated is **rejected**. No customer, metric, or "shipped" without proof. |
| **P2** | **Evidence-based**                         | Priority is scored, not argued: `P=(E×I×R)÷Effort`; `E=5` reserved for a pilot artifact that does not exist                                                | CDEP rubric (**Implemented** as process)                                                  | No item enters the roadmap without a **cited evidence artifact** (admissibility gate, §3). A hunch is `needs-evidence` and returned.                          |
| **P3** | **Secure-by-default**                      | Context isolation, sandbox, allow-listed + Zod-validated IPC, backend-brokered PKCE, Argon2id, SHA-256 refresh rotation + reuse detection, Ed25519 signing | **Validated** (0 prod npm-audit vulns; tests)                                             | Security-relevant change requires an **RFC + security-owner review**; open **HIGH** items (TD-1, TD-2) are **GA blockers**, not options.                      |
| **P4** | **Reuse-only — no duplicate architecture** | Every prior program "adds no runtime and no architecture"; map to existing systems, never redesign                                                         | governance discipline (**Implemented** as practice)                                       | A new idea must **map to an existing surface** or enter as research (§5). Duplicating a capability that already exists is refused at RFC / ARB review.        |
| **P5** | **Offline-capable**                        | Local Postgres + Redis; offline deployment manifests validated; offline bundle harness exists                                                              | **Validated** (kubeconform strict + shellcheck); bundle transfer **Proposed** (Val §9(6)) | No feature may **hard-require an external SaaS** with no offline or degraded path. Honest `/health` degradation is the sanctioned pattern, not faked success. |

> **Principle precedence.** When two principles pull against each other, **P1
> (authenticity) and P3 (security) win** — the platform will ship _less_, labelled
> honestly, before it ships _more_, labelled falsely or insecurely.

---

## 3. Decision framework

How a product decision is actually made: what evidence it needs, who decides, and
whether it is a **one-way (irreversible)** or **two-way (reversible)** door. This layer
sits over the real RFC / lazy-consensus / lead-maintainer machinery
([`GOVERNANCE.md`](../../GOVERNANCE.md)) — it does not replace it.

### 3.1 Evidence bar (the admissibility gate)

Every decision starts with an **evidence link** (a bench JSON, a reliability
pass/fail, an `audit_log` export, a risk-register entry, or a pilot artifact) and a
**four-way label**. **No link ⇒ inadmissible** — logged `needs-evidence` and returned,
never scored. This is the same discipline as CDEP intake
([`PRODUCT-EVOLUTION.md` §1.3](../pilots/PRODUCT-EVOLUTION.md)).

### 3.2 Who decides (roles / boards — never people)

| Role / board                              | Decides                                                 | Status                     |
| ----------------------------------------- | ------------------------------------------------------- | -------------------------- |
| **Code owner / Maintainer**               | Routine changes in their path by lazy consensus         | operating                  |
| **Roadmap owner** (a maintainer function) | Horizon placement of admitted, scored items             | operating                  |
| **Lead maintainer(s)**                    | Ties, one-way doors, release go/no-go, governance/gates | operating                  |
| **Security response**                     | Security-relevant behaviour; HIGH-item closure sign-off | operating                  |
| **Architecture Review Board (ARB)**       | Reuse-first review of new architecture / dependencies   | **Proposed — not staffed** |
| **Advisory board / working groups**       | Non-binding strategic input                             | **Proposed — not staffed** |

> Proposed bodies hold **no authority** and make **no decisions** until formally
> chartered ([`COMMUNITY-GOVERNANCE.md` §7–8](../adoption/COMMUNITY-GOVERNANCE.md)).

### 3.3 Decision classes — reversible vs. irreversible

| Decision class                                  | Door                                  | Evidence bar                                    | Decides                                  | Recorded as                  |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------------------- | ---------------------------------------- | ---------------------------- |
| Routine (bug, docs, test, config)               | **Two-way**                           | green gates                                     | Code owner (lazy consensus)              | PR + CHANGELOG               |
| Feature scope / roadmap sequencing              | **Two-way**                           | admitted intake + `P` score                     | Code owners + roadmap owner; ties → lead | RFC (if triggered) + horizon |
| Data-model / DB migration                       | **One-way** (forward-only migrations) | RFC + migration review                          | Lead maintainer + code owner             | RFC + **ADR**                |
| Security / trust behaviour (auth, IPC, signing) | **One-way**                           | RFC + security-owner review; HIGH = GA blocker  | Security response + lead                 | RFC + **ADR**                |
| Public API / SDK / CLI contract                 | **One-way** (SemVer)                  | RFC + deprecation plan                          | Lead maintainer(s)                       | RFC + **ADR** + CHANGELOG    |
| New architecture / runtime dependency           | **One-way**                           | RFC + **reuse-first test** (§5) + ARB review    | Lead / ARB _(proposed)_                  | RFC + **ADR**                |
| Governance / gates / licensing                  | **One-way**                           | lead-maintainer approval (licensing unresolved) | Lead maintainer(s)                       | governance PR                |

### 3.4 Decision rules

1. **No evidence, no decision.** The admissibility gate (§3.1) runs first; an
   un-cited proposal is returned, not debated.
2. **Reversibility sets the bar.** A **two-way** door moves by lazy consensus; a
   **one-way** door needs RFC + **ADR** + lead-maintainer sign-off. **When unsure,
   treat it as one-way.**
3. **Rank, don't argue.** Competing items are ordered by `P=(E×I×R)÷Effort`
   ([CDEP §2](../pilots/PRODUCT-EVOLUTION.md)); ties break by the **EOSP dependency
   wave**, never by preference.
4. **Prerequisite beats priority.** A lower-`P` _prerequisite_ is sequenced before its
   dependents (e.g. desktop CI before rollback automation), regardless of score.
5. **Write it down, immutably.** Every one-way decision is a Michael-Nygard **ADR**;
   change is a **new superseding ADR** (per ADR-001), never an edit.
6. **HIGH security overrides schedule.** TD-1 and TD-2 gate GA; no override without a
   **written** lead-maintainer + security-owner rationale.

---

## 4. Feature philosophy

A feature is not "done" because it runs. It is done when it **passes the real gate
wall** _and_ is **honestly labelled**. Maturity is never overstated beyond **Validated
Release Candidate**.

### 4.1 The acceptance bar (real gates)

| Gate                                   | Requirement                                   | Label on pass | Blocking?                      |
| -------------------------------------- | --------------------------------------------- | ------------- | ------------------------------ |
| Typecheck / lint                       | 0 errors, `--max-warnings 0`                  | Implemented   | **Yes**                        |
| Tests                                  | full workspace suite green (3,856 today)      | Validated     | **Yes**                        |
| Build                                  | production build 0                            | Implemented   | **Yes**                        |
| Production vulns                       | `npm audit --omit=dev` = 0                    | Validated     | **Yes**                        |
| Deploy artifacts (if touched)          | kubeconform strict + shellcheck               | Validated     | **Yes**                        |
| **Honesty gate**                       | four-way label + citation; no fabricated data | —             | **Yes — a product law (§4.2)** |
| Security review (if security-relevant) | security-owner sign-off                       | —             | **Yes**                        |

CI enforces the code gates (`backend-ci.yml`, `deploy-validation.yml`,
`windows-release.yml`); the honesty gate is enforced in review. **Nothing merges red.**

### 4.2 "No fabricated data" — the product law

The strongest acceptance rule, and it is **already law in code**: the store catalog
ships **empty** and seed tests **assert** it is empty (`SEED_STORE_ON_BOOT=false`; risk
PR-8 **eliminated**). Therefore:

1. **No feature may ship demo, sample, or seeded data that could be mistaken for real**
   — empty-by-default is the pattern, not a nicety.
2. **A KPI is a definition + telemetry source, never a value.** Product analytics wire
   to the real substrate (`/metrics`, `/health`, `audit_log`); no usage, revenue, or
   adoption figure is displayed until real telemetry produces it.
3. **Honest degradation over false success.** A feature that cannot complete reports it
   truthfully (the `/health` `degraded` pattern) rather than faking a result.
4. **No overstatement of maturity.** Nothing is shown as GA, Proven, or Certified until
   it is; every capability carries its honest four-way label.

### 4.3 Feature rules

- **Green-in-CI is the only "done" bar** — the gate wall owned by DevEx, referenced
  here, not re-litigated per feature.
- **Reject on any red gate or any missing/false label** — an unlabelled or
  over-claimed feature is returned, exactly like an un-cited decision (§3.1).
- **Security-relevant features carry security review**; HIGH open items block GA.

---

## 5. Innovation guidelines

How a new idea enters **without breaking the reuse-only / no-duplicate-architecture
discipline (P4)**. Innovation is welcome; **duplicate architecture is not.**

### 5.1 Two lanes

| Lane                         | For                                                                     | Machinery                                                                                                                    | Exit                                       |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Product-enhancement lane** | Buildable work grounded in a cited artifact                             | CDEP intake + `P` rubric → RFC → gates ([CDEP](../pilots/PRODUCT-EVOLUTION.md))                                              | ships **Implemented/Validated**            |
| **Research lane**            | Speculative ideas (forecasting, formal verification, new observability) | NSSP research roadmap; climbs the **L0→L4** ladder with a citation per rung ([NSSP](../science/manuals/RESEARCH-ROADMAP.md)) | graduates by **evidence**, never assertion |

An idea with a real artifact takes the product lane; an idea without one takes the
research lane at **L0 (Future Vision)** — it is **never** dropped straight onto the
committed roadmap.

### 5.2 The reuse-first test (the P4 guardrail)

Before any new surface, subsystem, or runtime dependency, the proposer must show, in
the RFC, that **no existing surface covers it** — mapping to the real inventory
(1,925 shared types; existing engines, connectors, telemetry). If an existing surface
covers it, the idea is **reshaped to reuse it**. Only a demonstrated reuse-failure
justifies new architecture, and that requires **ARB review + an ADR** (§3).

### 5.3 Innovation gate

| Stage          | Question it must answer                                           | Gate                    | Label on exit               |
| -------------- | ----------------------------------------------------------------- | ----------------------- | --------------------------- |
| **Frame**      | What problem, for which persona/segment? (never a named customer) | issue filed             | —                           |
| **Admit**      | Is there a cited artifact, or is it a research question?          | admissibility (§3.1)    | Proposed _or_ Future Vision |
| **Reuse-test** | Does an existing surface already cover this?                      | reuse-first test (§5.2) | reshaped or escalated       |
| **Decide**     | One-way or two-way? Who signs?                                    | decision framework (§3) | RFC / ADR                   |
| **Prove**      | Does it pass the gate wall + honesty gate?                        | feature bar (§4)        | Implemented → Validated     |

### 5.4 Innovation rules

1. **Reuse before build.** Map to an existing surface first; a duplicate of an existing
   capability is rejected at RFC / ARB.
2. **Evidence or research — never both-none.** A buildable idea needs a cited artifact;
   a speculative one enters the research roadmap at L0. Nothing skips the gate.
3. **Climb the ladder, don't leap it.** A research item graduates L0→L1→L2→L3→L4 with a
   citation at each rung; **no accuracy, benchmark, or capability is claimed before its
   artifact exists.**
4. **Future Vision stays uncommitted.** Federation, multi-region / i18n, and
   forecasting carry **no timeline**; they enter the committed (1.x) roadmap only when
   real evidence grounds them.
5. **New architecture = reuse-first RFC + ARB + ADR.** A genuinely new subsystem or
   dependency is a one-way door and is recorded as such.

---

## Provenance & scope

- **Real (cited):** the vision statement and pillars ([`README.md`](../../README.md));
  the empty-catalog law (`SEED_STORE_ON_BOOT=false`, PR-8 eliminated); the quality
  baseline (typecheck/lint 0, 3,856 tests, build 0, 0 prod vulns) and CI workflows; the
  security primitives (PKCE/RFC 8252, Argon2id, Ed25519, SHA-256 rotation); the open
  registers TD-1…TD-10 / PR-1…PR-8 and the seven governed open items
  ([`GOVERNANCE-MATRICES.md`](GOVERNANCE-MATRICES.md)); the `P=(E×I×R)÷Effort` rubric and
  ADR machinery ([CDEP](../pilots/PRODUCT-EVOLUTION.md)); the RFC / roles / release gate
  ([`GOVERNANCE.md`](../../GOVERNANCE.md), [`COMMUNITY-GOVERNANCE.md`](../adoption/COMMUNITY-GOVERNANCE.md));
  the L0–L4 ladder and research questions ([NSSP](../science/manuals/RESEARCH-ROADMAP.md)).
- **Defined (this document):** the vision-to-evidence mapping, the five product
  principles and their governing rules, the decision-class / reversibility table and
  rules, the feature-acceptance law, and the two-lane innovation intake — **strategy
  governance over the real substrate; no runtime, no architecture added.**
- **Proposed / Future Vision (honest):** the RC→GA gate closure (TD-1, TD-2, TD-4); the
  ARB, advisory board, and working groups (**not staffed**); federation, multi-region /
  i18n, and the statistical forecasting engine (**no timeline, no code**). **No GA,
  customer, adoption figure, metric value, or roadmap achievement is asserted anywhere.**
  Roles and boards, never people.
