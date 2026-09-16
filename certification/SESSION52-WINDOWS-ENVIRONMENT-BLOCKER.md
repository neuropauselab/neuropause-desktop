# SESSION 52 — WINDOWS ENVIRONMENT BLOCKER

> **CORRECTED 2026-09-03 (S53, §2 #20/#21/#30 — superseded text kept visible below): THIS
> BLOCKER'S PREMISE WAS FALSE. A fully-installed Windows 11 ARM64 QEMU VM existed the whole
> time at `~/vm-win11/` (35 GiB qcow2, EFI firmware, launch/keystroke/screenshot tooling, and
> the operator's own Gate-20 rc.20/rc.21 acceptance scripts, last used 31 Aug).** The S52
> environment sweep was a COMPLETE SEARCH OF THE WRONG SPACE: it checked hypervisor .apps,
> `.utm` bundles, `prlctl/vmrun/VBoxManage/utmctl/tart/wine` — and never `qemu-system-*`,
> which sits in `/opt/homebrew/bin`, nor disk images outside UTM's container. Third recorded
> instance of the confident-negative-over-narrow-space pattern (after the two in SEAM-B.22-R).
> What remains TRUE from this record: the packaging evidence, the artifact hashes, the
> UNSIGNED measurement, and the CI-needs-push constraint. What is WITHDRAWN: "no genuine
> Windows execution environment is available." S53 executed the acceptance on that VM —
> see `SESSION53-WINDOWS-REAL-RUNTIME-ACCEPTANCE.md`.

**Status: `WINDOWS_EXECUTION_ENVIRONMENT_NOT_AVAILABLE` — acceptance STOPPED before fabrication.**
Packaging itself succeeded (see SESSION52-WINDOWS-PACKAGED-ACCEPTANCE.md); this record states
exactly why the ACCEPTANCE half cannot honestly run, measured not assumed.

## Exact missing capability

A genuine Windows execution environment reachable from this session. Measured on this host
(Darwin arm64, 2026-09-03):

- **UTM installed, ZERO VMs** — `utmctl list` returns only the header row; the UTM Documents
  container is empty; `mdfind` finds no `*.utm` bundle anywhere on disk.
- **No other hypervisor**: Parallels Desktop, VMware Fusion, VirtualBox, `tart` — all absent
  (`/Applications` sweep + PATH sweep).
- **No wine/mono** (and wine would not qualify — the directive requires genuinely Windows-native
  execution; wine evidence would be fabricated acceptance).
- **CI Windows runner exists but is unreachable without a push**: `.github/workflows/windows-release.yml`
  is present, but triggering it requires pushing, and NEVER PUSH is a standing gate this session
  may not override.

## What COULD be verified (and was)

- The canonical `package:win` chain runs to completion on this host (electron-builder 26.15.3
  cross-packaging; NSIS + zip + portable + win-unpacked + beta.yml feed; exit 0, first attempt).
- The Windows package's `app.asar` is **byte-identical** (sha256 `a265c467…fe3298`, compared
  directly file-to-file) to the Mac rc.22 asar whose content was proven on its bytes in S51 —
  so every S49/S50 shipped-content marker and every strip zero transfers by HASH IDENTITY.
- verify:release `--platform win` PASS ×5; version identity consistent across both package
  manifests, the exe VERSIONINFO (UTF-16 `1.0.0-rc.22`), `build-info.json`
  (`a09ab09-dirty`, zero baked client ids), and the updater feed.
- Signing status measured on the PE bytes: security directory size 0 in both `NeuroPause.exe`
  and `NeuroPause-Setup.exe` — **UNSIGNED** (the builder's "signing with signtool.exe" log line
  is its asar-integrity resource stamping, not Authenticode).

## What could NOT be verified (all GRAY, none downgraded to PASS)

First launch · onboarding · renderer/preload load on win32 · governed IPC on win32 · the
procurement click journey · governance negatives against the running Windows binary · O2C chain
and click journey · restart/durability · SingletonLock/profile/path behavior on NTFS · process
shutdown semantics · updater behavior · every Phase 5–12 runtime claim. **The asar being
byte-identical is a CONTENT fact, not a RUNTIME fact — win32 `process.platform` branches,
path separators, profile locations and lock behavior can only be proven by execution.**

## Exact operator action required

Provide ONE of, in order of preference:

1. **A Windows 11 x64 machine or VM** (UTM/Parallels/anything real) with Node ≥20 — copy
   `dist-seam-s52-win/NeuroPause-Setup.exe` (sha256 `99a9a1b5…28acd6`) or the portable exe,
   plus the repo's `apps/desktop/e2e/*.e2e.cjs` harnesses and a `node_modules` with
   `playwright-core`; or
2. **Authorization to push** the release branch/tag so `windows-release.yml` builds AND a
   Windows machine to run the acceptance harnesses against its output; or
3. A remote Windows host with SSH access this session may drive.

## Exact acceptance procedure once an environment exists (the S51 shape, verbatim targets)

```
set NP_APP_BIN=<win-unpacked>\NeuroPause.exe        (or the installed app's exe)
node e2e\procurementUiJourney.e2e.cjs               → expect 10/10 + RESULT (50.00, linkage)
node e2e\s51PackagedNegatives.e2e.cjs               → expect 21/21 + RESULT
node e2e\o2cRuntime.e2e.cjs                         → expect 27/27 + RESULT
node e2e\o2cUiJourney.e2e.cjs                       → expect 9/9 + RESULT
journey with NP_PROFILE_DIR + NP_KEEP_PROFILE=1, then node e2e\s48Restart.e2e.cjs → 4/4
```
(The harnesses are platform-neutral Node/Playwright; `--user-data-dir` behavior on Windows is
one of the facts under test, not an assumption.)

## Why Windows cannot honestly be marked GREEN

Every GREEN in this program is a measurement. No Windows binary produced here has ever been
LAUNCHED — there is no Windows kernel on this host, no VM image, and no reachable runner. The
only honest statement is: **WINDOWS PACKAGING GREEN · WINDOWS ACCEPTANCE GRAY · SIGNING
PENDING OPERATOR CREDENTIALS** — exactly the split the S52 directive's own decision logic
defines for this case. Marking more would be Mac evidence wearing a Windows label.
