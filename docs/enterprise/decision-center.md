# Decision Center

> A governed decision workspace. Source:
> `apps/desktop/src/renderer/src/enterprise/DecisionCenterPanel.tsx`.

Where a human decides every action an AI worker proposes that carries side
effects. Each pending item shows the full governance picture before you act.

## What it surfaces

- **Pending approvals** — every job proposal whose verdict is `require_approval`
  and that has not yet been decided.
- **High-risk actions** — the subset of pending proposals at `high`/`critical`
  risk.
- **Policy violations** — compliance findings that are not `pass`, with severity,
  category, detail, and evidence count.
- **AI recommendations** — the count of standing recommendations.

For each pending proposal it shows: the **governance verdict** (allow / require
approval / deny with reasons), the **evidence** the worker cited, and the
**related Knowledge-Graph entities** — matched by linking each evidence reference
to its `entity:<id>` node in the organization graph. Supporting documents appear
among those related entities (graph nodes of kind `document`).

## Actions — and exactly what each does

All five are real and recorded; none is a no-op.

| Action | Effect | Recorded |
| --- | --- | --- |
| **Approve** | approves the proposal; the worker proceeds | Governance Trace |
| **Reject** | rejects the proposal | Governance Trace |
| **Request changes** | rejects with a `Changes requested: …` note so the worker can be re-run with guidance | Governance Trace |
| **Escalate** | parks the action and rejects with an `Escalated for owner review: …` note (a side effect never proceeds while escalated) | Governance Trace |
| **Delegate** | re-runs the originating worker + skill to produce a revised proposal | new governed job |

Approve/Reject/Request-changes/Escalate go through `ipc.workforce.approve` /
`reject` with your note, which writes the per-action **Governance Trace™** (the
workforce audit log). Delegate goes through `ipc.workforce.runJob`. A note box
captures the rationale and is carried into the trace.

## Honesty

The footer states plainly which actions write to the trace and that Delegate
re-runs the worker. The Decision Center never takes a side effect on its own — it
only records your decision and lets the existing workforce governance act on it.
