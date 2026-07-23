# NeuroPause Governance

How decisions get made in this repository: who decides, how changes are
proposed, and how releases are governed.

> **Status & scope.** NeuroPause is **proprietary software — All Rights
> Reserved** ([`LICENSE`](LICENSE)), currently developed by **internal
> maintainers and contracted partners**. The governance below reflects that
> reality. Where a body or process is **not yet staffed or adopted**, it is
> labelled **_proposed_** — those parts describe a direction, not a current
> operating structure, and no individuals are named or implied. The public
> community-governance framework this document points to is in
> [`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md).

---

## Principles

1. **Honesty over polish.** Capabilities are labelled Verified / Modeled /
   Advisory / Absent ([`docs/README.md`](docs/README.md#reading-the-honesty-labels)).
   No fabricated customers, metrics, benchmarks, or certifications ever enter the
   repo or its docs.
2. **The gates are the contract.** A change is "done" when the real quality gates
   pass — see [Release governance](#release-governance).
3. **Decisions are written down.** Non-trivial direction is captured in an issue
   or an RFC, not only in chat.
4. **Least surprise.** Security, licensing, and data-model changes get the most
   scrutiny.

---

## Roles

Roles are defined by **responsibility**, not by title. Current holders are
tracked in [`CODEOWNERS`](CODEOWNERS) via **placeholder team handles** — those
handles are placeholders to be mapped to real teams/individuals by the repo
administrators; this document deliberately names no people.

| Role                                 | Who                                                 | Responsibilities                                                                                      |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Contributor**                      | Any internal or partner contributor under agreement | Proposes issues/RFCs, opens PRs, follows [`CONTRIBUTING.md`](CONTRIBUTING.md)                         |
| **Reviewer**                         | Contributors trusted in an area                     | Reviews PRs for correctness, tests, and the honesty labels                                            |
| **Maintainer / Code owner**          | Owners listed in [`CODEOWNERS`](CODEOWNERS)         | Approves and merges PRs in their paths; guards the gates; triages issues                              |
| **Lead maintainer(s)**               | Designated maintainer(s)                            | Break ties, own release governance, own security response                                             |
| **Security response**                | Maintainers per [`SECURITY.md`](SECURITY.md)        | Handle private vulnerability reports                                                                  |
| **Steering / advisory** _(proposed)_ | **Not staffed**                                     | Cross-cutting strategy — see [Advisory board (proposed)](#advisory-board-and-working-groups-proposed) |

**Becoming a maintainer.** A contributor with a sustained track record of quality
contributions and reviews in an area may be proposed as a code owner by an
existing maintainer; lead maintainers confirm by consensus. (For the
internal/partner phase this is an internal decision; the public-facing version of
this ladder is **proposed** in the community framework.)

---

## How decisions are made

**Default: lazy consensus.** Most changes proceed by PR. If no code owner for a
touched path objects and the gates pass with the required approval(s), the change
merges. Silence on a reasonable, well-scoped PR is assent.

**Non-trivial changes need an RFC.** New surfaces, dependencies, data-model or
schema changes, security-relevant behaviour, public API/SDK/CLI changes, and
anything cross-cutting go through the lightweight **RFC process** defined in
[`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md#2-rfc-process).
Open the RFC before large implementation work.

**Disagreement & escalation.** Reviewers resolve most disagreements in the PR. If
a code owner objects, the objection must be addressed or explicitly overridden by
a lead maintainer with a written rationale. Unresolved cross-area disputes
escalate to the lead maintainer(s), whose decision is final for this phase.

**Changes to governance itself** (this file, `CONTRIBUTING.md`, `CODEOWNERS`, the
gates) require lead-maintainer approval and are announced in the PR description.

---

## Contribution & review rules

- Every PR follows [`CONTRIBUTING.md`](CONTRIBUTING.md): Conventional Commits,
  DCO sign-off, and (for partners/externals) a CLA on file.
- Each touched path needs approval from at least one of its
  [`CODEOWNERS`](CODEOWNERS).
- Security-relevant work is **not** discussed in public issues/PRs — see
  [`SECURITY.md`](SECURITY.md).
- The [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) governs all interactions.

---

## Release governance

Releases are governed by the **real, existing** process — not a proposed one:

- **The gate.** Every release passes the
  [Release Checklist](docs/guides/RELEASE-CHECKLIST.md): versioning (SemVer,
  current line `1.0.0-rc.1`), the four quality gates (`typecheck`, `lint
--max-warnings 0`, `test`, `build`) plus `format:check`, dependency/security
  review, packaging/signing, migrations, and post-release verification.
- **CI enforcement.** [`backend-ci`](.github/workflows/backend-ci.yml) runs
  typecheck, lint, test, build, and a Docker build; [`deploy-validation`](.github/workflows/deploy-validation.yml)
  validates `deploy/**` (`yamllint`, `helm lint`, strict `kubeconform`).
- **Versioning & changelog.** [SemVer](https://semver.org/) with `-rc.N` pre-GA;
  changes are recorded in [`CHANGELOG.md`](CHANGELOG.md) (Keep a Changelog),
  driven by Conventional Commits.
- **Honest maturity.** The authoritative readiness classification is the
  [Enterprise GA Assessment](ENTERPRISE-GA-REPORT.md); the platform is a
  **Validated Release Candidate** ([`ENTERPRISE-VALIDATION-REPORT.md`](ENTERPRISE-VALIDATION-REPORT.md)),
  **not GA**. Known limitations (Apple JWKS verification, unsigned marketplace
  install when the trust store is empty, no macOS release automation in CI) are
  disclosed in every release, never hidden.
- **Sign-off.** The lead maintainer(s) own the go/no-go decision using the
  checklist output.

The **roadmap-governance and release-cadence framework** (how proposals become
roadmap items, triage, and cadence) is in
[`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md).

---

## Advisory board and working groups (proposed)

An **advisory board** and topic **working groups** (e.g. security, SDK/developer
experience, deployment/operations) are **proposed structures — not staffed and
not operating.** No members exist or are implied. Their proposed charters,
scope, and the conditions under which they would be stood up are described in
[`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md#7-advisory-board-proposed).
Until formally established and staffed, they carry no authority and make no
decisions.

---

## Amending this document

Propose changes by PR (governance changes require lead-maintainer approval, per
above). Material shifts — especially any that would open a public contribution or
open-source path — depend on a licensing decision that has **not** been made and
must be reflected consistently across [`LICENSE`](LICENSE),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and the community framework.
