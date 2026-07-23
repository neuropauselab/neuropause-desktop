# NeuroPause EOSP — Developer Operations & Engineering Operating Model

> **What this is.** The engineering **operating model** for the Enterprise Operations & Scale
> Program (EOSP): how a change moves from issue to release, how branches and reviews are run,
> what the merge/release bar is, and how developer productivity is _defined and measured_. It
> **adds no runtime and no platform** — it is roles, cadences, decision rules, and checklists
> layered over the **real** contributor scaffolding.
>
> **Extends, does not duplicate.** [`CONTRIBUTING.md`](../../CONTRIBUTING.md) owns setup, the
> gate commands, and the commit convention; [`CODEOWNERS`](../../CODEOWNERS) owns review
> ownership; [`GOVERNANCE.md`](../../GOVERNANCE.md) owns decision authority;
> [`docs/guides/RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md) owns the per-release
> gate. This manual references those as the source of truth and adds the operating discipline
> **around** them. Reliability/on-call/capacity live in the companion [`SRE.md`](SRE.md).
>
> **Honesty banner (non-negotiable).** Every metric here is a **definition + how-to-measure**,
> never a claimed value. There are **no fabricated velocity, DORA, throughput, or failure-rate
> numbers** — no production fleet or release history is asserted. The platform is a **Validated
> Release Candidate** (`1.0.0-rc.1`), operated by an **implied/target org**; this document
> defines **roles, not people** and names no individuals.

---

## 1. Engineering workflow

The lifecycle every change follows. Each stage cites the **real** asset that governs it and
the **real** gate that must be green. Nothing here is aspirational — every row is an executable
step or a decision with an owning role.

| Stage               | Action                                                                                                                                 | Real asset / gate                                                                                          | Owning role             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| **1. Issue / RFC**  | File a `bug_report` or `feature_request`; for a new surface, dependency, schema, or public API/SDK/CLI change, open an **RFC first**   | [`.github/ISSUE_TEMPLATE/`](../../.github/ISSUE_TEMPLATE), RFC per `docs/adoption/COMMUNITY-GOVERNANCE.md` | Contributor             |
| **2. Triage**       | Confirm not a duplicate, not a security report (→ `SECURITY.md`), label, size, accept/decline direction                                | `needs-triage` label; `GOVERNANCE.md` (lazy consensus / RFC)                                               | Maintainer / Code owner |
| **3. Branch**       | Sync trunk, branch with a typed name: `feat/…`, `fix/…`, `docs/…` (see §2)                                                             | `CONTRIBUTING.md` "Branch & PR workflow"                                                                   | Contributor             |
| **4. Build change** | One logical change per branch; **write tests** for new behaviour and every fix; never weaken a test to pass a gate                     | Vitest; TS `strict` (`tsconfig.base.json`)                                                                 | Contributor             |
| **5. Local gates**  | Run the full gate wall (§4) to zero errors/warnings **before** requesting review                                                       | `CONTRIBUTING.md` "Quality gates"                                                                          | Contributor             |
| **6. Commit**       | **Conventional Commits** + **DCO sign-off** (`git commit -s`); `!` + `BREAKING CHANGE:` footer for breaks                              | `CONTRIBUTING.md` "Commit convention"                                                                      | Contributor             |
| **7. Open PR**      | Use the PR template; link the issue/RFC (`Closes #`); check the gate + honesty boxes truthfully; request every touched-path code owner | [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)                               | Contributor             |
| **8. CI**           | Relevant workflow(s) run and must be green (§4)                                                                                        | `backend-ci`, `deploy-validation` (per-PR); `windows-release` (tag)                                        | CI / Code owner         |
| **9. Review**       | ≥1 code owner **per touched path** approves against the §3 standards; author addresses comments with follow-up commits                 | `CODEOWNERS`, §3 checklist                                                                                 | Reviewer / Code owner   |
| **10. Merge**       | **Squash-merge** once required approvals + green CI are in; commit subject stays Conventional (feeds `CHANGELOG.md`)                   | `CONTRIBUTING.md`; `GOVERNANCE.md` release governance                                                      | Code owner              |
| **11. Release**     | When cutting a version, run the Release Checklist end to end; tag `vX.Y.Z[-rc.N]`; tag push drives `windows-release`                   | [`RELEASE-CHECKLIST.md`](../guides/RELEASE-CHECKLIST.md)                                                   | Lead maintainer         |

**Decision rules.**

- **RFC-before-code** for non-trivial change is a gate, not a courtesy — direction is agreed
  before implementation so review is about correctness, not re-litigating scope (`GOVERNANCE.md`).
- **Security work never enters a public issue/PR** — private disclosure via
  [`SECURITY.md`](../../SECURITY.md); the pre-GA security items (Apple JWKS, unsigned
  marketplace install) are tracked, not opened publicly.
- **Lazy consensus** is the default: a well-scoped PR with the required approval(s) and green
  gates merges; a code owner's unresolved objection blocks until addressed or overridden by a
  lead maintainer with written rationale.

---

## 2. Branch strategy

### 2.1 Current reality (stated honestly)

The documented contributor workflow tells you to _"sync `main` and branch from it"_
(`CONTRIBUTING.md`), and that is the **target**. In **practice to date**, delivery has been
organized on **sequential `phase-*` integration branches** — the platform was built phase by
phase (evidence: the `PHASE-2…5-REPORT.md` series and `MANIFEST-phase*` files at the repo
root), with work landing on the active phase branch rather than a continuously-integrated
trunk. This is the honest state: a **phase-branch delivery model**, not yet trunk-based.

| Aspect             | Current (`phase-*`) reality                                        | Consequence                                            |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Integration target | Active `phase-*` branch                                            | Trunk (`main`) is not the continuous integration point |
| Branch lifetime    | Long-lived, phase-scoped                                           | Larger merges, later conflict discovery                |
| Per-PR CI coverage | `backend-ci` on backend/shared; `deploy-validation` on `deploy/**` | Desktop suite not gated per PR (§4)                    |
| Release cut        | From the phase line at RC                                          | Release provenance tied to phase, not a release branch |

### 2.2 Proposed model — trunk-based + release branches (improvement)

Proposed as the clean target once continuous integration cadence is adopted. It is an
**improvement proposal**, not a claim of current practice.

```
main (trunk, always releasable)
 ├── feat/marketplace-review-sort   short-lived, ≤ a few days, squash-merged to main
 ├── fix/apple-jwks                  short-lived
 └── release/1.0.x                   cut at release time; tags vX.Y.Z live here
       └── (hotfix commits cherry-picked back to main)
```

| Rule                     | Specification                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Trunk**                | `main` is always releasable and green; every merge keeps it that way                                          |
| **Short-lived branches** | Typed names (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `ci/`); rebase on `main`; live days, not phases |
| **Merge**                | Squash-merge to `main` behind required approvals + green CI                                                   |
| **Release branch**       | Cut `release/X.Y` at release time; stabilize there; tag `vX.Y.Z[-rc.N]` on that branch                        |
| **Hotfix**               | Branch `fix/…` from the release tag, patch, tag `vX.Y.(Z+1)`, **cherry-pick back to `main`**                  |
| **SemVer + tags**        | Tags follow [SemVer](https://semver.org/); a `v*` tag push triggers `windows-release`                         |

**Migration path (phase → trunk), executable and low-risk:**

1. Designate the current phase line's HEAD as `main` and protect it (require green CI +
   code-owner approval to merge).
2. Shorten branch lifetime: new work branches from `main`, targets `main`, squash-merges.
3. Introduce `release/X.Y` at the next release cut; move tagging onto it.
4. Backfill the per-PR desktop CI gap (§4) so trunk stays releasable without relying on the
   release-tag run to catch desktop regressions.

**Branch protection to enable (proposed, over the real workflows):** require `backend-ci` on
backend/shared PRs and `deploy-validation` on `deploy/**` PRs; require ≥1 code-owner approval;
forbid direct pushes to `main` and `release/*`; require linear history (squash).

---

## 3. Code review

Review authority is defined by [`CODEOWNERS`](../../CODEOWNERS): the **last matching pattern
wins**, and **each touched path needs approval from at least one of its owners**. Roles are
responsibilities (`GOVERNANCE.md`), never named people.

| Path (real CODEOWNERS mapping)                                                  | Required owner(s)                    | Why                                             |
| ------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| `*` (default)                                                                   | `@neuropause/maintainers`            | Baseline ownership                              |
| `/apps/backend/src/auth/`, `/middleware/`, `/db/`                               | backend **+ `@neuropause/security`** | Auth, rate-limit, schema are security-sensitive |
| `/apps/backend/src/store/`, `/billing/`                                         | backend **+ marketplace / commerce** | Marketplace + revenue surfaces                  |
| `/apps/desktop/src/main/{security,auth,ipc,marketplace,nps}/`, `/preload/`      | desktop **+ security / marketplace** | Trust store, IPC, package install               |
| `/deploy/`, `/scripts/`, `/tools/`, `docker-compose*.yml`                       | `@neuropause/devops`                 | Infra + release surfaces                        |
| `/.github/workflows/`                                                           | `@neuropause/devops`                 | CI is a release control                         |
| `/LICENSE`, `/CONTRIBUTING.md`, `/GOVERNANCE.md`, `/CODEOWNERS`, `/SECURITY.md` | `@neuropause/leads` (+ security)     | Governance changes need lead approval           |

> **Enforcement risk (carry this).** Every `@neuropause/*` handle in `CODEOWNERS` is a
> **placeholder**; an unresolvable owner **silently disables enforcement for that path**.
> Mapping placeholders to real teams is a **prerequisite** for code-owner review to actually
> gate merges — track it as an operating item, not an assumption.

**Reviewer checklist (apply to every PR):**

- [ ] **Correctness** — the change does what the linked issue/RFC states; edge cases handled.
- [ ] **Tests** — new behaviour and every fix add Vitest coverage; no test weakened/deleted to
      pass a gate; failure reproduced-then-fixed for bugs.
- [ ] **Gates** — the PR's gate boxes reflect a **real local run**, not transcribed numbers.
- [ ] **Type safety** — no new `any`/`@ts-ignore` escapes `strict`; contracts stay in `shared`.
- [ ] **Security-sensitive paths** — a **security** owner reviewed any auth/middleware/db/ipc/
      trust-store change; no regression to the tracked pre-GA items.
- [ ] **Surface & compat** — public SDK/CLI/API/IPC changes are intentional, SemVer-correct, and
      `BREAKING CHANGE:`-flagged when breaking.
- [ ] **Migrations** — SQL is forward-only, additive, and reversible by a documented data-side
      path (`DISASTER-RECOVERY-GUIDE.md`).
- [ ] **Honesty** — no fabricated customers, metrics, benchmarks, or certifications; honesty
      labels (Verified / Modeled / Advisory / Absent) respected; new limitations disclosed.
- [ ] **Commits** — Conventional Commits, DCO signed-off; contributor is cleared (CLA on file
      for partner/external).

**Review discipline (operating norms):** review is **blocking, not advisory** on owned paths;
reviewers resolve disagreements in the PR, escalating an unresolved code-owner objection to a
lead maintainer (`GOVERNANCE.md`); authors respond with **follow-up commits**, not force-pushed
history, until the final squash.

---

## 4. Release quality

### 4.1 The gate wall (the merge/release bar)

These are the **real** gates — identical in `CONTRIBUTING.md`, the PR template, `backend-ci`,
and the Release Checklist. They are the bar for **both** merge and release. Run from the repo
root; **re-run and copy actual output — never transcribe** a previous run.

| Gate                    | Command                | Required result                                                              |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Typecheck               | `npm run typecheck`    | **0 errors** across all workspace projects; TS `strict`                      |
| Lint                    | `npm run lint`         | **0 warnings, 0 errors** (`eslint . --max-warnings 0`)                       |
| Test                    | `npm run test`         | Vitest suites pass — **all green** (RC baseline: **3,856** tests)            |
| Build                   | `npm run build`        | Production build backend→desktop, **exit 0**                                 |
| Format                  | `npm run format:check` | Prettier reports **no drift**                                                |
| Prod deps               | `npm audit --omit=dev` | **0 production vulnerabilities** (dev-only advisories tracked, non-blocking) |
| Deploy (if `deploy/**`) | `deploy-validation`    | `yamllint` + `helm lint` + strict `kubeconform` pass                         |

> The test count is a **baseline for the assessed commit**, not a target — the honest number is
> whatever `npm run test` prints on the change under review. A dropped count is a regression to
> investigate, not a box to re-check from memory.

### 4.2 CI coverage matrix (what actually runs, when)

| Workflow            | Trigger                                                                  | Runs                                                                                                                    | Coverage note                                           |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `backend-ci`        | push/PR touching `apps/backend/**`, `packages/shared/**`, root manifests | typecheck + lint (`--max-warnings 0`) + test + build **(backend workspace)**, then Docker build                         | Per-PR gate for backend/shared only                     |
| `deploy-validation` | push/PR touching `deploy/**`                                             | `yamllint`, `helm lint`, `helm template`, strict `kubeconform` (raw + rendered)                                         | Per-PR gate for infra manifests                         |
| `windows-release`   | `workflow_dispatch`; **tag push `v*`**                                   | **full** `npm run typecheck` + `lint` + `test` (whole monorepo), Windows package, GitHub Release + self-hosted download | Full suite runs at **tag/manual** time — **not per PR** |

### 4.3 The two CI gaps — carried as tracked risks

Both are **honest, disclosed gaps** (`ENTERPRISE-GA-REPORT.md` TD-4 / risk PR-4;
`RELEASE-CHECKLIST.md` §4). They are not hidden and not assumed-covered.

| Risk                                   | What is true                                                                                                                                                                             | Compensating control (real)                                                             | Residual action (owner)                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **No per-PR desktop CI** (TD-4)        | Desktop's **3,548 tests** are gated per PR by **no** workflow; per-PR CI is backend/shared + deploy only. The full suite runs only via `windows-release` on a **tag** or manual dispatch | Full local gate wall (§4.1) required before review; full-suite run at every release tag | **Add a desktop test workflow** (typecheck+lint+test on `apps/desktop/**` PRs) — Devops / lead |
| **No macOS release automation** (TD-4) | `windows-release` automates Windows only; macOS packaging/signing/notarization is **manual** (`RELEASE-CHECKLIST.md` §4; `docs/launch/LAUNCH-02-MAC-PACKAGING.md`)                       | Manual mac packaging runbook; Windows path is CI-provenanced and signing is env-gated   | **Add macOS packaging/signing/notarization to release CI** — Devops / lead                     |

**Operating rule:** because desktop regressions are not caught per PR, a PR touching
`apps/desktop/**` **must** attach real local `npm run test` output, and the **release cut is
the enforced full-suite checkpoint** — do not defer the desktop run past the tag. Rollback
readiness (`RELEASE-CHECKLIST.md` §7) is **advisory app-binary / data-side restore**; the
on-call restore path must be understood before a release is declared done.

---

## 5. Developer productivity

> **Definitions only — no values.** This section defines metrics and **how to compute them from
> git and CI**. It reports **no** deployment frequency, lead time, failure rate, or recovery
> time — there is **no release history or production fleet** to measure, and fabricating one is
> prohibited (`_grounding.md`). Every metric below is **baseline-TBD**: populated from real git
> history and CI/Release logs once a continuous cadence exists, then reviewed — never asserted.

### 5.1 DORA metric definitions + measurement method

| Metric                                     | Definition                                               | Measure from git / CI (executable)                                                                                                                   | Honesty note                                                            |
| ------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Deployment frequency (DF)**              | How often the org ships a release                        | Count `v*` tags (or `windows-release` GitHub Releases) per window: `git tag --list 'v*' --sort=creatordate`                                          | Tag-driven deploy is real; **DF value is TBD** (no release cadence yet) |
| **Lead time for changes (LTC)**            | Median time from first commit of a change to its release | Per merged change: `release_tag_date − first_commit_authored_date` (git log + tag dates); take the median over the window                            | Requires consistent tagging; **no value asserted**                      |
| **Change failure rate (CFR)**              | Fraction of releases that require remediation            | `remediating_releases / total_releases`, where a remediating release is a hotfix (`fix` tag) or a data-side restore per `DISASTER-RECOVERY-GUIDE.md` | No prod fleet ⇒ **definition only**, no rate                            |
| **Failed-deployment recovery time (MTTR)** | Median time from a failed release's detection to restore | `restore_complete − failure_detected` from the release/incident log; restore path is data-side (`RELEASE-CHECKLIST.md` §7)                           | No incidents to date ⇒ **definition only**                              |

### 5.2 Flow, quality & toil signals (definitions)

Supplementary signals, all computable from git/CI/PR metadata; again **definitions, not values**.

| Signal                        | Definition                                                               | Source                                                         |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **PR cycle time**             | PR open → merge, median                                                  | PR timestamps                                                  |
| **Review latency**            | PR "review requested" → first review                                     | PR/review events                                               |
| **CI pass rate**              | Green runs / total runs, per workflow                                    | `backend-ci` / `deploy-validation` / `windows-release` history |
| **Gate-failure distribution** | Which gate fails most (typecheck / lint / test / build / format / audit) | CI job outcomes                                                |
| **Rework / revert rate**      | `revert` commits ÷ merges; churn on a PR after first approval            | `git log --grep '^revert'`; PR diff history                    |
| **Flaky-test rate**           | Tests that pass on re-run without a code change                          | CI re-run outcomes                                             |
| **Escaped-defect rate**       | `fix` PRs closing a defect that shipped in a prior release               | Issue labels + `CHANGELOG.md`                                  |

**Toil signal (engineering side).** The largest standing engineering toil source is the
**per-PR desktop CI gap** (§4.3): every desktop PR carries a manual full-suite run that CI
should perform. Closing TD-4 is the highest-leverage toil-reduction item on the engineering
side — it converts a repeated manual gate into an automated one and lets trunk stay releasable
(§2.2). (Operational/on-call toil is owned separately in [`SRE.md`](SRE.md) §1.)

**How these are used (proposed wiring, honest).** No dashboard exists; these are computed
**externally** over real git history and CI logs (mirroring the SRE stance that alerting is
proposed wiring over a real substrate). Reviewed on the operating cadence
(`OPERATIONS-GUIDE.md`), they inform staffing, automation priority, and the branch-model
migration — they are **inputs, not scorecards**, and carry **no fabricated targets**.

---

## Provenance & scope

- **Real (verified):** the gate wall (typecheck 0 / lint `--max-warnings 0` / test 3,856 /
  build 0 / 0 prod vulns), conventions (Conventional Commits, SemVer, TS `strict`, Prettier),
  templates (`.github/`), ownership (`CODEOWNERS`), and the three workflows (`backend-ci`,
  `deploy-validation`, `windows-release`) — from the repo and `ENTERPRISE-GA-REPORT.md`.
- **Honest gaps (carried, not hidden):** no per-PR desktop CI; no macOS release automation
  (TD-4 / PR-4). Advisory rollback; placeholder `CODEOWNERS` handles.
- **Proposed (labelled):** trunk-based + release-branch model and its migration; branch
  protections; a desktop CI workflow; external productivity-metric wiring.
- **Definitions only:** all DORA and flow/quality signals — **no velocity, DORA, or failure
  values are asserted**; no production fleet or release history exists. Roles, not people.
