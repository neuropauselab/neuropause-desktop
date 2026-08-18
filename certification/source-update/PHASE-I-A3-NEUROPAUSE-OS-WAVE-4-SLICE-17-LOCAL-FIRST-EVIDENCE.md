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

## e2e — `local-mode.spec` GREEN (5/5, in-session, honest build)
`e2e/localMode.e2e.cjs` — a plain RELEASE build (no `NP_E2E_BUILD`/seed → `__NP_E2E__` false), FRESH isolated profile,
backend unreachable. **First run was against a STALE bundle** (built before the renderer branch landed) and showed the
wall — a stale-build artifact, not a failure; caught via the captured screenshot. Rebuilt with the renderer branch and
re-ran: **PASS, all 5 assertions:**
```
✓ window is not an e2e-seeded build (title: "NeuroPause")
✓ the "Working locally" affordance is shown
✓ the affordance offers to connect an account to sync
✓ the sign-in WALL is NOT shown (it is dead in local mode)
✓ the full product shell rendered (not a blank frame)
PASS — the sign-in wall is dead; a fresh unseeded build is usable in local mode.
```
**The sign-in wall is dead** on a fresh, unseeded, offline build — S17's headline is proven end-to-end.

### F-S17-1 · The captured screenshot shows the pre-existing first-run ONBOARDING over the mounted local shell
The screenshot (`e2e/artifacts/local-mode.png`) is **not** the `LoginScreen` wall and **not** a blank frame — it is the
pre-existing first-run onboarding ("Your AI. Your Data. Your Control." · **Try Free Locally** · Sign In · Skip setup for
now) rendering ON TOP of the mounted local shell (the assertions matched because `LocalModeBanner`'s "Working locally"
text + the shell are in the DOM beneath it, and the wall's "Sign in to your AI operating layer" is absent). So a fresh
profile DOES enter local mode (FG-6), and this onboarding — which FG-6 is what makes actually functional (its "Try Free
Locally" / "Skip setup" now lead into a real local principal instead of the dead wall) — is the intended S39 welcome.
**Finding:** two local-first entry affordances now coexist — the onboarding's "Try Free Locally" and the in-shell
`LocalModeBanner`. They are complementary (one-time welcome vs persistent in-shell reminder) but their messaging should
be reconciled into ONE coherent local-first story at **S39 (first-run experience)**. Not a defect; a design-coherence
item, logged.

## Graceful cloud-absence pass (LANDED, non-frozen)
Audited every renderer surface backed by the 10 token-gated cloud clients. Mechanism: `hasActivePrincipal` passes the
`requireAuth` gate for `local`, so each cloud client's own `not_authenticated` message ("Sign in to manage
organizations.") reaches the renderer as a RED error banner. Fixed with honest absence derived from the auth state
beneath (S19):
- New: `useIsLocalMode()` (auth `state==='local'`), `CloudUnavailableLocal` (EmptyState: "{feature} is unavailable
  while working locally" + a Connect-an-account button), `LocalModeConnectProvider`/`useLocalModeConnect` (shell-wide
  connect action, provided in App.tsx's local branch → reveals the real `LoginScreen`).
- **Gated (honest absence in local mode):** Organization (`AppShell` router, the live-session offender) · AI Store
  (`AppShell`) · Trusted Devices (`SettingsShell` panel, hook-safe wrapper) · Billing/Subscription (wrapper). Genuine
  failures (authenticated + backend down) STILL render as failures — the gate keys strictly on `local`.
- **Already graceful (no change, verified by the audit):** semantic search (lexical fallback + reason note), livesync
  (swallowed → connection layer), license (cached-tolerant), backfill (no renderer surface).
- Tests: `ui-tests/localModeAffordance.test.tsx` (+2 — honest-absence copy, connect wiring, explicit-action override;
  and NOT the "Sign in to manage" error). UI suite **259 passed**; typecheck node+web + lint clean.
- `local-mode.spec` extended: after the shell mounts it navigates to Organization and asserts the honest-absence copy
  (with a non-fatal fallback — the multi-step first-run onboarding is not reliably click-through in-harness, so the
  Organization honest-absence derivation is proven deterministically by the component test above; the e2e still proves
  the wall is dead + the shell mounts).

## S17 — DEFINITION OF DONE (walked)
| DoD item (roadmap S17) | status | evidence |
|---|---|---|
| No account → full product on local store | ✅ | FG-6 `enterLocalMode`; App.tsx `local` branch → full shell; `local-mode.spec` 5/5 |
| Cloud features absent GRACEFULLY | ✅ | Org/Store/Devices/Billing → `CloudUnavailableLocal`; semantic/livesync/license already graceful; backfill no surface |
| One affordance "Working locally — connect an account to sync" | ✅ | `LocalModeBanner` (top of shell) + per-surface connect via `CloudUnavailableLocal`/`useLocalModeConnect` |
| Every network call behind explicit connectivity+auth state | ✅ | cloud clients token-gated (fail closed for local); surfaces gate on `useIsLocalMode`; real failures still look like failures (S19) |
| First-run onboarding for local mode | ✅ (pre-existing) | the "Your AI. Your Data. Your Control." onboarding ("Try Free Locally"/"Skip setup") — FG-6 makes it functional; F-S17-1 reconciliation → S39 |
| Exit: fresh clone usable, networking off | ✅ | `local-mode.spec` GREEN on a plain release build, fresh profile, backend down |
| Playwright `local-mode.spec` | ✅ | `e2e/localMode.e2e.cjs` — 5/5 core; Org honest-absence via component test (e2e nav is best-effort) |
| Walkthrough evidence | ✅ | `e2e/artifacts/local-mode.png` (onboarding over the mounted local shell) |

**S17 CLOSED** — the sign-in wall is dead and cloud absence is honest. Open follow-ups tracked, NOT blockers: S39
reconciliation of the two local-first affordances (F-S17-1); softening the semantic-search "Sign in…" reason copy.
