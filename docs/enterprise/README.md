# Enterprise Operating System — Architecture

> Phase 7, Stage 1 (Enterprise OS Core). The organizational foundation that turns
> NeuroPause from a personal operating layer into an operating environment for a
> whole organization.

## What it is

Stage 1 is **pure backend infrastructure** — the runtime, data model, and
governed read/write surface that the Stage 2 experience (Executive Command
Center, Decision Center, Organization Explorer, …) renders on top of. It is real
production code, persisted to disk, type-checked, and unit-tested. There is no UI
in this stage.

It is composed of six pieces:

- **[Organization Runtime](./organization-runtime.md)** — the org chart:
  organizations → business units → departments → teams → people + AI workers,
  with roles and permissions. Persisted and editable.
- **[Organization Graph](./organization-graph.md)** — a relationship graph that
  weaves the org chart, the AI workforce, the connectors, and the business
  entities (projects, customers, documents) into one view. A *projection*.
- **Enterprise Workspace** — the unified working set (projects, tasks, knowledge,
  AI workers, connectors, documents). Stage 1 ships the data layer that powers it
  via the org graph + the executive snapshot; the surface lands in Stage 2.
- **[Executive Dashboard](./executive-dashboard.md)** — the live snapshot that
  rolls every layer (org health, workforce, activity, risk, approvals,
  intelligence, operations) into one structure. An *aggregation*.
- **[Enterprise Governance](./governance.md)** — organization-wide roles,
  permissions, approval chains, compliance rules, and an audit trail.
- **[Multi-Workspace](./multi-workspace.md)** — multiple organizations and
  workspaces with isolated, switchable contexts.

## How it composes the existing platform

The Enterprise OS does not rebuild what earlier phases already provide. It
**reads** them:

| Need | Source |
| --- | --- |
| AI workers, trust, health | Workforce registry (Phase 6) |
| Jobs, proposals, approvals | Workforce job store (Phase 6) |
| Governed-action audit | Workforce audit log (Phase 6) |
| Projects / customers / documents | Unified Data Model (Phase 4) |
| Recent activity | Enterprise Timeline (Phase 5) |
| Briefing headline, recommendations | Intelligence engines (Phase 5) |
| Connectors, connected accounts | Connector Framework (Phase 4) |
| Installed apps | Local Application Registry |

The only **new** persisted state is the org chart, the workspace list, and the
governance config (approval chains + compliance rules) + the org-level audit
trail. The org graph, compliance findings, and executive snapshot are computed on
demand — projections, never a second source of truth.

## Honesty of the data

- The default organization is a **seeded default workspace** — a real org chart
  you can rename, restructure, and extend. Its name says so.
- It contains **no fabricated people**. The only human member is the signed-in
  account owner (bound from the session); the rest of the members are the **real
  AI workers** from the workforce, folded onto the team that matches each
  worker's role.
- Every dashboard number is computed from live state. The one composite — the org
  health score — has an explicit formula (see the dashboard doc).

## IPC surface

All enterprise channels sit behind the same secure IPC bridge as every other
runtime channel (`enterprise:*`). They are read-only or propose-only with respect
to side effects: org-structure edits are recorded to the audit trail, and no
worker action is ever taken without the existing human-approval gate. See each
sub-document for the channels it owns.

## Stage 2 — the experience

Stage 2 (Enterprise Experience) renders this foundation. It is **renderer only**;
it adds no backend. Eight surfaces — Executive Command Center, Decision Center,
Organization Explorer, Business Operations, Enterprise Search, Executive
Workspace, Executive Briefings, and Enterprise Customization — live under
`apps/desktop/src/renderer/src/enterprise/` and read this data layer (plus the
Phase 5 intelligence and Phase 6 workforce) live, through the same secure IPC
bridge. See **[experience.md](./experience.md)** for the surface index and
**[performance.md](./performance.md)** for the rendering + refresh strategy.

## Verification

- `npm run typecheck -w @neuropause/desktop` — node + web both at 0 errors.
- `npm test -w @neuropause/desktop` — the org runtime, workspace manager, org
  graph projector, governance engine, and executive aggregator each have a
  dedicated electron-free test file.
