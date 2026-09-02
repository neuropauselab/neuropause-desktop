# SESSION 52 — WINDOWS PACKAGED ACCEPTANCE GATE

## 1 · Executive result

**WINDOWS PACKAGING: GREEN — WINDOWS ACCEPTANCE: GRAY (no Windows execution environment exists;
measured, and the acceptance half was STOPPED rather than fabricated) — SIGNING: PENDING
OPERATOR CREDENTIALS (UNSIGNED, measured on the PE bytes).** The strongest honest new fact:
the Windows package ships an `app.asar` **byte-identical to the Mac rc.22 asar S51 proved on
its bytes**, so shipped-content is established by hash identity while every runtime claim
remains GRAY until a real Windows launch. Companion record:
`SESSION52-WINDOWS-ENVIRONMENT-BLOCKER.md` (the Phase-1 blocker, with the exact operator
runbook to convert GRAY into measurement).

## 2 · Baseline & custody (Phase 0)

HEAD `a09ab09` (S51) confirmed; tree dirty only by the custody-protected
`certification/baseline.json` (never staged; standing law) → provenance stamps `a09ab09-dirty`
honestly. Version `1.0.0-rc.22` in BOTH manifests (the S51 sanctioned bump; no new bump —
the Windows artifact is the rc.22 counterpart, deliberately, and inventing rc.23 for
appearance was refused). Protected artifacts untouched: `dist/` (rc.20), `dist-seam-s48/`
(rc.21), `dist-seam-s51/` (Mac rc.22), `dist-seam-b13/`. All S52 output went to fresh
`dist-seam-s52-win/`. `.env.entra` never sourced; zero `CSC*`/`*CLIENT_ID*` env.

## 3 · Windows environment (Phase 1) — measured NOT AVAILABLE

Host is Darwin arm64. UTM installed with ZERO VMs (utmctl list header-only; empty Documents
container; no `*.utm` via mdfind); no Parallels/VMware/VirtualBox/tart; no wine (and wine
would not qualify); `windows-release.yml` CI exists but needs a push — forbidden by the
standing NEVER-PUSH gate. Full detail + operator runbook in the blocker record. One incidental:
probing `utmctl` auto-launched UTM.app; it was quit immediately (no VM ever existed to touch).

## 4 · Version + build discipline (Phase 2)

No version mutation this session (both manifests already rc.22 via S51's
`scripts/bump-version.cjs`). Release-discipline pins **4/4**. Internal consistency measured:
root pkg = desktop pkg = `build-info.json` = exe VERSIONINFO (UTF-16 `1.0.0-rc.22` present) =
`beta.yml` feed = **1.0.0-rc.22**, commit stamp `a09ab09-dirty`, `connectorClientIds: {}`.

## 5 · Packaging (Phase 3) — canonical chain, first attempt, exit 0

`generate-notices` → `generate-build-info` → `electron-vite build` →
`electron-builder --win --x64 --publish never -c.directories.output=dist-seam-s52-win` →
`verify:release --platform win --dist dist-seam-s52-win` **PASS ×5** (feed parsed rc.22,
version parity, sha512 feed↔binary). Toolchain: electron 42.8.1 · electron-builder 26.15.3.
Notices/build-info regenerated (no tracked-file drift beyond what S51 committed).

```
NeuroPause-Setup.exe (NSIS, x64)      111,956,195 B  sha256 99a9a1b531b336a56b26794f9d3c945672e7d00e3dc02d44f180a7a9aa28acd6
NeuroPause-1.0.0-rc.22-win.zip        154,447,673 B  sha256 32c2a9858235b45f485f1bfe9069fb068d5ea328c921cd154f8785de297eda9b
NeuroPause 1.0.0-rc.22.exe (portable) 111,653,129 B  sha256 264a2cc5b672abbb2e818f8b4f2e9754eb4c841480e41677d7095872bef2dc29
win-unpacked/resources/app.asar        59,194,373 B  sha256 a265c467d9eb9c307fbf8c25723350253e60e06b0dfec815fa985e5becfe3298
+ beta.yml updater feed · blockmap · win-unpacked tree (app-update.yml, elevate.exe, docs, notices)
```

## 6 · Artifact content proof (Phase 4) — BY HASH IDENTITY to the S51-proven bytes

`dist-seam-s52-win/win-unpacked/resources/app.asar` sha256 **equals** the Mac
`dist-seam-s51/.../app.asar` sha256, compared directly file-to-file this session (both on
disk). Therefore S51's byte-level content proof transfers EXACTLY, not by inference:
S49 markers **11/11** (all placed in the main bundle) · S50 fence prose **3/3** in main ·
S50 editor/picker literals **4/4** exclusively in renderer assets · strip negatives **6/6 at
ZERO** across the whole asar (`__NP_E2E__`, `NEUROPAUSE_E2E_VERIFY`, `e2eSeed`,
`procurementUiJourney`, `PR-PILOT-1`, `installE2eSeedPrincipal`) · single-router evidence
(one `platform:command.dispatch` channel literal in main). No dev/test route ships; no
duplicate IPC router/bus; no renderer→store path — all as proven on these bytes in S51 §3.

