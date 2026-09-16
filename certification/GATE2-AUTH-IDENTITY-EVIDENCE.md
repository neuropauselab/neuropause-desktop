# GATE 2 — AUTH / IDENTITY

**Date:** 2026-08-30 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `33371ed` (Gate 10)
**Scope:** Gate 2 only. Gates 1/4 files inspected but NOT committed here (see "Decision on stranded work").

The row was **YELLOW** with two named residuals: *no re-restore on reachability recovery* and *renderer auth
state machine untested*. Both are now closed at the root, with regression tests and executed negative controls.

---

## DECISION ON STRANDED / UNCOMMITTED WORK (inspected first, nothing discarded)

| Working-tree change | Classification | Decision |
|---|---|---|
| `auth/authService.ts` + `auth/authService.test.ts` (M) | **Partially-implemented fix, in Gate 2's core file.** The stranded "Gate-1 offline entry-path" change degrades an offline-returning user (valid token, backend unreachable after retries) to **device-local mode** instead of the escape-less sign-in wall, with 4 tests incl. a discriminating negative (a genuine 401 still clears). It touches `restoreSession` — Gate 2's state machine — and is the FIRST HALF of the "re-restore on reachability recovery" story. | **KEPT and integrated into Gate 2.** The re-restore is the second half; both land together as one coherent auth-state-machine change. The offline→local half is credited below and also serves Gate 1's offline entry path. |
| `certification/GATE1-OFFLINE-LOCAL-FALLBACK-EVIDENCE.md` (untracked) | Evidence for the offline→local half (labeled Gate 1). | **Left untracked (not discarded).** This Gate-2 evidence covers the same authService change; the operator can retire or commit the Gate-1 file separately. |
| `e2e/tenantOwnership.e2e.cjs` + `certification/GATE4-RUNTIME-OWNERSHIP-EVIDENCE.md` (untracked) | **Unrelated stranded Gate-4 work.** | **Left untouched.** Not part of Gate 2. |
| `certification/baseline.json` (M) | Custody-protected freeze baseline (CLAUDE.md §1). | **Left untouched.** |
| `.claude/`, `dist-seam-b13/`, `out-run/`, `out-seam-b20/`, `source-update/SEAM-B37…` | Scratch / build / prior-seam artifacts. | Ignored. |

---

## ROOT CAUSE (reproduced against the code before any change)

`authService` is a pure **source**: it `emit('statusChanged')` and exposes `restoreSession`. It subscribes to
NOTHING — no connectivity, telemetry, or recovery signal (verified: its only imports are node builtins, electron
shell, config, logger, secureStore, backendClient, loopbackServer, localPrincipalStore). `restoreSession` runs
exactly once at boot (`index.ts`). So a user who launched offline degraded to device-local mode (stranded fix)
and **stayed there for the entire session** even after the backend returned — the "no re-restore on reachability
recovery" residual. Separately, **no test mounted `App`/`AuthProvider`**, so the status→surface mapping and the
main→renderer broadcast were unverified.

**A latent security defect surfaced while designing the re-restore** (independent subagent + code read):
`restoreSession` has no concurrency guard and its refresh bypasses the round-33 `refreshInFlight` single-flight.
Adding a runtime re-restore trigger makes two overlapping restores reachable — both read the same stored token
and both POST it, and the backend treats a re-sent (rotated) token as theft: **it revokes every session on
every device** (`refresh_reused`). This had to be closed as part of the fix, not after it.

---

## FIX (minimum, fail-closed, defense-in-depth)

- **`auth/authService.ts`**
  - `restoreInFlight` **single-flight** on `restoreSession` — all restore entry points (boot + reachability
    retry) share one in-flight run, so the rotating token can never be double-POSTed (closes the latent
    revoke-all).
  - `retryCloudRestore()` — re-attempts the cloud restore. **NO-OP unless status is `local` AND a refresh token
    is stored**, so it can never disturb an authenticated session, a logged-out user, or a genuine local-first
    user, and never contacts the backend in those cases. Single-flighted with `restoreSession`. **A genuine
    rejection here does NOT wall**: it clears the invalid token but STAYS local — a background reachability probe
    must never convert a working local session into the escape-less sign-in screen. Success promotes
    local→authenticated. A network error stays local and keeps the token for the next edge.
  - (integrated stranded change) the network-unreachable branch of `doRestoreSession` degrades to
    `enterLocalMode()`, not `unauthenticated`.
- **`runtimeTelemetry.ts`** — `probeBackend` fires an injected `onReachabilityRecovered` callback on the
  (recovering|disconnected)→connected **EDGE only** (once per recovery, never on every healthy probe). Injected,
  not imported, so the sampler stays dependency-free and unit-testable.
