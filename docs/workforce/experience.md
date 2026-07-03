# AI Workforce — Experience

> Phase 6 · Stage 2. Everything the operator sees and controls, over the Stage 1
> engine. Six surfaces, one live data provider, full evidence and audit.

Stage 1 built the engine (runtime, registry, SDK, governance, orchestrator, nine
workers). Stage 2 is the cockpit. It adds **no autonomy** — it surfaces what the
engine already does and gives a human the controls. Every number on screen is
measured from real jobs and the audit trail; every answer cites its evidence.

## Where it lives

- A new **AI Workforce** section in the sidebar opens the experience.
- The renderer module is `apps/desktop/src/renderer/src/workforce/`:
  - `WorkforceProvider.tsx` — loads workers, jobs, the governance audit trail,
    and policies, and subscribes to the live workforce broadcast so every panel
    stays current. Exposes the action surface (run a skill, approve/reject a
    proposal, run/resume a workflow, resolve a checkpoint).
  - `WorkforceView.tsx` — the tabbed shell.
  - one file per surface (below), plus `lib.ts` (status → colour/label maps and
    formatters) and `primitives.tsx` (worker glyph, trust meter, evidence pills,
    the governance verdict block).
- The sidebar's **Automations** and **Analytics** entries deep-link into the
  Automation Studio and Workforce Analytics tabs respectively.

The whole surface reads through the same secure `ipc.workforce.*` channels the
engine exposes; the renderer holds no privileged state of its own.

## The six surfaces

### 1. Mission Control
One dashboard: worker count and how many are idle, running jobs, pending jobs,
proposals waiting for approval, organisation health (share of healthy workers),
and job success rate. Below that, a live **workforce status** grid (every worker
with lifecycle, health, trust, and queue depth), an **alerts** list (unhealthy or
degraded workers, waiting approvals, recent failures — each navigates to where
you fix it), and **recent activity** across all workers. Everything is derived
live from the provider; nothing is precomputed.

### 2. AI Workforce dashboard
Every worker as an expandable card: status, health, trust meter, skill count,
queue depth, and a measured success rate from its job history. Expand a worker to
see its goals, full skill list, recent tasks, and health counters — and to **run
a skill**. Running a read-only skill shows its summary and evidence inline;
running a skill that proposes an action parks a proposal and links you to the
Approval Center. The worker detail is fetched on demand through
`ipc.workforce.worker(id)`.

### 3. Human Approval Center
The inbox for the propose → gate → approve loop. Each parked proposal shows the
proposing worker, the proposed action and its summary, its **risk**, its
**evidence**, and the **full governance verdict** — the four checks (permission,
trust, evidence, policy), their outcomes, and the policies that fired. You can
**Approve**, **Reject**, **Edit** (attach an instruction), or **Delegate** (record
a hand-off note); the note rides along with your decision and is written to the
audit trail. Approving authorises the proposal and records the decision —
carrying out *external* actions (sending, writing) wires in as connectors gain
action scopes; until then, approval is the governed authorisation step, recorded
honestly.

### 4. Automation Studio
A visual builder over the orchestrator. Compose a workflow from **AI Worker**
steps (pick a worker and one of its skills) and **human approval checkpoints**,
then run it and watch each step execute — with status, retries, and live
checkpoint resolution. Approval checkpoints can be approved or rejected in place;
worker steps that propose an action are resolved in the Approval Center and the
run resumed. The conceptual pipeline (Trigger → Condition → AI Worker → Approval →
Connector action → Notification) is shown in full; **worker and approval steps
execute today**, and the dashed stages (trigger scheduling, connector actions,
notifications) are represented and execute once those subsystems are wired. This
surface uses two Stage-2 channels added for it: `workflow.resume` and
`workflow.checkpoint`.

### 5. Workforce Analytics
Measured metrics only. Worker utilisation (jobs per worker), job success rate
(succeeded over terminal), execution time (average and total — these are real
milliseconds; deterministic skills run fast), proposals and human reviews,
worker trust distribution, and human intervention (approved / rejected /
pending). **Cost** is a transparent formula — total compute × a configurable
$/worker-hour rate — and is labelled as an estimate, not a billed figure; it is
negligible until model-backed skills add token and inference costs. Trust is
shown as a current distribution; **trend history accrues as workers run over
time** — the panel says so rather than inventing a trend.

### 6. Executive Chat
A secure executive assistant. Business questions ("today's priorities", "what's
blocked", "summarise today's work") are answered by the **Enterprise Intelligence
Layer** (`founderAI.ask`) and rendered with facts (each with evidence),
suggestions kept separate, and references. Workforce questions ("which workers are
idle", "show pending approvals", "what's running now") are answered from **live
worker and job state**, citing worker and job IDs as evidence. Either way, every
answer cites what it is grounded in — and says when there is nothing to answer
from.

## What Stage 2 deliberately does not do

- It does not let workers act autonomously. The cockpit only surfaces the engine;
  side effects still require human approval.
- It does not fabricate metrics. Durations, counts, success rates, and audit
  totals are read from real jobs and the audit log. Cost is a labelled formula.
- It does not invent trust trends or connector actions. Where history or a
  subsystem isn't there yet, the UI says so.
