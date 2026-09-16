# SESSION 131 — SOFTWARE SUPPLY-CHAIN TRUST HARDENING (CI/repository-level)
## SBOM + build provenance + packaged-content assertion + dependency scan + workflow least-privilege
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · NON-FROZEN (zero frozen change, no FG token)

---

## 1 · SCOPE / BASELINE
- Baseline HEAD: **06127b1** (S130). This session is **CI/repository-level only** — no product runtime change, no packaging/notarization/signing/updater/installer/distribution work (all deferred per directive).
- `gate-detector.sh` = **PROCEED for every changed file** — zero frozen surfaces touched, no FG token consumed or guessed.

## 2 · DISCOVERY FINDINGS — existing supply-chain controls (measured at HEAD, starting from the SLSA audit)
Present already: `package-lock.json` (pinning) · `verify-release-artifacts.cjs` (feed↔binary sha512, unit-tested) · `verify-e2e-strip.sh` (seed-content strip — but REBUILDS out/, so unusable as an always-on PR gate) · `verify-m365-artifact-parity.cjs` · `certification-freeze.yml` (source tamper-evidence; already `permissions: contents: read`) · `generate-notices.cjs` (license attribution) · electron-builder `files:` rules (`out/**` + `package.json`, `!**/*.test.ts`).

## 3 · CONTROLS ACTUALLY MISSING (confirmed, not assumed)
- **SBOM** — no machine-readable bill of materials (only license notices). MISSING.
- **Build provenance** — only self-attested `build-info.json`; no digest-bound record. MISSING/PARTIAL.
- **Dependency vuln scan in CI** — no `npm audit` step, no Dependabot. MISSING.
- **CI-wired packaged-content assertion** — the only strip rule is `!**/*.test.ts`; nothing asserts the broader prohibited set on every PR. MISSING (partial content-strip existed but rebuilds out/).
- **Workflow least-privilege** — `desktop-ci.yml` (and `backend-ci.yml`) declared no `permissions:` block (inherited broad default token). WEAKNESS.

