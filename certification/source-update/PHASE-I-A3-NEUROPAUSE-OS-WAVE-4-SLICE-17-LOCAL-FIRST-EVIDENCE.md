# SLICE 17 — Local-first mode (kill the sign-in wall) · EVIDENCE

**Status: FG-6 LANDED (frozen bracket closed) — the honest `local` AuthStatus + device-local principal.**
Main-side local-first is TEST-VERIFIED and green; the renderer wall-kill + affordance + `local-mode.spec` land as
report-and-continue (below). FREEZE INTACT (both brackets recorded).

## The FG-6 token (honored, verbatim)
```
AUTHORIZED: FG-6 — local AuthStatus + device-local principal, per gate doc
```
Presented in `certification/source-update/FG-6-LOCAL-PRINCIPAL-GATE.md`; the operator ran the four read-only
confirmations (all matched) and issued the literal token with five on-record conditions + four condition-3 pins.

## Change-control bracket (both INTACT records committed)
```
<checkpoint>  alive(s17): local namespace rules (local:/@device.invalid) — FG-6 checkpoint
              freeze: re-record at s17 local-namespace checkpoint — INTACT #1 (BASELINE-3f19fb707fa0)
<frozen>      alive(s17): FG-6 honest `local` AuthStatus + device-local principal
              freeze: re-record at FG-6 local principal — INTACT #2 (BASELINE-43238f789694)
```
- The gate §8 "non-frozen helpers checkpoint first" was infeasible: every new module references `LocalPrincipal` /
  `state:'local'`, which do not exist until the contract lands, so nothing non-frozen compiles before the frozen diff.
  Fell back to the base §2.2 choreography — the checkpoint carries only the pure namespace rules (which compile
  pre-contract), and the status wrappers + store + edits land in the isolated frozen commit as authorized-diff +
  minimum-accompaniment. **The authorized §5 diff is byte-for-byte unchanged**; only the commit partitioning adapted.

## What landed (frozen, exact §5)
- `packages/shared auth.ts` — `LocalPrincipal { id; displayName; createdAt }` (no token/session/org) + additive
  `| { state:'local'; principal }`. Never conflated with `authenticated`.
- `authService.ts` — `restoreSession` no-account branch → `enterLocalMode()` (was the sign-in wall); `enterLocalMode()`
  loads-or-creates the stable principal → `state:'local'`.
- `runtimeCore.ts ×3` — the two CST actors → `resolveGovernedActor` (`local:<id>` self-disclosing; forged `local:`
  cloud id → deny; deny-by-default); `secureBridge.isAuthenticated` → `hasActivePrincipal` (local passes local RBAC).
- `enterprise/index.ts ×3` — `sessionEmail` ×2 → `sessionEmailFor`; `bindOwner` claims the owner for local via the same
  synthetic email the membership check then matches.

## Minimum accompaniment (non-frozen)
- `localNamespace.ts` (checkpoint) — pure rules: `local:<id>`, `@device.invalid`, forgery predicate, invalid-by-rule email.
- `governedActor.ts` / `localIdentity.ts` — the status wrappers (`resolveGovernedActor`, `hasActivePrincipal`,
  `sessionEmailFor`, `principalDisplayName`).
- `localPrincipalStore.ts` — enveloped JSON store; **`declareStoreScope` INSTALL_GLOBAL / SYSTEM / INSTALL_METADATA /
  retention NONE**; registered in `storePaths` (backed up + rollback-covered) so the id survives restore (pin 3).

## Consumer-audit table outcome (FG-6 condition 1) — 28 narrowing consumers, deny-by-default
- **Touched (accept local):** App.tsx render gate (renderer, follows), `authService` restore, the 2 CST actors, the RBAC
  dispatch gate, `sessionEmail` ×2, `bindOwner`. Each sorts `local` explicitly.
- **Auto-deny, no edit (11):** the 10 token-gated cloud clients + livesync `refreshRuntimeIdentity` — a local principal
  holds no access token → `getValidAccessToken()` null → fail closed; livesync only opens on `=== 'authenticated'`.
