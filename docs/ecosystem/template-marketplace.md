# Enterprise Template Marketplace

Apply ready-made enterprise and automation templates, grouped by category.

## Categories

Five categories are shown as filters with icons: **Workflows**, **Governance
Policies**, **Approval Chains**, **Dashboards**, and **Industry Templates**.
Listings of kind `enterprise_template` and `automation_template` are classified
into a category by a heuristic over the listing's kind, name, and summary
(automation templates are workflows; names mentioning governance/SOC/compliance
are governance policies; and so on).

## Apply

"Apply" records an installation, exactly like installing a worker or connector.
**Honest seam:** fully wiring a governance pack or approval-chain template into
the live Enterprise governance layer (Phase 7) — so that applying it actually
creates the chains and rules — is a tracked seam. Today, apply records adoption
and surfaces update availability; it does not yet mutate the enterprise
governance runtime.

## IPC

Shares the Stage 2 installs channels and the Stage 1 `listings`.
