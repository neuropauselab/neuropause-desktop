# NeuroPause — Phase 7, Stage 2 (Enterprise Experience)

Renderer-only. No backend changes. Overlay from the repo root with:
    unzip -o ~/Downloads/neuropause-phase7-stage2.zip

## NEW — enterprise experience module (apps/desktop/src/renderer/src/enterprise/)
  lib.ts                        tone maps, EnterpriseTab, widget/nav prefs
  EnterpriseProvider.tsx        one live data provider (snapshot, org, graph,
                                governance, compliance, audit, workspaces,
                                workers, jobs, recommendations, connectors)
  primitives.tsx                ScoreRing, MiniBars
  CommandCenterPanel.tsx        Executive Command Center (10 live widgets + search)
  DecisionCenterPanel.tsx       Decision Center (approvals, risk, violations,
                                evidence, related graph entities, 5 actions)
  OrganizationExplorerPanel.tsx Org chart + radial relationship graph
  BusinessOpsPanel.tsx          Business Operations dashboard (configurable)
  EnterpriseSearchPanel.tsx     Federated + org-local enterprise search
  ExecutiveWorkspacePanel.tsx   Delegate, launch workflows, monitor, audit
  BriefingsPanel.tsx            Morning/Evening/Weekly/Monthly briefings
  CustomizePanel.tsx            Dashboards, navigation, units, roles, governance, theme
  EnterpriseView.tsx            Container: sub-nav, live header, deep-linking

## NEW — shell wrapper
  apps/desktop/src/renderer/src/views/EnterpriseView.tsx

## NEW — documentation (docs/enterprise/)
  experience.md                 Stage 2 overview + surface index
  executive-command-center.md
  decision-center.md
  organization-explorer.md
  executive-workspace.md
  enterprise-search.md
  performance.md

## MODIFIED
  apps/desktop/src/renderer/src/shell/sections.ts   + 'enterprise' section (icon grid, phase 7)
  apps/desktop/src/renderer/src/shell/AppShell.tsx  + lazy EnterpriseView + route case
  docs/enterprise/README.md                         + Stage 2 section + cross-links

## Verify on your machine (from the repo root)
  npm run typecheck -w @neuropause/desktop     expect: node + web, 0 errors
  npm test -w @neuropause/desktop              expect: 30 files / 157 tests pass
  npm run dev                                  expect: new "Enterprise" sidebar section, 8 sub-tabs
