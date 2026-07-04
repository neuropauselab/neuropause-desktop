# V2.1 — Executive Intelligence Delivery

Transforms NeuroPause from a reactive dashboard into a proactive executive
intelligence platform by **delivering already-built intelligence on a schedule**.
It creates no new AI and no second scheduler — it wires existing capabilities.

## What was reused (STEP 1 recon — never duplicated)
- **`taskScheduler.every()`** — the existing recurring scheduler. The engine adds
  one 60s tick task; it does not introduce a second scheduler.
- **`notificationScheduler.notifyNow()`** — the existing desktop-notification
  path. The desktop channel calls it; no second notification system.
- **`generateBriefing(period, { entities, events, now })`** — the existing
  Mission Brief generator, read exactly as `initDailyIntelligence` reads it
  (unifiedStore + enterprise timeline). No second Mission Brief.

## Architecture (one reusable engine)
```
IntelligenceSource (register)         DeliveryChannel (deliver)
  key, label, cadence, produce()  ─┐    desktop  → notificationScheduler.notifyNow
                                   │    email/slack/teams/mobile → interface-only stubs
        DeliveryEngine ────────────┘
   • taskScheduler.every('delivery-engine:tick', 60s)
   • on tick: for each source whose cadence matches this minute →
       produce() → filter(priority+DND, critical-overrides) →
       sort by impact → deliver() to available channels
   • getPreferences() injected (working hours, DND, times, min priority)
```
Any module registers a source; the engine schedules, prioritizes, and delivers.
Mission Brief morning + evening are registered today; Founder AI, Engineering
alerts, Org alerts, weekly/monthly reports are future `register()` calls — no
engine change needed.

## Files changed
- `packages/shared/src/types/delivery.ts` (new) — shared types: priorities,
  impact axes, `IntelligenceItem`, `DeliveryCadence`, `IntelligenceSource`,
  `DeliveryChannel`, `DeliveryPreferences` + defaults, `meetsPriority`,
  `scoreImpact`. Exported from the shared barrel.
- `apps/desktop/src/main/services/deliveryEngine.ts` (new) — the reusable engine
  (register/tick/cadence-match/prioritize/deliver), fully DI for testing.
- `apps/desktop/src/main/services/executiveDelivery.ts` (new) — composition root:
  desktop channel (reuses notificationScheduler), interface-only email/slack
  stubs, preferences persistence (userData JSON, the existing pattern), Mission
  Brief source (reuses generateBriefing), the engine singleton, `initExecutiveDelivery()`.
- `apps/desktop/src/main/services/deliveryEngine.test.ts` (new) — 10 tests.
- `apps/desktop/src/main/runtimeCore.ts` — one `await initExecutiveDelivery()`
  after `initDailyIntelligence()`, plus the import.

## Prioritization (STEP 5)
`shouldDeliver`: below-threshold priority is dropped; **critical always delivers
(even under DND)**; non-critical is suppressed under DND. Scheduled briefs fire at
the user-chosen time (the schedule *is* the intent — not additionally gated by
working hours). `scoreImpact` weights security/revenue/urgency highest and scales
by evidence confidence, so low-confidence items rank down and the highest-impact
notification surfaces most-recent.

## Personalization (STEP 4)
`DeliveryPreferences` (persisted, user-editable): enabled, timezone offset,
morning-brief time, evening-summary time, weekly-report day, working hours, DND,
minimum priority. Defaults: on, 08:00 brief, 18:00 summary, Monday weekly, 09:00–
18:00 hours, min priority "high".

## Channels (STEP 3)
Implemented: **desktop** (native notification via the existing path). Designed as
interfaces only, not yet available: email, slack, teams, mobile — each is a
`DeliveryChannel` with `available:false`, so adding one later is a channel object,
not an engine change. Notification-center and Mission-Brief-panel delivery reuse
the same item (the deep-link field routes the click).

## Tests & verification
- Desktop: **542 passed** (10 new: cadence fires/doesn't, empty no-op, priority
  threshold, DND vs critical, no double-fire, disabled, impact ordering, plus the
  scoreImpact/meetsPriority unit tests). Backend: 168 passed. Typecheck + lint clean.

## Known limitations
- Delivery is scheduled by a 60s tick; fire time is accurate to the minute (by
  design — briefs are minute-granular).
- Only the desktop channel is live; other channels are interface stubs.
- The Mission Brief item summarizes section count + a lead line; richer per-source
  bodies (e.g. top-3 priorities inline) are a natural follow-up.
- Founder AI / Engineering / Org alert sources are not yet registered — the engine
  supports them; wiring each is a subsequent increment.
- Deep-link click handling routes via the existing notification wiring; a
  dedicated in-app deep-link handler for `enterprise/briefings` can be added.

## How it runs
`initExecutiveDelivery()` is called at boot from `runtimeCore`. It loads prefs,
registers the morning + evening Mission Brief sources, and starts the engine. At
the configured times, if the brief has content, a native notification is
delivered; if empty, nothing fires (silent no-op).
