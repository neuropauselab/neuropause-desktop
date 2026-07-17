# NeuroPause Intent Experience Program v2.0 — Intent-Native Operating System

**Program:** Intent Experience Program v2.0 · Intent-Native Operating System
**Type:** Read-only reprojection LAYER over the existing P14 strategy goals (no new runtime, engine, store, memory, or AI system)
**Status:** Complete — all six validation gates green; adversarial authenticity review returned **SHIP** with zero fabricated values and zero dead buttons; two honesty nits fixed. Ships with a live interactive prototype.
**Date:** 2026-07-17

---

## Mission

Transform NeuroPause from a Decision Center into an **Intent-Native Operating System**: the app organizes around the user's current *outcome*, not around modules. It never asks "What module do you want?" — it asks "What outcome are you trying to achieve?" — and then assembles the context (progress, risks, approvals, recommendations, the next best action) around that outcome. This is the natural next step after the Experience Program v1.0 decision-first home: v1.0 compressed the platform into *what to decide*; v2.0 reorganizes the platform around *what you are trying to achieve*.

The governing constraint of this program was **production authenticity**. Every number on screen must come from a real production data source; every button must execute a real action or be removed; every panel must be backed by a real implementation or hidden. No placeholders, no mock dashboards, no fabricated metrics, no "coming soon" widgets, no UI that implies a capability that does not exist. Where a field has no real source, it is **omitted, not faked**. That constraint shaped every design decision below.

---

## Repository Recon

Recon ran first, and it produced the single most important realization of the program: **an "intent" does not need to be invented — it already exists in the platform as a real, measured strategic goal.** The P14 Autonomous Enterprise Intelligence layer exposes `strategyOverview().goals` — a `GoalManager` holding `StrategicGoal[]`, where each goal's `current` value is resolved by a function over live production signals (`s.risk.overall`, `s.health.overall`, `s.workforce.overallSuccessRate`, cloud capacity utilization, compliance failures), its `progress` is computed attainment versus a real target, its `status` (`on_track`/`at_risk`/`off_track`) derives from that progress, and its `evidence` array carries real platform signal ids. Goals also carry real `objectives` (sub-metrics), `milestones` (with planning horizons), and `dependencies` (ids of other goals). This is the authentic foundation the mission's "intent" concept demanded: real outcomes with real state.

Recon confirmed three more real seams that make the intent workspaces authentic rather than decorative. First, the P14 **Planning Engine** already computes, for every not-on-track goal, an advisory `PlanStep` carrying an `action` and a real `StrategyApprovalRequirement` (governance-chain aware) — that is the genuine per-intent "next best action" and "approvals" source. Second, **strategic decisions** carry a `category: GoalCategory`, the same category enum goals use — so decisions can be linked to an intent by shared category without fabricating a relationship. Third, the **Reasoning Engine** exposes a real `confidence` figure, which is a board-level strategic-reasoning confidence (not a per-goal number).

Recon also drew the authenticity boundary lines that the rest of the build respected: strategic goals carry **no per-goal confidence field**, so no per-intent AI-confidence is shown; there is **no real per-goal completion date**, so the goal's real planning horizon (30/90/180/365-day) is surfaced as the honest "target horizon" instead of a fabricated ETA; and the workforce/connector runtimes hold **no per-goal assignment**, so per-intent worker/connector rosters are withheld rather than invented. Finally, recon confirmed the `intent:read` permission, the `intent:*` channels, and the `intent/` and `intentHome/` modules were all collision-free, and that removing the deceptive v1.0 catalog entry (below) was safe.

---

## Intent UX Audit

Before this program, NeuroPause's front door was the v1.0 Decision Center — a strong decision-first home, but still organized around *decisions the platform surfaces to you*, with the twenty-plus module Centers reachable by navigation underneath. The audit found that the platform still fundamentally answered "what does the system want to tell you?" rather than "what are *you* trying to achieve?" A user with a goal in mind — reduce risk, raise reliability, improve cost efficiency — had to translate that goal into which decision card or which module to open. There was no screen where the user names an outcome and the platform assembles everything around it, no persistent sense of "these are my active outcomes and how each is progressing," and no place where every screen answered "what's the next best action on this outcome?"

The audit also flagged a concrete authenticity defect inherited from v1.0: the intent catalog contained a `launch-product` entry marked `available: false`, rendered with a "soon" chip. That is exactly the "coming soon / implies a capability that doesn't exist" pattern the v2.0 mandate forbids. It was removed as part of this program (see Faithfulness Audit).

---

## Workspace Changes

