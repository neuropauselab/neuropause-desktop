# Sprint 5 — Early Access Readiness

This document covers Sprint 5: making NeuroPause ready for early-access users. It
delivers the **onboarding wizard and first-run experience**, a **Welcome Center**,
the **connector setup flow** (by deep-linking the existing Connectors surface, not
duplicating it), an **AI health dashboard** built as probes inside the existing
diagnostics framework, **feedback & support reporting**, **pilot mode**, and — as
the composite of all of these — the in-app early-access experience.

The sprint constraints were honored throughout: the Enterprise OS was not modified,
no new AI capabilities were added (AI health is read-only probes over subsystems
that already exist), and every increment was applied and verified green on the
development machine before the next began. Per the sprint brief, work **stops after
this document** pending review.

---

## 1. What was delivered

| Ask | Outcome | Where |
| --- | --- | --- |
| Onboarding wizard | Built: shared five-step catalog, persisted state service (8 tests), five IPC channels, modal wizard | `packages/shared/src/types/onboarding.ts`, `main/onboarding/`, `renderer/onboarding/OnboardingWizard.tsx` |
| First-run experience | Same state: the wizard mounts in `AppShell` only when the install reports `firstRun` | `shell/AppShell.tsx` |
| Welcome Center | Built: a `Welcome` sidebar section with the getting-started checklist, deep links, feedback card, pilot card, and "Restart tour" | `views/WelcomeView.tsx`, `shell/sections.ts` |
| Connector setup flow | Reused: the wizard/checklist "Open Connectors" deep-links into the existing `ConnectorsView` OAuth flow; no duplicate UI was written | wizard + welcome step links |
| AI health dashboard | Extended: three tested probes (Ollama reachability with the "ollama serve" hint, AI memory total, knowledge-graph counts) registered into the existing diagnostics service; rendered by the existing `DiagnosticsPanel` | `main/platform/aiHealthProbes.ts`, `registerDiagnosticProbes` in `main/platform/index.ts`, wiring in `main/runtimeCore.ts` |
| Feedback & support | Built: persisted feedback store (7 tests), four IPC channels, "Share feedback" card on Welcome; support remains the existing tested support bundle, linked from Welcome | `packages/shared/src/types/feedback.ts`, `main/feedback/` |
| Pilot mode | Built: persisted opt-in service (5 tests), two IPC channels, Welcome card with badge + Join/Leave; joining also completes the wizard's pilot step | `packages/shared/src/types/pilot.ts`, `main/pilot/` |
| Early-access experience | The composite: first-run wizard → welcome checklist → connect sources → check AI health → opt into pilot → send feedback | all of the above |

## 2. Behavior worth knowing

- **Wizard semantics.** `start` and `completeStep` are idempotent; finishing the
  last step sets `completedAt`; **Skip tour** dismisses (sets `completedAt`) while
  leaving steps individually incomplete, so the Welcome checklist keeps offering
  them. "Open …" buttons complete the step, navigate via the shell's own
  `SECTIONS`/`navigateByIndex`, and close the wizard. "Restart tour" calls the
  audited `onboarding:reset`, so the wizard greets again on the next launch.
- **AI health.** The Ollama probe GETs `/api/tags` with a timeout, mirroring the
  model client's URL resolution (`NEUROPAUSE_OLLAMA_URL`, then
  `http://localhost:11434`). If Ollama is not running, the check reads **down**
  with the recommendation `Try: ollama serve` — that is the probe working. Store
  probes report counts; a throwing store becomes a down check, never a crash.
- **Feedback posture.** Feedback is local and export-based — the same posture as
  crash reporting and telemetry; there is no remote ingestion service, and the UI
  copy says so.
- **Pilot mode.** Joining records the opt-in (first-ever `joinedAt` preserved
  across leave/rejoin) and badges the install. It does **not** change the update
  channel, unlock features, or alter runtime behavior.

## 3. State and storage

New per-install files under Electron `userData`, all written atomically with mode
0600: `onboarding.json`, `feedback.json`, `pilot.json`. Sprint 4 files
(`feature-flags.json`, `license-status.json`, livesync files) are unchanged.

## 4. IPC added this sprint

All Zod-validated, allowlisted, and registered in `runtimeCore` following the
established pattern: `onboarding:status`, `onboarding:start`,
`onboarding:completeStep`, `onboarding:dismiss`, `onboarding:reset` (audited);
`feedback:submit`, `feedback:list`, `feedback:export`, `feedback:clear` (audited);
`pilot:status`, `pilot:setEnabled` (audited). Renderer bindings live under
`ipc.onboarding`, `ipc.feedback`, and `ipc.pilot`.

## 5. Reproducing the verification

```
npm run lint
npm run typecheck -w @neuropause/desktop
npm test -w @neuropause/desktop
cd apps/backend && npm run typecheck && npm test
```

Expected at sprint close: desktop **525** passing tests across 66 files (26 new
this sprint: onboarding 8, AI probes 6, feedback 7, pilot 5), backend **168**, no
type errors, no lint warnings.

## 6. Honest gaps and pending confirmations

1. **Visual confirmations are still pending from the developer.** The renderer has
   no unit harness (long-standing), so these are eyeball checks that have not yet
   been reported back: the wizard greeting a first-run install and its
   Continue/deep-link/relaunch behavior; the Welcome checklist, Restart tour, and
   deep links; the three AI rows in Operations → Diagnostics; saving a feedback
   entry; Join/Leave on pilot mode. The service layer beneath every one of these
   is unit-tested.
2. Onboarding step completion is wizard/user-driven — creating an org or
   connecting a source does not auto-complete the matching step.
3. Feedback: `appVersion` is stored as null until `buildInfo` is threaded through;
   there is no list/export UI yet (IPC only) and no Operations-side entry point.
4. Pilot: the badge lives on the Welcome card only; a shell-header badge awaits an
   `AppShell` header recon. Pilot deliberately gates nothing.
5. Sprint 4's carried gaps remain open and tracked in
   `SPRINT-4-COMMERCIAL-READINESS.md` §8 (flag call-site gating and plan-tier
   sourcing, license enforcement/refresh cadence, sync renderer integration and
   old `cloud/sync` retirement, billing live-mode, per-entity sync authz).

## 7. Stop point

Per the Sprint 5 directive, no further work proceeds until this sprint is
reviewed and the next phase is approved.
