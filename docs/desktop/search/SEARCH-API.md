# NEMS Universal Search — API Reference (Phase 6 Stage 3)

The universal search layer is a **renderer-side composition over existing services**. It introduces no new index, no new IPC channel, and no main-process code. This reference covers the pure modules under `apps/desktop/src/renderer/src/search/` and the existing IPC surface they consume.

## Module: `queryPlanner.ts`

### `planSearch(raw: string, now?: Date): SearchPlan`
Deterministic natural-language → structured plan. No LLM, no I/O; `now` is injectable for tests. The planner only ever **narrows** routing — unknown words stay in the retrieval text; nothing is invented.

Extractions (each recorded in `plan.explain`): quoted `"exact phrases"`; relative dates (`today`, `yesterday`, `this/last week`, `this/last month`, `recent`) → `since`/`until` epoch-ms bounds; connector aliases (`gmail`, `google drive`, `github`, `slack`, `jira`, `outlook`, …) → `connectorIds`; content kinds (`emails`→message, `documents`/`files`, `meetings`→calendar_event, `issues`/`PRs`→task, …) → `entityKinds`; app-record terms (`decisions`, `workflows`, `connectors`, `workspaces`, `sessions`, `apps`, `people`) → `recordKinds`; ERP terms (`invoices`, `orders`, `customers`, …) → `moduleTerms`; index hints (`memory`, `timeline`, `graph`) → `engineSources`; a person from `involving/assigned to/owned by/with <Name>`; status flags (`failed`, `unread`). `"assigned to me"` is recorded but not yet account-resolved (documented limitation).

```ts
interface SearchPlan {
  raw: string; text: string; phrases: string[];
  entityKinds: string[] | null; connectorIds: string[] | null;
  recordKinds: RecordKind[] | null; engineSources: EngineSourceKey[] | null;
  sources: PipelineSourceKey[] | null; moduleTerms: string[];
  since: number | null; until: number | null;
  person: string | null; flags: { failed?: boolean; unread?: boolean; mine?: boolean };
  explain: string[];
}
```

## Module: `searchModel.ts`

### The envelope — `UnifiedSearchItem`
Every hit from every source is mapped into one shape: `{ key, id, type, kind, title, summary, source, connectorId, timestamp, baseScore, score, explanation, matchText }`. `type` ∈ `entity | graph | memory | timeline | decision | workflow | connector | workspace | app | section | execution | person | business`.

### `SearchExplanation` — "Why this result?" (mandatory on every item)
`{ factors: {label, detail?, weight?}[], source, freshness, confidence }`. `confidence` is `high|medium|low` for content relevance and **`null` for navigational hits** (sections/apps/workspaces) where a confidence claim is not meaningful. `freshness` is `null` when the source carries no timestamp — never fabricated.

### Scope selector — `SEARCH_SCOPES`, `applyScope(plan, scopeId): ResolvedPlan`
Eight scopes (`all`, `content`, `knowledge`, `activity`, `operations`, `business`, `people`, `navigate`), each declaring which **existing** pipeline sources it routes to plus optional kind/record narrowing. `applyScope` combines user scope with the plan: the scope decides which sources run; the plan's filters narrow within them. In `all`, planner routing takes over only for pure browses (no free text), so a text query never silently skips an index.

### `rankUnified(items, {queryText, now, pinnedKeys?}): UnifiedSearchItem[]`
Explainable cross-source blend: source-normalized relevance ×0.55 + title match ×0.2 + recency (7-day half-life) ×0.15 + pinned ×0.1. Every contribution is appended to `explanation.factors` with its weight; confidence and freshness are computed here. Deterministic tie-break by title.

### Other exports
`applyPlanFilters(items, plan)` (dates/phrases/person/connectors/failed — returns kept + human notes), `groupItems`, `applyViewFilters` (type/date/sort), `matchScore` (exact > prefix > substring > subsequence), `freshnessLabel`, `readSearchHistory`/`pushSearchHistory` (prefs-backed, cap 20, injectable reader), `TYPE_META`.

## Module: `searchPipeline.ts`

### `runUnifiedSearch(rp: ResolvedPlan, io: SearchIo, opts?): SearchRunHandle`
Runs the resolved plan's sources **in parallel with per-source settle** (the Stage 2 isolation contract): each source independently becomes `ready` (optionally with a partial note) or `unavailable(reason)`; `opts.onUpdate` streams each source's items the moment it finishes; `cancel()` stops further updates; per-sub-call timeout (default 8 s) turns hangs into explicit unavailability. Returns real measured `timings` per source. A 20-entry / 60 s LRU cache (`planKey`) serves repeats; `bypassCache` forces a live run.

Sources → existing services only:

| Source | Existing service(s) | Notes |
|---|---|---|
| `engine` | `ipc.search.enterprise` (+ `ipc.unified.search` when kind/connector filters apply) | The federated engine (entity/graph/memory/timeline). The event query is required — a failed engine never renders as a fake empty. |
| `records` | `ipc.decisions.list`, `ipc.automations.list`, `ipc.connectors.list`, `ipc.workspaceContexts.list`, `ipc.execute.sessions/history`, `ipc.enterprise.org`, local app catalog + section registry | Renderer-filtered with `matchScore`; per-feed failures degrade to a partial note. |
| `semantic` | `ipc.memory.semanticRecall` | Backend vector search; an auth failure surfaces its reason (e.g. "Sign in to use semantic search."). |
| `modules` | `ipc.enterpriseModules.list` + `ipc.enterpriseModules.search` | Term-routed to matching modules, fan-out cap 4 **with an explicit note when capped** (no silent truncation). |

### `SearchIo`
The injected I/O port (all methods return `Promise<unknown>`; mapping is defensive). Bound to `ipc.*` by `SearchHost`; faked in tests.

## Module: `searchActions.ts`
`actionsFor(item)` → per-type action descriptors (Open, Pin, Copy title, Open connector, View in timeline, Open AI Memory). `resolveAction(item, actionId)` → a resolution over existing shell verbs (`section`, `enterprise-tab`, `connectors-tab`, `open-app`, `switch-workspace`, `copy`, `pin`). The host executes; pinning persists through `ipc.enterprise.personalization.favorite`.

## Module: `searchHandoff.ts`
One-shot mailbox (`setPendingSearchQuery` / `consumePendingSearchQuery`) so the command palette and Mission Control launch the full search view with a pre-filled query without touching any provider.

## React: `SearchHost.tsx` / `SearchView.tsx`
`SearchHost` binds pipeline↔IPC, streams updates, owns history (prefs `searchHistory`), saved searches (personalization saved views, `tab:'search'`), pinned results (personalization favorites, `kind:'search-result'`), and executes actions. `SearchView` renders the scope selector, per-source status strip, "Understood as…" plan transparency, filters/sort, grouped results, the expandable "Why this result?" panel, quick actions, saved/recent rails, and keyboard navigation.

## Security & permissions
All engine/entity/semantic calls ride the existing RBAC gates (`intelligence:read` on `EnterpriseSearch`/`UnifiedSearch`; org scoping inside memory ranking; federation remains opt-in and is **not** queried by default). The records feeds are the same RBAC-gated list IPCs every existing view uses. The search layer adds no privileged path.
