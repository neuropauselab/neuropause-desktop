# NeuroPause — One Intelligent Workspace: the Intelligence Experience

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15`
**Gate:** `typecheck:release` PASS · `lint:release` PASS · `test:release` **6,225 / 6,225 across 651 files** (desktop; up from 6,197 / 649), backend 418, cloud-core 44, companion-protocol 23 — **0 failures, none deleted or weakened**
**Status: IMPLEMENTED — DEVICE VISUAL VERIFICATION PENDING.**

---

## The core principle, implemented

> NeuroPause chooses the right intelligence for the job:
> deterministic logic → local AI → private infrastructure → approved external AI → honest refusal.

This is now enforced *in the pipeline*, not described in copy:

```
User request (ONE assistant — ipc.assistant.ask, from AI Home and Assistant alike)
  ↓ intent classification                     (existing)
  ↓ DETERMINISTIC-FIRST SEAM                  (new — deterministicAnswers.ts)
  │   arithmetic · clock · record aggregates · permission refusals
  │   HIT → answer + evidence, AI ENGINE NEVER INVOKED, measured as NONE
  ↓ structured resolvers                       (existing: intelligence, knowledge,
  │                                             automation, operations, strategy…)
  ↓ retrieval → reasoning                      (existing; mode-gated)
  ↓ AI ROUTING PLANNER                         (existing Private First:
  │                                             local → private → external-with-consent)
  ↓ refusal on this device                     (existing; external never invoked)
```

The test that pins the rule (`assistantDeterministic.test.ts`): the fake AI
engine **throws if called** — "What is 2 + 2?", "today's date", "outstanding
invoice total", "pending approvals" all answer with **zero** engine
invocations, measured as `none`, badged **NO AI MODEL USED** (never "local
AI").

### The deterministic seam (`deterministicAnswers.ts`)

| Question shape | Source | Notes |
|---|---|---|
| Arithmetic (`what is 2+2`, `17 x 23 =`) | A closed-grammar parser | Deliberately not `eval()`; `1/0`, code, anything outside `0-9.()+-*/x×÷` refuses. |
| Today's date / day / time | The injected clock | |
| Outstanding invoice total | `finance-invoices` records: Σ max(total − paid, 0) | Names the invoice count; settled and deleted rows excluded. |
| Units remaining in lot X | `md-lots`: quantity − consumed − split | The same arithmetic as the lot model; unknown lot → truthful "does not exist" with search scope stated. |
| Current stock of SKU | `inventory-products` derived stock fields | Unknown SKU falls through (may be a knowledge question). |
| Pending approvals | The live jobStore count | Zero is an answer, not an empty state. |

**Record reads are RBAC-gated at the seam.** The composition root supplies a
port that authorizes the module's declared read permission with the same gate
the generic channels use; a refusal comes back as **an answer** ("you don't
have access") — never a fall-through that would let the model answer over data
the records layer just refused. Open questions ("why did profitability fall?")
return null and take the existing pipeline unchanged.

### Measured intelligence economics

Engineless turns record one `none` into the existing `routingUsageStore`;
engine-backed turns are measured by the engine itself (never both — that would
double-count). Settings → AI now shows, **only when measured**:

> *"N% of M measured requests were answered without an external AI provider."*

Zero measurements → the existing waiting message. No invented percentages.

---

## The three-layer answer model (AI Home)

Every response renders as:

- **ANSWER** — the envelope text (or the honest clarification / findings-only note), with the ProcessingBadge.
- **REASON** — `reasoningSummary` + recommendations. For deterministic answers this states the computation ("sum of (total − amount paid) over every invoice that still has a balance"); for AI answers, the existing "synthesized by MODEL strictly over N findings" sentence.
- **EVIDENCE** — collapsible: the findings (computed values with labels) and sources (module + record counts). **No evidence is stated as a property of the answer**, not hidden. When the envelope carries a navigation resolution, an **"Open the records"** button deep-links the owning section.

All three layers read from the real `AssistantEnvelope` — nothing is
synthesized in the renderer.

## Business Home (Professional / Business profiles)

AI Home gains a **"What needs your attention"** strip — real queries only:

| Tile | Source |
|---|---|
| Decisions awaiting review | `executive-decisions` records, status `active`, via the generic RBAC-gated module channel |
| Open tickets | `helpdesk-tickets` records, same channel |
| Batches in quarantine | `md:lot.list` view counts (the Medical Device pack's own IPC) |

A tile appears only when its query **succeeded** (an RBAC refusal or absent
module omits it silently); all-zero renders *"No items requiring attention."* —
a statement about the business, not an empty screen. Nothing is fabricated to
fill space, and Personal profiles don't see the strip at all.

## Business information architecture

For the **Business** profile the sidebar regroups the *same* visible sections
into user-goal groups: **Today · Business · Work · Data · Operations ·
Intelligence · System** (`businessGroupFor` in `experienceModel.ts`). A render
mapping only: SECTIONS untouched, order within groups preserved, every nav
lock green, advanced tier and command palette unchanged. Personal/Professional
keep the registry grouping. UI language stays user-facing ("Data", not
"Universal Data Plane" — the Data Command Center section was already labelled
"Data"); technical names remain in Advanced/internal surfaces.

## Performance HUD removed from normal runs

The dev-only floating Performance panel (`PerformanceOverlay`) previously
rendered on every unpackaged run. It is now **opt-in** behind
`VITE_NP_PERF_HUD=1`; the measurement pipeline (PerfSampler, perf recorder,
Operations diagnostics) is untouched.

---

## What already existed and is REUSED, not rebuilt

First screen / Try Free Locally / processing choice / workspace profiles
(previous stage); Private First routing + execution-stamped metadata + badge +
Why + usage (previous stage); ONE assistant pipeline with intent, retrieval,
reasoning, plans, **approval-gated execution through the ExecuteEngine,
verification and audit** (Stage 4/5 — the governed-action model the charter
describes); the structured domain resolvers (intelligence, knowledge,
automation, operations, strategy, federation, analytics, twin); the Data
Command Center UI (Import/Export/Quality/History/Provenance/Mappings/Coverage —
real backends, built in Phase 6); ERP, Medical Device pack, RBAC, SoD, audit
chains, provenance, relationship engine. **No second assistant, approval
engine, import system, provider registry or memory model was created.**

## Limitations — stated

| Item | Status |
|---|---|
| Device visual verification | **PENDING** — bundle builds (AiHomeView 14.8 kB with the new layers); `npm run dev` needs macOS. |
| Deterministic coverage | Six resolver families. Everything else deliberately falls through — extending the seam is data + one resolver, but only these are claimed. |
| Cross-domain variance chains ("why did margin change" computed across Sales→COGS→Inventory) | **PARTIAL** — the existing intelligence/analytics resolvers answer their catalogued questions; a general deterministic variance decomposition is NOT implemented and is not claimed. AI answers over retrieved evidence remain available. |
| Quality Center / Document Control | **NOT IMPLEMENTED** (unchanged) — surfaced as "Not yet configured", integration seams ready. |
| Digital Twin | Existing platform surfaces remain **preview-labelled** where seeded. |
| Attention strip breadth | Three real tiles. More dimensions (deadlines, financial impact ranks) need their owning services to expose deterministic reads first. |
| DOM-level UI tests | Repo has no DOM test library; all view logic lives in the tested pure models. |
