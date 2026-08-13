# NeuroPause — Private-First Onboarding + AI Workspace

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15`
**Gate:** `typecheck:release` PASS · `lint:release` PASS · `test:release` **6,197 / 6,197 across 649 files** (desktop; up from 6,148 / 646), backend 418, cloud-core 44, companion-protocol 23 — **0 failures, none deleted or weakened**
**Status: IMPLEMENTED — DEVICE VISUAL VERIFICATION PENDING.**

---

## The rule the whole stage is built on

**A claim about where processing happened must come from the execution, never
from the configuration.** Every AI response carries routing metadata stamped by
the client that actually completed the request; the badge, the "Why?" answer
and the usage statistics are all derived from that stamp. Nothing in the
renderer infers a location. Nothing displays a location for a run that produced
none. Nothing shows a percentage that was not computed from measured counts.

"Private First" is therefore not copy — it is a routing policy with a planner,
a composite client, a refusal path, and nineteen tests, four of which are the
charter's own critical cases.

---

## The user journey

```
Launch
  ↓  (experience profile: state = pending)
"Your AI. Your Data. Your Control."     [ Try Free Locally ]  [ Sign In ]
  ↓
"Where should your AI work?"            On this device · With approved cloud AI
  ↓  → ipc.aiConfig.setMode('private_first') + setExternalConsent(bool)  ← REAL routing config
"How do you want to use NeuroPause?"    Personal · Professional · Business/Enterprise
  ↓  → experience profile: workspaceType + completed                     ← reshapes nav
AI Home — "What do you want to accomplish?"  → first task through the real assistant
```

Each decision persists the moment it is made (`experience-profile.json`,
`ai-config.json` — both under userData with the store envelope; secrets stay in
the OS keychain via the existing Secure Vault). Quitting mid-flow loses
nothing; completion is one-way and cannot be resurrected by a later write
(asserted by test). "Sign In" records a skip and routes to the existing
Settings identity surface — it does not pretend to be a registration flow, and
consequently **no "no credit card required" claim appears anywhere**.

The existing onboarding checklist wizard (legal, organization, connectors, AI
key) still runs — after the experience, never on top of it.

---

## The AI modes, and what they actually do

| Mode | Behaviour |
|---|---|
| `private_first` | Try local → private infrastructure → external, external only with explicit consent. |
| `local_only` | Local/private routes only. A request that needs a model and finds none **fails on this device** with a message saying nothing was sent anywhere. |
| `external` | The user's configured cloud provider leads (their pre-mode behaviour, preserved exactly). |

**Backwards compatibility is a resolution rule, not a migration.** A stored
`mode` of null (every install predating this stage) resolves to the mode that
reproduces that install's existing behaviour: effective-provider Claude →
`external`; anything else → `private_first`. A working cloud setup keeps
working identically — `assembleRouteCandidates` only adds the local route when
there is *evidence the user means to have one* (provider selected, endpoint
set, env vars, or an explicit mode choice), so a legacy claude-install with no
key still reports needs-setup rather than growing a surprise localhost route.
Both behaviours are pinned by the pre-existing providerManager/engineManager
tests, updated to the evolved contract with their intent intact.

### Location classification

`classifyEndpointLocation`: loopback (`localhost`, `127.0.0.1`, `::1`,
`0.0.0.0`) → **local**; any other endpoint → **private_infrastructure** (the
user's infrastructure, but not this machine). An unparseable endpoint
classifies as remote — over-claiming "local" is the one failure the function
is not allowed to have. Anthropic is **external** by definition. A fourth
state, **none**, is stamped when no model ran at all (deterministic assistant
answers, refused plans, failures) — "computed on this device" is stated, but
never dressed up as "local AI".

### The four critical cases (all tested, `privateFirstRouting.test.ts`)

| Situation under `private_first` | Result |
|---|---|
| Local model available | **LOCAL** — external client never called |
| Local down, private infrastructure available | **PRIVATE INFRASTRUCTURE**, with the failed local attempt recorded in the metadata |
| Only external enabled | **EXTERNAL**, and "Why?" says local was tried first and why it failed |
| External disabled, nothing private available | **FAILS ON THIS DEVICE.** The planner returns a refusal; the composite is built with zero routes; the test asserts the external client was *never invoked*. |

---

## Architecture

```
packages/shared/src/types/aiRouting.ts     the policy: locations, modes, planRoute,
                                           AiRoutingMetadata, explainRouting, usage math
packages/shared/src/types/experienceProfile.ts  workspace types + first-run state machine

