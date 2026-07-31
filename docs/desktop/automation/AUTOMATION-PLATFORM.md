# Enterprise Automation Platform (Phase 6 · Stage 8)

The Automation Platform is **one additive orchestration subsystem**
(`apps/desktop/src/main/automationPlatform/`) composed entirely over engines
that already exist. It owns **no runtime, no store, no scheduler class, no
executor, and no mutation surface**. Execution continues to flow exclusively
through the existing spine:

```
Assistant → Approval → ExecuteEngine → Workforce → Connector Executors
```

This document is **test-locked** to the code registries
(`automationRegistry.stage8.test.ts` fails if the two drift): every playbook,
policy-defaults entry, IPC channel, and assistant question listed here exists in
`automationRegistry.ts` / `index.ts`, and vice versa.

---

## 1. The Automation Catalog (computed, never stored)

`ap:catalog` classifies every automation-capable capability **live** on each
read (3 s TTL): Automation Builder rules, registry playbooks, workflow runs,
delivery-engine sources, scheduled sandbox validations, autonomous-ops advisory
plans, and the assistant's built-in flows. Per-source read failures isolate into
`unavailable` entries — a failing source never fabricates rows.

Structural disclosures ship on **every** catalog response:

- Workflow runs live in an in-memory map (jobs persist; the run list does not
  survive a restart).
- The `'workflow'` ExecutionKind is declared in the shared union but no executor
  is registered for it — runs start only through the existing
  `WorkforceWorkflowRun` path.
- Scheduled automation rules never fired before Stage 8 — the schedule tick
  introduced here is the first emitter.

## 2. Playbooks (code-shipped, versioned; compiled to the EXISTING WorkflowSpec)

Playbooks are **data**, not a new engine: versioned definitions compiled by
`playbookComposer.ts` into the existing `WorkflowSpec`, executed only by the
existing orchestrator via the existing `workforce:workflow.run` surface. The
compiler inserts a **human approval checkpoint before every side-effecting
step** (Principle C); unknown workers/skills and dangling dependencies become
declared compile issues, never silent repairs.

Registry (`PLAYBOOK_REGISTRY`):

| id | version | category | policy defaults | steps (side-effecting gated) |
| --- | --- | --- | --- | --- |
| `daily-ops-review` | v1 | operations | `standard-ops` | briefing → recommend → note (note gated) |
| `incident-first-response` | v1 | incident-response | `critical-response` | context → propose → record (record gated) |
| `weekly-maintenance-review` | v1 | maintenance | `maintenance-window` | review → remind → log (remind + log gated) |
| `quarterly-ops-report` | v1 | reporting | `standard-ops` | brief → recommend → explicit sign-off gate → record (record also gated) |

Every worker step references the **real** built-in `worker:operations` worker
and its real skills (`briefing`, `recommend`, `remind`, `note`); the
side-effect flags mirror the worker's own skill declarations (`briefing` and
`recommend` are read-only; `remind` and `note` have side effects).

## 3. Schedules (D-3 — the Builder's `schedule` trigger fires at last)

Before Stage 8 the Automation Builder accepted `schedule` triggers but nothing
ever emitted a schedule event. The platform adds a **1-minute tick registered on
the EXISTING `taskScheduler`** (`automation-platform:schedule-tick`) — no new
scheduler class. Each tick parses active schedule rules with the deterministic
label subset (`scheduleParser.ts`):

- `daily 9am` · `daily at 17:30` · `daily`
- `weekly monday 9am` · `monday` · `weekly`
- `hourly` · `hourly at :30`
- `every 15 minutes` · `every 2 hours`

Due rules fire **through the EXISTING runner path**
(`selectRulesForEvent` → `AutomationRunner.runRule`) with a
`source: 'schedule'` event, deduped per occurrence in memory (the delivery-
engine convention). Labels outside the subset (cron expressions, free text) are
**never guessed** — they surface as `schedule-unparseable` monitor findings.

## 4. Policy resolution (D-4 — composition; Governance always wins)

`policyResolver.ts` composes, in precedence order:

1. **Enterprise approval chains** (existing governance) — a governing chain
   always forces human approval;
2. **Global-governance autonomous allows** via the reused P19 derivation
   (`deriveAutoAllowedTriggers`, exact `autonomous:<trigger>` form) and the
   reused P19 invariant `computeAutoExecutable` — explicit allow AND ungoverned,
   default **false**;
