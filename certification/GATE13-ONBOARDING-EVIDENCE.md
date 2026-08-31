# GATE 13 — ONBOARDING

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `1d22de7` (Gate 12)
**Decision (operator):** CONSOLIDATE TO ONE ONBOARDING FLOW.

The row was **YELLOW**; round 36 fixed FirstRunExperience's five RED conditions. The one remaining item was the
"two-systems-back-to-back design" — a product decision left open. It is now decided and implemented.

---

## ROOT CAUSE

A brand-new user met **two onboarding systems back-to-back in the same session**:

1. **`FirstRunExperience`** — the full-screen takeover (welcome → processing → workspace → discovery →
   understanding), rendered by `AppShell` when the experience profile is `state:'pending'`. This is the REAL
   required setup: it writes the tenant AI-routing preference (`ai:preference.set`, RBAC), the workspace type,
   and the understanding attributes, then flips the profile to `completed`.
2. **`OnboardingWizard`** — a separate "Welcome to NeuroPause" checklist modal, rendered by `AppShell` when the
   profile is NON-pending (`experienceProfile.state !== 'pending'`). Its effect read `onboarding:status`, saw
   `firstRun:true`, and popped **the instant FirstRun finished** (and on Skip).

Sequence (AppShell, before): `pending` → FirstRunExperience → user finishes → `ipc.firstRun.set(state:'completed')`
→ AppShell re-reads → profile now non-pending → the `else if` branch mounts OnboardingWizard → its `firstRun:true`
pops the second modal. Two "Welcome to NeuroPause" dialogs, one after the other. **Confirmed by a negative
control** (below): under the pre-change code, a completed profile + `onboarding.firstRun:true` pops the wizard.

**Decisive fact for safe removal:** OnboardingWizard does **zero functional setup** — it only records "seen"
timestamps (`onboarding:completeStep`) and deep-links to sections (`onGoTo`). Org creation, connector linking,
AI-key entry all happen in the destination sections and in FirstRunExperience, independently. Removing it loses
only a duplicate tour, no required setup.

## ONBOARDING FLOW — BEFORE / AFTER

**Before (first launch):** FirstRunExperience takeover → (on finish/skip) → OnboardingWizard "Welcome to
NeuroPause" checklist modal → shell. Two onboarding surfaces.

**After (first launch):** FirstRunExperience takeover → shell. **One** onboarding journey. The wizard's checklist
content is **not lost** — it lives on, un-popped, as the persistent **Getting Started** section (`WelcomeView`),
still backed by the same `onboarding:*` service (which also feeds commercial telemetry) — so nothing was deleted
from the product's capabilities, only the redundant auto-popped modal.

**Returning user (both before and after):** sees NEITHER — a `completed`/`skipped` profile hides FirstRun; this
was already correct. The defect was strictly the first-launch double-exposure.

## IMPLEMENTATION (removed, not hidden)

- **`AppShell.tsx`** — removed the `OnboardingWizard` import and the `else if experienceProfile.state !== 'pending'`
  → `<OnboardingWizard/>` branch; the onboarding slot now renders FirstRunExperience (when pending) else nothing.
  Updated the `xp:profile.get` fail-open comment (a load failure now shows the shell with no onboarding, not a
  "legacy wizard").
- **`OnboardingWizard.tsx`** — **deleted** (the component no longer exists; genuine removal).
- **`focusTrapGate12.test.tsx`** — removed the OnboardingWizard import + its focus-trap `describe` block + the
  header reference (the component it tested is gone); the other four overlays keep their round-50 coverage.
- **`appNavigationE2E.test.tsx`** — updated the one stale comment naming the wizard.
- **KEPT** (shared, not onboarding-wizard-exclusive): `onboarding/*` main service + handlers, the `onboarding:*`
  channels, `ipc.onboarding`, `WelcomeView` (Getting Started), `commercial/*` telemetry, `onboardingService.test.ts`.

**Preserved:** all required setup (FirstRunExperience is unchanged and remains the complete first-run: AI mode,
workspace type, understanding). No security/tenancy/consent/authorization/provenance/fail-closed behavior touched
— the AI-preference RBAC path, the profile-state machine, and the Sign-In detour are all unchanged. The `legal`
step was a soft "seen" timestamp with no code gating on it, still reachable in Getting Started — no enforced
consent gate was removed.

## USER WORKFLOW VERIFIED (driven UI, `onboardingConsolidation.test.tsx`)

Over the REAL App/AppShell/providers:
- **First launch (pending):** exactly ONE onboarding surface appears (`findAllByRole('dialog', {name:'Welcome to
  NeuroPause'})` has length 1) — never two stacked modals.
- **After completion, even with `onboarding.firstRun:true` + a real next step** (the exact state that used to pop
  the wizard): NO onboarding overlay appears and the shell is usable — the back-to-back is gone.
- **Skipped profile:** no onboarding overlay.
- **Returning (completed) user:** no onboarding at all.

## TESTS / RESULTS

- New: `onboardingConsolidation.test.tsx` **4/4**. Updated: `focusTrapGate12.test.tsx` (wizard block removed;
  the other four overlays still green).
- Full main suite: **9494 passed / 7 skipped / 0 failed**.
- Full UI suite: **55 files / 344 passed / 0 errors**.
- Typecheck web **0**; ESLint on changed files **clean**.

## NEGATIVE CONTROL (executed)

Restored the pre-change `AppShell.tsx` + `OnboardingWizard.tsx` from HEAD and re-ran the "after completion, NO
second overlay pops" test with the poppable status (completed profile + `firstRun:true` + a real next step): it
**FAILED** — the "Welcome to NeuroPause" wizard dialog appeared (the back-to-back reproduced). Restored the
consolidation → 4/4. (An earlier draft used empty `steps`, under which even the old wizard rendered null — the
test was strengthened to a real step so it genuinely distinguishes old vs new.)

## GATE 13 RESULT

**YELLOW → GREEN.** The two back-to-back onboarding systems are consolidated to one coherent first-run journey;
the duplicate modal is removed (not hidden); returning users see no onboarding; all required setup and the
Getting Started checklist content are preserved; negative-controlled. No remaining blockers.

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run -c vitest.ui.config.ts ui-tests/onboardingConsolidation.test.tsx ui-tests/focusTrapGate12.test.tsx
```
