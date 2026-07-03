# Founder AI v2 — Executive Intelligence

Founder AI is the executive interface of NeuroPause — not a chatbot. A founder asks
a strategic question; Founder AI classifies intent, gathers only relevant evidence,
runs the AI Engine for narrative, gates the result through governance, and returns a
structured executive answer. **It never invents facts**: deterministic findings are
authoritative and always present; the model only explains and recommends over them.

Built and verified in slices: **F1** engine → **F2** Executive Chat → **F3** right
rail → **F3b** data-derived suggestions → **F3c** Evidence Inspector + Reasoning
Timeline + provenance. All slices are applied and green (typecheck node+web, full
vitest suite, lint 0).

## Architecture

```
Question ─▶ classifyFounderIntent (deterministic, 12 intents + unclear)
              │
              ├─ confidence < 0.34 ─▶ clarification  (no model call, no guessing)
              │
              ▼
          deterministicFindings(intent)   ← Mission Brief sections (evidence + connector)
          buildContext(worker:'founder')  ← Context Builder: brief, KG, AI memory,
              │                              previous-decisions, timeline
              ├─ no findings AND no context ─▶ "not enough evidence"  (no model call)
              │
              ▼
          AI Engine.run('founder.executive', tier:'balanced')
              │   (render prompt + auto-injected context → router → model →
              │    parse JSON → cost → usage → AUDIT)
              ▼
          governance gate (read-only allow; external-action recs flagged for approval)
              ▼
          FounderResponse  { executiveSummary, keyFindings, businessImpact,
                             recommendations, evidence, confidence, sourceSystems,
                             governance, intent, grounded, aiOffline }
```

Everything reuses existing systems — AI Engine, Context Builder, Knowledge Graph,
Timeline, Unified Data Model, AI Memory, Mission Brief, Ollama adapter, AI Audit.
The services are **pure** (dependencies injected), so they unit-test electron-free.

### Founder Workspace (UI)

A two-column layout under Operations → Founder AI:

- **Executive Chat** (left): input + data-derived suggested questions; renders the
  structured response — Executive Summary, Key Findings (each tappable to inspect
  evidence), Business Impact, Recommendations (advisory; approval badge when an
  action verb is present), Governance, and a Reasoning Timeline.
- **Right rail**: five compact cards, each wired to real data through existing
  channels — Today's Priorities (recommendations), Pending Approvals (governance
  proposal queue), AI Worker Status (worker registry), Recent Decisions (workforce
  audit), Recent Connector Events (timeline).

The old rule-based engine (`founder/founderEngine.ts`, channel `founder:ask`) is
untouched and still registered; Founder AI v2 runs on `founder:ask-v2`.

## Files changed (by slice)

**F1 — engine**
- `packages/shared/src/types/aiEngine.ts` — `FounderIntentV2`, `FounderIntentResult`, `FounderFinding`, `FounderResponse`
- `packages/shared/src/ipc/channels.ts` — `FounderAskV2`
- `packages/shared/src/ipc/contracts.ts` — `FounderAskV2Request`
- `apps/desktop/src/main/ai/promptManager.ts` — `founder.executive` prompt
- `apps/desktop/src/main/ai/founderAI.ts` — classifier, governance, orchestrator, briefing→findings
- `apps/desktop/src/main/ai/founderAI.test.ts` — intent / unit / context / governance / audit / provenance
- `apps/desktop/src/main/ai/index.ts` — `initFounderAIv2()`
- `apps/desktop/src/main/runtimeCore.ts` — register handlers

**F2 — Executive Chat**
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `founderAI.askV2`
- `apps/desktop/src/renderer/src/operations/FounderPanel.tsx` — structured response rendering

**F3 — right rail**
- `apps/desktop/src/renderer/src/operations/FounderWorkspaceRail.tsx` — five real-data cards
- `apps/desktop/src/renderer/src/operations/FounderPanel.tsx` — two-column layout

**F3b — data-derived suggestions**
- `apps/desktop/src/main/ai/founderSuggestions.ts` + `.test.ts` — briefing-driven question derivation
- `packages/shared/src/types/aiEngine.ts` — `FounderSuggestedQuestion`
- `packages/shared/src/ipc/channels.ts` / `contracts.ts` — `FounderSuggestions` + request
- `apps/desktop/src/main/ai/index.ts` — `suggest` handler
- `apps/desktop/src/renderer/src/lib/ipc.ts` — `founderAI.suggestions`
- `apps/desktop/src/renderer/src/operations/FounderPanel.tsx` — dynamic chips