- **`backendReachabilityHub.ts`** (new) — dependency-free seam mirroring `tenantRecoveryHub`; the sampler
  announces, subscribers react. Best-effort (a throwing listener never withholds the edge).
- **`neuroCore.ts`** — constructs the sampler with `announceBackendReachable` as the edge callback.
- **`index.ts`** — at the boot composition point, `onBackendReachable(() => void authService.retryCloudRestore())`.

**Nothing weakened.** The re-restore only ever GRANTS by fully re-validating against the live backend (refresh +
`me`); an unreachable or rejecting backend never authenticates. Fail-closed, deny-by-default, and the
`@device.invalid` local principal (no cloud authority) are all preserved.

## FILES CHANGED

| File | Change |
|---|---|
| `src/main/auth/authService.ts` | `restoreInFlight` single-flight; `retryCloudRestore` + `doRetryCloudRestore`; integrated offline→local degrade |
| `src/main/backendReachabilityHub.ts` | **new** — dependency-free reachability edge seam |
| `src/main/runtimeTelemetry.ts` | fire the reachable EDGE via an injected callback |
| `src/main/neuroCore.ts` | wire the sampler's edge to `announceBackendReachable` |
| `src/main/index.ts` | subscribe the auth re-restore to the reachable edge at boot |
| `src/main/auth/authService.test.ts` | +8 Gate-2 pins (single-flight, recovery, no-ops, reverse-wall, e2e) |
| `src/main/runtimeTelemetry.test.ts` | **new** — edge fires once per recovery |
| `src/main/backendReachabilityHub.test.ts` | **new** — best-effort delivery |
| `ui-tests/authStateMachine.test.tsx` | **new** — App status→surface routing (6) |
| `ui-tests/authProviderTransitions.test.tsx` | **new** — provider seed + live broadcast (2) |

## AUTH WORKFLOW VERIFIED

- **End-to-end (integration, real `authService`):** offline launch → degrades to local (token kept) → backend
  reachable edge → `retryCloudRestore` → authenticated. (`authService.test.ts`)
- **Seams:** the reachable edge fires once per recovery (`runtimeTelemetry.test.ts`); the hub delivers
  best-effort (`backendReachabilityHub.test.ts`); the wiring is `neuroCore` (announce) + `index.ts` (subscribe).
- **Renderer:** every `AuthStatus` maps to the right surface, incl. the escape-less wall ONLY from genuine
  sign-in states, never from local (`authStateMachine.test.tsx`); the provider seeds and stays live via the
  `AuthStatusChanged` broadcast (`authProviderTransitions.test.tsx`).
- **NOT re-verified here (external-blocked):** a packaged-runtime offline→reconnect live run needs a backend
  that goes down then up; unavailable from this Linux sandbox (macOS `node_modules`, no display) — the same
  platform hold Gates 1/20 carry. Logic is covered at the integration + seam + renderer levels.

## TESTS / RESULTS

- Gate-2 cluster: `authService.test.ts` **19/19** (11 → 19), `runtimeTelemetry.test.ts` **3/3**,
  `backendReachabilityHub.test.ts` **2/2**, ui `authStateMachine` **6/6** + `authProviderTransitions` **2/2**.
- Full main suite: **907 files / 9486 passed / 7 skipped / 0 failed**. Full UI: **51 / 332**.
- Typecheck node + web **0**; ESLint on all changed files **clean**.

## NEGATIVE CONTROLS (executed)

Neutered three boundaries at once → exactly **3** assertions fail, restore → all green:
- `restoreInFlight` removed → the concurrent-restore pin fails (token POSTed twice = the revoke-all reuse);
- `retryCloudRestore` rejection made to wall → the "stays local, never an escape-less wall" pin fails;
- the telemetry edge made to fire every probe → the "fires once per recovery" pin fails.

## GATE 2 RESULT

**YELLOW → GREEN.** Both named residuals closed at the root with regression tests + negative controls; a latent
`refresh_reused` revoke-all closed in the same change. Only external-verification-blocked packaged-runtime
evidence remains (non-blocking, same class as Gates 1/20).

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run src/main/auth/authService.test.ts src/main/runtimeTelemetry.test.ts src/main/backendReachabilityHub.test.ts
npx vitest run -c vitest.ui.config.ts ui-tests/authStateMachine.test.tsx ui-tests/authProviderTransitions.test.tsx
# packaged-runtime GREEN needs a macOS launch: sign in with the backend up, quit, stop the backend, relaunch
# offline → local shell; restart the backend WITHOUT quitting → the session re-restores to authenticated.
```
