# NeuroPause PERG — Prioritization Framework

> **What this is.** The **governance home of the prioritization engine**: how a
> proposal is admitted, **scored on real evidence**, ranked, and **committed to a
> governed roadmap wave** — and **which role decides at each gate.** It adds **no
> runtime and no platform**; it is factors, anchors, weighting policies, and decision
> rules over the **real** backlog.
>
> **Elevates, does not restate.** CDEP
> [`PRODUCT-EVOLUTION.md §2`](../pilots/PRODUCT-EVOLUTION.md) defined the rubric
> `P = (E × I × R) ÷ Effort` as an _execution_ loop; sibling governance docs then
> **consume** it — [`PRODUCT-STRATEGY.md §3`](PRODUCT-STRATEGY.md) names it as principle
> **P2**, [`ROADMAP-GOVERNANCE.md §1–2`](ROADMAP-GOVERNANCE.md) places its _rank_ on the
> board — but neither **defines** the scoring precisely enough to audit. This document
> is that definition: it **elevates the CDEP rubric into the governance scoring
> standard** (anchors reused **verbatim**) and adds the three weighting policies
> (customer-evidence, risk, business-impact) and the **commit-to-wave** decision gate.
> It does **not** re-derive the backlog, the waves
> ([`GOVERNANCE-MATRICES.md §4`](GOVERNANCE-MATRICES.md)), or the roadmap board.
>
> **Honesty banner (non-negotiable).** Evidence-based means **ranked by real
> evidence.** **No pilot has run**, so the top evidence tier is **empty** and every
> scored item currently caps at `E = 4` (§2.1, §3). The only scored backlog is the
> **seven real open items** from the GA/Validation registers
> ([`_grounding.md`](_grounding.md)); **no invented item, no fabricated demand, usage,
> revenue, or ARR** appears anywhere. The platform is a **Validated Release Candidate**
> (`1.0.0-rc.1`) — no GA, no customer, no fleet. Roles, never people.

---

## 1. Prioritization framework (the governance model)

Prioritization is a **four-gate pipeline**. An item that fails a gate is returned to
refinement, never advanced on preference. The pipeline is the scoring counterpart to
the roadmap board: it produces the **ranked, wave-committed** item that
`ROADMAP-GOVERNANCE.md §1` then places on a horizon.

### 1.1 The pipeline — intake → score → rank → commit

| Gate   | Step                 | Pass condition                                                                                                                                                                                            | Accountable role                                                                         |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **G1** | **Intake**           | A **real evidence link** is attached (bench JSON, reliability pass/fail, `audit_log` export, or a risk-register entry) — the admissibility gate (`PRODUCT-EVOLUTION.md §1.3`, `PRODUCT-STRATEGY.md §3.1`) | Roadmap owner (triage, weekly refinement)                                                |
| **G2** | **Score**            | `E`, `I`, `R`, `Effort` assigned **from the cited anchors** (§2.1); each score names its evidence                                                                                                         | Owning role proposes; domain lead reviews                                                |
| **G3** | **Rank**             | `P = (E×I×R) ÷ Effort` computed; the item takes its place in the ordered table (§2.3)                                                                                                                     | Mechanical — the formula; Lead maintainer breaks ties                                    |
| **G4** | **Commit to a wave** | Item placed in **W1 / W2 / W3** honoring the dependency edges in `GOVERNANCE-MATRICES.md §4` — **a prerequisite is committed ahead of its dependents regardless of `P`** (§1.3)                           | Roadmap owner commits; Lead maintainer signs off; Security response signs off HIGH items |

**G1 is the anti-fabrication gate.** No evidence link ⇒ the proposal is a hunch, logged
`needs-evidence` and returned, never scored — invented demand cannot buy priority with
assertion, which is what keeps it off the roadmap.

### 1.2 Who decides (scoring decision rights — roles, never people)

