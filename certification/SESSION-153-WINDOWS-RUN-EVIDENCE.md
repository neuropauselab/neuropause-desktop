# SESSION 153 — WINDOWS RELEASE-CANDIDATE CERTIFICATION (FAIL-CLOSED)
### Date: 2026-09-06 · Branch: cert/data-import-cst-integration · HEAD e59f3d2 · DOCS-ONLY (zero source, zero frozen)
### Verdict: **YELLOW — engineered + package-capable, but Windows operator evidence CANNOT be produced in this environment.** No Windows gate claimed GREEN. Nothing simulated.

---

## A · Environment ground truth (why this session stops)
The execution environment is **Linux, not Windows** — measured this session:
- `uname -a` → `Linux … 6.8.0 … aarch64 GNU/Linux`; `cmd.exe /c ver` → NOT PRESENT. (Also **aarch64**, not the
  x64 target a Windows release build requires.)
- Windows build/signing toolchain: `signtool.exe` ABSENT · `powershell.exe`/`pwsh` ABSENT · `makensis` (NSIS)
  ABSENT · `osslsigncode` ABSENT · `wine` ABSENT.
  - **Caveat recorded honestly:** `/usr/bin/signtool` IS present, but it is an unrelated Linux binary (not
    Microsoft's Authenticode `signtool.exe`) and **cannot Authenticode-sign a Windows PE**. It is NOT a
    Windows signing capability and is not used.
- Windows signing credentials: `CSC_LINK`, `CSC_KEY_PASSWORD`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` →
  **ALL UNSET**.

Mission rule: *"If the required Windows environment/certificate is unavailable: STOP FAIL-CLOSED. Do not run a
simulated Windows certification. Record the exact missing prerequisite as B — operator/environment. Produce the
Windows operator runbook and stop."*

**Therefore this session STOPS at the first Windows-hardware gate. Every Windows gate below is BLOCKED-B
(operator/environment), not RED (no engineering defect found), and none is marked GREEN.**

## B · Exact commit tested
`e59f3d2` (HEAD). Desktop app + frozen contracts unchanged since S150 `d4d6cc6` (S151 measurement; the only
later merge, `7704a77`, touched `apps/web`+backend only). Tracked tree clean except pre-existing
`certification/baseline.json` (M) + untracked stray docs carried from prior sessions — none is desktop source.

## Release-path gate ledger (SOURCE → … → VERIFY)
| # | Gate | Status | Class | Evidence / blocker |
|---|---|---|---|---|
| 1 | SOURCE (commit + integrity) | **VERIFIED HERE** | — | HEAD `e59f3d2`; desktop/frozen identical to S150; typecheck node/web 0/0 (S151, HEAD). |
| 2 | BUILD (electron-vite bundle) | NOT RUN | B | A Linux bundle proves nothing about a signed Windows artifact; not run to avoid conflation. |
| 3 | PACKAGE (win nsis/zip/portable) | **BLOCKED** | B | `electron-builder --win` needs a Windows host + NSIS; `makensis` absent, not Windows. |
| 4 | NSIS installer | **BLOCKED** | B | config present (`electron-builder.yml`: nsis oneClick:false, perMachine:false, dir-choice, shortcuts) — cannot build here. |
| 5 | Windows ZIP | **BLOCKED** | B | target configured (zip x64); cannot build here. |
| 6 | Portable artifact | **BLOCKED** | B | target configured (portable x64); cannot build here. |
| 7 | Authenticode signature | **BLOCKED** | B | no `signtool.exe`, no cert, `CSC_*`/`WIN_CSC_*` unset. |
| 8 | Certificate identity/validity | **BLOCKED** | B | no code-signing certificate available. |
| 9 | Signature validity on final artifacts | **BLOCKED** | B | requires the signed PE on Windows (`signtool verify /pa`). |
| 10 | Clean-VM / user install | **BLOCKED** | B | requires the `.exe` on Windows. |
| 11 | Per-user install behavior | **BLOCKED** | B | nsis per-user configured; needs a real install. |
| 12 | Launch + first-run onboarding | **BLOCKED** | B | needs the packaged Windows app. |
| 13 | Local-first shell | **BLOCKED** | B | needs the packaged Windows app (in-app-proven historically, not on a Windows artifact). |
| 14 | Authentication path | **BLOCKED** | B | operator-at-keyboard on the Windows app. |
| 15 | Governed ERP transaction | **BLOCKED** (win) | B | governed path is test-/runtime-proven (macOS build, prior); not reproducible from Linux for Windows. |
| 16 | Restart/relaunch durability | **BLOCKED** (win) | B | durable-journal recovery test-proven; Windows-packaged restart run pending. |
| 17 | No duplicate economic effect after restart | **BLOCKED** (win) | B | at-most-once test-proven; Windows-packaged run pending. |
| 18 | Packaged-content (no seeds/sentinels) | **BLOCKED** (win asar) | B | `verify-e2e-strip.sh` / `verify-packaged-content.cjs` need the Windows artifact. |
| 19 | SBOM / provenance | DEFERRED to the run | B | Node scripts are Linux-runnable, but the release SBOM must bind the actual Windows artifact set. |
| 20 | Release artifact hashes / feed | **BLOCKED** | B | `verify:release -- --platform win` compares feed sha512 ↔ Windows binaries. |
| 21 | SmartScreen behavior | **BLOCKED** | B | requires the signed installer downloaded on Windows; reputation accrues over installs (not from signing alone). |
| 22 | Windows credential/filesystem behavior | **BLOCKED** | B | packaged-app behavior (DPAPI/keychain, %APPDATA% profile) needs the Windows app. |

## C–P · Structured report
- **C · Artifact names + hashes:** **NONE PRODUCED** (no Windows build). Expected on the run:
  `NeuroPause-Setup.exe` (nsis), `NeuroPause-<ver>-win.zip`, `NeuroPause-<ver>-portable.exe`, `beta.yml` —
  sha512 recorded by `verify:release --platform win`.
- **D · Authenticode evidence:** **BLOCKED-B** — no signtool/cert.
- **E · Certificate evidence:** **BLOCKED-B** — no code-signing cert; `CSC_*`/`WIN_CSC_*` unset.
- **F · Installer evidence:** **BLOCKED-B** — cannot build nsis here.
- **G · Clean-install evidence:** **BLOCKED-B** — needs Windows.
- **H · First-run evidence:** **BLOCKED-B** — needs the packaged Windows app.
- **I · Authentication evidence:** **BLOCKED-B** — operator-at-keyboard on Windows.
- **J · Governed transaction evidence:** **BLOCKED-B this session** (test/runtime-proven historically; not
  reproducible from Linux for a Windows artifact).
- **K · Restart/recovery evidence:** **BLOCKED-B this session** (test-proven; Windows-packaged run pending).
- **L · Packaged-content / SBOM evidence:** **BLOCKED-B** on the Windows asar.
- **M · SmartScreen evidence:** **BLOCKED-B** — not observable without downloading the signed installer on
  Windows; **explicitly NOT claimed** (signing ≠ reputation).
- **N · Failures + classification:** **No A/C/D defect discovered.** Sole blocker is **B
  (operator/environment): a real Windows x64 host + an Authenticode code-signing certificate are absent from
  this Linux/aarch64 environment.** Release infra verified present/engineered in S151 (`package:win`,
  `verify:release --platform win`, nsis/zip/portable config, `windows-release.yml` CI).
- **O · Remaining release gates:** all of rows 3–22 — every one gated by Windows hardware + a signing cert,
  none by code.
- **P · Final verdict:** **YELLOW.** Engineered + package-capable; Windows RC operator evidence is missing
  because the required host/certificate are unavailable here. **NOT GREEN. NOT GA. Nothing simulated.**

## Exact operator runbook (execute on real Windows x64)
Prereqs: Windows 10/11 x64 host; **Authenticode (ideally EV) code-signing certificate**; Node LTS;
`set CSC_LINK=path\to\cert.pfx` + `set CSC_KEY_PASSWORD=…` (or `WIN_CSC_*`).
```
cd apps\desktop
npm ci
npm run package:win                                  # (3-9) build → nsis+zip+portable → Authenticode sign → verify:release --platform win
signtool verify /pa /v "dist\NeuroPause-Setup.exe"   # (7)(8)(9) signature + chain + timestamp
certutil -hashfile "dist\NeuroPause-Setup.exe" SHA256 # (C) installer hash (repeat for zip/portable)
:: On a CLEAN Windows VM / fresh user:
::   install NeuroPause-Setup.exe (per-user, dir choice, shortcuts)        (10)(11)
::   launch → onboarding (Skip setup → Skip tour) → local-first shell      (12)(13)(14)
::   run a governed transaction (create Sales Order / post journal)         (15)
::     proposal → confirm → execute → verify → evidence
::   quit + relaunch → durable state recovers, no duplicate effect          (16)(17)
::   observe SmartScreen on first download/run (record verbatim)            (21)
npm run verify:packaged -- --dir "dist\win-unpacked\resources"   # (18) no seeds/sentinels
npm run verify:sbom                                              # (19) SBOM/provenance
npm run verify:release -- --platform win                        # (20) feed sha512 ↔ binaries
```
Capture each command's real output here and flip the ledger rows to GREEN only where the output supports it.
**Do not claim SmartScreen reputation from a successful signature alone.**

## Scope discipline honored
No macOS claim (S152 already correctly YELLOW/B). No updater N→N+1 claim (host not exercised). No source
modified, no frozen surface touched, no FG requested (none needed — the blocker is environment, not contract).
No feature work, no deferred architecture reopened, no policy-open capability activated. No GA claim.

## Next release gate
Both real-hardware OS tracks (macOS S152, Windows S153) are **operator/environment-blocked (class B)** in this
Linux/aarch64 environment — neither is an engineering defect. The remaining release gates, in order of leverage
once an operator has hardware:
1. **macOS RC** — run the S152 runbook on Apple Silicon (most complete track).
2. **Windows RC** — run the runbook above on Windows x64 with an Authenticode cert.
3. **Updater N→N+1→rollback** — deploy the feed to `https://neuropause033.com/updates` and exercise a real
   upgrade + rollback (explicitly identified as the remaining release gate; updater readiness is NOT claimed).

**BLOCKED-B at the Windows packaging/signing gate: no Windows x64 host, no Authenticode certificate in this
Linux/aarch64 environment. No engineering defect found; release infrastructure present and engineered. Verdict
YELLOW — nothing simulated, no Windows gate claimed GREEN, no GA.**
