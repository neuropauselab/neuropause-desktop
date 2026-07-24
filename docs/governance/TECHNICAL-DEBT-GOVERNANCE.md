# NeuroPause PERG — Technical Debt Governance

> **What this is.** The **governance manual for NeuroPause's technical-debt register**:
> how each real debt item is classified, triaged, scheduled into a dependency wave,
> remediated, verified, and **retired** — and who (by role) approves each transition.
> It **adds no runtime and no architecture.** It is a taxonomy, a lifecycle, approval
> roles, an architecture-review trigger, and a retirement policy laid over the **real**
> GA debt register.
>
> **Honesty banner (non-negotiable).** The platform is a **Validated Release Candidate**
> (`1.0.0-rc.1`) — **no GA, no post-GA release, no production fleet.** The register below
> **is** the real GA debt matrix (`ENTERPRISE-GA-REPORT.md §4`, TD-1…TD-10) — **severities
> and file citations verbatim.** No debt item is invented; no remediation date, velocity,
> or completion metric is asserted (none exists to cite). Every remediation ties to a
> **real file or a named gap.** Sequence encodes **dependency**, not schedule.
>
> **Elevate, do not restate.** This document builds **on** EOSP
> `docs/operations/CONTINUOUS-IMPROVEMENT.md` (the improvement backlog, wave sequencing,
> and weekly/monthly/quarterly cadences — the _engine_ that runs this workflow) and on
> `GOVERNANCE-MATRICES.md §3–§4` (the governed register and roadmap-dependency waves).
> It adds the **governance layer** EOSP does not: the debt **taxonomy**, the register
> **state machine** with approving roles, the **ARB-review** trigger, and the per-class
> **definition-of-done / retirement** policy. It references those docs; it does not repeat
> them. Roles, never people.

---

## 1. Debt taxonomy

Every register item carries exactly one **category**. The six categories below partition
the real TD-1…TD-10 with no remainder and no overlap. A category fixes the **review lens**
(§3), the **owning role**, and the **definition-of-done** (§5) for its members.

| Category                 | What it governs                                                             | Owning role         | Definition-of-done lens (§5)                                        |
| ------------------------ | --------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| **security**             | Auth/integrity/crypto controls that gate identity, supply-chain, or trust   | Security            | negative case proven refused (unsigned/forged) or review documented |
| **reliability**          | Availability, recovery/DR, and the observability that makes failure visible | SRE                 | control is observable/recoverable — alert fires or drill passes     |
| **test/quality**         | Coverage gaps in the tested surface (interaction/a11y/coverage instrument)  | QA                  | missing suite exists **and** is gated green in CI                   |
| **release-engineering**  | CI gating and release/packaging automation                                  | DevEx / Release eng | workflow runs green in CI                                           |
| **performance**          | Client/server resource budgets measured against a declared limit            | Frontend            | measured artifact under a stated budget                             |
| **product-completeness** | Surfaced coverage of an already-complete backend model                      | Product             | UI coverage matches the backend model                               |

### Classification of the real register (TD-1…TD-10 → category)

Severities are **verbatim** from `ENTERPRISE-GA-REPORT.md §4`. Owning roles are consistent
with `GOVERNANCE-MATRICES.md §3`.

| ID        | Debt item (real)                                            | Category             | Severity    | Owning role |
| --------- | ----------------------------------------------------------- | -------------------- | ----------- | ----------- |
| **TD-1**  | Apple `id_token` decoded, signature not verified vs JWKS    | security             | **High**    | Security    |
| **TD-2**  | Marketplace app install skips signature check when unsigned | security             | **High**    | Security    |
| **TD-3**  | Rate limiter fails open when Redis unavailable              | reliability          | **Medium**  | SRE         |
| **TD-4**  | No per-PR desktop CI; no macOS release automation           | release-engineering  | **Medium**  | DevEx       |
| **TD-5**  | Update rollback advisory-only; federation DR modeled        | reliability          | **Medium**  | SRE         |
| **TD-6**  | No alert routing, tracing, or capacity forecasting          | reliability          | **Medium**  | SRE         |
| **TD-7**  | Renderer component/E2E/a11y absent; no coverage instrument  | test/quality         | **Medium**  | QA          |
| **TD-8**  | Largest renderer chunk 930 KB                               | performance          | **Low–Med** | Frontend    |
| **TD-9**  | Some admin scopes surfaced in UI partially                  | product-completeness | **Low**     | Product     |
| **TD-10** | FNV-1a used where a crypto hash may be expected (one path)  | security             | **Low**     | Security    |

