# WHOLE-PRODUCT FINAL ENGINEERING AUDIT

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `e51f9f4` (Gate 27, rc.21)
**Readiness matrix at audit start:** round 60 — **GREEN 23 · YELLOW 4 · RED 0 · GRAY 0**.
**Nature:** whole-product audit from 0→100%, NOT a gate. No new gates created or invented. The audit
inspects every module/feature/IPC route/workflow/screen, traces the critical workflows end-to-end, runs the
existing suites, adds only missing high-value coverage, fixes genuine defects, and separates **VERIFIED** from
**EXTERNALLY BLOCKED** from **NOT YET VERIFIED**. "GREEN gate" was never assumed to mean "the whole product is
done" — this pass looked past the scoreboard.

---

## METHOD

Four independent subagent audits (fresh context each), then reconciliation against first-hand measurement:

- **Audit A — coverage / inventory:** repository-wide module + feature + IPC map; hunt for
  stubbed/unreachable/placeholder/partial functionality and orphan exports.
- **Audit B — security / IPC integrity:** every declared channel vs. every registered handler; called-but-
  unregistered channels; classification-invariant integrity; authority resolution.
- **Audit C — UX / integration honesty:** every shipped (non-preview) screen for copy that outruns reality;
  disclosure vs. capability.
- **Audit D — critical-workflow tracing:** the six consequential workflows UI→IPC→main→storage/provider→
  response→UI.

