# Executive Workspace

> A workspace for executives and managers. Source:
> `apps/desktop/src/renderer/src/enterprise/ExecutiveWorkspacePanel.tsx`.

The place to put the AI workforce to work and keep an eye on the organization
while it does.

## Capabilities

- **Assign work / Delegate to AI workers** — pick a worker, then one of its
  skills (loaded via `ipc.workforce.worker(id)`), and **Delegate** it. Read-only
  skills run immediately; side-effecting skills are approval-gated and surface in
  the Decision Center. Backed by `ipc.workforce.runJob`.
- **Launch governed workflows** — one click wraps the selected worker + skill in
  a workflow with a human **approval checkpoint** and runs it through the
  orchestrator (`ipc.workforce.runWorkflow`). The checkpoint appears in the
  Decision Center / Automation Studio.
- **Monitor the organization** — a compact strip: org health, workers active, avg
  trust, pending approvals (links to the Decision Center), and risk level — all
  from the executive snapshot.
- **Review recommendations** — the standing recommendations with priority.
- **Manage approvals** — the pending count links straight to the Decision Center.
- **Review audit history** — the organization **Governance Trace**: recent
  enterprise audit entries (`actor`, `action`, `target`, `summary`, time).

## Feedback

After delegating or launching, an inline banner confirms what happened and where
to look (e.g. "needs your approval — see the Decision Center"), so an executive
always knows the governance state of what they just started.
