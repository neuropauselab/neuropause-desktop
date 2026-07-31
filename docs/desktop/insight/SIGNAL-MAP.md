# Enterprise Signal Map (Phase 6 · Stage 6)

The complete inventory of signals the NEMS platform produces and the Enterprise
Intelligence Layer consumes. **This document is locked to code**: the same map
ships as the typed registry in
`apps/desktop/src/main/insight/signalRegistry.ts`, and
`signalRegistry.test.ts` asserts that every registry id and name appears here —
the inventory cannot silently drift.

Each signal carries the enhancement-#1 metadata:

- **Freshness** — expected cadence, and the staleness window after which the
  layer degrades its trust in the reading (`—` = freshness is not
  time-meaningful; computed-on-demand signals are always current).
- **Completeness** — structural coverage: `full`, `bounded` (capped/ring
  history, bound stated), or `partial` (known gaps, stated).
- **Trust** — provenance tier (`provider-authoritative` > `runtime-recorded` >
  `derived` > `heuristic`) and the 0–1 evidence weight used by the confidence
  breakdown.

| # | id | Signal | Owner | Freshness | Completeness | Trust | Depends on | Consumers |
|---|----|--------|-------|-----------|--------------|-------|------------|-----------|
| 1 | `work-entities` | Work entities (tasks, projects, meetings, emails, docs, notifications) | `unified/unifiedStore` | per-sync · stale after 240 min | full | provider-authoritative · 0.95 | — | search, briefings, recommendations, hub, assistant retrieval |
| 2 | `timeline-events` | Enterprise timeline events | `timeline/` over `platform/eventBus` | realtime · — | bounded — live event window (bounded buffer) | runtime-recorded · 0.9 | — | briefings, P7 incidents, assistant, hub, webhooks |
| 3 | `workforce-jobs` | Workforce jobs + parked approvals | `workforce/runtime/jobInstance` | realtime · — | bounded — durable, capped at 2000 jobs | runtime-recorded · 0.9 | timeline-events | approval center, executive snapshot, recommendations, hub, notifications |
| 4 | `executions` | Executions (all kinds) | `executeEngine + executionStore` | realtime · — | bounded — ring of last 200 sessions | runtime-recorded · 0.9 | — | operations center, P19, hub timeline, work summary |
| 5 | `workflow-runs` | Workflow runs | workforce orchestrator (`workflow.*` events) | realtime · — | bounded — observed via the timeline event window | runtime-recorded · 0.85 | timeline-events, workforce-jobs | timeline, notifications |
| 6 | `automation-runs` | Automation runs | `AutomationRunHistory` + per-rule `lastRun` | realtime · — | bounded — ring of last 200 runs | runtime-recorded · 0.9 | — | automation monitor, recommendations, work summary |
| 7 | `connector-health` | Connector health & sync state | `connectorService` + runtime supervisor + sync snapshots | per-sync · stale after 120 min | full | runtime-recorded · 0.9 | — | diagnostics, assistant snapshot, recommendations, notifications |
| 8 | `assistant-conversations` | Assistant conversations (incl. waiting steps) | `assistant/conversationStore` | realtime · — | full | runtime-recorded · 0.9 | — | recommendations, hub, productivity timeline |
| 9 | `ai-invocations` | AI invocations & usage | `ai/aiEngine` audit log | realtime · — | full | runtime-recorded · 0.9 | — | session inspector, AI health, cost views |
| 10 | `memory-corpus` | Memory corpus + memory audit | `memory/memoryStore + memoryAuditLog` | realtime · — | partial — distilled from #1/#2, not a full copy | derived · 0.7 | work-entities, timeline-events | retrieval, recall, meeting prep, assistant tasks |
| 11 | `recommendations` | Recommendations | `recommendations/` (computed, stateless) | on-demand · — | full | derived · 0.8 | work-entities, timeline-events, workforce-jobs, automation-runs, connector-health, assistant-conversations | hub, executive snapshot, decisions |
| 12 | `notification-inbox` | Notification inbox | `notifications/inboxStore` | realtime · — | bounded — durable, capped at 200 items | runtime-recorded · 0.85 | timeline-events | bell, notifications view, productivity timeline |
| 13 | `briefings` | Briefings (5 periods) | `intelligence/briefingGenerator` (computed) | scheduled · — | full | derived · 0.8 | work-entities, timeline-events | delivery, assistant, hub today |
| 14 | `org-structure` | Org structure & metrics | `enterprise/org/orgStore` | per-sync · — | full | runtime-recorded · 0.9 | — | org UI, org health, executive snapshot |
| 15 | `org-health` | Org-health scores + findings | `orgIntelligence` + `healthHistoryStore` (90-day daily history) | daily · stale after 2880 min | bounded — 90 daily points | heuristic · 0.65 | workforce-jobs, automation-runs, connector-health, org-structure | executive center, org-intelligence delivery |
| 16 | `executive-snapshots` | Executive snapshots | `computeExecutiveSnapshot + ExecutiveCenterSnapshot` | on-demand · — | full | derived · 0.8 | workforce-jobs, connector-health, recommendations, org-structure, org-health | enterprise dashboard, hub executive, decisions |
| 17 | `p7-intelligence` | P7 intelligence report | `enterpriseIntelligenceSubsystem` (computed, 3 s TTL) | on-demand · — | full | heuristic · 0.7 | timeline-events | ops surfaces, P14–P19 layers |
| 18 | `system-health` | System health | `NeuroCore.snapshot()` | on-demand · — | full | runtime-recorded · 0.9 | automation-runs | settings/ops surfaces |
| 19 | `workforce-kpis` | Workforce KPIs & bottlenecks | `workforce/intelligence/*` | on-demand · — | full | derived · 0.8 | workforce-jobs | workforce center, insights |
| 20 | `decisions` | Decisions | `enterprise/decisionStore` | realtime · — | bounded — durable, capped at 500 decisions | runtime-recorded · 0.9 | — | decision UI, hub executive, meeting prep |
| 21 | `workspace-contexts` | Workspaces & contexts | `ipc/handlers/workspaceContexts` | realtime · — | full | runtime-recorded · 0.9 | — | assistant context, shell |
| 22 | `hub-feeds` | Mission Control / Hub feeds | renderer compositions (per-view) | on-view · — | partial — composite of #1–#16, not raw evidence | derived · 0.6 | work-entities, timeline-events, workforce-jobs, executions, recommendations, executive-snapshots | users |

**Projected at report time** (fed into the P7 engines as
`extraNodes`/`extraEdges`/`CorrelationEvent`s, with evidence ids preserved):
`work-entities`, `timeline-events`, `workforce-jobs`, `executions`,
`workflow-runs`, `automation-runs`, `connector-health`,
`assistant-conversations`, `notification-inbox`, `org-health`,
`system-health`, `decisions`.

**Honest exclusions:** "search activity" exists only as renderer-local
recent-search state (not a durable signal); "Analytics" is not a distinct
subsystem — analytical views are compositions of the signals above.
