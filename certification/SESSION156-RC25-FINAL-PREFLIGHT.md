# SESSION 156 — RC.25 FINAL RELEASE PREFLIGHT (code-side)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD f46abbc · DOCS-ONLY (zero source, zero frozen)
### Verdict: **RC.25 PREFLIGHT = GREEN (code-side).** Engineering-complete, no defect. Operator certification (sign/notarize/publish/install/update) remains PENDING and is NOT claimed.

---

## 1 · Repository integrity
- HEAD `f46abbc`; branch `cert/data-import-cst-integration`.
- `git status`: only pre-existing `certification/baseline.json` (M) + untracked stray docs
  (`.claude/`, SLSA audit, two NP-* evidence docs) — **no source modifications**; all S151–S155 commits are
  docs-only.
- Desktop version = **`1.0.0-rc.25`** (`apps/desktop/package.json`).
- **Frozen contracts unchanged since S150 `d4d6cc6`:** `git diff d4d6cc6 HEAD -- packages/shared
  apps/desktop/src/main/runtimeCore.ts apps/desktop/src/main/enterprise/index.ts` = EMPTY.
- typecheck **node = 0 / web = 0** (re-run this session at HEAD). Release scripts resolve (`package:mac/win/
  universal`, `verify:release`, `verify:sbom`, `verify:packaged`, `generate-build-info`, `notarize`).
- No source change made — the report was not "cleaned up" by editing code.

## 2 · Release version consistency (single source → all stages)
`package.json` **1.0.0-rc.25** is the sole version source:
- `generate-build-info.cjs` reads `../package.json`; derives channel from the prerelease tag
  (`-internal.*` → internal, else **beta**) ⇒ rc.25 → channel **beta** → `resources/build-info.json`.
- `electron-builder` reads the same `package.json` version; `electron-builder.yml publish.channel: beta`
  matches.
- Feed metadata emitted as `beta-mac.yml` / `beta.yml`; the app's updater reads the baked `beta` feed.
- ⇒ **rc.25 is internally consistent** across package.json → build-info → electron-builder → feed → updater.
  No new version invented. (Note: `build-info.json` on disk records the last *built* artifact rc.24; it is
  regenerated at package time, so the published build will stamp rc.25 — expected, not a defect.)

## 3 · Release workflow preflight (config only — no runner executed)
Both workflows preserve the intended sequence:
`tag → signing-capable runner (macos-latest / windows-latest) → build/package → sign (env-driven CSC) →
notarize where applicable (notarize.cjs) → verify:release → artifact publish (scp) → feed publish (scp
beta*.yml + payloads + blockmap → /updates/, beta→latest alias) → HTTPS reachability curl`.
No fake/local substitute for the signing runners was executed.

## 4 · Deployment safety (source/config-verified)
- **`PUBLISH_TO_SITE == 'true'` gate** present in BOTH workflows (2 gated steps each: artifact + feed). ✓
- **`DEPLOY_SSH_KEY` isolated to deployment** — held in the publish steps' own `env:`; the job exposes only a
  boolean `HAS_DEPLOY_KEY`, not the key, to other steps. ✓
- **Local builds cannot publish** — all `package:mac`/`package:win`/`package:mac:universal` scripts use
  `--publish never` (3 occurrences). ✓
- **Feed destination** = `root@64.227.128.218:/opt/neuropause-site/website/updates/` (served at
  `https://neuropause033.com/updates`), the URL baked via `electron-builder.yml`. ✓
- **No renderer-controlled publication target / no arbitrary update URL** — feed URL baked at build; channel
  coerced to a fixed enum; no `setFeedURL`/renderer URL (S154). ✓
- No secret values read or printed.

## 5 · Release verification readiness
`verify-release-artifacts.cjs` is ready to validate, fail-closed on any missing/mismatched artifact
(recomputed base64 sha512 ↔ feed):
- **macOS:** `beta-mac.yml` · `NeuroPause-arm64.dmg` · `*-mac.zip` · `*.blockmap`.
- **Windows:** `beta.yml` · `NeuroPause-Setup.exe` · `*.zip` · portable `.exe` · `*.blockmap`.
Missing installer / payload / feed, or a digest/size mismatch → non-zero exit (fail-closed). ✓

## 6 · FINAL OPERATOR CHECKLIST
**A. GitHub repo variable:** `PUBLISH_TO_SITE=true` — presence **UNKNOWN** (repo variables not readable here).
**B. Required secrets (presence UNKNOWN — not readable here; values never exposed):**
`APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID` · `APPLE_CSC_LINK` · `APPLE_CSC_KEY_PASSWORD` ·
`WIN_CSC_LINK` · `WIN_CSC_KEY_PASSWORD` · `DEPLOY_SSH_KEY` → all **UNKNOWN** (referenced in CI; set/confirm in
GitHub → Settings → Secrets and variables → Actions).
**C. Trigger:** push tag `v1.0.0-rc.25`.
**D. Expected pipeline:** build → sign → notarize (mac) → `verify:release` → publish artifacts → publish feed
→ HTTPS feed check.
**E. Required post-publication evidence (capture verbatim; do not infer):**
`https://neuropause033.com/updates/beta-mac.yml` reachable · `…/beta.yml` reachable · real artifact SHA-512
hashes (from `verify:release`) · real signing evidence (`codesign`/`signtool verify`) · real install evidence
(fresh-profile launch on macOS/Windows).

## 7 · Rollback (unchanged; operator's decision, not selected)
- **A. Current design:** roll-forward + operator/feed-driven recovery using `rollbackTarget()`
  (`allowDowngrade=false`). Zero code.
- **B. Future option:** automatic in-app downgrade — only after explicit policy authorization (a scoped
  engineering slice; NOT implemented).

## 8 · Change rule
**No engineering defect found → ZERO SOURCE CHANGES.** No frozen contract needed modification; no FG requested.

## 9 · Final verdict
- **RC.25 PREFLIGHT: GREEN (code-side).**
- **Engineering status:** ENGINEERING-COMPLETE — integrity clean, version rc.25 consistent, workflows/deploy
  safety verified, verify:release fail-closed, typecheck 0/0, frozen unchanged, no defect.
- **Operator blockers (all B/GRAY, none engineering):** GitHub secrets + `PUBLISH_TO_SITE` presence UNKNOWN;
  tag push on signing-capable runners; host actually serving `/updates/` (S154 showed empty).
- **Exact release trigger:** push tag `v1.0.0-rc.25` (after §6-A/B are set).
- **Exact evidence required after the workflow runs:** §6-E — feed reachable (mac+win), real hashes, real
  signing evidence, real install evidence; then S152/S153 install certification + S154 N→N+1 run.
- **Exact next gate:** the operator release workflow/tag — **not another feature-development session.**

**No GA claim. No signing/notarization/SmartScreen/feed-publication/update-certification claimed. No source
modified, no frozen surface touched, nothing simulated, no secret values read. This is the final code-side
preflight; the code side is GREEN with no defect — the next action is the operator release tag.**