apps/desktop/src/main/ai/
  privateFirstClient.ts    the composite ModelClient — ordered attempts, execution stamp
  providerManager.ts       assembleRouteCandidates (ONE assembly site) + buildModelRouter
  aiConfigStore.ts         + mode, externalConsent, resolveAiMode (null-preserving)
  routingUsageStore.ts     measured counts, envelope-persisted, tamper-corrected
  aiEngine.ts              copies the execution stamp onto AiEngineResponse; measures
  aiConfigIpc.ts           setMode / setExternalConsent / routingStatus / routingUsage

apps/desktop/src/main/onboarding/
  experienceProfileService.ts   pending → completed|skipped; per-decision events

apps/desktop/src/renderer/src/firstRun/
  experienceModel.ts       ALL renderer judgements (pure, 17 tests)
  FirstRunExperience.tsx   the three-step full-screen flow
  AiHomeView.tsx           Ask NeuroPause + suggestions + upgrade card
  ProcessingBadge.tsx      the badge + "Why?" (renders NOTHING without metadata)
  workspaceTypeStore.ts    tiny external store feeding the nav filter
```

The metadata path, end to end:

```
AI request → planRoute(mode, candidates) → PrivateFirstClient.complete()
  → tries each permitted route in order, records each failure
  → the SUCCEEDING client's result is stamped with AiRoutingMetadata
