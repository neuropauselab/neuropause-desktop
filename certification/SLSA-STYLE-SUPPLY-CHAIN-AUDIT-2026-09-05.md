# NeuroPause Desktop — SLSA-style supply-chain & end-to-end readiness audit
### As of HEAD c65d76e (S126) · 2026-09-05 · Framing: SLSA v1.0 Build track (L0–L3) + Source track + related controls

This audits the *shipping/supply-chain* posture of the whole repo against SLSA, then adds the
end-to-end delivery gaps SLSA doesn't cover. Every row is evidence-based; unknowns are marked, not
guessed. "Met/Partial/Missing" is a claim about the SHIPPED artifact path, not about intent.

---

## 0 · TL;DR
- **Build track: ~L1 (partial).** A build description + weak self-attested provenance exist
  (`build-info.json`), and a real artifact↔feed integrity check exists (`verify-release-artifacts.cjs`,
  sha512). But provenance is **not signed**, **not builder-generated** in the SLSA sense, and the
  artifacts themselves are **unsigned / un-notarized** today.
- **Build L2/L3: not met** — no signed provenance, no isolated/hardened non-forgeable provenance.
- **Source track: unusually strong for L1–L2 intent** — git + branch + a frozen-surface **freeze
  baseline** enforced in CI (`certification-freeze.yml` / `verify-freeze.sh`) gives real
  tamper-evidence on certified source; **but** no evidenced two-person review / protected-branch policy.
- **Biggest gaps:** artifact **signing + notarization** (macOS Gatekeeper-rejected today), **no SBOM**
  (only license notices), **no SLSA provenance/attestation** (cosign/sigstore/in-toto absent), and
  **distribution maturity E0** (never a signed, notarized, verified public release).

---

## 1 · SLSA BUILD TRACK

| Requirement | State | Evidence |
|---|---|---|
| **L1 — Provenance exists / scripted build** | **PARTIAL** | Build is fully scripted (`package:mac/win/universal` → `generate-notices` + `generate-build-info` + `electron-vite build` + `electron-builder … --publish never` + `verify:release`). `build-info.json` bakes version / commit / channel / build-time / dirty-flag. **But** it is not SLSA-format provenance: no builder identity, no declared materials/inputs (dependency digests), no output-subject digest list. |
| **L1 — Provenance distributed with artifact** | PARTIAL | `build-info.json` ships inside the app (Release Diagnostics); the updater feed (`beta-mac.yml`) carries per-file sha512. No standalone provenance document accompanies the release. |
| **L2 — Hosted build service** | PARTIAL/UNPROVEN | `macos-release.yml` / `windows-release.yml` run on GitHub-hosted runners on tag push — but the certified artifacts to date were built **locally** (SEAM-B.13 dmg), and the hosted path has never produced a signed release. |
| **L2 — Signed provenance (authenticated, non-forgeable-by-tenant)** | **MISSING** | No provenance signing anywhere; `build-info.json` is plaintext, self-generated, editable. No cosign/sigstore/in-toto. |
| **L3 — Isolated, hardened builds; provenance unfalsifiable** | **MISSING** | No build isolation attestation; `--publish never` + local builds; no ephemeral-runner/hermetic guarantees recorded. |

**Net build level: L1-partial.** The honest artifact grade already recorded internally is **artifact
E3 / packaged-runtime E3 / distribution E0** (SEAM-B.11–B.13) — consistent with this.

---

## 2 · SLSA SOURCE TRACK (and NeuroPause's unusual extra control)

| Requirement | State | Evidence |
|---|---|---|
| Version control | MET | git; branch `cert/data-import-cst-integration`. |
| Change history / provenance of source | MET (+strong) | Per-slice conventional commits + evidence docs; **`certification-freeze.yml` fails CI when certified source moves without a re-freeze** (`verify-freeze.sh`, INTACT baselines) — a genuine source tamper-evidence control beyond typical SLSA source L1. |
| Frozen-surface governance | MET (product-specific) | `gate-detector.sh` + `frozen-surfaces.json` + FG-gate choreography gate every change to `packages/shared`, `cst/`, `connectors/index.ts`, `runtimeCore.ts`. |
| Two-person review / protected branches | **UNPROVEN** | No CODEOWNERS / required-review / branch-protection evidence in-repo; commits are single-author (agentic). This is the main **Source L2/L3** gap. |
| Retained, immutable history | PARTIAL | History retained; no evidenced push-protection / no-force-push enforcement (the program forbids history rewrite by policy, not by a proven server rule). |

---

## 3 · DEPENDENCIES, SBOM, VERIFICATION

| Control | State | Evidence / gap |
|---|---|---|
| Dependency pinning | MET | `package-lock.json` present (npm lockfile). |
| Vulnerability scanning (npm audit / Dependabot / Snyk) | **UNPROVEN / MISSING** | No scan step found in CI workflows; no Dependabot config observed. |
| **SBOM (CycloneDX / SPDX)** | **MISSING** | Only `THIRD-PARTY-NOTICES.md` (license text via `generate-notices.cjs`) — that is *attribution*, not a machine-readable bill of materials. |
| Artifact integrity check | MET | `verify-release-artifacts.cjs` verifies the updater feed's `sha512`/size against the on-disk binaries before publish; wired into every `package:*`. |
| Consumer-side verification of provenance | **MISSING** | No documented "verify provenance before install/deploy" step (there is nothing signed to verify). |

---

## 4 · ARTIFACT SIGNING / NOTARIZATION (the headline gap)

