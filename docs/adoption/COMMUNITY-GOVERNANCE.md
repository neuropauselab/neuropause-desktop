# NeuroPause — Community Governance Framework

The GEAP community-governance deliverable: the model, processes, and proposed
structures that let NeuroPause be governed openly and predictably as adoption
grows. It **operationalizes** the repository governance artifacts
([`GOVERNANCE.md`](../../GOVERNANCE.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md),
[`CODEOWNERS`](../../CODEOWNERS)) — it adds process, not runtime or architecture.

> **Grounding & honesty.** NeuroPause is **proprietary — All Rights Reserved**
> ([`LICENSE`](../../LICENSE)) at **1.0.0-rc.1 (Validated Release Candidate)**.
> Governance today serves **internal maintainers and contracted partners**. A
> **public community path is _proposed_, not open**, and depends on a licensing
> decision that has **not** been made. This document names **no** contributors,
> board members, or working-group members, and cites **no** community metrics
> (contributors, downloads, adoption) — those would be fabrications. Every
> "proposed" structure is a design, not a staffed body.

Readiness anchor: the Community Readiness Matrix in
[`ADOPTION-MATRICES.md`](ADOPTION-MATRICES.md).

---

## 1. Governance model

NeuroPause uses a **maintainer-led model with lazy consensus**, chosen for a
small, accountable contributor base under a proprietary licence:

