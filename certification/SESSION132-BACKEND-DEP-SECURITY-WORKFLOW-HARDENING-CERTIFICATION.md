# SESSION 132 — BACKEND DEPENDENCY SECURITY + WORKFLOW SUPPLY-CHAIN HARDENING
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · CI/repository-level, NON-FROZEN, no FG token

## S132 STATUS: **YELLOW**
Workflow hardening implemented + enforced (GREEN). The qs dependency remediation is **BLOCKED on a decision** (documented, not guessed) — hence YELLOW, not GREEN. No manufactured success.

---

## 1 · Dependency vulnerability before / after
- **Before & after: UNCHANGED.** `qs@6.15.3` (advisory GHSA-4mjr-xmp4-gh2g, moderate) is still present via `@neuropause/backend → express@4.22.2 → {qs, body-parser@1.20.6 → qs}`. Backend-only; the Electron desktop app ships no express/qs. `npm audit`: 15 advisories (7 moderate / 7 high / 1 critical) — the high/critical are dev-toolchain (vitest/vite/esbuild/postcss/nanoid) requiring semver-major bumps, out of scope and report-only per policy.

## 2 · Exact dependency remediation
- **NONE applied — STOPPED per the DEPENDENCY REMEDIATION RULE.** Full analysis in `DECISION-MEMO-S132-DEPENDENCY-REMEDIATION.md`. Summary: the only fixed qs is **6.16.0**, which is **out of** express/body-parser's declared `qs: ~6.15.1`; npm@10.5.0 will not cleanly apply an `overrides: {qs:6.16.0}` to the existing lockfile (leaves 6.15.3, ELSPROBLEMS "invalid"); and a full lockfile regen on this Linux box strips **107 unrelated cross-platform binaries** (mac/win esbuild/rollup/argon2) — the exact churn the rule forbids — while still not upgrading qs. Decision required (Option A force-override + cross-platform regen on CI / Option B express 5 major / Option C accept-and-monitor). `package.json` + `package-lock.json` left git-clean.

## 3 · npm audit result
15 advisories unchanged. CI scan remains **report-only** (S131 policy preserved; no blocking threshold invented; root-level audit crosses workspaces so it must not gate desktop CI on backend advisories).

## 4 · SBOM component count + digest
Unchanged and truthful (no dependency changed): **985 components**, digest `sha256:f861c70e66fe9cffc64c2299d385320a3642c82a1eac0a3f35c5cc4614ad9f6a`; `verify-sbom` OK (corresponds to lockfile). No credential/secret in the SBOM.

## 5 · Workflow security matrix (measured)
| workflow | trigger | permissions (before → after) | 3rd-party actions | secrets | PR trust | write | risk |
|---|---|---|---|---|---|---|---|
| backend-ci.yml | push/PR (paths) | **NONE → `contents: read`** ✅ | checkout@v4, setup-node@v4, docker/setup-buildx@v3, docker/build-push@v6 (`push:false`) | none | fork PR | read | fixed |
| deploy-validation.yml | push/PR (paths) | **NONE → `contents: read`** ✅ | checkout@v4, azure/setup-helm@v4 | none | fork PR | read | fixed |
| desktop-ci.yml | push/PR (paths, +`.github/workflows/**`) | `contents: read` (S131) | checkout@v4, setup-node@v4, upload-artifact@v4 | none | fork PR | read | OK |
| certification-freeze.yml | push all / PR / dispatch | `contents: read` | checkout@v4, setup-node@v4 | none | PR | read | OK |
| macos-release.yml | dispatch + tag `v*` | `contents: write` (justified) | checkout@v4, setup-node@v4, upload-artifact@v4, **softprops/action-gh-release@v2** | APPLE_*, DEPLOY_SSH_KEY | tag/dispatch only (no PR) | write (release) | legitimate; SHA-pin debt |
| windows-release.yml | dispatch + tag `v*` | `contents: write` (justified) | checkout@v4, setup-node@v4, upload-artifact@v4, **softprops/action-gh-release@v2** | WIN_CSC_*, DEPLOY_SSH_KEY | tag/dispatch only | write (release) | legitimate; SHA-pin debt |

## 6 · Permissions changes
Added `permissions: contents: read` to **backend-ci.yml** and **deploy-validation.yml** (the two workflows that inherited the broad default token). Verified read-only is sufficient: backend `docker-build` uses `push:false` + GHA cache (no registry login/push); deploy-validation is yamllint + helm lint. Release workflows already carry a justified, minimal `contents: write`; left unchanged (not weakened).