The roles below are the **existing** governance roles (`PRODUCT-STRATEGY.md §3.2`);
this document assigns them their **scoring-specific** responsibilities. It charters **no
new board.**

| Role / board                                                                                 | Prioritization responsibility                                                                  | Status                     |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| **Owning role** (per TD: Security eng · Release eng/DevEx · SRE/Ops · QA/Frontend · Product) | **Proposes** `E/I/R/Effort` for items in its domain, each with a cited artifact (G2)           | operating                  |
| **Roadmap owner** (a maintainer function)                                                    | Runs intake triage (G1), computes the rank (G3), and **commits the wave** (G4)                 | operating                  |
| **Lead maintainer(s)**                                                                       | Breaks score **ties**, ratifies the committed set, holds release go/no-go                      | operating                  |
| **Security response**                                                                        | **Signs off** closure of HIGH register items (TD-1, TD-2) before their score credits a GA-gate | operating                  |
| **Architecture Review Board (ARB)**                                                          | _Consulted_ when an item touches a public contract / new dependency (reuse-first review)       | **Proposed — not staffed** |

> The ARB is **Proposed — not staffed** and holds **no authority** until formally
> chartered (`PRODUCT-STRATEGY.md §3.2`; `COMMUNITY-GOVERNANCE.md §7–8`). Where this
> framework says "consult ARB," that consultation is _advisory_ today and becomes
> binding only on charter.

### 1.3 The commit-to-wave gate (the governance decision)

The rank (G3) orders intake by **leverage**; the commit (G4) is the governance act that
binds that order to the **governed roadmap**, and it is **dependency-first**:

- **Prerequisite beats priority.** Where a higher-`P` item depends on a lower-`P`
  prerequisite, the prerequisite is committed to the **earlier** wave. The **wave**,
  not the raw `P`, is what the Roadmap owner commits to (`PRODUCT-STRATEGY.md §3.4`
  rule 4; `PRODUCT-EVOLUTION.md §2.4`).
- **The dependency source is fixed.** Wave membership and its edges are the
  **Roadmap Dependency Matrix** (`GOVERNANCE-MATRICES.md §4`) — not re-litigated per
  meeting. §2.4 shows the two edges that currently reorder the raw `P` sequence.
- **HIGH security overrides schedule.** A HIGH item (TD-1, TD-2) cannot be deferred out
  of its GA-gating wave without a **written** Lead-maintainer + Security-response
  rationale (`PRODUCT-STRATEGY.md §3.4` rule 6).

### 1.4 Cadence — when the pipeline runs

The pipeline reuses the EOSP review loops (`CONTINUOUS-IMPROVEMENT.md §3`); it schedules
**no new meeting**:

- **Monthly improvement review** → re-run G2–G3 on new evidence; re-rank the table.
- **Quarterly reassessment / planning ritual** (`ROADMAP-GOVERNANCE.md §2`) → re-run
  G4; re-commit waves; read GA-readiness with Eng leadership.
- **A new pilot evidence artifact** is the _only_ event that can raise an item to
  `E = 5` (§3) or admit the first customer-driven proposal — it re-opens G1 for the
  currently-empty customer tier.

---

## 2. Scoring methodology

### 2.1 The four factors (ordinal anchors — elevated verbatim from CDEP §2.1)

Each factor is scored on a **defined ordinal anchor**, and **each score must cite the
evidence** that earns it. The anchors are reused exactly from `PRODUCT-EVOLUTION.md
§2.1` so the governance score and the pilot score are the same number.

