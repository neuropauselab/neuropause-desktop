# Enterprise Intelligence Layer (Phase 6 · Stage 6)

The intelligence layer on top of the platform already delivered. It is **not**
another assistant, workflow engine, or search engine: it consumes the signals
every existing subsystem produces (see [SIGNAL-MAP.md](./SIGNAL-MAP.md)),
correlates them through the **existing P7 pure engines**, and produces
explainable insights, deterministic predictions, and governed
recommendations — while executing nothing itself.

## Architecture (composition, no engine)

```
signals (existing stores)                     the EXISTING P7 pure engines
  unifiedStore · jobStore · executeEngine ┐
  automation runs · connectorService      │   buildEnterpriseGraph
  conversationStore · inboxStore          ├─▶ correlateIncidents        ─┐
  orgIntelligence · healthHistoryStore    │   analyzeRootCause           │
  NeuroCore · decisionStore · timeline    ┘   composeEnterpriseIntelligence
                                                                         ▼
        main/insight/ (Stage 6 — pure composition)               composed report
  signalRegistry   the Signal Map as typed data (freshness /
                   completeness / trust per signal; doc-locked)
  signalProjection ops signals → extraNodes/extraEdges/events
                   (evidence ids preserved; per-source isolation)
  healthFramework  8 composed health domains, every score explained
  predictions      7 deterministic heuristics over recorded history
  insightModel     dependency graph · confidence breakdowns ·
                   outcome lifecycle · ten-question resolvers
  index            wiring: 3 s TTL cache · 5 read-only insight:* IPC ·
                   2 delivery-engine sources · insight.* timeline events
```

- **Intelligence Graph** — the unified P7 graph with the operational projection
  folded in (`ops:` nodes for connectors, automation rules, workers, approval
  queues, projects, the execute engine, the assistant). Computed per report,
  cached ~3 s, stored nowhere.
- **Correlation & root cause** — the existing `correlateIncidents` /
  `analyzeRootCause` running over base timeline events **plus** projected
  operational events, so chains like *connector failure → automation failure →
  approval backlog → project risk* are computed graph paths with per-record
  evidence ids.
- **Health framework** — eight domains (organization, departments, projects,
  workflows, automations, AI & workforce, connectors, approvals), each
  **composed from an existing computation**, each carrying explanation lines,
  evidence references, and a declared confidence. Missing sources produce
  explicit `unavailable` domains; low confidence is stated, never hidden.
- **Predictions** — deterministic heuristics only (approval backlog, project
  delay, connector instability, automation failure rate, inactivity,
  operational drift, risk trend). Each states its basis and horizon and stays
  silent without sufficient history.
- **Confidence breakdown** (enhancement #3) — every composed output carries
  `{dataAvailability, signalQuality, historicalCoverage, correlationStrength,
  overall}` instead of one opaque number.
- **Intelligence Dependency Graph** (enhancement #2) — per report, the
  signal → finding → recommendation links are materialized so every
  recommendation can answer *"how did correlated signals produce this?"* (the
  Intelligence Center's "Why?" panel). No graph store exists.
- **Outcome lifecycle** (enhancement #3) — recommendation → approved →
  executed → verified, where each stage is **derived from a real record**: a
  decision created from the recommendation or an `approval.granted` event in
  its correlation chain; an execution session sharing the chain; a
  deterministic re-observation that the underlying condition cleared
  (published as `insight.outcome_verified`). Absent records mean the stage
  simply does not appear.

## Governance

Read-only by construction: the subsystem imports no executor, no store writer,
and no scheduler. The five `insight:*` channels are RBAC-gated with the
existing `intelligence:read` permission and classified under the fail-closed
startup invariant. The two monitoring sources (`insight-monitor` every 15 min,
`insight-risk-trend` daily) register on the **existing delivery engine** and
pass the same gates as every other source (enabled → per-source mute →
priority threshold → DND) — they produce recommendation items, never actions.
Suggested recoveries reach execution exclusively as **assistant plan steps
behind the existing approval flow** (`assistant:plan.decide` →
ExecuteEngine).

## Surfaces

- **Intelligence Center** — the Executive Intelligence Dashboard (6.11) as a
  tab of the existing Intelligence workspace: eight explained health domains,
  the 30-day trend, active incidents with probable causes, tracked
  predictions, ranked recommendations with evidence + outcome lifecycle +
  dependency explanations, the signal honesty strip, and recently-verified
  outcomes.
- **Work Hub → Executive** — a summary intelligence tile deep-linking into the
  Intelligence Center.
- **Assistant** — the ten enterprise questions ("why did sales decrease?",
  "which projects are most at risk?", "what changed today?", "which teams need
  attention?", "show operational anomalies", "explain yesterday's failures",
  "which workflows repeatedly fail?", "which approvals are blocking?",
  "predict next week's risks", "summarize enterprise health") resolve
  deterministically into an `'intelligence'` structured report — answer,
  evidence, affected systems, confidence breakdown, assumptions, suggested
  action. Questions outside the connected data say so plainly (no revenue
  signal connected → stated, not invented).
- **Notifications** — insight items land in the existing inbox under their own
  mute-able source keys.

## API reference (read-only)

| Channel | Request | Response |
|---|---|---|
| `insight:report` | `{}` | `InsightReport` — signals, graph summary, incidents, health framework, predictions, recommendations, dependency graph, confidence, unavailable |
| `insight:rootCause` | `{ targetResourceId?, windowMs? }` | `RootCauseReport` (existing P7 shape) over base + projected events |
| `insight:health` | `{}` | `InsightHealthFramework` |
| `insight:predictions` | `{}` | `{ predictions: InsightPrediction[] }` |
| `insight:dashboard` | `{}` | `InsightDashboard` — health, incidents, predictions, recommendations, trend, signals, dependency graph, recently verified |

Timeline events: `insight.detected`, `insight.recommended`,
`insight.approval_requested`, `insight.outcome_verified` (category
`enterprise`, one `ins_…` correlation id per chain).

## Performance (6.12 budgets, locked by bench)

Correlation ≤ 100 ms · health framework ≤ 100 ms · root cause ≤ 200 ms ·
dashboard ≤ 500 ms — asserted at 5 k entities / 5 k events in
`src/main/insight/insightBench.test.ts`; the 3 s TTL cache (P7 precedent)
bounds repeated reads.
