# APP LIVELINESS CENSUS — 2026-08-19 (NP-008 §1)
### The truth table of what the app IS tonight, on the launch profile.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Method.** Real-Electron walk (`apps/desktop/e2e/livelinessCensus.e2e.cjs`) on a FRESH THROWAWAY local-first profile
(`mkdtemp`, plain mode: no `NEUROPAUSE_E2E`, no app-principal env — the compiled e2e seams inert, the NP-007 V3
plain-mode pins are the proof). First-run walked and captured verbatim; workspace type = Business (the fullest
sidebar — `sectionVisibleFor('business')` shows everything); **all 47 visible surfaces visited** (run 3; runs 1–2
were harness lessons: the Early-Access tour modal blocks all navigation until dismissed). Per-surface rendered text,
console errors, main-process refusals, and screenshots recorded. Evidence: `certification/np-008-census-report.json`
(committed) + `apps/desktop/e2e/artifacts/census/` (JSON, full main log, 47+ screenshots — local, not committed).
Launch honesty checks: `Entering device-local mode` ✓ · e2e seed line ABSENT ✓ · LocalModeBanner shown ✓ ·
no overlay before the walk ✓. **ZERO external effects; ceremony surfaces untouched (r2 profile, app-principal env,
mail-send path, runbook).**

**Classes.** LIVE (evidence-backed data path; an honest empty over a real store is LIVE) · RENDERS-ONLY (UI without
real substrate, incl. seeded demo data) · STUB · BROKEN (errors/crashes) · GATED (needs cloud/consent and says so).

## Headline

- **BROKEN: 0 of 47.** No error boundary fired, no crash, zero renderer console errors on 46/47 surfaces.
- **LIVE: 29** (mostly honest-empty over real stores — the local-first substrate is real).
- **RENDERS-ONLY: 14 — 13 of them honestly Preview-labeled.** The one unlabeled: `intent-home` (F-N8-1).
- **GATED: 2** (Organization, AI Store — the S17 honest gates, working as designed).
- **STUB: 0.**
- The launch profile's dishonesty is concentrated in **four small findings** (F-N8-1/2/3/5/6), all renderer-side,
  none frozen.

## First-run claims (every line traced)

| Claim (rendered) | Verdict |
|---|---|
| "Your AI. Your Data. Your Control. Try NeuroPause free… work locally on your computer" | TRUE — S17 local mode is the real default; no wall |
| "This sets real routing, not a preference label" | TRUE — writes `ai:preference` through tenant RBAC (`setPreference`), effective mode derived `min(platform, tenant)` |
| **"A local model server is running on this device with 4 models installed."** | **TRUE — live `detectOllama()` probe; Ollama genuinely runs here with 4 models.** Absence renders as "No local AI is set up yet" + honest fail-closed line |
| "if none is available, requests fail here rather than being sent anywhere" | TRUE — Private-First routing, BRAIN-1 honest fallback |
| Workspace step "this choice shapes the workspace… change it later without losing anything" | TRUE — experience profile store; nav regrouping only |
| Understanding step "not objective truth… every line shows where it came from" | TRUE — attributes carry status (stated/inferred/corrected) + source |
| Tour (6 steps, real onboarding catalog) | Steps real; **step 3 directs a local-mode user to Organization, which is cloud-gated (F-N8-7)** |

First-run persisted every choice through real stores on the plain local profile — the D-5 write path (`ai:preference.set`)
that was refused in the S54 incident (app-principal ordering defect, repaired in NP-007) ADMITS in plain local mode.

## The truth table (47 surfaces, SECTIONS order)