3. **Registry policy defaults** (`POLICY_DEFAULTS_REGISTRY`): `standard-ops`
   (weekday 08:00–18:00 window), `maintenance-window` (weekend 06:00–20:00),
   `critical-response` (no window; `requiresApprovalOverride: true` — even an
   explicit allow never auto-runs critical response).

## 5. Explainability (D-5 — Principle D, structurally enforced)

Every compiled plan carries the mandatory envelope — `why`, `evidence`,
`triggeringConditions`, `expectedOutcome`, `rollback`, `confidence`,
`affectedSystems`. `composeExplainability` **throws** on an incomplete envelope
(`explainabilityIssues`), so an unexplainable plan is a defect, not a warning.

## 6. Honest rollback

The repository has exactly two real rollback mechanisms and the planner says so:
the orchestrator's `recover()` (workflow-replay of failed steps) and the
worker-package version rollback (when a previous version is retained). External
connector side effects have **no undo** — `rollbackPlanner.ts` reports
`kind: 'none'` with a compensating **suggestion** (never auto-run) instead of
fabricating an undo.

## 7. Simulation (D-7 — sandbox reuse)

`compileSimulation` emits a valid `EnterpriseScenarioSpec`
(`ap-sim:<playbookId>@v<version>`, `triggerAutomation` steps on the
`automation` channel) for the **existing** sandbox runner. Running it stays
behind the existing `sandbox:manage` surface; no scenario assertions are
fabricated.

## 8. Monitoring & the delivery source

`executionMonitor.ts` computes evidence-cited findings: `stuck-execution`
(running/waiting > 30 min), `failed-run` (24 h window), `awaiting-approval`
(jobs + workflow checkpoints > 24 h), `error-rule`, `schedule-unparseable`, and
`schedule-never-fired`. One governed delivery source — **`automation-watch`**
(daily, via the existing delivery engine) — turns critical/high findings into
recommendation **items**, never actions. The source is mutable/mutable-off in
the existing notification preferences like every other source.

## 9. The read-only IPC surface (D-9)

Six channels, all `requireAuth` + RBAC **`autonomousops:read`** (the existing
P19 read scope — no new permission), registered in the completeness lock via the
`ap:` prefix:

| channel | payload |
| --- | --- |
| `ap:catalog` | the computed Automation Catalog |
| `ap:playbooks` | the versioned playbook registry (optionally one by id) |
| `ap:plan` | compiled plan: workflow + issues + explainability + policy + approvals + simulation + knowledge joins |
| `ap:policies` | policy defaults + autonomous allows + governed chains |
| `ap:monitor` | the execution-monitor findings |
| `ap:dashboard` | the composed dashboard |

**Zero mutation channels.** Building rules still goes through the existing
`automations:save`; running compiled workflows still goes through the existing
workforce surface; sandbox simulation still goes through `sandbox:manage`.

## 10. The assistant's six automation questions (D-8)

`resolveAutomationQuestion` routes exactly six keys — `build-automation`,
`explain-automation`, `simulate-automation`, `execute-automation`,
`monitor-automation`, `debug-automation` — disjoint from the Stage 5/6/7
resolvers and from the Stage 4/5 operational intent ("launch the onboarding
automation" still routes to the existing gated action flow). Answers ride the
existing `'intelligence'` structured-report kind. The `execute-automation`
answer is a **pointer to the gated flow** — it never starts anything.

## 11. The Automation Center · Platform tab

One additive tab (`platform`) inside the existing Automation Center renders the
catalog, playbooks with compiled plans (checkpoints + the Principle D envelope
visible), policy resolution, the monitor, and the structural disclosures. The
tab is read-only; the capability registry entry is `automation.platform`.

## 12. Performance budgets (bench-locked)

At the Stage 8 load model (500 sessions · 500 jobs · 100 rules · 24 playbooks ·
200 run records):

- catalog build ≤ 100 ms
- playbook compile + policy + approvals (plan) ≤ 50 ms
- monitor scan ≤ 100 ms
- dashboard composition ≤ 500 ms

`automationBench.stage8.test.ts` enforces these against synthetic fixtures of
exactly that shape (after a discarded warm-up pass).
