# GATE 18 — E2E PRODUCT TEST (DRIVEN-UI)

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `ee1ff81` (Gate 2)
**Scope:** Gate 18 only. Test-only change — no production/UI code modified (no bug found; the gap was coverage).

The row was **YELLOW** with one code-resolvable residual: *"the renderer layer is exercised only via the jsdom
harness (component tests), not by a driven-UI click-through … ; Windows end-to-end remains machine-blocked."*

---

## THE GAP (reproduced first, against the code)

Two E2E tiers already existed and neither drove the renderer as an integrated app:

- `src/main/e2e/productJourney.test.ts` — 8 phases over the **real production main-process classes**
  (experience profile, tenant AI preference clamp, org/workspace/governance stores, data-plane pipeline, restart
  persistence + audit hash-chain). It touches **no React/renderer** at all (verified: no `@testing-library`, no
  `window.neuropause`, no component render).
- `apps/desktop/e2e/*.e2e.cjs` (9 Playwright harnesses) — drive the **real packaged Electron app**, but require a
  display + a macOS Electron binary + a built `out/main/index.js`, so they are **not runnable in a headless CI
  sandbox** (they open and screenshot real BrowserWindows). This is why the achievable renderer E2E here is
  jsdom-based.

**The precise gap:** no test mounted the **real `App`** with its **real `AppShell` + real providers** and drove
a **real sidebar navigation (section click → section renders)** followed by an **in-section state machine** over
real IPC→main handlers. The only test importing `@renderer/App` (`authStateMachine.test.tsx`) mocks the entire
shell + provider stack to markers; every other driven-UI test mounts a single screen with `ShellProvider`/
`WorkspaceContextProvider` mocked away. Independent subagent verification confirmed this and confirmed a full
real-App mount is feasible in jsdom (no Electron-only provider API; every boot-time IPC caller catches, so an
unrouted channel degrades rather than crashes).

## WHAT WAS ADDED

`apps/desktop/ui-tests/appNavigationE2E.test.tsx` — a driven-UI E2E that mounts the **real `App`** (only
`useAuth` is mocked, to a deterministic `local` principal — no auth channels, no wall) inside the real
`ThemeProvider`, letting the **real `AppShell`, `Sidebar`, `ShellProvider`, `WorkspaceContextProvider`,
`ConnectionProvider`, and every other provider** boot over the real IPC→handler harness (`ui-tests/setup.ts`,
which dispatches routed channels to real handlers through real Zod schemas). Boot channels are routed so the
shell reaches a stable idle with no onboarding takeover blocking navigation (`workspace-ctx:bootstrap`,
`xp:profile.get`→completed, `onboarding:status`→not-first-run, `app:getThemeSource`, `app:getInfo`,
`livesync:status`, the three `intent:*`).

## E2E WORKFLOWS VERIFIED (real driven UI)

1. **Navigation + loading → success.** Click the real **"Business"** sidebar item → the section renders its
   **loading skeleton** (`.np-skeleton`, success not yet present) → the real `enterprise:modules` read resolves →
   the **family rail** ("Finance") renders and the skeleton is gone. Navigation, a loading state, and successful
   completion, all through the real `ShellProvider`/`AppShell`.
2. **Navigation + error/denial.** With `enterprise:modules` refused, clicking Business renders the **denial
   state** ("You don't have access to Business", no useless retry) through real navigation — never blank — with
   the shell chrome intact.
3. **Navigation between two sections.** Business → (Administration) → Business: the active view actually changes
   (the Finance rail leaves and returns), proving the real section state machine, not a one-shot render.
4. **Membership-gated workspace switch (state transition).** Open the always-mounted `WorkspaceSwitcher` → the
   popover leads with the **organization workspaces** from the real `enterprise:workspace.list` → click
   "Operations" → the membership-gated `enterprise:workspace.switch` is invoked with `{ id: 'ws-ops' }`.
5. **Refused switch (fail-closed, not silent).** A refused `enterprise:workspace.switch` surfaces the gate's
   message **verbatim** in a `role=alert` — the security-relevant refusal is shown, not swallowed.

Security/tenancy/consent/fail-closed preserved: `useAuth` is pinned to `local` (a device-local principal, no
cloud authority); the switch goes through the real membership-gated channel and its refusal is surfaced verbatim;
nothing about the routing/provider stack was weakened (the test only observes the real components).

## TESTS / RESULTS

- New: `appNavigationE2E.test.tsx` **5/5**.
- Full UI suite: **52 files / 337 passed** (was 51/332).
- Full main suite: **907 files / 9486 passed / 7 skipped / 0 failed** (unchanged — no main code touched).
- Typecheck web **0**; ESLint on the new file **clean**.

## NEGATIVE CONTROL (executed)

Neutered the real navigation — `SidebarItem`'s `onClick={() => setSection(section.id)}` → a no-op — and the
**three navigation tests failed** (clicking "Business" no longer renders the section: Finance/denial never
appear); restored → 5/5. This proves the tests drive the **real** sidebar navigation, not a superficial direct
render of `BusinessView`.

## GATE 18 RESULT

**YELLOW → GREEN.** The driven-UI click-through the residual named is now real and negative-controlled: the real
App shell is navigated as a user, with navigation, loading, error, state transitions and successful completion
all verified over real IPC→main handlers. Combined with the existing main-process product journey
(`productJourney.test.ts`) and the macOS **packaged** driven journey (Gate 26's Playwright run on the real app),
the product's critical workflows are proven end-to-end. Remaining (non-blocking, machine-blocked): a **Windows**
packaged-Electron driven run — the `e2e/*.e2e.cjs` harnesses are ready but need a display + Windows/macOS binary
unavailable in this sandbox (the same platform hold Gate 20 carries).

## EXACT NEXT COMMAND

```bash
cd apps/desktop
npx vitest run -c vitest.ui.config.ts ui-tests/appNavigationE2E.test.tsx
# packaged driven-UI on a real machine (macOS, with a build):
#   npm run build -w @neuropause/desktop && node e2e/localMode.e2e.cjs
```