| Factor                          | Question                                                               | Ordinal anchors (cite the evidence for each score)                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E — Evidence strength** (1–5) | How real is the evidence this is a genuine problem?                    | **5** = a **pilot evidence artifact** confirms it — _reserved; none exists (§3)_. **4** = named **HIGH** in the risk register (`GA §8`, PR register). **3** = a **GA-gating validation gap** ranked highest-leverage (`Val §10`). **2** = named **MEDIUM** / disclosed gap. **1** = secondary / also-tracked real item. **0** = no cited artifact ⇒ inadmissible (G1). |
| **I — Impact** (1–5)            | Blast radius if left unaddressed (qualitative — §5).                   | **5** = every deployment; **security-exposure / data-loss** class. **4** = every deployment; **trust/quality or botched-recovery** class. **3** = a **broad path** (desktop/macOS releases; observability). **2** = a **narrow path**. **1** = cosmetic.                                                                                                               |
| **R — Risk-reduction** (1–5)    | How much a **named** register risk / maturity blocker is retired (§4). | **5** = closes a strict **GA blocker** (open-HIGH, **unmitigated**). **4** = clears a GA-gating validation gap (`Val §10` exit bar). **3** = removes a domain blocker (Release/Ops → Defined, `CONTINUOUS-IMPROVEMENT.md §1`). **2** = partial — a **proven mitigation already exists**. **1** = marginal.                                                             |
| **Effort** (1–5, **divisor**)   | Relative implementation cost.                                          | **1** = localized (config / one seam). **2** = one subsystem, established pattern. **3** = one subsystem, new capability. **4** = **new infra / scarce resource** (mac runner, tracing stack). **5** = large / multi-part.                                                                                                                                             |

### 2.2 The formula

```
Priority   P  =  (E × I × R)  ÷  Effort
```

Higher `P` = commit sooner. `P` is a **ranking device, not a metric** — it carries no
unit and is never reported as a measurement. Ties break by the **dependency wave**
(§1.3), never by preference. A customer-driven proposal enters this table **only** once a
pilot gives it `E ≥ 1` from a real artifact (§3); until then it is unscored, not
zero-scored.

### 2.3 Worked scoring — the seven real open items

The rows below are the **actual** open items (`_grounding.md`; `CONTINUOUS-IMPROVEMENT.md
§2`), re-scored by this rubric. **Nothing is invented, added, or removed.** The **Wave**
column is the committed wave from the Roadmap Dependency Matrix
(`GOVERNANCE-MATRICES.md §4`); it is set at G4, _after_ the rank, and may differ from
pure `P` order (§2.4). Rows are listed in descending `P` (the rank), so the wave column
visibly diverges — that divergence is the governance gate working.

| Rank | Open item (real)                         | TD / risk            |  E  |  I  |  R  | Eff |  **P**   | **Wave** | Evidence cited                                           |
| ---- | ---------------------------------------- | -------------------- | :-: | :-: | :-: | :-: | :------: | :------: | -------------------------------------------------------- |
| 1    | Apple `id_token` **JWKS verification**   | TD-1 / PR-1 **HIGH** |  4  |  5  |  5  |  2  | **50.0** |  **W1**  | HIGH, `GA §8 TD-1`, `Val §9(1)`, `apple.ts:77`           |
| 2    | **Signed / trusted** marketplace install | TD-2 / PR-2 **HIGH** |  4  |  5  |  5  |  3  | **33.3** |  **W1**  | HIGH, `GA §8 TD-2`, `Val §9(2)`, `packageService.ts:184` |
| 3    | **Target-hardware** desktop benchmarks   | TD-7-adj / —         |  3  |  3  |  4  |  3  | **12.0** |  **W3**  | GA-gating gap, highest-leverage, `Val §10`, `GA §8(6)`   |
| 4    | **Per-PR desktop CI**                    | TD-4a / PR-4 Med     |  2  |  3  |  3  |  2  | **9.0**  |  **W1**  | MEDIUM, `GA §8 TD-4`, `Val §9(9)`                        |
| 5    | Automated, tested **update rollback**    | TD-5 / PR-7 High\*   |  2  |  4  |  2  |  3  | **5.3**  |  **W2**  | MEDIUM debt; PR-7 High **mitigated** (ADR-001)           |
| 6    | **macOS release automation**             | TD-4b / PR-5 Med     |  2  |  3  |  3  |  4  | **4.5**  |  **W2**  | MEDIUM, `GA §8 TD-4`, `Val §9(9)`                        |
| 7    | **Alerting + tracing + forecasting**     | TD-6 / PR-6 Med      |  2  |  3  |  3  |  4  | **4.5**  |  **W2**  | MEDIUM, `GA §8 TD-6`, `Val §9(11)`, folds PR-3           |

