# LAUNCH-READINESS — the honest artifact (NP-008 §3)
### "Ready to launch" is this checklist reading true, not a feeling. · 2026-08-20, post-NP-008 night work

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## Standing claims (the product's truth, stated once)

1. **Local-first is fully honest.** A fresh install gets the full product on a device-local principal — no sign-in
   wall (S17), first-run claims all trace to real substrate (census §First-run: every line TRUE, including the
   live-probed "local model server with N models"), cloud-only surfaces state their absence (`CloudUnavailableLocal`),
   and the local identity never masquerades as a provider-managed account (F-N8-6 fixed tonight).
2. **ONE governed consequential capability: M365 `mail.send`** — proposal → human confirm → CST → admission →
   certified executor → independent read-back, LIVE-VERIFIED once (S15/S16, VERIFIED_SUCCESS with captured
   internetMessageId). The Brain-proposed ceremony (S5.4) is **PENDING** — mock-proven only; NO Brain-proposed real
   external effect has occurred. Destination delivery is NOT GOVERNED.
3. **Everything else is labeled.** 14 seeded/prototype surfaces carry the Preview banner (intent-home joined them
   tonight); composed lenses record their gaps honestly ("never fabricated"); refusals are named, not rendered as
   zeros (F-N8-3 fixed tonight); UNKNOWN stays UNKNOWN.

## Verification this artifact stands on (all RUN tonight, none inferred)

- Census walks: pre-fix 47/47 (`np-008-census-report.json`) · post-fix 47/47 (`np-008-census-report-postfix.json`),
  both on fresh throwaway local-first profiles, e2e seams inert (seed line absent, verified in-run).
- Full main suite **859 files / 8996 passed / 3 skipped** · ui suite **41 / 278** · typecheck clean ·
  `verify-e2e-strip.sh` **PASS** at final source · **FREEZE INTACT** at `BASELINE-1ac1c6b0bbbb` (zero frozen touches
  all night; re-record `e24666e` over green).
- **Ceremony build preserved:** the LAST build of the night is `NP_E2E_BUILD=1`; `out/main/chunks/e2eSeed-DzsziIdg.js`
  present, sentinel grep = 1. (The strip script rebuilds `out/` as release to prove absence — the e2e rebuild must
  always be the final build before a ceremony sitting; noted for every future night.)
- Commits: `6ec7a3d` (census) · `e46e661` (truth-order fixes) · `e24666e` (freeze re-record) · slice-3 doc commit.

## Per-surface readiness (class · what changed tonight · evidence)

Census detail per surface: `certification/APP-LIVELINESS-CENSUS-2026-08-19.md`. "post" = post-fix walk.