## 4 · CAPABILITY IMPLEMENTED (smallest valuable CI-only slice)
A cohesive supply-chain-trust slice, all deterministic + unit-tested, reusing the repo's `.cjs`-pure-functions + `src/main/release/*.test.ts` precedent:
1. **SBOM (CycloneDX 1.5) + provenance** — `generate-sbom.cjs` folds the committed `package-lock.json` (offline, deterministic) into a component document (deduped, sorted, workspace-links excluded) + a `provenance.json` binding commit/repo/workflow/builder/timestamp/**sbom digest**. `verify-sbom.cjs` fails closed on empty/invalid/mismatched/hostile SBOM.
2. **Packaged-content assertion** — `verify-packaged-content.cjs` scans the freshly-built `out/**` (no electron-builder needed) for prohibited material per the repo's ACTUAL packaging rules + a conservative prohibited set; hostile filenames cannot bypass.
3. **CI wiring** — `desktop-ci.yml` gains least-privilege `permissions: contents: read`, SBOM generate+verify, the packaged-content assertion, an SBOM/provenance artifact upload, and a (report-only) dependency vuln scan.
4. **Dependabot** — `.github/dependabot.yml` (npm + github-actions ecosystems, weekly, grouped).

## 5 · EXACT FILES / WORKFLOWS CHANGED (all non-frozen)
- **new** `apps/desktop/scripts/generate-sbom.cjs` · **new** `apps/desktop/scripts/verify-sbom.cjs` · **new** `apps/desktop/scripts/verify-packaged-content.cjs`
- **new** `apps/desktop/src/main/release/sbom.test.ts` (10) · **new** `apps/desktop/src/main/release/packagedContent.test.ts` (7)
- `apps/desktop/package.json` (+`sbom`, `verify:sbom`, `verify:packaged` scripts)
- `.github/workflows/desktop-ci.yml` (least-privilege + SBOM/verify + packaged-content + artifact upload + audit report)
- **new** `.github/dependabot.yml` · `.gitignore` (ignore generated `apps/desktop/dist-sbom/`) · this cert.

## 6 · SECURITY WEAKNESSES FOUND & FIXED
- **FIXED:** `desktop-ci.yml` had no `permissions:` block → added `permissions: contents: read` (least privilege; a future step cannot silently inherit write scopes).
- **FOUND, recorded (not auto-rewritten per directive):** `backend-ci.yml` also lacks a `permissions:` block; all workflows pin actions to major tags (`@v4`) not full SHAs (mutable third-party action reference). These are concrete but out of this slice's touched surface — recommended for a dedicated workflow-hardening pass; Dependabot's `github-actions` ecosystem now tracks action updates.
- **FOUND (real advisory):** production-dependency **high** — `qs` DoS via `body-parser`/`express` (GHSA-4mjr-xmp4-gh2g), plus 3 moderate. Origin: **backend** transitive (`apps/backend`); the Electron desktop app never ships express. See §8.

## 7 · RESULTS
- **SBOM:** IMPLEMENTED + VERIFIED — 985 components from the real lockfile; digest `sha256:f861c70e…`; `verify-sbom` OK (corresponds to lockfile). Deterministic (byte-stable across runs).
- **Vulnerability scan:** IMPLEMENTED (report) — 4 advisories (3 moderate, 1 high); the high is the backend `qs`/`body-parser`/`express` chain. See §8.
- **Provenance:** PARTIAL (IMPLEMENTED, self-attested) — `attestationLevel: SELF_ATTESTED_UNSIGNED`, binds commit + repo + workflow + builder identity + build timestamp + SBOM digest. CI fields populate under GitHub Actions; honestly `null` locally. NOT signed SLSA provenance (cosign/in-toto remains the operator-gated follow-up).
- **Packaged-content assertion:** IMPLEMENTED + VERIFIED — pure classifier, 7 tests incl. hostile-filename bypass attempts; runs on `out/**` in CI. (Does not replace `verify-e2e-strip.sh` content-grep; it is the always-on filename-level gate.)
- **Artifact/hash verification:** the SBOM digest is the S131 immutable hash; the existing `verify-release-artifacts.cjs` feed↔binary sha512 remains the release-artifact hash control (unchanged).

## 8 · PACKAGED-CONTENT POLICY + VULN-GATE AMBIGUITIES (documented, not silently decided)
- **Source maps:** the repo has NO explicit ship/strip policy for `*.map`. The assertion therefore flags them ONLY under `--prohibit-source-maps` (default off). RECORDED AMBIGUITY — needs an operator/release-policy decision, not invented here.
- **Vuln-scan gating threshold:** choosing a severity that BLOCKS a merge is a release-policy decision the repo has not made, and `npm audit` at the workspace root spans ALL workspaces — so gating desktop CI on a backend-only advisory (the express/qs high) would be wrong coupling. The scan is therefore REPORT-ONLY. A gating threshold + per-workspace scoping is the recommended follow-up. **The express/body-parser/qs prod-high is a real finding for a dedicated backend dependency-remediation slice (`npm audit fix` bumps qs/body-parser; requires backend regression) — NOT fixed here to keep this slice CI-only and in-scope.**

## 9 · TESTS & FULL REGRESSION (nothing hidden)
| Check | Result |
|---|---|
| gate-detector (9 files) | **PROCEED ×9** — zero frozen, no FG |
| check-workflows.sh | **OK** — all 6 workflows parse |
| YAML parse (dependabot + desktop-ci) | **OK** |
| typecheck node / web | **0 / 0** |
| eslint (CI command `eslint apps/desktop --max-warnings 0`) | **0** |
| Focused (sbom + packagedContent) | **17 passed** |
| Full main suite (8 shards) | **10,800 passed / 7 skipped** (1034 files) |
| Full UI suite | **486 passed** (87 files) |
| SBOM smoke (real lockfile) | 985 components · verify OK |
| Packaged-content smoke | clean tree passes · dirty tree (.env + *.test.ts) fails |

**Decision-neutrality:** main 10,783 → **10,800** (+17 = 10 SBOM + 7 packaged-content); **zero existing tests changed**. UI unchanged (no renderer change). Adversarial coverage: SBOM rejects invented/mismatched/empty/hostile-named components; packaged-content catches every prohibited class and cannot be bypassed by traversal/mixed-separator/case/nesting filenames.

## 10 · WHOLE-REPOSITORY MATURITY (delta)
- Supply-chain: **SLSA Build ~L1 → L1-strong** — SBOM (was MISSING → IMPLEMENTED/VERIFIED), digest-bound provenance (was MISSING → PARTIAL/self-attested), CI vuln scan + Dependabot (was MISSING → IMPLEMENTED-report), always-on packaged-content gate (was MISSING → IMPLEMENTED), desktop-ci least-privilege (was WEAK → FIXED). Signing/notarization + signed SLSA attestation remain the standing operator/secret gate (L2+).
- No product runtime change; framework-only packages untouched; no package deleted/archived/retired.

## 11 · REMAINING BLOCKERS
- **OPERATOR/SECRET-GATED:** artifact signing + notarization; signed SLSA provenance (cosign/in-toto); hosted-runner authoritative release. Standing human gate (certs = money + custody).
- **OPERATOR-PENDING (Linux sandbox):** macOS keychain proof (S113/S115); real-Electron click-throughs.
- **FOLLOW-UP (recorded):** backend `qs`/`express` prod-high remediation slice; workflow SHA-pinning + `backend-ci.yml` least-privilege; source-map ship policy; vuln-gate threshold policy.

## 12 · RECOMMENDED S132
1. **Backend dependency remediation** — `npm audit fix` for the express/body-parser/qs high + moderate advisories, then backend regression + updated SBOM. Concrete, high-value, closes the one real prod-high.
2. **Workflow-security hardening pass** — SHA-pin third-party actions + add least-privilege `permissions:` to `backend-ci.yml`/release workflows (Source-track / GitHub-Actions security).
3. **Signed provenance (operator-gated)** — wire `actions/attest-build-provenance` in the release workflow to emit an in-toto attestation over the artifact + SBOM digests (raises to honest SLSA Build L2).

**No FG token consumed or guessed. No policy invented (ambiguities documented). No duplicate build/packaging/artifact system. No product runtime change. Zero frozen surfaces touched.**