\* PR-7 ("botched update, no clean rollback") is **High** in the register, but a proven
mitigation exists (data-side restore, ADR-001), so `R = 2` — partial, not `5` (§4).

### 2.4 Rank → wave commitment (the two governed overrides)

Pure `P` order is `1 → 2 → 3 → 4 → 5 → 6 ≈ 7`. The committed waves are
**W1 {1, 2, 4} · W2 {5, 6, 7} · W3 {3}**. Two dependency edges in
`GOVERNANCE-MATRICES.md §4` reorder the raw sequence — this is exactly what G4 exists to
do:

- **Defer a high-`P` item.** Target-hardware benchmarks rank **3rd** (`P = 12.0`) but
  commit to **W3**, because §4 records their edge _"Depends on: macOS build (W2)"_ — you
  cannot benchmark on a signed Apple-Silicon artifact that does not exist yet. A
  high-leverage item waits behind its prerequisite.
- **Advance a lower-`P` item.** Per-PR desktop CI ranks **4th** (`P = 9.0`) but commits
  to **W1**, because §4 records both W2 items — macOS automation (TD-4b) and rollback
  (TD-5) — as _"Depends on: W1 CI."_ The desktop gate is a **root prerequisite**, so it
  is pulled forward ahead of higher-scored dependents.

**Intra-wave order** follows `P`: W1 = `1 → 2 → 4`; W2 = `5 (5.3) → 6 ≈ 7 (4.5)`, the
`6 ≈ 7` tie breaking to **macOS first** because it unblocks the W3 benchmarks (§4) while
alerting has no dependent — dependency, not preference. The result **reproduces the
Roadmap Dependency Matrix exactly**; critical path to GA: `W1 → W2 → GA cand. → W3 + pilot`.

---

## 3. Customer-evidence weighting

**Real pilot evidence outweighs internal assumption — structurally, not rhetorically.**
The evidence factor `E` is a tiered ladder whose **top rung is reserved exclusively for
a customer/pilot evidence artifact** (`E = 5`). Everything below is internal evidence:
the risk register (`E = 4`), a validation gap (`E = 3`), a MEDIUM (`E = 2`), a secondary
item (`E = 1`). Because `E` multiplies `P`, an item confirmed by a pilot artifact
**always outranks the same-shaped item scored on internal evidence alone**.

### 3.1 The customer-evidence tier is empty (the cap)

**No pilot has run** (`_grounding.md` rule 5; `PRODUCT-EVOLUTION.md §2.1`). Therefore:

- **`E = 5` is unattainable today.** Every one of the seven real items is internal, so
  each **caps at `E = 4`** — reached only by the two named HIGH items (TD-1, TD-2). This
  is the cap that makes "evidence-based" literal: **only a real customer signal can earn
  the top evidence score**, and none exists.
- **The customer-driven roadmap slot is blank.** The Roadmap Dependency Matrix carries
  an **8th** row — _"first customer pilot (CDEP)"_ (`GOVERNANCE-MATRICES.md §4`, W3) —
  that is **not** one of the seven scored items. It receives **no `P`** and holds no wave
  priority until a pilot supplies `E ≥ 1` from a filled CDEP intake artifact
  (`PRODUCT-EVOLUTION.md §1`). It is intentionally empty, not overlooked.

### 3.2 How the weighting will act once evidence exists (illustrative, not scored)