- **Deferred, safe fallback (documented):** subsystem audit/attribution actors (dataPlane/documents/identity/holds/
  governed-binding/ecosystem/directory/companion/telemetry) fall to their existing `null`/`'owner'`/`'system'`/off
  fallback — audit labels + optional surfaces, never authority, never cloud-authenticated. Structured actor-kind → S34.
- **TYPECHECK-FORCING = 0** — no compiler backstop; enforced by CLAUDE §4 new standing rule (every future AuthStatus
  consumer handles `local` explicitly).

## Pins honored (proofs)
- `local:` self-disclosing + **forged authenticated `local:` DENIED** (governedActor.test V-3 — the S33 confused-deputy
  edge, pinned now) + **never stripped** (localNamespace.test) — pins 1, 2.
- Stable id → correlation (V-5, localPrincipalStore idempotency) — pin 3.
- Deny-by-default actor: only `authenticated`/`local` → actor; else null → `NO_ACTOR` (V-4) — pin 4.
- `@device.invalid` synthetic non-routable tenant identity; **invalid-by-rule outbound** (D-12 addendum,
  `isDeviceInvalidEmail`).

## Proofs (RUN against BASELINE-43238f789694)
- New unit pins: `localNamespace.test` (5), `governedActor.test` (7), `localIdentity.test` (5), `localPrincipalStore.test`
  (3), `authService.test` local-mode (3). All green.
- Full main **8766 passed / 3 skipped** (828 files) · UI **254 passed** (34) · typecheck node+web clean · lint clean ·
  `verify-e2e-strip` **PASS** (no seam leaked). Pre-existing `typecheck:test` noise in
  `timelineTenancy.test.ts` / `webhookEgressTenancy.test.ts` (EventResource/WebhookPoster generics) — unrelated to FG-6;
  logged, not fixed in passing.

## Report-and-continue — renderer wall-kill (LANDED, non-frozen)
- `App.tsx` `local` branch → mounts the FULL shell (shared provider stack refactored into `Shell`) with a
  **clearly-synthetic** local display session (`localDisplaySession`: email in the `@device.invalid` namespace, no
  token, rendered ONLY inside the `local` branch — claims no authentication). The sign-in wall no longer gates a
  device-local principal.
- `LocalModeBanner` — the ONE affordance ("Working locally — your data stays on this device · Connect an account to
  sync"). Its CTA reveals the REAL `LoginScreen` (given an added optional `onDismiss` = "Keep working locally"), never a
  fake sign-in. UI truth: the banner is shown because the app is in the `local` branch.
- Tests: `ui-tests/localModeAffordance.test.tsx` (3) — the affordance renders + CTA fires; `LoginScreen` shows the
  way-back ONLY when reached from local mode. UI suite **257 passed** (35 files); typecheck:web + lint clean.

## Honest e2e status (NOT yet confirmed in-session)
- `e2e/localMode.e2e.cjs` (`local-mode.spec`) is written — a plain RELEASE build (no `NP_E2E_BUILD`/seed), fresh
  isolated profile, backend down; asserts the "Working locally" affordance is present and the sign-in wall is absent,
  with a runbook. **An in-session launch against the release bundle exceeded the 2-minute shell budget** (a full app
  boot with an unreachable backend is slow) — this is a heavy-launch timeout, **NOT** a proven pass or failure. So the
  main + renderer-component layers are TEST-VERIFIED, but the fresh-profile end-to-end walkthrough (including any
  first-run onboarding interaction) is **operator-runnable + UNCONFIRMED** — treated with the same honesty as the
  S14/S15 operator-run specs. Do not claim "fully usable local mode" until the spec is green.

## Remaining for S17 exit
1. Run `local-mode.spec` to green (fresh profile, networking off) — confirm no first-run modal blocks the shell; capture
   the walkthrough screenshot as PILOT-adjacent evidence.
2. Graceful cloud absence audit (the 10 token-gated clients render "unavailable — working locally", no error-spam).
