# Executive Command Center

> The organization's home screen. Source:
> `apps/desktop/src/renderer/src/enterprise/CommandCenterPanel.tsx`.

The first surface an executive opens. Ten live widgets over the executive
snapshot, the org graph, compliance findings, the workforce, and recommendations
— with an always-present enterprise search bar.

## Widgets

| Widget | Shows | Source |
| --- | --- | --- |
| Organization Health | health score ring, members (human/AI), units, leadership coverage, risk | `snapshot.organization`, `snapshot.risk` |
| Executive Intelligence | daily briefing headline, grounded flag, recommendation + open-risk counts | `snapshot.intelligence`, `snapshot.risk` |
| AI Workforce Status | running/idle, avg trust, success rate, health rollup | `snapshot.workforce` |
| Business KPIs | projects, tasks, documents, customers, connectors, recent activity | `snapshot.activity`, `snapshot.operations` |
| Active Projects | project nodes from the organization graph | `graph.nodes` (kind `project`) |
| Critical Alerts | compliance findings that are not `pass`, by severity | `compliance` |
| Pending Approvals | jobs awaiting approval; deep-links to the Decision Center | `jobs` |
| Daily Briefing | headline + link into Briefings | `snapshot.intelligence` |
| Enterprise Search | a search box that deep-links into the Search surface | — |
| Recommendations | next-best-actions | `recommendations` |

## Real-time

Every widget reads provider state. The provider is subscribed to the Platform
Event Bus and the workforce/enterprise broadcasts, so a new job, a decided
proposal, a compliance change, or a structure edit refreshes the relevant widgets
within ~180 ms — no manual reload.

## Configurable

A **Customize** control toggles each widget on or off. Selections persist in
`localStorage` (`np.enterprise.widgets.command`) and can be reset from the
Customization surface. The enterprise search bar is always present regardless of
widget configuration.

## Deep links

The search bar and several widgets call the shared `onNavigate(tab, query?)` to
jump to the Decision Center, Organization Explorer, Workspace, Briefings, or a
pre-filled Enterprise Search.