- **Contributors** propose and implement changes under [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- **Reviewers / code owners** ([`CODEOWNERS`](../../CODEOWNERS)) guard each area
  and the quality gates.
- **Lead maintainer(s)** own release governance, security response, and
  tie-breaking.
- Roles, the promotion ladder, and escalation are defined once in
  [`GOVERNANCE.md`](../../GOVERNANCE.md) and are not restated here.

**Decision rule.** Most changes proceed by **lazy consensus**: a well-scoped PR
with the required code-owner approval and green gates merges if no owner objects.
Anything larger than a routine change enters the **RFC process** below.

**Phasing.** The model is designed to extend cleanly from the current
internal/partner phase to a proposed public phase without changing its shape —
only widening who may participate, and only if the licence permits.

---

## 2. RFC process

The **Request for Comments (RFC)** process is how non-trivial direction is
proposed, discussed, and recorded. It is deliberately lightweight.

**When an RFC is required:**

- A new user-facing surface, module, or public **SDK/CLI/API** change.
- A new runtime dependency, or a data-model / DB-migration change.
- Security-relevant behaviour (auth, IPC, signing/trust, secret handling).
- Anything cross-cutting (touching multiple workspaces) or breaking.
- Any change to governance, the gates, or licensing posture.

Routine bug fixes, docs, tests, and self-contained changes **do not** need an RFC —
a normal issue + PR is enough.

**Lifecycle:**

| Stage                   | What happens                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Draft**               | Author opens an RFC (see format) as a PR adding a file, or a tracked proposal issue. Status `draft`.                            |
| **Review**              | Code owners and affected maintainers comment. Author revises. A **≥ 7-day** comment window is the default for substantial RFCs. |
| **Last call**           | Lead maintainer signals intent to accept/reject; final objections raised.                                                       |
| **Accepted / Rejected** | Lead maintainer(s) record the decision and rationale. Accepted RFCs become tracked work.                                        |
| **Implemented**         | Linked PRs land through the normal gates; RFC marked `implemented`.                                                             |
| **Superseded**          | A later RFC may replace an earlier one; link both.                                                                              |

**Suggested RFC format** (keep it short):

```
# RFC: <title>
- Status: draft | review | accepted | rejected | implemented | superseded
- Author(s): <handle(s)>
- Created: <YYYY-MM-DD>
- Tracking issue: #<id>

## Summary            (one paragraph)
## Motivation         (problem; persona/segment — never a named customer)
## Design             (what changes; behaviour, surfaces, data model)
## Alternatives       (what else was considered, and why not)
## Risks & security   (impact, migration, honesty-label effects)
## Rollout            (phasing, docs, gate impact)
```

> **Decision authority.** Acceptance is by lazy consensus of the relevant code
> owners, with the **lead maintainer(s)** as the deciding authority on
> disagreement (per [`GOVERNANCE.md`](../../GOVERNANCE.md)). Where the _proposed_
> advisory board or working groups are cited below, they are **advisory only**
> and, being unstaffed, hold **no** decision power today.

---

## 3. Feature-proposal workflow

The path from an idea to shipped code:

1. **Idea → issue.** Open a [feature request](../../.github/ISSUE_TEMPLATE/feature_request.md).
   Frame the problem with a **persona/segment**, not a named customer.
2. **Triage.** Maintainers label and route it (see §5). Small, clear features can
   skip straight to a PR.
3. **RFC (if required).** If it meets an RFC trigger (§2), the proposal is
   promoted to an RFC before implementation.
4. **Design agreement.** Code owners agree on scope/approach in the issue/RFC.
5. **Implementation.** PR(s) with tests, following [`CONTRIBUTING.md`](../../CONTRIBUTING.md)
   (Conventional Commits, DCO, CLA where applicable).
6. **Gates & review.** All real gates green (§6); code-owner approval obtained.
7. **Merge & changelog.** Squash-merge; the change flows into
   [`CHANGELOG.md`](../../CHANGELOG.md).
8. **Roadmap update.** If it was a roadmap item, its status is updated (§4).

Guardrail: a feature is only "done" when its behaviour is real and honestly
labelled — **no** fabricated metrics, customers, or certifications, and no
overstatement of maturity beyond **Validated Release Candidate**.

---

## 4. Roadmap governance

The roadmap is a **framework for sequencing**, not a set of dated promises or
market claims.

- **Horizons.** Work is grouped **Now / Next / Later**. "Now" items have owners
  and agreed scope; "Later" items are directional and may change.
- **What may appear.** Only real, buildable work grounded in the codebase or a
  prior program report. **No** adoption/revenue/market numbers, and no
  named-customer commitments.
- **How items enter.** Accepted RFCs and triaged high-priority features become
  roadmap candidates; lead maintainer(s) sequence them against capacity and the
  honest known-limitations backlog (e.g. Apple JWKS verification, unsigned
  marketplace install when the trust store is empty, macOS release automation not
  yet in CI).
- **Maturity honesty.** Each item carries its honesty label
  ([`docs/README.md`](../README.md#reading-the-honesty-labels)); nothing is shown
  as GA until it is.
- **Cadence.** The roadmap is reviewed on a regular maintainer cadence and
  whenever a release ships. Changes are visible in the repository, not announced
  as achieved outcomes.

---

## 5. Issue triage

Triage keeps the tracker trustworthy. Default **weekly** maintainer triage;
security items are handled immediately and privately per
[`SECURITY.md`](../../SECURITY.md).

**Suggested label taxonomy:**

| Group    | Labels                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| Type     | `bug`, `enhancement`, `docs`, `refactor`, `question`, `rfc`                                       |
| Priority | `p0-critical`, `p1-high`, `p2-normal`, `p3-low`                                                   |
| Status   | `needs-triage`, `needs-info`, `accepted`, `blocked`, `in-progress`, `wontfix`, `duplicate`        |
| Area     | `area:backend`, `area:desktop`, `area:sdk`, `area:cli`, `area:shared`, `area:deploy`, `area:docs` |

**Triage steps:** confirm it is not a security report; reproduce or request info
(`needs-info`); label type/priority/area; route to the code owner(s); close
duplicates/out-of-scope with a reason. A stale `needs-info` issue may be closed
after a reasonable wait and reopened when information arrives.

---

## 6. Release governance

Release governance is **already real** — this section points at it rather than
re-inventing it:

- **The gate:** [Release Checklist](../guides/RELEASE-CHECKLIST.md) — versioning
  (SemVer, current `1.0.0-rc.1`), the four gates (`typecheck`, `lint
--max-warnings 0`, `test`, `build`) plus `format:check`, dependency/security
  review, packaging/signing, migrations, post-release verification.
- **CI enforcement:** [`backend-ci`](../../.github/workflows/backend-ci.yml)
  (typecheck, lint, test, build, Docker build) and
  [`deploy-validation`](../../.github/workflows/deploy-validation.yml)
  (`yamllint`, `helm lint`, strict `kubeconform`).
- **Versioning & changelog:** [SemVer](https://semver.org/) with `-rc.N` pre-GA;
  [`CHANGELOG.md`](../../CHANGELOG.md) (Keep a Changelog), driven by Conventional
  Commits.
- **Classification:** authoritative readiness is the
  [Enterprise GA Assessment](../../ENTERPRISE-GA-REPORT.md); the platform is a
  **Validated Release Candidate** ([`ENTERPRISE-VALIDATION-REPORT.md`](../../ENTERPRISE-VALIDATION-REPORT.md)),
  **not GA**. Known limitations ship disclosed, never hidden.
- **Sign-off:** lead maintainer(s) own the go/no-go using the checklist output.

---

## 7. Advisory board (proposed)

> **Proposed — not staffed, not operating. No members exist or are implied.**

An advisory board is **proposed** to give strategic, non-binding input as
adoption widens. It is documented here as a **design** so it can be stood up
deliberately later; today it has **no** members and **no** authority.

- **Purpose (proposed):** advise on roadmap direction, ecosystem/partner
  priorities, and standards alignment — **advisory only**; decision authority
  stays with maintainers per [`GOVERNANCE.md`](../../GOVERNANCE.md).
- **Composition (proposed):** a small group drawn from **personas/segments**
  (e.g. an enterprise operator, an implementation partner, a developer/SDK user,
  a security/compliance practitioner, a researcher) — described as roles, never
  named individuals.
- **Cadence (proposed):** periodic review sessions; inputs recorded as RFCs or
  issues so they pass through the normal process.
- **Stand-up conditions:** a public/partner community of sufficient scope, a
  licensing decision that permits it, and a maintainer decision to charter it.
  Until all three hold, the board remains a proposal.

---

## 8. Working groups (proposed)

> **Proposed — not staffed, not operating. No members exist or are implied.**

Topic **working groups (WGs)** are **proposed** to let focused areas coordinate
without fragmenting governance. Proposed initial WGs, each mapping to real code
and docs:

| Proposed WG              | Focus                                             | Real basis                                                                                                                               |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Security                 | Auth, IPC/RBAC, signing/trust, disclosure hygiene | [`docs/guides/SECURITY-GUIDE.md`](../guides/SECURITY-GUIDE.md), [`SECURITY.md`](../../SECURITY.md)                                       |
| Developer experience     | SDK, CLI, plugin/connector authoring              | [`packages/sdk`](../../packages/sdk), [`packages/cli`](../../packages/cli), [`docs/runtime/PLUGIN-SDK.md`](../runtime/PLUGIN-SDK.md)     |
| Deployment & operations  | K8s/Helm/offline, day-2 operations                | [`deploy/`](../../deploy), [`docs/guides/OPERATIONS-GUIDE.md`](../guides/OPERATIONS-GUIDE.md)                                            |
| Marketplace & ecosystem  | Store, publisher trust, partner surfaces          | [`apps/backend/src/store`](../../apps/backend/src/store), [`apps/desktop/src/main/marketplace`](../../apps/desktop/src/main/marketplace) |
| Documentation & adoption | Doc IA, guides, GEAP artifacts                    | [`docs/README.md`](../README.md), [`docs/adoption/`](.)                                                                                  |

- **Charter (proposed):** each WG would have a scope, a code-owner sponsor, and a
  mandate to shepherd RFCs in its area — **recommending**, not deciding.
- **Lifecycle (proposed):** stood up when there is sustained work and people to
  do it; retired or merged when not. No WG operates until formally chartered and
  staffed.

---

## 9. Public community path (proposed)

The move from internal/partner to a public community — public issue tracker,
published CLA tooling, and any open-source subset — is a **proposed future
direction** contingent on a licensing decision **not yet made**. Opening it would
require consistent updates across [`LICENSE`](../../LICENSE),
[`CONTRIBUTING.md`](../../CONTRIBUTING.md), and this framework, plus a
maintainer/lead decision. Until then, this repository is **internal/partner-only**
and the structures in §7–§8 remain proposals.

---

## Reading note

This framework is **actionable** (processes, an RFC format, a label taxonomy, a
release-gate pointer) and **grounded** (it extends the real repository artifacts).
It invents no people, no metrics, and no maturity: proprietary status, Validated
Release Candidate maturity, and the internal/partner-now / public-proposed split
are respected throughout.
