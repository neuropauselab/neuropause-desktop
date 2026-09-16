# GATE 20 — WINDOWS ACCEPTANCE · ROUND 63

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `b356682` (Gate 12)
**Scope:** Gate 20 only. Determine what keeps it from GREEN, reproduce, fix every **code-resolvable** issue, and
characterize the operator-gated remainder precisely. No product code changed (no defect found).

---

## STARTING STATE (round 62)

rc.21 (local-first) was built and driven on real Windows 11 ARM64 (QEMU/HVF, x64 emulation). **PASS:** B1
(device-local entry, 8/8 launches), B2 (org/workspace/runtime ready), B3 (tenant resolution LOST=0, recovered
54ms with no sign-in), B4 (no-handler=0), B7 (restart persistence), B8 (repeated launch clean, 723 handlers), B10
partial (privacy step honest-offline). **NOT driven → YELLOW:** B5 (import/export), B6 (Business/Assistant), B9
(owner-row), **B11 (provisioned-owner — "the last release blocker", never even reported)**.

## WHAT KEEPS IT FROM GREEN (reproduced/measured)

The residual is **execution on Windows**, not code. Two facts establish this:

1. **Independent Windows-specific defect hunt — NONE found.** B5/B6/B9/B11 were traced end-to-end for
   Windows-only breakage:
   - Filesystem paths use `path.join` / injected base dirs (`app.getPath('userData')`), never hardcoded `/`
     (`dataPlane/index.ts`, `enterprise/org/orgStore.ts`); the one path normalizer handles both separators
     (`backup/backupArchive.ts` `split(/[\\/]+/)`).
   - The window loads via `loadFile(join(__dirname,'../renderer/index.html'))` (`main/window.ts`), NOT a
     hand-built `file://` from a `C:\` path — the classic Windows bug is absent; the IPC origin gate is a
     `file://` scheme prefix check, unaffected by path shape.
   - The CSV importer drops `\r` and strips the UTF-8 BOM (`dataPlane/parsers.ts`), so a Windows CRLF / Excel CSV
     parses correctly.
   - Every `process.platform === 'darwin'` branch has a correct Windows path (the W-2 title-bar/gutter fixes hold;
     `windowChrome.ts`, `lib/platform.ts`, `Toolbar.tsx`, `index.ts` last-window-quit).
   - **Import ingests file CONTENT as base64 over IPC (`dp:import`) with NO native open-dialog**, and export's
     `saveExport` is an injected dependency — so B5 is drivable without a POSIX/native dialog.
   - B9/B11 owner-row logic is pure in-memory main-process code (`orgStore.ts` `protectedOwnerIdForTarget` /
     `assignProvisionedOwner` / `healProvisionedOwnerAnchors`) — no path/platform dependency.
   **Verdict: platform-safe; the four items behave identically on Windows.**

2. **B9/B11 execute at BOOT and are logged, GUI-free — the "never reported" was a capture gap.** `bindOwner`
   (`enterprise/index.ts:632`) runs `claimOwnerIdentity` at startup; on a fresh profile the device-local principal
   claims the unclaimed owner row and emits `INFO (enterprise) Owner bound to the active principal {local:true}`.
   That line is in `app.log` on the first fresh-profile launch — but the acceptance runner greps only the
   boot-health matrix and never this line, and in rc.21's capture it scrolled out of the 400-line
   `app.interactive.tail400.log` window. So B11 was undriven *for want of a grep*, not for want of the platform or
   the feature. (Confirmed: the captured tail-400 shows `Organization runtime ready {orgs:1,...,users:28}` and the
   boot bracket, but the owner-claim line is above the tail window.)

## FIXES LANDED (code-resolvable; verified on this host)

- **`scripts/verify-acceptance-artifact.cjs`** — new pre-flight manifest entry `owner-claim-boot-log`:
  marker `'Owner bound to the active principal'` (a RUNTIME string literal, minification-durable), source
  `apps/desktop/src/main/enterprise/index.ts`, `acceptanceItems: ['B9','B11']`. This complements the existing
  `protectedOwnerIdForTarget` identifier (which proves the guard SHIPS) with the log line B9/B11 are actually
  READ from, so the pre-flight confirms an artifact can produce B9/B11 evidence before a machine session.
- **`acceptanceArtifactParity.test.ts`** — its data-driven anti-rot pin auto-covers the new marker (asserts it
  still exists in `enterprise/index.ts`, and that it is minification-durable). **10/10 green on this host.**
- **`WINDOWS-ACCEPTANCE-ROUND32.md` (R63 amendment)** — records the defect-hunt result, the B9/B11 boot-log
  mechanism, and the single runner grep line to add in the FIRST-LAUNCH block
  (`Say ("owner.bound=" + (Grep 'Owner bound to the active principal'))`). The guest runner
  (`run-windows-vm/guest/acceptance-runner.ps1`) is a protected skill path, so the line is specified in the
  authoritative procedure doc for the operator to apply.

## TESTS / CHECKS (this host)

| Check | Result |
|---|---|
| `acceptanceArtifactParity.test.ts` (anti-rot incl. the new marker + load-bearing verifier) | **10/10** |
| Pre-flight manifest sanity (`owner-claim-boot-log` present, 10 entries) | PASS |
| No product/renderer/`.ts` code changed | confirmed (only a `.cjs` script + docs) |
| Host full-suite baseline (unchanged — no test added, data-driven pin) | main 912/9522/7 · UI 58/354 at HEAD |

## WHAT REMAINS (operator-executed Windows session)

- **B9/B11:** now capturable from the boot log via the runner line above — `owner.bound >= 1` on a fresh profile.
- **B5 / B6:** need the flows *triggered* (import a file; Business/Assistant respond) — no boot line stands in.
  IPC-drivable (base64 import, injectable export, IPC-backed Business/Assistant), so a future Playwright
  `_electron` harness on the guest could drive them without the framebuffer (the proven macOS
  `journalPackaged.e2e.cjs` pattern); until then they are driven by hand, and the QEMU framebuffer resolution is
  the knob to raise so the app window fits.
- Graceful `Shutdown flush complete` still needs a driven `app.quit` (menu/Alt+F4), not a force-kill.

This host cannot drive the Windows guest — the QEMU VM lives on the operator's Mac (`run-windows-vm` skill). The
run is therefore operator-executed, the same external-execution shape as S15 and Gate 8's live keys.

## GATE 20 RESULT

**YELLOW (unchanged).** No product code defect exists (independently verified). The B11 capture gap is closed on
the tooling side (pre-flight marker + anti-rot pin + runner instruction), so the next Windows session can report
B9/B11 from the boot log with no GUI. GREEN needs one operator-run interactive Windows session (rc.21 passes the
pre-flight) driving B5/B6 and capturing B9/B11 via the added grep — and a driven `app.quit`. Nothing was weakened.

## EXACT NEXT COMMAND (operator, on the Mac with the QEMU guest)

```bash
cd apps/desktop
node scripts/verify-acceptance-artifact.cjs --resources <staging-resources-dir>   # pre-flight: expect all 10 features present
# then, per WINDOWS-ACCEPTANCE-ROUND32.md, run the rc.21 acceptance on the Windows VM with the added
# `owner.bound=` grep, drive B5/B6 interactively, and capture app.first.log / screenshots into
# certification/windows-runtime-evidence-rc21/.
```