The program adds one new first-class section — **Today's Intent** (`intent-home`) — placed as the very first item in the navigation, ahead of the v1.0 Decision Center and the legacy Home. It is a *new front door*, not a rewrite: every existing Center remains exactly as it was and is reachable unchanged. The new section is backed by a new read-only main-process layer (`intent/`) and a new renderer Center (`intentHome/`), wired through the same RBAC spine, channel registry, and `ecosystem:event` liveness broadcast every prior increment uses. No existing capability was rebuilt, and no runtime, engine, store, or mutation was added — the layer only reads `strategyOverview()` and reprojects it.

---

## Dynamic Experiences

The heart of the program is that selecting an intent auto-assembles a workspace around it — but only from facets that have a *real per-intent source*. When a user focuses an outcome, the layer assembles its **objectives** (the goal's real sub-metrics, each with its own current/target/progress/status), its **timeline** (the goal's real milestones, each with a real planning horizon and status), its **evidence** (the real platform signal ids backing the goal's current value), its **dependencies** (the real goals this one depends on, each shown with its live status and a "blocking" flag when it is off-track), its **related recommendations** (the real strategic decisions that share the goal's category, each with the decision's real confidence), and its **next best action** (the real Planning-Engine plan step and the real governance approval it would require).

The workspace panels for which the platform has *no* real per-intent source — AI-worker rosters, connector bindings, per-intent analytics time-series — are deliberately not rendered. Instead of drawing an empty or fabricated panel, the workspace shows a short, factual line naming what was withheld and why ("Not shown for this outcome (no real per-intent source): AI workers · Connectors · Analytics. These panels are withheld rather than fabricated."). This is the opposite of UI deception: the interface tells the user exactly where the real data stops.

---

## Adaptive Workspaces

The home is role-adaptive across ten role lenses — Founder, CEO, CTO, CFO, COO, Sales, Marketing, HR, Legal, and Operations. A role does not invent or alter any outcome; it simply selects which of the *real* intents to emphasize, by their real `GoalCategory`. Founder mode shows every outcome; the CFO lens shows the financial and compliance outcomes; the CTO lens shows infrastructure, security, and operational outcomes; and so on. The emphasized set is always a genuine subset of the real intents, ordered by the same urgency ranking, and the hero "Today's Intent" follows the active lens (the most urgent outcome *within* that lens). The adaptation is instant, client-side state; the underlying data is role-agnostic and real.

---

## Next Best Action System

Every screen answers "what next?" with a real action, never an invented one. Each intent card carries a one-line next action drawn from the real Planning-Engine plan step ("Advance …"); the focused hero renders that action prominently along with its real approval requirement, stated honestly — when a governance chain governs the action, the UI names the chain and its step count; when no chain governs it yet, the UI says exactly that ("No approval chain governs this action yet — it would need one before execution") rather than implying governance that does not exist. When an outcome is on-track and the Planning Engine recommends no step, the UI says "This outcome is on track — no action needed right now" rather than manufacturing busywork. The board also surfaces the single highest-priority next best action across all outcomes. The action's primary button routes to the real Strategy Center, where the goals and decisions are actually managed and dispositioned through the existing approval and execution engines — this layer reads and recommends; it never executes.

---

## Intent Routing Improvements

The intent-native model changes routing from *module-first* to *outcome-first*. Rather than a search box that matches keywords to sections, the outcomes themselves are the navigation: the multi-intent board is the list of real strategic goals, each a live outcome the user can focus to open its workspace, with the primary action on each routing into the real Strategy Center that manages it. As part of this program the v1.0 intent catalog was also corrected for authenticity: the `launch-product` entry that advertised an unbacked "coming soon" capability was removed, so every remaining routing intent points at a section that genuinely does the work.

---

## Performance

Today's Intent is a single lazy-loaded chunk (27 KB) that fetches three already-memoized read projections — the board, the workspaces, and the governance ledger — in one `Promise.all` and renders immediately with a skeleton state. All compression and assembly happen in the main process behind a 3-second TTL with per-projection memoization, so repeat reads are O(1) cache hits; the snapshot recomposes only after the TTL lapses or a backing store emits a change event. Role switching, intent focusing, and the provenance disclosure are pure client-side state with no refetch. Progress bars and transitions are CSS/GPU-based, and there is no polling — liveness rides the existing `ecosystem:event` broadcast, exactly as the v1.0 layer does.

---

## Accessibility

Every interactive element is a real `<button>` (keyboard-focusable and screen-reader reachable); the refresh control carries an `aria-label`; the board-level reasoning-confidence figure carries a `title` clarifying that it is board-level and not per-intent. State is never conveyed by color alone — every status and band is rendered as a colored dot *and* a text label ("On track", "At risk", "Off track"). The layout reflows from a three-column ultra-wide board down to a single column, and it reuses the existing app's color-token and reduced-motion infrastructure so it inherits the platform's accessibility settings natively.

---

## Faithfulness / Authenticity Audit

Because production authenticity was the dominant constraint, the layer was built so that authenticity can be *audited*, and the governance accessor ships a machine-readable ledger to prove it. Every field the layer exposes traces to a real source: the intent identity, category, success metric, target, current value, and unit come from the real `StrategicGoal`; progress and status come from the goal's real attainment and derived status; the band is a pure mapping of the real status (off-track⇒critical, at-risk⇒at-risk, on-track⇒healthy, so an on-track outcome is never shown false-red and a struggling one is never shown false-green); dependencies, "blocked," and "blocked by" are resolved from sibling goals' real statuses; objectives, timeline, and evidence are the goal's own real facets; the next best action and its approval come from the real Planning-Engine plan step and governance chain; recommendations are the real category-linked strategic decisions; and the board-level reasoning confidence is the real Reasoning Engine figure. Counts and overall progress recompute from the real goal statuses.

The ledger is equally explicit about what is **deliberately omitted rather than fabricated**: per-intent AI confidence (goals carry none — board-level strategic-reasoning confidence is surfaced instead, honestly labeled), a calendar ETA or completion date (none exists — the goal's real planning horizon is shown instead), per-intent AI-worker and connector rosters (no per-goal assignment exists — those workspace panels are withheld), and per-intent analytics charts (no per-intent time-series exists — no placeholder chart is drawn). The one authenticity defect inherited from v1.0 — the `launch-product` intent's `available: false` "soon" chip — was removed, and a test now locks that no intent may advertise an unbacked capability.

An independent adversarial review audited every rendered number and every button against this mandate and returned **SHIP**: it found no fabricated value, no dead or deceptive button (role select, refresh, card focus, provenance toggle, and the Strategy Center navigation all perform real actions against a real registered section), no panel implying a nonexistent capability, and confirmed the plan-step-to-goal mapping and the category-based decision linkage are correct. Its two low-severity honesty nits were fixed: the hero now only claims "what most needs you now" when it is genuinely showing the top-ranked outcome (and says "Focused outcome" when the user has manually selected a lower-priority one), and the `urgency` field's documentation was corrected to match its implementation.

---

## Validation Results

All six gates green with real exit codes. Typecheck: 0 across all five workspaces (node + web). Lint: 0 with `--max-warnings 0`. Desktop tests: **3,198 passed** across 371 files (up 29 from the v1.0 baseline of 3,169), including the new intent model, service, authz, and renderer-mapping suites plus the v1.0 faithfulness lock. SDK tests: 15 passed. CLI tests: 30 passed. Production build: 0, with `IntentHomeView` emitted as its own 27 KB lazy chunk. The new tests lock the authenticity law directly — every intent field maps from a real input with no fabrication, an on-track outcome is never false-red, per-intent confidence is asserted absent, "blocked" derives from a dependency's real status, the workspace withholds unbacked panels and documents them, role lenses only emphasize real intents, the model is deterministic, and it never throws on an empty snapshot.

---

## Launch Readiness

NeuroPause now has an intent-native front door. A user opens the app and sees their current outcomes — real strategic goals measured from live production signals — with the single outcome that most needs them elevated as Today's Intent, its progress, risks, approvals, recommendations, and next best action assembled around it, and every other outcome one focus-click away. It is role-adaptive across ten lenses, and every screen answers "what next?" with a real action. Critically, every byte of it is authentic: every number traces to a real `strategyOverview()` field, every button performs a real action, and everything the platform cannot honestly back is withheld and documented rather than faked. The layer changes how humans interact with NeuroPause — organizing it around outcomes instead of modules — without changing how NeuroPause works, and it adds no runtime, engine, store, or mutation.

---

## Remaining Opportunities

This program delivers the intent-native front door and the authentic reprojection that powers it; it deliberately does not fabricate the capabilities the platform does not yet really have. The highest-value honest next steps: add a real per-goal confidence signal upstream in the Planning/Reasoning engines so the Intent Dashboard can show a per-intent confidence that is genuinely sourced; add real per-goal target dates in the strategy layer so "target horizon" can become a real ETA; introduce a real per-goal linkage to the AI-worker and connector runtimes so the withheld workspace panels can be populated authentically rather than remaining hidden; wire the Strategy Center primary action to deep-link to the specific focused goal rather than the section; and, once product signs off, make Today's Intent the app's default landing section (it is currently the first section; the default remains `home`, a one-line change). Each of these unlocks a richer intent experience *by adding a real source upstream* — never by fabricating one in the projection.
