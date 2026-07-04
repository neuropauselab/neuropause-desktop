# V2.8 — Unified Interaction Layer

One interaction router so every input surface — voice, keyboard, command palette,
quick actions, context menus, and notification actions — resolves through the SAME
pipeline into existing services. This increment ships the **pure, fully tested
router + registry** (the STEP 2 heart). The renderer surfaces that consume it
(palette additions, context menus, notification-action buttons) are React and are
called out as the on-device wiring step.

## STEP 1 recon — reused, never duplicated
- Existing **CommandPalette** (`CommandItem` + `GroupKey`) → the registry feeds it;
  we add commands, not a second palette.
- **V2.5 `deepLinkToSection`** → the shared navigation vocabulary every resolution
  uses; the router emits deep-links, the shell already knows how to route them.
- **V2.6 `VoiceResponse`** (deepLink/actionId/requiresApproval) → adapted into the
  same `CommandResolution` model, so voice and palette share one pipeline.
- Existing **enterprise search**, **intelligence pipeline** (founder/brief/org-health/
  executive snapshot), and **governance/approval** path → resolutions point at
  these; nothing is re-implemented.

## Architecture
```
 voice ─┐
 keyboard ─┤
 palette ─┼─▶ UnifiedCommand ─▶ resolveCommand() ─▶ CommandResolution ─▶ shell executes with
 quick action ─┤     (id + source)      (pure, total)     (navigate/search/       EXISTING services
 context menu ─┤                                            intelligence/action/ui)
 notification ─┘

 voice output ─▶ voiceResponseToResolution() ─▶ same CommandResolution model
```

## Command model (the one vocabulary)
- **`CommandId`** — ~25 stable ids (open.*, search.*, action.*, voice.*, org.*,
  brief.*, eng.*, notification.*). Adding one is additive.
- **`CommandResolution`** — `{ kind: navigate | search | intelligence | action | ui,
  deepLink?, query?, intelligence?, actionId?, requiresApproval?, uiEffect? }`.
- **`COMMAND_REGISTRY`** — every command in one place (title, group, keywords,
  shortcut). Single source of truth for palette + quick actions + context menus.

## STEP mapping
- **STEP 2 (router)** — `resolveCommand()` is pure + total; a resolution exists for
  every registry id (asserted by test).
- **STEP 3 (universal palette)** — `filterCommands(query)` filters the registry by
  title/keyword, feeding the EXISTING palette (open Founder AI, mission brief,
  search org/memory/timeline, create task, generate report, start voice, …).
- **STEP 4 (contextual quick actions)** — `quickActionsFor(section)` returns the
  right descriptors per screen (organization → health/report/notify; brief →
  explain/export/share; engineering → issue/failures/notify).
- **STEP 5 (notification actions)** — snooze/dismiss/explain resolve to governed
  actions or the intelligence pipeline, carrying the notification's `contextId`.
- **Voice unification** — `voiceResponseToResolution()` maps a spoken turn into the
  same model (action → governed action; deepLink → navigate; pure answer → no-op).

## Governance
Every state-changing command (`action.*`, notify, share) resolves with
`requiresApproval: true` and an `actionId` for the EXISTING approval path — the
router never self-executes. Read-only navigations/searches don't require approval.

## Files changed
- `packages/shared/src/types/interaction.ts` (new) — the unified command model.
- `packages/shared/src/interactionRouter.ts` (new) — registry + router + adapters.
- `packages/shared/src/index.ts` — export both.
- `apps/desktop/src/main/interaction/interactionRouter.test.ts` (new) — 18 tests.

## Tests & verification
Desktop **618 passed** (18 new: registry totality + uniqueness, every resolution
kind, voice adaptation for action/navigate/pure-speech, quick actions per screen,
palette filtering). Shared + desktop + backend typecheck: **0**. Lint: clean.

## Known limitations — read honestly
- **Renderer wiring is NOT in this increment** and is not CI-verifiable (no headless
  browser). The pure router/registry is done and tested; the on-device steps are:
  1. Feed `COMMAND_REGISTRY` + `filterCommands` into the existing CommandPalette's
     command group (it already renders a `Commands` group — map descriptors to
     `CommandItem`s and dispatch `resolveCommand` on select).
  2. Render `quickActionsFor(section)` as a quick-action bar per screen.
  3. Add context-menu + notification-action buttons that emit `UnifiedCommand`s.
  4. In the shell's executor, switch on `CommandResolution.kind` → reuse
     `setSection(deepLinkToSection(...))` for navigate/search, the intelligence IPC
     for intelligence, the approval path for action, and the voice/palette toggles
     for ui.
  Each is small and mechanical; all verify on macOS.
- Keyboard-shortcut registration (binding ⌘⇧F etc. to command ids) is a renderer
  concern layered on the registry — a follow-up.
- `search.timeline` currently deep-links to the organization surface; a dedicated
  timeline search route can be added when that view exposes a query param.

## How the shell executes a resolution
```ts
const res = resolveCommand(command);            // or voiceResponseToResolution(voice)
switch (res.kind) {
  case 'navigate':
  case 'search':       setSection(deepLinkToSection(res.deepLink)); /* + run search */ break;
  case 'intelligence': /* call existing founder/brief/org-health IPC */ break;
  case 'action':       /* route res.actionId through the approval path */ break;
  case 'ui':           /* open voice widget / palette / toggle sidebar */ break;
}
```
