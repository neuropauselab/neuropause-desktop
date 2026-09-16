# DECISION-MEMO-S132 — qs / body-parser / express advisory remediation (BLOCKED, decision required)
### Date: 2026-09-06 · Advisory: GHSA-4mjr-xmp4-gh2g (qs DoS) · Status: STOPPED per S132 DEPENDENCY REMEDIATION RULE

## 1 · Finding (measured, current source)
- **Vulnerable component:** `qs@6.15.3` (a single deduped instance). Advisory GHSA-4mjr-xmp4-gh2g, severity **moderate** (current `npm audit`; S131 reported it as the "high" in the prod view — the advisory posture has since been reclassified to moderate). Vulnerable range: `qs 2.2.5 – 6.15.3`.
- **Dependency path (only one):** `@neuropause/backend → express@4.22.2 → { qs@6.15.3, body-parser@1.20.6 → qs@6.15.3 }`. `express` and `body-parser` are flagged **only transitively** (they "depend on vulnerable qs"). No other package in the repo consumes `qs`.
- **Reachability:** backend (`apps/backend`, Express HTTP layer) only. The Electron **desktop app never ships express/qs** (verified S131 — desktop packaged content is `out/**`, no express).

## 2 · Why a minimal safe update does NOT exist (measured, not assumed)
- **The only published fixed qs is `6.16.0`.** The `6.15.x` line ends at `6.15.3`; there is **no `6.15.4/6.15.5` patch** (registry-verified). So the fix requires crossing the `6.15 → 6.16` minor boundary.
- **Both parents pin `qs: ~6.15.1`** (= `>=6.15.1 <6.16.0`), measured from `express@4.22.2` and `body-parser@1.20.6`. There is **no patched express 4.x or body-parser 1.x** (registry-verified: nothing `>4.22.2 <5`, nothing `>1.20.6 <2`).
- **The npm `overrides: { "qs": "6.16.0" }` route does NOT apply cleanly.** Measured with npm@10.5.0: `npm why qs` reports `qs@6.15.3 overridden`, `npm ls` reports `invalid: "6.16.0" … ELSPROBLEMS`, and the installed/locked qs **stays 6.15.3** — npm refuses to force an out-of-declared-range override into the existing lockfile, leaving an inconsistent tree. This is not a stable, deterministic lockfile.
- **A full lockfile regeneration (`rm package-lock.json && npm install`) causes 107 unrelated version changes** — it strips every non-Linux platform binary (`@esbuild/darwin-*`, `@rollup/rollup-win32-*`, `@node-rs/argon2-*` for mac/win/android) because this sandbox is Linux/arm64. That would **break the macOS/Windows release builds** and is exactly the "significant unrelated dependency churn" the S132 rule forbids — and it *still* leaves qs at 6.15.3.

## 3 · The decision required (operator/architecture)
Pick one; each is a policy/architecture choice, not a mechanical fix:

- **Option A — Force qs 6.16.0 via override, regenerate the lockfile on a multi-platform-safe runner.** The override is legitimate (qs 6.16.0 is the advisory's own prescribed fix and is API-compatible with the `qs.parse` surface express/body-parser use). But applying it cleanly requires regenerating `package-lock.json` in an environment that preserves all platforms' optional binaries (a real CI matrix / mac+win, or `--os`/`--cpu` install flags), because a Linux-only regen drops 107 cross-platform entries. **Recommended**, but must run where the lockfile stays cross-platform-complete — not in this Linux sandbox.
- **Option B — Upgrade express to 5.x.** `express@5.2.1` pulls a fixed qs in-range, but express 5 is a **major, breaking** upgrade (router, middleware, body-parser API changes) requiring backend code changes + full backend regression. Broad churn; out of a "minimal remediation" scope.
- **Option C — Accept the moderate advisory with documented mitigation.** qs 6.16.0's fix is a `depth`/`isBuffer` DoS hardening; qs already enforces a default `depth` limit and body-parser caps request size. The exposure is backend-only, and the report-only CI scan (S131) surfaces it continuously. Accept-and-monitor until Option A's cross-platform regen is scheduled.

## 4 · What S132 did NOT do (honesty)
- Did **not** commit the `overrides` change — it produced an inconsistent (`invalid`) lockfile and did not actually upgrade qs. Reverted to pristine; `package.json` and `package-lock.json` are git-clean.
- Did **not** regenerate the lockfile (would have dropped 107 cross-platform binaries).
- Did **not** upgrade express to 5.x (breaking, out of scope).
- Did **not** invent a vulnerability-blocking threshold (CI scan stays report-only, per S131 + S132 policy).

## 5 · Recommendation
Adopt **Option A**, scheduled as a small dedicated slice that runs the qs override + lockfile regeneration on a cross-platform-complete environment (or with `npm install --os=darwin --cpu=x64 …` passes to retain optional binaries), then verifies (a) qs resolves to 6.16.0 everywhere, (b) the 107 cross-platform entries are retained, (c) backend regression is green, (d) the SBOM shows qs@6.16.0 and the advisory clears. Until then, the exposure is backend-only, moderate, and continuously reported.
