# V2.2 — Founder AI Proactive Intelligence

Turns Founder AI from a reactive assistant (answers when asked) into a proactive
executive copilot (surfaces evidence-backed recommendations on a schedule) —
**reusing the V2.1 Executive Intelligence Delivery engine**. No new AI, no new
notifier, no new scheduler, no duplicated Mission Brief.

## STEP 1 recon — reused, never duplicated
- **`founderFindingsFromBriefing(brief, intent, limit)`** (existing) — returns
  deterministic, evidence-bearing `FounderFinding[]` (label, text, at, connectorId,
  evidence[]). "Never invented" is guaranteed by this existing extractor.
- **`generateBriefing(period, {entities, events, now})`** (existing) — the brief,
  read exactly as V2.1 / `initDailyIntelligence` reads it.
- **DeliveryEngine** (V2.1) — Founder AI registers as one `IntelligenceSource`;
  the engine handles scheduling, ranking, DND, and delivery.

## Architecture
```
generateBriefing() ─▶ founderFindingsFromBriefing()  [existing, evidence-bearing]
                              │  FounderFinding[]
                              ▼
   founderProactive.ts:  map each finding → IntelligenceItem
        • section → priority + impact (STEP 3)
        • evidence[] → governance.evidence / sourceSystems
        • evidence count → governance.confidence
        • section → reasoning + recommendedAction (STEP 5)
                              │  IntelligenceItem[] (governance-complete)
                              ▼
   deliveryEngine.register(founderProactiveSource)  ← existing V2.1 engine
        → ranks by impact×confidence, gates by priority/DND, delivers
```

## Intelligence sources (STEP 2)
The source draws from the briefing, which already aggregates engineering
(release_health, ci_health, pr_health, engineering_risk), attention items,
deadlines (upcoming), meetings, documents, and activity — i.e. engineering risks,
CI/release signals, upcoming deadlines, and org/product activity. Each finding is
backed by real evidence; empty ⇒ silent no-op.

## Ranking (STEP 3)
`SECTION_IMPACT` maps each briefing section to a priority + impact vector:
engineering_risk ⇒ **critical**; attention/release/ci/upcoming ⇒ **high**;
pr_health/meetings ⇒ normal; unknown ⇒ normal default. Impact weights (security/
revenue/urgency highest) are scaled by confidence in the engine's `scoreImpact`,
so only the highest-value insights get delivered (min-priority gate = "high" by
default).

## Governance (STEP 5) — never fabricated
Every proactive item carries `governance`: **evidence** (e.g. `commit:c0`),
**sourceSystems** (connector ids + evidence kinds), **confidence** (0.4→0.9 by
evidence count), **reasoning** (why it matters), **recommendedAction** (what to do).
Added to the shared `IntelligenceItem` type so any future source is held to the
same standard.

## Delivery (STEP 4)
Registered on the existing engine as `founder-ai-proactive`, daily at the user's
morning-brief time. Delivered through the existing desktop channel; the deep-link
`ai-workforce/founder` opens Founder AI. Critical findings override DND (per the
engine). Weekly/monthly/critical-alert cadences are future `register()` calls —
no engine change.

## Files changed
- `packages/shared/src/types/delivery.ts` — `IntelligenceItem.governance` added.
- `apps/desktop/src/main/ai/founderProactive.ts` (new) — the source: builds the
  brief, extracts findings, maps to governance-complete items, exposes
  `founderProactiveSource(atMinutes)`.
- `apps/desktop/src/main/services/executiveDelivery.ts` — registers the source
  (one line + import). No engine change.
- `apps/desktop/src/main/ai/founderProactive.test.ts` (new) — 5 tests.

## Tests & verification
Desktop **547 passed** (5 new: empty no-op, engineering_risk→critical+governance,
confidence-by-evidence, unknown-section default, source shape). Backend 168 passed.
Desktop + backend typecheck clean. Lint clean.

## Known limitations
- Findings come from the briefing window; a dedicated "since last delivery" diff
  (so the same finding isn't resurfaced daily) is a natural follow-up.
- Impact/priority is section-based heuristic mapping, not per-finding ML — by
  design (deterministic, explainable). Tunable via `SECTION_IMPACT`.
- Delivered via desktop notification today; a dedicated "Founder AI feed" panel
  view that lists items with their governance block is a next increment.
- Connector-failure / license-expiry / inactive-org signals surface only insofar
  as they appear in the briefing today; wiring those as first-class findings is a
  later increment on the same source pattern.