→ AiEngine copies the stamp onto AiEngineResponse.routing + records usage
→ assistantService copies it onto AssistantEnvelope.processing
→ ProcessingBadge renders label + "Why?" from the stamp — and only from it
```

One candidate assembly site (`assembleRouteCandidates`) feeds BOTH the router
construction and the Settings routing status, so what Settings shows and what
a request does can never be two different computations.

### Reuse, not duplication

The existing provider system remains the single source of truth: the same
`AiConfigStore`, the same Secure Vault credential, the same `engineManager`
hot-reconfigure, the same Ollama/Claude clients, the same assistant pipeline
(context → retrieval → reasoning → audit → correlation ids). The composite is
a `ModelClient` like any other; no second provider registry, no second engine,
no second settings store was created.

---

## Workspace types

Personal, Professional and Business are **one product** — nav and emphasis
over the same platform, the same stores, the same RBAC. The filter is a render
concern in `sectionVisibleFor`; the `SECTIONS` array, its order and every nav
lock are untouched (asserted), and the command palette still exposes
everything.

| Type | Shows |
|---|---|
| Personal | AI Home, Mission Control, Search, Assistant, Hub, Memory, Knowledge, Data, Workspace, Store, Notifications, Settings, Welcome |
| Professional | Everything except the platform-operations layers (cloud, control plane, federation, infrastructure, ecosystem, developer/commercial centers) |
| Business / Enterprise | Everything |
| *(no choice yet / pre-experience installs)* | Everything — existing installs are untouched |

**The upgrade path is real because there is nothing to migrate.** Switching
Personal → Professional is a one-field profile change revealing the business
surfaces; documents, knowledge, AI preferences and local data are the same
records before and after. The upgrade card says exactly that — and therefore
promises no migration, because none is needed. Switching back is equally free.

---

## AI Home

`ai-home` section ("Ask NeuroPause", Today group, positioned after the locked
landing quintet so every existing nav-lock test holds; 9.4 kB lazy chunk).

- The ask box submits through **`ipc.assistant.ask`** — the real turn pipeline
  with retrieval, audit and correlation ids. No parallel ask path exists.
- While in flight, the indicator names the *planned* first route ("Processing
  locally…") from the live routing plan; if no plan information exists it says
  "Working…" — a generic state, never a fabricated source.
- The answer renders with the **ProcessingBadge** from
  `envelope.processing`, plus findings and sources from the envelope.
- **Suggested actions are capability-gated** (tested): asks are offered only
  when a route is available; business analysis only when business records
  exist *and* the workspace type shows them; with no AI route the suggestion
  is "Set up AI processing". Nothing is offered that cannot execute.
- The assistant's conversation view carries the same badge on every turn.

---

## Settings → AI

**Private First routing** panel (above the existing provider panel):

- **AI Mode** — the three modes as a radio group; writes `ai:config.setMode`
  (audited — "when did requests start being allowed to leave the device" is a
  question the audit trail must answer).
- **External fallback consent** — explicit checkbox; audited; disabled under
  Local Only with the reason stated.
- **Routes** — Ollama and Anthropic with their real state: `Connected` (a live
  probe for Ollama), `Not configured`, `Disabled`, `Unreachable`, plus model
  and endpoint. When the current plan can serve nothing, the planner's refusal
  is shown verbatim.
- **AI Usage** — measured only. Zero runs → *"Usage data will appear after you
  use NeuroPause."* With data: per-location counts and percentages over the
  real total, labelled "measured over N AI runs on this install".
- **Privacy Center** — what happens / where / when / who controls it, for each
  of the three routes, in plain language that never exceeds the architecture:
  external prompt content goes to the provider the user enabled, and their
  terms govern their handling of it.

---

## Telemetry

Local platform events only (the existing event bus → timeline); no network
analytics system exists and none was invented. Recorded: `experience.decision`
platform events carrying **event names only** — `workspace_type_selected`,
`ai_mode_selected`, `onboarding_completed` / `onboarding_skipped` — fired once
per decision (tested), plus the routing-usage counters (location + timestamps
only). **Not recorded anywhere: prompts, document contents, or AI responses.**
The routing usage file contains four integers and two timestamps.

---

## Security

- The external-consent gate is enforced in the **planner**, and the refused
  plan produces a composite with zero routes — there is no code path from
  "external disabled" to an external request. Asserted by the never-called test.
- Mode and consent changes are **audited** through the secure bridge.
- All six new channels ride the existing secure bridge (sender trust, Zod
  validation, timeout, call audit) and are accounted for in the
  `runtimeAuthz` fail-closed inventory alongside the AiConfig block they
  extend (same sender-trust rationale: per-install desktop configuration).
- Secrets: unchanged — keys in the OS keychain via the Secure Vault; the new
  stores hold no secrets; profile and usage files are 0600 with the envelope
  (corrupt files quarantine, never silently reset).
- Workspace/tenant isolation and RBAC are untouched: the AI Home calls the
  same assistant pipeline with the same permission classes as the Assistant
  section.

---

## Tests — 49 added (desktop 6,148 → 6,197; files 646 → 649)

| Suite | Count | Covers |
|---|---|---|
| `privateFirstRouting.test.ts` | 19 | The four critical cases; endpoint classification (unparseable ≠ local); planner ordering + consent exclusion; per-route models; attempt recording; engine stamp + measurement; refusal → deterministic fallback with `none`; usage math; explainRouting. |
| `experienceProfile.test.ts` | 10 | Immediate persistence; reload survival; one-way completion; upgrade path changes type after completion; one event per decision; corrupt-file quarantine; usage store reload/tamper/garbage handling. |
| `experienceModel.test.ts` (renderer) | 17 | Nav filter per type (null = everything; personal allowlist is real ids; order preserved → nav locks hold); badge honesty (no metadata → nothing); Why composition; capability-gated suggestions; measured-only usage display; the first-run copy carries no unprovable claim (asserted: no "no credit card", no "100% local", no "never leaves your device"). |
| Updated in place | — | `aiConfigStore` (new fields round-trip + coercion + `resolveAiMode`), `providerManager` (composite contract, legacy no-key behaviour preserved), `aiConfigIpc` (DTO shape), `runtimeAuthz` (six channels accounted). Every original intent kept. |

---

## Limitations — stated, not implied away

| Item | Status |
|---|---|
| Device visual verification | **PENDING.** `npm run dev` requires macOS. The production bundle builds cleanly (all chunks emitted, `AiHomeView` 9.4 kB); the flow, routing and settings logic are covered by 49 tests; nobody has looked at the screen. |
| DOM-level renderer tests | Not possible in this repo (no DOM test library). All view logic is in the tested pure model. |
| Sign In | Routes to the existing Settings identity surface. There is no in-experience registration flow — which is exactly why no registration claims are made. |
| "Private infrastructure" | Means a user-configured remote model endpoint (e.g. Ollama on their own server), classified by where the endpoint points. There is no fleet-management of such infrastructure. |
| Bare single-provider routers | The pre-reconfigure boot router may serve a request without endpoint-classified metadata; such runs render **no badge** (absence, never a guess) and are measured only when the location is certain (Anthropic → external). After the first `engineManager.reconfigure()` every construction goes through the composite. |
| Local model quality/capability routing | Not implemented. Private First prefers by LOCATION; it does not judge whether the local model is *good enough* for a given task. |
| Personal-workspace content packs (notes templates, etc.) | Not implemented — Personal is a curation of existing surfaces. |
| The four AI-mode settings rows the charter sketches ("Local AI / Private Infrastructure / External AI" as separate toggles) | Implemented as the three real modes + per-route status rows, because a toggle per location would imply independent switches the router does not have. The consent checkbox is the one real independent switch, and it is there. |