| Control | State | Evidence |
|---|---|---|
| macOS code-signing | **CONDITIONAL / OFF** | `electron-builder.yml` + `macos-release.yml` are env-driven, **fail-open-to-unsigned**: absent `APPLE_CSC_LINK` ⇒ clean **UNSIGNED** build. Local keychain proved a Developer ID exists (SEAM-B.13 signed locally), but CI has no secrets ⇒ CI releases are unsigned. |
| macOS notarization | **OFF** | `scripts/notarize.cjs` no-ops without Apple creds and writes a status marker; `electron-builder.yml notarize:false`. Gatekeeper **rejects** the current artifact (recorded SEAM-B.13). |
| Windows signing | **OFF** | `windows-release.yml` present; no signing cert wired. |
| Honesty of the gap | GOOD | The gap is documented, not hidden: unsigned/un-notarized is a *marker file*, and the workflow comments state signing is automation-ready pending secrets on a real macOS release run. |

**This is a standing OPERATOR/human gate** (real signing certs = money + custody), not an engineering
defect — but until it clears, there is **no distribution-ready artifact**.

---

## 5 · END-TO-END DELIVERY GAPS (beyond SLSA)

What is still missing to call the platform "shipped end-to-end", from the internal certification record:

1. **Distribution E0 → not started.** No signed, notarized, Gatekeeper-passing, publicly-verifiable
   release has ever been produced. Publishing to `neuropause033.com` is deliberately OFF.
2. **Real macOS keychain proof (S113/S115) — OPERATOR-PENDING.** Durable Ed25519 key → safeStorage →
   sign → restart → recover → verify → tamper cannot run in the Linux sandbox; needs a Mac.
3. **Real-Electron click-through journeys (S121–S126) — OPERATOR-PENDING.** The operational
   overview / reliability / connector-lineage / evidence-search / evidence-trace UIs are proven at the
   governed-read + UI-bridge layer, not by a real macOS Electron click session.
4. **One governed external effect only.** M365 `mail.send` is the sole live, provider-verified vertical
   (S15/S16). The cohort connector actions and everything else remain TEST-VERIFIED, not live.
5. **Policy-blocked convergence items (documented, not invented):**
   - Persistence migration/upcaster format → `DECISION-MEMO-S124` (blocked on format policy).
   - `packages/security` delegation/JIT/impersonation → authority policy undefined.
   - SLO objective for the reliability error-budget verdict → `DECISION-MEMO-S122` (verdict dormant).
6. **~39/46 packages remain unwired** (retirement candidates or safe-harvest candidates) — progressive
   convergence, not deletion.
7. **AI grounding on operational evidence** (search/trace → Brain context) is designed but **not wired**
   — the likely next frozen (FG) boundary.
8. **CI coverage of the release strip/verify** is partial: `verify-e2e-strip` rebuilds `out/` (can't run
   while the armed ceremony build must be preserved); no CI job asserts the packaged asar is seed-free.

---

## 6 · WHAT WOULD RAISE EACH LEVEL (prioritized remediation)

**To reach honest SLSA Build L2:**
1. Generate **SLSA provenance** in CI (e.g. `slsa-framework/slsa-github-generator` or `actions/attest-build-provenance`) emitting an in-toto attestation over the artifact digests. (Frozen-safe: CI-only, no product source.)
2. **Sign** the artifacts + provenance (Apple Developer ID + notarization for mac; cosign/sigstore for the attestation). Requires the standing human cert/secret gate.
3. Run the release on the **hosted runner** as the authoritative build (retire local-build authority).

**To reach Build L3:** ephemeral/isolated runners + provenance the build tenant cannot forge (hosted generator with an OIDC-bound signer).

**Cross-cutting (independent of level):**
4. Add an **SBOM** step (CycloneDX for npm) alongside `generate-notices`.
5. Add **dependency vuln scanning** (Dependabot config + `npm audit` gate) to `desktop-ci.yml`.
6. Add a **packaged-content strip assertion** in CI (grep the asar for e2e seed sentinels) so "no test
   seam ships" is enforced, not manual.
7. Add **branch protection + required review** (or record why the agentic single-author model is the
   accepted control) to close the Source L2 gap.
8. Add a **consumer verification runbook** ("verify signature + notarization + provenance before
   install").

---

## 7 · POSTURE SUMMARY

| Dimension | Grade | One-line |
|---|---|---|
| Scripted, reproducible build | **Good** | `package:*` deterministic; feed↔binary sha512 verified. |
| Build provenance | **Weak (L1)** | `build-info.json` self-attested; not SLSA-format, not signed. |
| Source integrity | **Strong intent** | Freeze baseline + gate-detector in CI; review policy unproven. |
| Artifact signing/notarization | **Missing (operator-gated)** | Unsigned, un-notarized, Gatekeeper-rejected today. |
| SBOM | **Missing** | License notices only. |
| Provenance signing/attestation | **Missing** | No cosign/sigstore/in-toto/SLSA generator. |
| Dependency vuln scanning | **Unproven** | No CI scan step found. |
| Distribution readiness | **E0** | No public signed verifiable release. |
| Governed runtime correctness | **Strong** | ~10,740 main + 486 UI tests green; governed reads tenant-safe. |

**Bottom line:** the *product/governance* engineering is mature and well-tested; the *supply-chain /
release* posture sits at roughly **SLSA Build L1**, and the path to L2 is mostly **CI-only additions
(provenance + SBOM + vuln scan + strip assertion)** plus the **standing human gate for signing certs**.
Nothing here requires inventing policy; the signing/notarization/publish steps are the operator's call.