To show the ladder's effect **without inventing demand**: a customer-driven item a pilot
confirms at `E = 5` with, say, `I = 4`, `R = 4`, `Effort = 2` would score
`P = (5×4×4)÷2 = 40.0` — **above** every internal MEDIUM item and just below the HIGH
security pair. The _same_ item on internal evidence alone (`E = 4`) scores `32.0`; the
`5/4 = 1.25×` uplift _is_ the weighting — pilot evidence promotes an item roughly one
tier of urgency over an identical internal assumption. **These numbers illustrate the
mechanism only** — no such pilot item exists, so none is on the §2.3 table.

> **Invariant.** Until the customer tier is populated, the ranking in §2.3 is the
> complete, honest priority order. The framework does not _simulate_ customer demand to
> fill the gap; the gap stays visible.

---

## 4. Risk weighting

The `R` factor maps every scored item to the **real production-risk register** (**PR-1…PR-8**,
likelihood × impact; `_grounding.md`; `GOVERNANCE-MATRICES.md §2`) and **boosts HIGH-severity,
unmitigated** risks — `R` measures how much of a named register entry an item closes.

### 4.1 The PR-register map (real, cited)

| Scored item                | Retires risk                                           | PR severity | `R` earned | Why                                                                           |
| -------------------------- | ------------------------------------------------------ | ----------- | :--------: | ----------------------------------------------------------------------------- |
| TD-1 Apple JWKS            | **PR-1** forged Apple token                            | **HIGH**    |   **5**    | Strict GA blocker, **no** existing mitigation — full boost                    |
| TD-2 signed install        | **PR-2** malicious unsigned package                    | **HIGH**    |   **5**    | Strict GA blocker, integrity-hash-only today — full boost                     |
| TD-5 automated rollback    | **PR-7** botched update, no clean rollback             | **HIGH\***  |   **2**    | High risk **already mitigated** by data-side restore (ADR-001) — partial only |
| TD-4a per-PR desktop CI    | **PR-4** regression from no desktop CI                 | Med         |   **3**    | Removes the Release-domain blocker toward Defined                             |
| TD-4b macOS automation     | **PR-5** unsigned desktop build                        | Med         |   **3**    | Removes the signing/packaging blocker                                         |
| TD-6 alerting/tracing      | **PR-6** slow incident response (+ **PR-3** fail-open) | Med         |   **3**    | Removes the Ops manual-watch blocker; **folds two** PR entries                |
| Target-hardware benchmarks | _(no PR entry — validation gap)_                       | —           |   **4**    | Not a register risk; clears a **GA-gating validation gap** (`Val §10`)        |

### 4.2 The risk-reduction rule (the boost, and its honest limit)

- **HIGH + unmitigated → `R = 5` (the boost).** A HIGH register entry with no existing
  mitigation is a strict GA blocker; closing it earns the maximum risk-reduction score.
  Only **TD-1** and **TD-2** qualify — which is why they top the ranking.
- **HIGH + already-mitigated → discounted.** TD-5 maps to **PR-7 (High)**, but ADR-001
  established **data-side restore** as the _proven_ recovery path, so PR-7 is _mitigated,
  not closed_. Automating rollback retires only the **residual** risk ⇒ `R = 2`. The
  boost is conditional on **unmitigated** residual exposure; a High label alone does not
  buy a High `R`. This keeps the score honest and consistent with the CDEP scoring.
- **MEDIUM → `R = 3`** where the item removes a named domain blocker (Release/Ops →
  Defined); TD-6 additionally **folds PR-3's fail-open alert**, retiring two entries at once.
- **PR-8 is Eliminated** (`SEED_STORE_ON_BOOT=false`, fabricated-demo-data risk closed):
  it maps to **no open item** and needs no prioritization — cited for completeness only.

Net: the register **drives** the top of the ranking (the two HIGH-boosted items lead),
while the mitigation discount keeps a nominally-High-but-covered item from jumping the
queue on its label alone.