## 7 · Phases 5–12 — runtime halves: GRAY, with the exact expected targets recorded

First launch · procurement click journey (expect 10/10, 10×5=50.00, linkage) · governance
negatives (expect 21/21 incl. received/reversal/convertedReceipt refusals, replay suppression,
origin fence, tenant rejection) · O2C chain (expect 27/27) + click journey (expect 9/9) ·
restart (expect 4/4, journal N→N) · Windows OS integration (profile dirs, locks, paths,
shutdown) · security/tenant/actor on win32 — **ALL NOT EXECUTED: no Windows kernel exists
here.** Nothing was substituted, simulated, or inferred. The blocker record carries the
verbatim acceptance procedure; the harnesses (`procurementUiJourney`, `s51PackagedNegatives`,
`o2cRuntime`, `o2cUiJourney`, `s48Restart`) are platform-neutral and already parameterized
with `NP_APP_BIN`/`NP_PROFILE_DIR`.

## 8 · Source → package → running-binary divergence (Phase 12)

LAYER 1 (source) = certified at `f453b1c`/`a09ab09` (S50/S51 suites). LAYER 2 (Windows
package) = **identical bytes to the proven Mac package** (measured hash equality). LAYER 3
(running Windows binary) = **NOT MEASURED — GRAY**. The three-layer discipline is honored by
refusing to claim layer 3 from layers 1–2.

## 9 · Signing / distribution trust (Phase 15)

**UNSIGNED**, measured: PE security-directory size = 0 in both `NeuroPause.exe` and
`NeuroPause-Setup.exe` (python PE-header read; electron-builder's "signing with signtool.exe"
log line is its asar-integrity resource stamping, not Authenticode — classified so nobody
reads the log as a signature). No Windows certificate configured or present in env.
**WINDOWS DISTRIBUTION TRUST: PENDING OPERATOR CREDENTIALS** — separate from functional
acceptance, which is separately GRAY. SmartScreen behavior for an unsigned installer will be
the usual warning path — a distribution fact, not a software defect.

## 10 · Full regression (Phase 13)

```
Full main            966 files · 10,124 passed · 7 skipped   (IDENTICAL to S51)
Full UI              79 files · 448 passed                    (identical)
Release discipline   4/4
Typecheck            node + web PASS
Lint (source scope)  exactly 1 error — the LOGGED pre-existing frozen-path defect
                     (cst/sendTransition.negative.test.ts unused import) — PRE-EXISTING,
                     untouched, classification unchanged
Mac packaged suites  not re-run (no source change this session; S51 evidence stands)
```

## 11 · Failure classification matrix (Phase 14)

- **RED: 0.**
- **YELLOW:** F-S51-1 (`npm run lint` red-by-sweep over untracked build dirs — now also sweeps
  `dist-seam-s52-win/win-unpacked`; same class, same follow-up) · S49/S50 carry-forwards
  (procurement legacy-door origin fence, F-S50-1…7, policy memos).
- **GRAY:** every Windows runtime/acceptance claim (Phases 5–12) · Windows signing/SmartScreen
  behavior · updater end-to-end on Windows.
- **ENVIRONMENT:** the `utmctl` 60-s hang (utmctl auto-launching UTM.app; no VM existed).
- **PRE-EXISTING:** the one source-scope lint error (logged in CLAUDE.md §1's defect log).

## 12 · Windows release decision (per the directive's own logic)

**WINDOWS PACKAGING GREEN / WINDOWS ACCEPTANCE GRAY.** NOT a functional GO: no first real
Windows user until the acceptance matrix runs on a real Windows environment. The Mac rc.22
CONDITIONAL GO from S51 is unaffected.

## 13 · Remaining global release fences

macOS notarization (operator Apple credentials) · Windows EXECUTION environment (operator —
the blocker runbook) · Windows Authenticode certificate (operator) · open policy memos ·
S48 pilot fences · F-S51-1 lint hygiene.

## 14 · Next recommended session

**S53 — Windows acceptance execution**: operator provisions a Windows 11 x64 environment (or
authorizes the CI push), then the recorded five-harness matrix runs unchanged against
`NeuroPause-Setup.exe`/win-unpacked; any Windows-specific defect found gets classified and
fixed under the normal gates. Notarization + Authenticode slot in whenever credentials arrive
(no session needed for the mac half).