| Surface | Class | Changed tonight | Evidence |
|---|---|---|---|
| Mission Control | LIVE | — | census #1; real feeds, honest "unknown" runtime |
| Today's Intent | RENDERS-ONLY **(now labeled)** | **F-N8-1: Preview flag + banner** | post walk shows the banner verbatim; `sections.test.ts` lock updated |
| Search | LIVE | — | census #3 |
| Assistant | LIVE | — | census #4 |
| Work Hub | LIVE | — | census #5 |
| Ask NeuroPause | LIVE | — | census #6; local-route claim TRUE |
| Understand | LIVE | — | census #7 |
| Holds | LIVE | — | census #8 |
| Opportunities | LIVE | — | census #9 (exemplary honest-empty) |
| Organization | GATED | — | S17 gate, verbatim honest |
| Enterprise | RENDERS-ONLY (labeled) | — | Preview banner |
| Business | LIVE | — | census #12 |
| Administration | LIVE | — | honest-fallback banner is the house pattern; F-N8-4 open (gate framing) |
| Intelligence | LIVE-composed | **F-N8-2: empty-graph notice** | post walk renders "Computed over an empty enterprise graph…"; `intelligenceHonesty.test.ts` |
| Collaboration | LIVE | — | census #15 |
| Knowledge | LIVE | — | census #16 |
| Automation | LIVE | — | census #17 |
| AI Operations | LIVE-composed | — | honest per-stage gaps |
| Extensibility | LIVE-composed | — | census #19 |
| Operations (opscenter) | LIVE | — | F-N8-2 class noted on its HEALTH tile (open) |
| Developer | LIVE | — | seeds labeled "(Example)"/"seed" |
| Industry Center | RENDERS-ONLY (labeled) | — | Preview banner |
| Strategy Center | RENDERS-ONLY (labeled) | — | Preview banner |
| Digital Twin Center | RENDERS-ONLY (labeled) | — | Preview banner |
| Enterprise Knowledge | RENDERS-ONLY (labeled) | — | Preview banner |
| Orchestration | RENDERS-ONLY (labeled) | — | Preview banner |
| Intelligence Network | RENDERS-ONLY (labeled) | — | Preview banner |
| Autonomous Operations | RENDERS-ONLY (labeled) | — | Preview banner |
| Commercial Center | RENDERS-ONLY (labeled) | — | Preview banner |
| Release Ops | LIVE-composed | **F-N8-3: refusals NAMED, never zeros** | post walk: "1 of the operations panels could not load: Backups… fallback, not verified state"; model + ui pins |
| Ecosystem | RENDERS-ONLY (labeled) | — | Preview banner |
| Cloud | RENDERS-ONLY (labeled) | — | Preview banner |
| Infrastructure | LIVE | — | 10 platforms honestly "Not configured" |
| Federation | RENDERS-ONLY (labeled) | — | Preview banner |
| AI Store | GATED | — | S17 gate |
| Enterprise Marketplace | RENDERS-ONLY (labeled) | — | all packages "(Example)" |
| Workspace | LIVE | — | the app launcher (product core) |
| Runtime | LIVE | — | census #38 |
| AI Workforce | LIVE | **F-N8-5: count-drift copy dropped** | header no longer claims "Nine"; 27 real workers shown |
| Workforce Admin | LIVE | — | census #40 |
| Connectors | LIVE | — | 22 real families, honest states |
| Data | LIVE | — | census #42 |
| Medical Devices | LIVE | — | explicit no-regulatory-claim |
| AI Memory | LIVE | — | census #44 |
| Notifications | LIVE | — | census #45 |
| Getting Started | LIVE | — | real checklist state |
| Settings | LIVE | **F-N8-6: local identity truth** | post walk: "This is a device-local identity…"; `useIsLocalMode`-derived |

**Class-change summary (overnight):** BROKEN 0→0 · unlabeled-RENDERS-ONLY 1→0 (intent-home labeled) ·
refusal-as-zero surfaces 1→0 (Release Ops) · false local-mode claims 2→0 (Settings identity, Workforce count).
Substrate wiring (§2.3): the directive's candidates were verified ALREADY WIRED with pins —
`m365WriteStatesDisplay.test.tsx` (S19 five states), `workspaceDomainRollup.test.tsx` (L1 rollup), FG-9 brainReview
panel pins (Phase 0). ActionRecord answerability remains main-side by the S34a fence → follow-up below.

## Open items (recorded, not hidden)

- **F-N8-4** · Administration's cloud-orgs panel: local-aware gate framing instead of failure-framed fallback (low).
- **F-N8-7** · Tour step 3 sends local-mode users to the gated Organization surface (main-side onboarding catalog).
- **F-N8-2 (residual)** · opscenter HEALTH tile + Release Ops KPI strip share the vacuous-score class; Intelligence
  carries the notice, these two do not yet.
- **N-1** · Dev launches report the Electron binary version (42.8.1); packaged builds report the real version.
- **N-3** · "0/13 connectors" (adapters) vs "22 connectors" (families) — one word, two denominators; needs a naming
  decision, not a silent change.
- **Pre-existing lint ×2** on FROZEN surfaces (`cst/sendTransition.negative.test.ts` unused import;
  `packages/shared/ipc/contracts.ts:2434` escape — already in the CLAUDE §1 defect log). Untouched per frozen law.
- **DISCOVERED FOLLOW-UPs** (proposals, not executed): ActionRecord read-model surface (a proper bounded slice with
  its own tests, superseding the S34a no-UI fence only by operator approval) · `installE2eSeedPrincipal` strip-grep
  belt-and-braces (from NP-007) · first-run/tour local-mode awareness (F-N8-7).

## The bar, honestly stated

The launch profile tonight: **no surface crashes, no surface silently errors, no surface presents unlabeled fake
data, gated surfaces say why, and the one governed capability is exactly one.** What remains between this and
"launch": the S5.4 ceremony (operator-gated, NP-000), the open items above, and the §5 sequencing decision (NP-006)
— none of which this artifact claims to have done.