## 7 · SHA-pinning changes
- **NONE applied — documented debt, not guessed.** The one justified pin is the third-party community `softprops/action-gh-release@v2` in the secret-scoped release workflows. Resolving its authentic commit SHA requires the GitHub API, which returned empty via the sandbox's fetch; per program law (**never guess a SHA**), pinning is deferred to an environment that can resolve it. First-party `actions/*`, `docker/*`, `azure/*` are lower-risk verified publishers; Dependabot's `github-actions` ecosystem (added S131) tracks their updates. Recorded as remaining debt (§14).

## 8 · pull_request security findings
No `pull_request_target`, no secret exposure to fork PRs, no checkout of attacker-controlled refs, no unsafe `${{ }}` interpolation into `run:` found. Release workflows (secrets present) trigger **only** on `workflow_dispatch` + tag push — never on `pull_request` — so fork PRs cannot reach signing/deploy secrets. CI workflows now all declare least-privilege `contents: read`.

## 9 · Tests & regression
| Check | Result |
|---|---|
| gate-detector (6 changed files) | **PROCEED ×6** — zero frozen, no FG |
| check-workflows.sh | **OK** — all 6 parse |
| workflow least-privilege CLI | **OK — 6 workflows, all least-privilege** |
| typecheck node / web | **0 / 0** |
| eslint (`eslint apps/desktop --max-warnings 0`) | **0** |
| Focused (workflowPermissions) | **13 passed** |
| Full main suite (8 shards) | **10,813 passed / 7 skipped** (1035 files) |
| Full UI suite | **486 passed** (87 files) |
| SBOM gen + verify | 985 components · OK · digest `f861c70e…` |

**Decision-neutrality:** main 10,800 → **10,813** (+13 = the new workflow-permissions test); **zero existing tests changed**; UI unchanged. Adversarial coverage: classifier fails closed on missing block / write-all / stray `packages:write`; allowlist proven minimal (only the two release workflows, `contents:write`); the SAME write on a non-release workflow is rejected; every real workflow asserted least-privilege end-to-end.

## 10 · Files changed (all non-frozen)
- `package.json` (+`verify:workflow-perms` script; qs override reverted → git-clean)
- `.github/workflows/backend-ci.yml`, `.github/workflows/deploy-validation.yml` (least-privilege `permissions`)
- `.github/workflows/desktop-ci.yml` (run workflow-perms assertion + trigger on `.github/workflows/**`)
- **new** `scripts/verify-workflow-permissions.cjs`
- **new** `apps/desktop/src/main/release/workflowPermissions.test.ts`
- **new** `certification/DECISION-MEMO-S132-DEPENDENCY-REMEDIATION.md` + this cert

## 11 · Commits
One non-frozen commit (this session). Excludes custody-protected `baseline.json` + prior-session stray files.

## 12 · Frozen surfaces touched
**None.** gate-detector PROCEED on every changed file. No FG token consumed or guessed.

## 13 · Policies left undefined (STOP, not invented)
- qs remediation approach (force-override + cross-platform regen vs express 5 vs accept-and-monitor) → `DECISION-MEMO-S132-DEPENDENCY-REMEDIATION.md`.
- Vulnerability-blocking severity threshold → intentionally not invented (report-only preserved).
- Signed SLSA provenance / notarization → standing operator/secret gate.

## 14 · Remaining security / supply-chain debt
- qs/body-parser/express advisory (backend, moderate) — awaiting the Option A/B/C decision.
- SHA-pin `softprops/action-gh-release@v2` in both release workflows (resolve authentic SHA in a network-capable env).
- Dev-toolchain semver-major advisories (vitest/vite/esbuild/postcss/nanoid) — report-only; batch upgrade is its own slice.
- Signed provenance + notarization (operator/secret-gated).

## 15 · Whole-repository maturity (delta)
- **Workflow supply-chain:** every CI workflow now declares explicit least-privilege `permissions` (2 gaps closed), enforced by a deterministic test + CI step + CLI that fails closed on future regressions. Release-write is allowlist-scoped. SHA-pin remains documented debt.
- **Backend dependency security:** truthfully measured; remediation blocked on a decision (memo), not silently skipped.
- No product runtime change; no duplicate infra; no package deleted/retired; SBOM unchanged & truthful.

## 16 · Recommended S133
1. **Execute DECISION-MEMO-S132 Option A** in a network/multi-platform-capable env: force `qs@6.16.0`, regenerate a cross-platform-complete lockfile (retain the 107 platform binaries), verify qs cleared + backend regression + refreshed SBOM.
2. **Resolve + apply the `softprops/action-gh-release` SHA pin** (network-capable env) in both release workflows.
3. Or resume **enterprise convergence** (ERP/CRM/AI/knowledge) — the operational-read + governed-AI spine remains the highest product-value track; supply-chain debt above is CI-only and continuously reported.

**No FG token. No policy invented. No duplicate build/packaging/artifact system. No product runtime change. Zero frozen surfaces touched. Dependency remediation honestly BLOCKED, not faked.**