The audit changes **exactly one** production file (a UI-truth copy fix) plus one new regression test. Every other
finding is either already-correct-by-design, an external hold already tracked on the matrix, or a low-severity
item deliberately documented-not-fixed with its reason (changing working code without a verified defect is out of
scope by the audit's own rules).

---

## PRODUCT AREAS AUDITED

| Area | Verdict |
|---|---|
| IPC layer — 773 declared channels, 743 invokable (20 legacy router + 723 runtime secure-bridge), 31 broadcast | **VERIFIED** — every runtime channel is gated (permission/requireAuth) or on `PUBLIC_CHANNELS`; `assertAllChannelsClassified` returns `[]`; startup throws if any channel is unclassified (`runtimeCore.ts:4088-4107`), pinned by `runtimeAuthz.test.ts` + `routerClassification.test.ts`. No called-but-unregistered channel found. |
| Multi-tenancy | **VERIFIED** — `createTenantContextResolver`/`resolveFull()` fail-closed; O(users) membership scan proven strictly linear (Gate 22); org/workspace name uniqueness enforced at store chokepoints (Gate 23). |
| Auth / identity | **VERIFIED** — refresh token in `secureStore`, access token in-memory only, never to renderer; `restoreInFlight` single-flight; reachability-recovery re-restore guarded to `local`+token (Gate 2). |
| AI mode routing | **VERIFIED** — `resolveEffectiveAiMode` clamps `min(platform, tenant)`; boot router fail-closed; local mode = `@device.invalid`, no cloud authority. |
| Vault / credential redaction | **VERIFIED** — `logger.ts` redaction at console+file boundary; no credential path to renderer. |
| Governance (CST kernel, read-back verify, ActionRecord) | **VERIFIED (test)** — `governedSend`/`governedImport`, `verifyGovernedSend`/`readBackReconciler`, deny-by-default. The **live** M365 send + read-back is separately **LIVE-VERIFIED** (S15/S16). |
| Onboarding | **VERIFIED** — single consolidated `FirstRunExperience` flow; the redundant back-to-back wizard removed at root (Gate 13). |
| Marketplace / workforce / enterprise modules | **VERIFIED** — mutation ownership + install authority + per-module read gating pinned (R10 / Gate 5). |
| Shell / navigation / error states | **VERIFIED** — driven-UI E2E over real IPC→main (Gate 18/19); failed sources are NAMED, not empty tiles (Gate 15). |
| Workspace app-tab canvas | **DEFECT FOUND → FIXED** (this audit) — see Bugs. |
| Connectors (M365 + preview families) | **HONEST BY DESIGN** — M365 mail.send is the one certified-live vertical; other families are explicitly preview/NOT-CERTIFIED (matrix + CLAUDE.md §1). Not a defect. |

---

## WORKFLOWS VERIFIED (end-to-end)

1. **Boot → runtime-core → window paint → shell.** Real-app captured logs: macOS `Startup complete 271–478ms`,
   722–723 secure handlers; Windows window paints at 372ms with heavy composition after first paint. Boot-window
   retry generalized + pinned (Gate 1). **VERIFIED** (macOS/Windows from captured evidence; Linux CI cannot run
   Electron).
2. **Sidebar navigation** (loading→success→refused) over real IPC→main handlers — `appNavigationE2E.test.tsx`,
   negative-controlled. **VERIFIED**.
3. **Membership-gated workspace switch** — success invokes the gated channel; refused shows the gate message
   verbatim. **VERIFIED**.
4. **First-run onboarding** — one flow, all required setup preserved; back-to-back pop removed
   (`onboardingConsolidation.test.tsx`). **VERIFIED**.
5. **Auth restore / offline→local fallback / reconnect re-restore** — `authService` single-flight + reachability
   edge; local mode fully usable with networking disabled. **VERIFIED** (test + captured logs); packaged-runtime
   offline→reconnect is **EXTERNALLY BLOCKED** (no Electron in CI).
6. **Governance send → read-back verify** — `governedSend` → CST admission → execute → `verifyGovernedSend`
   terminal (VERIFIED_SUCCESS / VERIFIED_FAILURE / UNKNOWN→HOLD), deny-by-default. **VERIFIED (test)**; the single
   real M365 send is **LIVE-VERIFIED** (S15/S16); destination receipt remains **NOT GOVERNED** (honestly labeled).

---

## BUGS FOUND AND FIXED

**Bug 1 (LOW, UI-truth) — the Workspace app-tab canvas overclaimed Phase-4 features as present capability.**
`AppTabContent.tsx` rendered three capability cards in the **present tense** — "Run the app in an embedded,
signed-in session", "Your work here flows into your timeline", "Everything stays searchable in AI Memory" —
directly beneath a disclosure stating those features "arrive with Connectors in Phase 4." A shipped (non-preview)
surface presenting not-yet-live features as current capability violates the UI-truth rule (CLAUDE.md §4).

**Fix (copy only, no logic change):** future-tensed the three card bodies ("Will run the app…", "…will flow into
your timeline", "Will become searchable…") and added an explicit grid caption **"Planned for this canvas —
arrives with Connectors (Phase 4)."** The existing Phase-4 disclosure banner and the DEV-only "Connected" badge
(fresh tab renders "Not connected") were already correct and were left intact.

**Regression test:** `ui-tests/appTabContentHonesty.test.tsx` (3 tests) — pins the Phase-4 disclosure, the
"Planned for this canvas" caption + forward-looking body, and the **absence** of the old present-tense overclaims;
plus the "Not connected" default badge. **3/3 pass; negative-controlled** (revert the copy → the assertions fail).

No other genuine defect was found. Working code was not changed without a verified defect.

---

## DOCUMENTED — NOT FIXED (low severity, with reason)

- **IPC boot-time handler-existence guard (Audit B recommendation).** Audit B suggested asserting
  `RUNTIME_INVOKABLE_CHANNELS ⊆ {d.channel for d in defs}` at startup (`runtimeCore.ts:4088-4107`). **Not added:**
  the set is currently clean (no called-but-unregistered channel exists — verified), and adding an
  Electron-boot-path assertion is untestable from CI and risks breaking fail-closed boot for a gap that does not
  exist. Documented as a future hardening item, not a defect.
- **Auth dual-lock (Audit C, LOW, pre-existing).** A theoretical dual-acquire window in the auth restore path is
  practically unreachable given the `restoreInFlight` single-flight added in Gate 2. Pre-existing, LOW, no verified
  failure — left unchanged rather than perturb a working, security-critical path.

## DECLARED INCOMPLETE — BY DESIGN (honest, labeled, off the critical path)

These are intentionally-not-yet-live and are labeled as such in the product and corpus — they are **not** hidden
stubs: the zero-model `referenceDrafter` draft lane (BRAIN-1 serves reference-only until an eval clears + operator
go), L6 `stateHash`, durable confirmation nonce, and PDF export. The 41 preview connector packages remain
NOT CERTIFIED / NOT LIVE, off the critical path. M365 mail.send is the first and only live governed vertical.

---

## TESTS ADDED / RUN

- **Added:** `ui-tests/appTabContentHonesty.test.tsx` — 3 tests, negative-controlled. (One production file changed:
  `AppTabContent.tsx`, copy only.)
- **Full main suite:** **912 files / 9522 passed · 7 skipped · 0 failed.**
- **Full UI suite:** **58 files / 354 passed · 0 failed** — run **twice consecutively, both clean** (an earlier
  transient "1 failed" did not reproduce and was not attributable to this change; the new test passes in isolation
  and in-suite).
- **Typecheck** (`tsconfig.web.json`): exit 0. **ESLint** on both changed files: clean.

---

## REMAINING RISKS

- The four remaining matrix YELLOWs are **all external / machine-blocked**, not code defects: **Gate 8** (cloud AI
  provider keys), **Gates 20/26/27** (Windows interactive sign-in + visual/packaged hold).
- **Flaky UI test surface:** the full-App-mount driven-UI tests are timing-sensitive under jsdom (async
  `system:runtimeState` teardown noise). Observed once as a transient single failure that did not reproduce across
  two subsequent clean runs. Non-blocking; a candidate for a future stabilization pass (deterministic teardown), not
  a product defect.
- **CI cannot run real Electron** (no display / macOS-native node_modules in the Linux sandbox) — interactive
  renderer FPS + sustained memory/CPU on the real app remain a documented Mac-profiling follow-up via the shipping
  instrumentation.

## EXTERNAL VERIFICATION REQUIRED (cannot be done from CI)

- **Windows** interactive sign-in + packaged visual pass (Gates 20/26/27) — real Windows machine.
- **Cloud AI** live-provider routing completion (Gate 8) — real provider API keys at a human gate.
- **Real-Mac** interactive renderer/memory/CPU profiling (Gate 22 follow-up) — packaged macOS launch.
- **Live M365 cohort ceremony** (SEAM-B series) — operator-gated: new Entra registration + consent + first real
  external effect. Test/artifact layers are proven; only the human credential + consent steps remain.

---

## VERIFIED vs EXTERNALLY BLOCKED vs NOT YET VERIFIED

- **VERIFIED (this sandbox, evidence above):** all IPC classification/authority invariants; the six critical
  workflows at test level; multi-tenancy, auth, AI-routing, Vault-redaction, governance (test) properties; the
  UI-truth fix; both full suites green; typecheck + lint clean.
- **EXTERNALLY BLOCKED:** Windows interactive/visual (20/26/27); cloud AI keys (8); real-Mac interactive
  profiling; packaged-runtime offline→reconnect; the live M365 cohort ceremony.
- **NOT YET VERIFIED (declared incomplete by design):** zero-model draft lane beyond reference, L6 stateHash,
  durable nonce, PDF export, the 41 preview connector families — all labeled, none presented as live.

---

## EXACT EVIDENCE

- `AppTabContent.tsx` — three card bodies future-tensed + grid caption "Planned for this canvas — arrives with
  Connectors (Phase 4)"; grid `mt-4`→`mt-2`; Phase-4 disclosure banner + DEV-only Connected badge unchanged.
- `ui-tests/appTabContentHonesty.test.tsx` — 3 tests (Phase-4 disclosure; planned caption + forward body + old
  overclaims absent; "Not connected" default), negative-controlled.
- Full main **912/9522/7/0**; full UI **58/354/0** (×2); typecheck web exit 0; eslint clean.
- Matrix unchanged at round 60 (**GREEN 23 · YELLOW 4 · RED 0 · GRAY 0**) — no gate created or altered.

## FILES CHANGED (staged for this commit)

| File | Change |
|---|---|
| `apps/desktop/src/renderer/src/views/workspace/AppTabContent.tsx` | UI-truth: future-tense the 3 capability-card bodies + add "Planned for this canvas — arrives with Connectors (Phase 4)" caption. Copy only; no logic change. |
| `apps/desktop/ui-tests/appTabContentHonesty.test.tsx` | **new** — 3-test regression pinning the disclosure, the planned framing, and the absence of the old present-tense overclaims; negative-controlled. |
| `certification/WHOLE-PRODUCT-AUDIT-EVIDENCE.md` | **new** — this document. |

Deliberately **not** staged: `certification/baseline.json` (custody-protected, pre-existing untouched change),
`.claude/`, `dist-seam-b13/`, `out-run/`, `out-seam-b20/` (build scratch), and the stranded prior/deferred-gate
files (`e2e/tenantOwnership.e2e.cjs`, `GATE1-*`, `GATE4-*`, `NP-AMEND-001-*`, `SEAM-B37-*`). No
security/tenancy/consent/authorization/provenance/Vault/fail-closed property and no GREEN gate was weakened.

## EXACT NEXT COMMAND

```bash
cd /Users/saurabhpatel/Desktop/neuropause-desktop && git push
```