| # | Surface | Class | Evidence (rendered on the launch profile) |
|---|---|---|---|
| 1 | Mission Control | LIVE | Real feeds composed: NeuroCore health snapshot (score 83, runtime honestly "unknown"), connectors honest "disabled", timeline 5 real events, "Nothing running right now". Note N-3: "0/13 connectors" (sync adapters) vs 22 families elsewhere — inconsistent denominator |
| 2 | Today's Intent | **RENDERS-ONLY → F-N8-1** | 9 SEEDED autonomous-intelligence goals ("Expand industry readiness"…) presented as "TODAY'S INTENT — WHAT MOST NEEDS YOU NOW", **no Preview label** — the same seeded store strategy-center shows WITH a label |
| 3 | Search | LIVE | Honest empty; real federated indexes; recents "stored locally" |
| 4 | Assistant | LIVE | Honest empty; conversations real store; "acts only after your approval" consistent with lanes |
| 5 | Work Hub | LIVE | Honest empty composition of real feeds (brief/meetings/recommendations/notifications) |
| 6 | Ask NeuroPause | LIVE | "Ready — a local route will be tried first" — TRUE (Private First + Ollama detected) |
| 7 | Understand | LIVE | The setup answer shown with provenance ("You told us"); on-device claim accurate |
| 8 | Holds | LIVE | Honest empty; real hold store + decision record; "a hold is not a failure" |
| 9 | Opportunities | LIVE | Exemplary honesty: "Insufficient evidence… will not invent a finding"; shows exactly what was examined (0 POs) |
| 10 | Organization | GATED | S17 gate: "unavailable while working locally… connect an account to sync" |
| 11 | Enterprise | RENDERS-ONLY (labeled ✓) | Preview banner verbatim; seeded org (28 members/13 units) inside the label |
| 12 | Business | LIVE | "14 areas · 0 records… draws every number from live records"; real module registry; honest empty per family |
| 13 | Administration | LIVE | Real aggregation + THE HONEST-FALLBACK PATTERN: "1 of the administration panels could not load: Cloud organizations… a fallback, not verified state" (org:list is authenticated-only — correct deny). Improvement: F-N8-4 |
| 14 | Intelligence | LIVE-composed → **F-N8-2** | Real read-only composition BUT "Enterprise health 100/100 · 12 live KPIs" over a 0-node graph — vacuously-perfect scores presented as health |
| 15 | Collaboration | LIVE | Honest empty + "gaps recorded honestly" (verified absent, never fabricated) |
| 16 | Knowledge | LIVE | Honest empty + honest gaps |
| 17 | Automation | LIVE | Honest empty rule engine; deep-links to the real builder |
| 18 | AI Operations | LIVE-composed | Reads real services; some counters come from seeded strategy stores (labeled per-stage "honest gaps") |
| 19 | Extensibility | LIVE-composed | Real registries (22 connectors, 27 workers); marketplace counts are the 5 "(Example)" seeds |
| 20 | Operations (opscenter) | LIVE | Honest empty graph; same vacuous-100 class as F-N8-2 on its HEALTH tile |
| 21 | Developer | LIVE | Real developer registry; local principal shown honestly; seed listings labeled "seed"/"(Example)" |
| 22 | Industry Center | RENDERS-ONLY (labeled ✓) | Preview banner; honest readiness "0/12 ready" |
| 23 | Strategy Center | RENDERS-ONLY (labeled ✓) | Preview banner; the seeded 9 goals — inside the label |
| 24 | Digital Twin Center | RENDERS-ONLY (labeled ✓) | Preview banner; twin over seeded org |
| 25 | Enterprise Knowledge | RENDERS-ONLY (labeled ✓) | Preview banner; projections of existing systems |
| 26 | Orchestration | RENDERS-ONLY (labeled ✓) | Preview banner |
| 27 | Intelligence Network | RENDERS-ONLY (labeled ✓) | Preview banner; "Above industry" benchmark is seeded — inside the label |
| 28 | Autonomous Operations | RENDERS-ONLY (labeled ✓) | Preview banner; honest zeros; approval-gated framing accurate |
| 29 | Commercial Center | RENDERS-ONLY (labeled ✓) | Preview banner; free tier real (billing store) |
| 30 | Release Ops | LIVE-composed → **F-N8-3** | Real ops lens BUT `settled()` converts a PERMISSION REFUSAL (backup:list, cloud:operate) into fallback zeros — "Data backups available: 0" when the truth is "could not read" (the F-5 class). Note N-1: version tile shows the Electron binary version (42.8.1) in dev launches |
| 31 | Ecosystem | RENDERS-ONLY (labeled ✓) | Preview banner; "(Example)" worker listing |
| 32 | Cloud | RENDERS-ONLY (labeled ✓) | Preview banner; seeded home tenant |
| 33 | Infrastructure | LIVE | Real platform registry; 10 platforms honestly "Not configured" |
| 34 | Federation | RENDERS-ONLY (labeled ✓) | Preview banner; home org real, 0 peers honest |
| 35 | AI Store | GATED | S17 gate, verbatim honest |
| 36 | Enterprise Marketplace | RENDERS-ONLY (labeled ✓) | Preview banner; all 5 packages "(Example)" |
| 37 | Workspace | LIVE | The app launcher — real catalog, real tab launches (the original product core) |
| 38 | Runtime | LIVE | Honest empty; real registry/sessions/plugins |
| 39 | AI Workforce | LIVE → **F-N8-5** | 27 real workers, honest idle/Unknown — but the header copy says "NINE governed AI workers" (copy drift vs 27 real) |
| 40 | Workforce Admin | LIVE | Honest empty; built-ins vs installed distinguished |
| 41 | Connectors | LIVE | 22 real families; honest Disconnected/Not configured; honest "no active syncs yet" |
| 42 | Data | LIVE | Honest empty; real import pipeline ("writes nothing until you approve it") |
| 43 | Medical Devices | LIVE | Honest empty; explicit "makes no regulatory or certification claim" |
| 44 | AI Memory | LIVE | Honest empty over real store |
| 45 | Notifications | LIVE | Honest "You're all caught up" over real inbox |
| 46 | Getting Started | LIVE | Real checklist state (6/6 after the tour) |
| 47 | Settings | LIVE → **F-N8-6** | Real panels; BUT the Identity panel tells a LOCAL principal "your name and email… are managed at your identity provider" — false in local mode (there is no identity provider; the account is `@device.invalid`) |