**Distribution:** security ×3 (TD-1, TD-2, TD-10) · reliability ×3 (TD-3, TD-5, TD-6) ·
release-engineering ×1 (TD-4) · test/quality ×1 (TD-7) · performance ×1 (TD-8) ·
product-completeness ×1 (TD-9). All ten classified; every category represented.

> **Note on TD-3.** The rate-limiter fail-open is a **deliberate availability-over-strictness
> design** (`rateLimit.ts:37`), not a defect. Its remediation is **observability, not a
> code fix** — surface it as an alert. It is therefore classified **reliability** and folds
> into TD-6's alerting work, consistent with `GOVERNANCE-MATRICES.md §3` and EOSP §2.

---

## 2. Remediation workflow

A debt item moves through six governed states. Each transition has an **approving role**
and a **required evidence**; no item advances on assertion alone. The cadences that execute
these transitions are the **EOSP loops** (`CONTINUOUS-IMPROVEMENT.md §3`) — this document
governs _what_ each transition requires, not _when_ the meeting sits.

### Lifecycle states

```
Registered ─▶ Triaged ─▶ Scheduled ─▶ In-remediation ─▶ Verified ─▶ Retired
  (real         (category,   (wave +      (fix against      (test/gate   (archived;
   report        severity,    dependency;  the cited file    green =       register
   only)         owner)       ARB if       / named gap)      the rule)     shrinks)
                              triggered §3)
```

### State-transition governance

| Transition                     | Approving role                                                              | Evidence required to advance                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **→ Registered**               | Weekly ops retro owner (on-call / SRE lead)                                 | Item cites a **real** source report (GA §4 / Val §9). No invented items.                                           |
| **Registered → Triaged**       | Owning-role lead (§1)                                                       | Category assigned; **severity inherited verbatim** from GA — never re-graded up without new evidence.              |
| **Triaged → Scheduled**        | Monthly improvement review owner (Eng/Ops lead); Release eng for sequencing | A dependency **wave** (W1–W3, §4) that respects prerequisites. **ARB decision if the item meets a §3 trigger.**    |
| **Scheduled → In-remediation** | Owning-role lead                                                            | Work targets the **cited file / named gap**; for ARB-flagged items, an approved RFC/ARB record precedes any merge. |
| **In-remediation → Verified**  | Owning-role lead **+ CI gate**; Security lead co-signs HIGH items           | The **verified-fix rule** below is satisfied.                                                                      |
| **Verified → Retired**         | Quarterly maturity reassessment (Eng leadership + domain leads)             | Validated evidence on file; item archived to the changelog and removed from the active register.                   |

### The verified-fix rule (the core of debt governance)

> **A debt item is retired only when its fix is _Validated_ — proven by an executed test
> or a passing CI gate that exercises the exact failure the item names.** Concretely: an
> unsigned install is _refused_ by a test (TD-2), a forged token is _rejected_ by a test
> (TD-1), an alert _fires_ on the real signal (TD-3/TD-6), a rollback _drill passes_ (TD-5),
> the renderer suite is _present and gated_ (TD-7), the chunk is _measured under budget_
> (TD-8). A merged PR, a passed code review, or stated intent is **not** retirement.

This elevates the four-way evidence split (`_grounding.md`): remediation moves an item from
**Proposed → Validated**, never merely to an unlabelled "done." It also elevates EOSP's rule
that a fix is credited "**only when it removes a named blocker**" (`CONTINUOUS-IMPROVEMENT.md
§2`) from a maturity-lift rule to a **register-retirement** rule. The GA exit bar is the same
gate written large: _"when items are closed **and green in CI**"_ (`ENTERPRISE-GA-REPORT.md §8`).