**F3c — Evidence Inspector + Reasoning Timeline + provenance**
- `packages/shared/src/types/aiEngine.ts` — `connectorId` on `FounderFinding`
- `apps/desktop/src/main/ai/founderAI.ts` — carry connector provenance, merge into source systems
- `apps/desktop/src/renderer/src/operations/FounderReasoningTimeline.tsx` — pipeline steps
- `apps/desktop/src/renderer/src/operations/FounderPanel.tsx` — expandable findings (evidence breakdown) + reasoning timeline

## IPC channels

- **`founder:ask-v2`** — `{ text, now? }` → `FounderResponse`
- **`founder:suggestions`** — `{ now? }` → `FounderSuggestedQuestion[]`
- Rail reuses existing channels: `recommendations:generate`, `workforce:workers`,
  `workforce:jobs`, `workforce:audit`, `enterpriseTimeline:query`
- `founder:ask` (legacy) — unchanged

## Database changes

**None.** Every path is stateless per request and reads only derived state (UDM
query, timeline query, computed Mission Brief, worker registry, governance queue,
audit log). No schema, no migration.

## Manual testing checklist

1. **Build green** — `npm run typecheck -w @neuropause/desktop`, then
   `(cd apps/desktop && ../../node_modules/.bin/vitest run)`, then `npm run lint`.
2. **Live, grounded** — `NEUROPAUSE_LLM_PROVIDER=ollama npm run dev` with Ollama
   running. Operations → Founder AI. Ask a starter chip or your own question.
   Expect: green `AI · <model>` badge with intent + match %, Executive Summary,
   Key Findings from your data, Business Impact, Recommendations, Governance, and a
   Reasoning Timeline (intent → context → model → governance).
3. **Evidence Inspector** — tap a Key Finding; it expands to show its connector,
   timestamp, and an evidence-kind breakdown.
4. **Suggested questions** — the chips reflect your data (engineering/release
   questions surface when CI sections are populated); hover for the reason.
5. **Right rail** — Today's Priorities (deduped with ×N), Pending Approvals, AI
   Worker Status (health pills + trust %), Recent Decisions, Recent Connector Events.
6. **Clarification** — an ambiguous question returns a "Need a bit more" card, no
   model call.
7. **No evidence** — with nothing connected, an honest "not enough evidence" answer.
8. **Model offline** — plain `npm run dev` (no provider): narrative cards drop, a
   dashed note explains, Key Findings still render, governance notes no model ran.

> GUI `.app` bundles do not inherit the shell environment, so the provider env var
> must be set for the `npm run dev` process.

## Known limitations

- **One real LLM worker.** Only Engineering AI routes through the AI Engine. The
  other workforce workers (Research/Finance/Marketing/Support/Legal/Sales/Operations)
  are deterministic skill-runners; their registry status is shown (AI Worker Status),
  but they don't produce LLM executive analysis. Founder AI grounds answers in
  available evidence and leaves a clean seam to fold real worker output in as those
  workers are promoted — it does not fabricate analysis from them.
- **Suggestions are briefing-driven.** The derivation service has seams for two live
  signals (`pendingApprovals`, `workersNeedingAttention`) — both tested — but the
  composition passes only the briefing today, so the approvals/worker-attention
  suggestions don't fire until the governance queue + registry are wired into that
  path. Suggestions are deterministic (rules over real data), not LLM-generated.
- **Conversation memory is a seam, not yet persisted.** Founder AI reads AI Memory
  as context but does not yet write founder conversations back
  (question/referenced-entities/decisions/approvals/action-items, no secrets).
- **Evidence Inspector** shows a connector + evidence-kind breakdown per finding.
  Resolving individual evidence ids to titles (most are timeline events, not
  entities) is a future enhancement; the Traces tab covers deep tracing.
- **Connector events** are grounded only in connectors with real adapters (GitHub,
  Google Calendar, Notion, Slack).
- **Governance depth.** Founder AI uses a focused read-only gate (the proven
  Engineering AI pattern). Deeper integration with the workforce GovernanceRuntime
  policy engine is a later item.
- **No renderer test harness.** UI is verified by typecheck + lint + live check;
  there is no RTL/jsdom setup in this codebase. Backend logic is fully unit-tested.
