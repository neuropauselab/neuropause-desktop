# GATE 19 — macOS

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `5bc5ebb` (Gate 18)
**Scope:** Gate 19 only. One real product fix (identity boot log) + macOS driven-UI automation + artifact
characterization. Reuses the Gate-18 driven-UI infrastructure.

The row was **YELLOW** with two residuals: *"Known boot-window artifacts (first-boot graph/memory rebuild
ordering, identity first-run ERROR each boot). Full workflow click-through not automated."*

---

## THE GAPS (reproduced first, against the code + captured boot logs)

Independent subagent verification against the code and the only captured boot logs in the repo
(`certification/windows-runtime-evidence-rc20/app.{first,repeat,final}.log`, same code as the macOS build):

1. **identity first-run ERROR each boot — REAL BUG.** `identityStore.readFromDisk` logged at **ERROR** for
   *every* non-`loaded` read state, including `first-run` — the benign "file does not exist yet" case. A fresh
   profile (or a local-mode install that never synced an external identity) has no `identity.json`, so **every**
   boot emitted `ERROR (identity) Identity state could not be read…{"state":"first-run"}` (observed on all 7
   boots in `app.final.log`). It diverged from `graphStore.ts:230` / `memoryStore.ts:251`, which use the same
   reader and correctly exclude `first-run` and log at `warn`. This spurious ERROR is exactly what breaks the
   "clean boot / no new errors" claim this gate audits.
2. **first-boot graph/memory rebuild ordering — BENIGN (characterized, no fix).** `initGraph`/`initMemory` arm a
   one-shot boot reprojection (t+1.5s/1.6s). If no tenant is resolved yet it returns early at **INFO**
   (`graph/index.ts:104`, `memory/index.ts:162`: "rebuild skipped: no organization is active"), never ERROR;
   the ERROR paths guard on `principal === null` and wrap reads in try/catch. On a fresh boot an empty
   graph/memory is the correct state, and later data-change events re-trigger the projection; on subsequent boots
   the tenant resolves (RECOVERED in ~24ms) well before the timer. Self-healing INFO artifact — correct
   behavior, left as-is (optional future hardening: hook the boot reprojection to `tenantRecoveryHub`).
3. **Full macOS workflow click-through not automated.** The renderer's macOS chrome — the inset traffic-light
   gutter the shell renders ONLY on macOS (`Toolbar.tsx:24`, `pl-20` vs `pl-3`, driven by `lib/platform.ts`
   `IS_MAC`) — had **no test**; the Gate-18 driven-UI test runs with jsdom's non-Mac `navigator.platform`, so
   the macOS branch was never exercised.

## THE FIX + AUTOMATION

- **`src/main/identity/identityStore.ts`** — `readFromDisk` now excludes `first-run` and logs at **`warn`**
  (was `!== 'loaded'` + `log.error`), mirroring graphStore/memoryStore. A missing file is silent (correct empty
  queue); a genuinely corrupt/newer file still surfaces (so "no questions" is never confused with "couldn't
  read"). One-line condition + level change; no behavior change beyond the log.
- **`src/renderer/src/lib/platform.test.ts`** (new) — pins `isMacPlatform` both branches (MacIntel/Mac → true;
  Win32/Linux/'' → false), the pure detection behind the chrome decision.
- **`ui-tests/macosJourney.test.tsx`** (new) — mounts the **real `App`** with `@renderer/lib/platform` forced to
  macOS (`IS_MAC` true) so the **real `AppShell` + `Toolbar`** render the macOS gutter, then drives the full
  workflow under it.
- **`src/main/identity/identityStore.bootLog.test.ts`** (new) — pins the boot-log fix.

## USER WORKFLOWS VERIFIED (macOS driven UI)

- **macOS chrome present.** The real shell's toolbar (banner landmark) renders the 80px traffic-light gutter
  (`pl-20`), never the Windows/Linux frame (`pl-3`) — the macOS-specific rendering, exercised for the first time.
- **Navigation into a section under macOS chrome** — click "Business" → loading skeleton → success family rail,
  over the real `ShellProvider`/`AppShell`/`Sidebar` and real `enterprise:modules` handler.
- **Membership-gated workspace switch through the macOS shell** — open the switcher → org workspaces load →
  switch "Operations" → the gated `enterprise:workspace.switch` is invoked (`{id:'ws-ops'}`).
- **Clean boot (no spurious identity ERROR)** — a fresh profile's missing `identity.json` no longer logs an
  ERROR; a corrupt file still warns.

Live macOS launch was already verified and is cited rather than re-run (a packaged Electron launch is not
runnable in this Linux sandbox): Gate 16 round-46 LIVE run (`Startup complete 478ms`, 723 secure handlers,
graceful `Shutdown flush complete {ran:23}`); Gate 27 packaged rc.20 (`Startup complete 271ms`, 722 handlers);
Gate 26 macOS interactive Playwright journey (account → first-run → AI → workspace → tour → shell → Assistant,
25+ screenshots). Security/tenancy/consent/fail-closed unchanged: the identity fix only lowers a log level for a
benign state (a corrupt file still surfaces); the switch stays membership-gated; `useAuth` is pinned to a
device-local principal.

## TESTS / RESULTS

- New: `identityStore.bootLog.test.ts` 2/2, `platform.test.ts` 2/2, `macosJourney.test.tsx` 2/2.
- Full main suite: **909 files / 9490 passed / 7 skipped / 0 failed** (the identity log-level change broke no
  existing test — nothing asserted the ERROR).
- Full UI suite: **53 files / 339 passed**.
- Typecheck node + web **0**; ESLint on changed files **clean**.

## NEGATIVE CONTROLS (executed)

- Revert the identity fix (`!== 'loaded'` + `log.error`) → the "missing file logs nothing" pin fails (a
  first-run read logs ERROR again); restore → green.
- Neuter the Toolbar macOS branch (`pl-20`→always `pl-3`) → the macOS journey's gutter assertion fails; restore
  → green. Proves the assertion is load-bearing on the real Toolbar code.

## GATE 19 RESULT

**YELLOW → GREEN.** Both named boot artifacts resolved (identity ERROR fixed at the root; graph/memory skip
characterized as a benign self-healing INFO), and the full macOS workflow click-through is automated over the
real App shell with the macOS chrome exercised for the first time — negative-controlled. Remaining (non-blocking,
machine-blocked): a packaged-Electron macOS launch driven by hand needs a display + binary unavailable here (the
`e2e/*.e2e.cjs` harnesses are ready; Gate 26 already drove the macOS packaged journey via Playwright).

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/main/identity/identityStore.bootLog.test.ts src/renderer/src/lib/platform.test.ts
npx vitest run -c vitest.ui.config.ts ui-tests/macosJourney.test.tsx
```