### Severity discipline

Severity is **inherited from the GA matrix and is immutable upward without new evidence** — a
Medium item is not promoted to High to jump a queue, and a High item is not quietly downgraded
to duck a GA gate. Only the **two HIGH security items (TD-1, TD-2)** are strict GA blockers
(`GOVERNANCE-MATRICES.md §2`); Medium items are hardening, and Low items are opportunistic.

---

## 3. Architecture review

Most debt remediation is **local** and proceeds by lazy consensus under the owning role
(mirroring `GOVERNANCE.md` "default: lazy consensus"). Some remediation changes a **boundary,
contract, dependency, or security-relevant behaviour** — those require **Architecture Review
Board (ARB)** review before merge, governed by the sibling PERG doc
[`ARCHITECTURE-STEWARDSHIP.md`](ARCHITECTURE-STEWARDSHIP.md) (which elevates the GEAP RFC
process into architecture stewardship).

### When a debt item needs ARB review

An item is flagged for ARB at the **Triaged → Scheduled** transition (§2) if its remediation
meets any trigger below — the same class of change that requires an RFC in `GOVERNANCE.md`
(new surfaces, dependencies, schema, security-relevant behaviour, cross-cutting):

| Trigger                                             | Real items it catches                                                              | Why ARB                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Adds/changes a **security-relevant control**        | **TD-1**, **TD-2**, **TD-10** (if the path proves security-relevant)               | Changes the identity/trust surface — must not weaken defense-in-depth |
| Adds an **external dependency / integration**       | **TD-1** (`jose`/JWKS client → Apple)                                              | New coupling must stay _Controlled_, not silently faked               |
| **Cross-cutting** reliability/observability surface | **TD-5** (rollback across release+DR), **TD-6** (tracing/alerting across services) | Touches multiple boundaries; changes the operational contract         |
| Local — **no** boundary/contract change             | **TD-3**, **TD-4**, **TD-7**, **TD-8**, **TD-9**                                   | Owning-role review + CI gate suffices; no ARB                         |

### The review lens — GA Architecture Health dimensions

ARB reviews a flagged remediation against the ten **Architecture Health** dimensions
(`ENTERPRISE-GA-REPORT.md §6`). The governing rule: **a remediation must not regress any
dimension currently rated _Strong_, and should lift a dimension currently rated _Gap_ /
_Adequate-incomplete_.**

| Health dimension                                        | Current GA rating                      | Debt remediation acting on it                  | ARB expectation                                |
| ------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Security architecture                                   | **Strong, 2 open items**               | TD-1, TD-2 close the two items; TD-10 reviewed | lift toward _Strong, 0 open_; never regress    |
| Observability                                           | **Adequate, incomplete**               | TD-6 (+ TD-3 alert)                            | lift toward _Adequate → complete_              |
| Test architecture                                       | **Strong (logic) / Gap (UI)**          | TD-7 renderer/a11y/coverage                    | lift the UI **Gap**                            |
| Deployability                                           | **Strong (server) / Gap (desktop CI)** | TD-4 desktop+mac CI; TD-5 rollback             | lift the desktop-CI **Gap**                    |
| Modularity / boundaries                                 | **Strong**                             | TD-8 route-split; TD-1 adds `jose`             | must **not** regress the clean workspace split |
| Coupling to external systems                            | **Controlled**                         | TD-1 (Apple JWKS)                              | new coupling stays labelled + Controlled       |
| Type safety · Reuse · Data authenticity · Documentation | **Strong**                             | (no open item degrades these)                  | hold the line — regression blocks merge        |

An ARB record (RFC outcome) is the **evidence** attached to the Scheduled→In-remediation
transition for flagged items; without it, the item cannot advance to merge.

---

## 4. Debt register (governed)

The real GA register, TD-1…TD-10, as the single governed table — **severities and file
citations verbatim** from `ENTERPRISE-GA-REPORT.md §4`; categories from §1; remediation and
retirement criteria from `GOVERNANCE-MATRICES.md §3`; waves from `GOVERNANCE-MATRICES.md §4`.
Every register item is **Proposed** (committed, near-term, backlog-grounded) until its
retirement criterion is Validated.