---

## 5. Business-impact weighting

**Impact is qualitative — reach × class-of-harm — never a currency.** The `I` factor
(§2.1) answers _"how bad, and how wide, if we do nothing?"_ in terms of **product and
trust outcomes**, and PERG assigns **no revenue, ARR, MRR, seat, or dollar figure** to
any backlog item — none exists to cite, and asserting one would violate `_grounding.md`
rules 2 and 4.

### 5.1 The impact dimensions (what `I` actually measures)

- **Reach** — deployments the harm touches: _every deployment_ (I ≥ 4) → _broad path_
  (I = 3) → _narrow path_ (I = 2) → _cosmetic_ (I = 1).
- **Class of harm** — the _kind_ of failure, by severity of consequence:
  **security-exposure / data-loss** (I = 5) > **trust/quality or botched-recovery**
  (I = 4) > **operability / release-quality** (I = 3).

Impact is thus a **product-risk statement**, not a market statement — deliberately
insulated from demand volume. A widely-_requested_ item earns urgency through the
**Evidence** factor (§3) once a pilot substantiates the request, **not** by inflating `I`.

### 5.2 Impact class of the seven real items (qualitative)

| Item                    | Reach            | Harm class                                            |  `I`  |
| ----------------------- | ---------------- | ----------------------------------------------------- | :---: |
| TD-1 Apple JWKS         | every deployment | **security exposure** (auth bypass on a forged token) | **5** |
| TD-2 signed install     | every deployment | **security exposure** (malicious package)             | **5** |
| TD-5 automated rollback | every deployment | **botched-recovery** (mitigated by restore, ADR-001)  | **4** |
| TD-7-adj benchmarks     | broad path       | client-tier performance baseline                      | **3** |
| TD-4a per-PR desktop CI | broad path       | release quality (regression surface)                  | **3** |
| TD-4b macOS automation  | broad path       | macOS release integrity                               | **3** |
| TD-6 alerting/tracing   | broad path       | operability (detection latency)                       | **3** |

The two `I = 5` rows (security-exposure class), with their HIGH `R` boost (§4), form the
head of the ranking. The single `I = 4` row (rollback, botched-recovery class) is
discounted on `R` because a proven mitigation exists — so high _impact_ does not, by
itself, carry it above the security pair. **No row cites a revenue or adoption figure;
impact is stated as harm class and reach only.**

---

## Provenance & scope

- **Real (cited):** the seven open items, severities, owning roles, and dependency waves
  (`GOVERNANCE-MATRICES.md §2–4`; `CONTINUOUS-IMPROVEMENT.md §2`; `GA §8 TD-1…TD-6`;
  `Val §9`, `§10`); the PR-1…PR-8 register and PR-8's elimination
  (`_grounding.md`); ADR-001's proven data-side restore (`PRODUCT-EVOLUTION.md §4.2`);
  the existing decision roles (`PRODUCT-STRATEGY.md §3.2`) and review cadence
  (`CONTINUOUS-IMPROVEMENT.md §3`).
- **Elevated (this document):** the CDEP rubric anchors reused **verbatim** as the
  governance scoring standard (`PRODUCT-EVOLUTION.md §2.1`), the four-gate
  intake→score→rank→commit pipeline, the commit-to-wave decision gate, and the three
  weighting policies — customer-evidence, risk, business-impact. **Process over the real
  substrate; no runtime added.**
- **Blank / absent (honest):** the entire **customer-evidence tier** (`E = 5`) and the
  customer-driven roadmap slot — **no pilot has run**, so every scored item caps at
  `E = 4`; all frequency counts; **every revenue, ARR, adoption, or usage figure.** The
  seven real open items are the _only_ scored rows; the ranking is consistent with the
  Roadmap Dependency Matrix. The platform is a **Validated Release Candidate**
  (`1.0.0-rc.1`). Roles, never people.