## Findings (truth-order queue for §2)

- **F-N8-1 · intent-home presents seeded strategy as the user's own intent, unlabeled.** The only RENDERS-ONLY
  surface without the Preview affordance. Fix (§2.2): the same Preview labeling its sibling strategy-center already
  carries (sections flag + in-view banner); nav-lock tests updated to the new truth.
- **F-N8-2 · Vacuously-perfect scores over empty substrate** (Intelligence "Enterprise health 100/100", opscenter
  HEALTH 100, Release Ops KPI strip). A perfect score computed from zero evidence is a claim the substrate does not
  support (S19 truthful-surfaces class). Fix (§2.2, bounded): honest empty-substrate framing where the emptiness is
  already exposed by the model; otherwise recorded, not hastily rewired.
- **F-N8-3 · Release Ops converts refusals into zeros** (`settled(…, fallback)` over 15 sources; observed live on
  `backup:list` → "0 backups"). The F-5 class. Fix (§2.1): track failed sources and render the Administration-pattern
  honest banner ("N panels could not load — fallback, not verified state").
- **F-N8-4 · Administration's cloud-orgs panel** shows a failure-framed fallback in local mode; a local-aware gate
  ("requires a connected account") would state the same truth without the error framing. Recorded; low priority.
- **F-N8-5 · Workforce copy drift**: "Nine governed AI workers" vs 27 real. Fix (§2.2): copy states the real count
  or none.
- **F-N8-6 · Settings Identity copy is false for local principals** ("managed at your identity provider"). Fix
  (§2.2): local-aware copy ("This is a device-local identity — nothing is managed by a provider").
- **F-N8-7 · Tour step 3 directs local-mode users to a gated surface** (Organization). Recorded (main-side onboarding
  catalog; candidate: local-aware step copy). Not fixed tonight — honest gate greets them, but the instruction
  dead-ends.

## Notes (environment artifacts, not product lies)

- **N-1** · Dev launches (`npx electron out/main`) report the ELECTRON BINARY version (42.8.1) via `app.getVersion()`;
  packaged builds report the real product version. Same lesson-family as the NP-007 title stamp: dev-launch identity
  surfaces are not authoritative. (`buildInfo.ts` also stamps `-e2e` on e2e-capable builds — the Release Ops version
  tile reads `app.getInfo()`, not buildInfo; recorded.)
- **N-2** · The census ran on the e2e-capable build with seams INERT (seed line absent, verified in-run). `out/` remains
  the ceremony-ready build; nothing tonight rebuilds it without `NP_E2E_BUILD=1`.
- **N-3** · Mission Control counts "0/13 connectors" (sync adapters) while Connector Center counts 22 (families) —
  two denominators for "connectors" on adjacent surfaces. Recorded for a naming decision; no silent change.