| ID        | Category             | Severity    | File / location (verbatim)                                   | Remediation (ties to real file/gap)                                                                                 | Retirement criterion                                  | Wave                                   |
| --------- | -------------------- | ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| **TD-1**  | security             | **High**    | `apps/backend/src/auth/providers/apple.ts:14-16,77`          | Verify `id_token` vs Apple JWKS (add `jose`/JWKS client; seam + `HARDENING TODO` already present)                   | Signature verified **+ test** (forged token rejected) | **W1**                                 |
| **TD-2**  | security             | **High**    | `apps/desktop/src/main/nps/packageService.ts:184`            | Require valid signature or non-empty publisher trust store; align with fail-closed worker path                      | Unsigned install **refused + test**                   | **W1**                                 |
| **TD-3**  | reliability          | **Medium**  | `apps/backend/src/middleware/rateLimit.ts:37`                | Deliberate fail-open — make it **alertable** (folds into TD-6), do not "fix" the design                             | Alert wired; behaviour documented                     | **W2** (via TD-6)                      |
| **TD-4**  | release-engineering  | **Medium**  | `.github/workflows/` (backend, deploy, windows only)         | Add per-PR desktop CI (typecheck+lint+3,548 tests) **+** macOS package/sign/notarize (mirror `windows-release.yml`) | Both jobs **in CI, green**                            | **W1→W2** (4a→4b)                      |
| **TD-5**  | reliability          | **Medium**  | update/rollback path; `docs/federation/disaster-recovery.md` | Promote rollback advisory → automated+tested; federation DR when federation ships                                   | Automated rollback **drill passes**                   | **W2**                                 |
| **TD-6**  | reliability          | **Medium**  | observability layer                                          | Wire alert routing off `/metrics` + distributed tracing + forecasting baseline                                      | Alerts **fire on burn-rate**                          | **W2**                                 |
| **TD-7**  | test/quality         | **Medium**  | `apps/desktop` test config                                   | Add renderer component/E2E/a11y suites + coverage instrumentation                                                   | Suites **present + gated** green                      | **W3** (validation; complements TD-4a) |
| **TD-8**  | performance          | **Low–Med** | `apps/desktop/out/renderer/assets/index-*.js`                | Route-level split / trim the 930 KB chunk (splitting already present for views)                                     | Chunk **under declared budget**                       | Opportunistic (non-gating)             |
| **TD-9**  | product-completeness | **Low**     | enterprise admin renderer                                    | Surface remaining admin scopes (backend model already complete)                                                     | **Full scope coverage** in UI                         | Opportunistic (non-gating)             |
| **TD-10** | security             | **Low**     | per Security Guide                                           | Review FNV-1a usage; swap to a crypto hash **only if** the path is security-relevant                                | **Reviewed / documented** (or swapped + test)         | Opportunistic (non-gating)             |

**Consistency check.** This table is row-for-row the GA `§4` matrix. Waves W1/W2/W3 match
`GOVERNANCE-MATRICES.md §4`: **W1** = TD-1, TD-2, TD-4a (desktop CI); **W2** = TD-4b (mac
automation), TD-5, TD-6 (with TD-3 folded in); **W3** = validation (benchmarks + TD-7-adjacent
renderer confidence). TD-8/9/10 are the GA **"Nice-to-have"** set (`§8`) — non-gating, worked
opportunistically, never blocking a wave.

---

## 5. Retirement strategy

Retirement is **how the register shrinks**. The register only grows from **real reports**
(no invention, §2) and only shrinks on a **Validated** retirement — so it trends monotonically
toward zero as debt is proven fixed, never by quietly dropping items.

### Definition-of-done, per category (the retirement contract)

An item's retirement criterion (§4) is the _instance_; the category DoD below is the _class
rule_ the criterion must satisfy. Verification is the **verified-fix rule** (§2) applied to
the class.

| Category                 | Definition-of-done (class)                                                                                                    | Verified by                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **security**             | The negative case is _provably refused_ (unsigned/forged rejected); review-only items carry a **documented** review outcome   | A test exercising the exact attack (TD-1 forged token, TD-2 unsigned install); documented review (TD-10) |
| **reliability**          | The failure is _observable or recoverable_ — an alert fires on the real signal, or the automated recovery path passes a drill | Alert fires on burn-rate (TD-3/TD-6); rollback drill passes (TD-5)                                       |
| **test/quality**         | The missing suite _exists and is gated_ — present, green, and **blocking** in CI                                              | Suite present + gated (TD-7); coverage instrument runs                                                   |
| **release-engineering**  | The workflow _runs green in CI_ on the real trigger (per-PR / release)                                                        | Desktop CI + mac release jobs green (TD-4)                                                               |
| **performance**          | The measured artifact meets a _declared budget_, proven by the build/bench                                                    | Chunk measured under budget (TD-8)                                                                       |
| **product-completeness** | UI coverage _matches the complete backend model_                                                                              | Full admin-scope surface (TD-9)                                                                          |

### How the register shrinks (the governed loop)

1. **Only real entries in.** New items are admitted only from a cited GA/validation report at
   the weekly retro (§2). The register can never inflate with invented debt.
2. **Only Validated exits out.** The **quarterly** reassessment (`CONTINUOUS-IMPROVEMENT.md §3`)
   is the sole forum that credits a retirement, and only on the verified-fix evidence — never
   on intent. This is the same audit EOSP already runs; PERG binds it to the register.
3. **Retired ≠ deleted.** A retired item is **archived to the changelog** (SemVer / Keep a
   Changelog is adopted, `_grounding.md`) with its verifying test/gate cited, then removed from
   the active register. The audit trail persists; the active surface shrinks.
4. **Reopen on regression.** If a retired item's guarding test/gate later fails, the item is
   **re-registered** at its original severity — retirement is durable only while its evidence
   holds green.

### Current retirement priority — the two HIGH items

**TD-1 (Apple JWKS) and TD-2 (signed-install enforcement) are the top of the register today.**
They are the only two **High**-severity items and the only **strict GA blockers**
(`GOVERNANCE-MATRICES.md §2` Release Readiness; `ENTERPRISE-GA-REPORT.md §8` "Security
(blockers)"). Both sit in **Wave 1**, touch **independent** subsystems (backend auth vs desktop
runtime), and so proceed in parallel. Retiring both — each proven by its negative-case test and
**green in CI** — closes the Security-architecture dimension from _"Strong, 2 open items"_ to
_"Strong, 0 open"_ (§3) and clears the GA security gate. **Until both are Verified and Retired,
the register carries an open GA blocker**; no Medium or Low item can substitute for them, and no
GA posture may be claimed. This is the single highest-leverage retirement the register holds.

---

## Provenance & scope

- **Real (verbatim from reports):** the register itself — TD-1…TD-10, severities, and file
  citations (`ENTERPRISE-GA-REPORT.md §4`); the wave sequencing (`GOVERNANCE-MATRICES.md §4`);
  the quality baseline that gates retirement — **0 typecheck / 0 lint / 3,856 tests / 0 prod-vuln
  build** (Validated).
- **Defined (this document):** the six-category taxonomy, the register **state machine** and its
  approving roles, the **ARB-review trigger**, and the per-class **definition-of-done / retirement**
  policy — governance over the real substrate; **no runtime, no architecture added.**
- **Proposed / absent (honest):** every register item is **Proposed** until Validated; **no
  remediation date, sprint count, velocity, or completion percentage appears anywhere** — none
  exists to cite (`_grounding.md` rules 1–3). The platform is a **Validated Release Candidate**
  (`1.0.0-rc.1`); GA is **gated on retiring TD-1 and TD-2**, governed here, not yet done.
- **Elevates, does not restate:** EOSP `CONTINUOUS-IMPROVEMENT.md` (backlog, waves, cadences,
  postmortem loop) · `GOVERNANCE-MATRICES.md §3–§4` (register + waves) · sibling
  `ARCHITECTURE-STEWARDSHIP.md` (ARB/RFC authority) · `ENTERPRISE-GA-REPORT.md §4/§6/§8`
  (TD matrix, Architecture Health, path to GA).
