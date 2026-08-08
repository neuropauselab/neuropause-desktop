# NeuroPause — Product Catalog

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: buyers, evaluators, product teams
>
> Every capability with its purpose, primary user, key workflows, **maturity**, and **dependencies**. Grounded in the repository. Tags: **Local-first**, **Cloud**, **External dependency**, **Preview**, **RC**. Machine-readable: [`PRODUCT-DATA.json`](PRODUCT-DATA.json).

## Enterprise Core / ERP

| Capability | Purpose | Primary user | Key workflows | Maturity | Dependencies |
|---|---|---|---|---|---|
| Business Workspace | Unified ERP over 104 modules / 13 families | Manager / operator | Browse family → open module → CRUD records | Local-first · RC | none |
| Finance (21) | Invoices, payments, GL, budgets, AR/AP, FX, treasury | Finance | Post journals, run aging/cash flow | Local-first · RC | Finance RBAC |
| Sales (7) | Quotes, orders, contracts, pricing, commissions | Sales | Quote→order→contract | Local-first · RC | `sales:manage` |
| CRM (8) | Contacts, leads, opportunities, activities, campaigns | Sales/CS | Manage pipeline & customer records | Local-first · RC | `crm:manage` |
| Procurement (7) | Suppliers, POs, RFQs, receipts | Procurement | Procure-to-receive | Local-first · RC | `procurement:manage` |
| Inventory (7) + Warehouse (8) | Stock, movements, valuation, zones/bins/picking | Ops | Stock & fulfillment | Local-first · RC | inventory/warehouse RBAC |
| Manufacturing (12) | BOM, production, scheduling, quality, costing | Manufacturing | Plan→produce→inspect | Local-first · RC | `manufacturing:manage` |
| Maintenance (10) | Assets, work orders, technicians, spares | Maintenance | Preventive/corrective work | Local-first · RC | `maintenance:manage` |
| Projects (4) | Projects, tasks, time, billing | PM | Plan→track→bill | Local-first · RC | none |
| HR & Payroll (15) | Employees, payroll, attendance, leave | HR | Hire→pay→manage | Local-first · RC | HR privacy RBAC |
| Helpdesk (1) / Documents (1) | Tickets / documents | Support | Ticket & document mgmt | Local-first · RC | none |
| Executive (3) | Executive decisions, execution proposals, BI reports | Executive | Decide & approve | Local-first · RC | `executive:*` |

## AI

| Capability | Purpose | Primary user | Key workflows | Maturity | Dependencies |
|---|---|---|---|---|---|
| AI Workforce | Run/supervise governed AI workers | Operator | Delegate→approve→execute→evidence | Local-first governance · RC | AI provider (External) |
| AI Operations | AI operating-loop overview | Exec/eng | Review loop; deep-link | Local-first · RC | none |
| Assistant | Conversational interface over engines | Any | Ask → grounded answer / gated action | RC | AI provider (External) |
| Automation | Trigger→condition→action workflows | Operator | Build & run automations | Local-first · RC | AI provider for AI actions |

## Knowledge

| Capability | Purpose | Primary user | Key workflows | Maturity | Dependencies |
|---|---|---|---|---|---|
| Knowledge (umbrella) | Search + memory + graph + fabric summary | Any | Search; deep-link out | Local-first · RC | semantic = External |
| Enterprise Knowledge | Deep fabric: relationships/lineage/evidence/governance | Analyst | Explore & trace | Preview | none (data pending) |
| AI Memory | Personal memory (conversations/notes) | Any | Save & retrieve | Local-first · RC | semantic = External |

## Digital Twin

| Digital Twin | Modeled representation of the organization | Exec/analyst | Explore & analyze state | Preview | local data (no separate cloud twin) |

## Operations

| Operations | Enterprise health/risk/incidents | Ops/SRE | Monitor & drill in | Local-first + Cloud health · RC | backend health |
| Autonomous Operations | Closed-loop, approval-gated ops | Ops/exec | Review plans/coordination | Preview | approval engine |
| Runtime | Installed apps/plugins/sessions/permissions | Power user | Manage local runtime | Local-first · RC | none |
| Release Ops | Product release/build/deploy lens | Release mgr | Track shipping | Local-first · RC | none |

## Industry

| Industry Platform | 20 vertical solution packs over the core | Vertical teams | Browse→select→configure | Preview | see [Industry Catalog](INDUSTRY-CATALOG.md) |

## Platform / Marketplace / Developer

| AI Store | Consumer AI app catalog | End user | Discover→install→launch | Cloud · RC | backend |
| Enterprise Marketplace | Governed signed packages | Admin/dev | Trust→install (governed) | Preview | backend |
| Connectors | Integrations to outside systems | Admin/user | Connect→sync→manage | 13 connectable + 9 Preview | provider OAuth (External) |
| Extensibility | Platform extensibility overview | Admin/dev | Review lenses; deep-link | Local-first · RC | none |
| Developer Platform | APIs, keys, portal, plugins, sandbox | Developer | Build & extend | Mixed | see [API/SDK Guide](../developer/API-SDK-GUIDE.md) |
| Cloud / Infrastructure | Cloud runtime / external cloud CMDB | Platform admin | Operate / discover | Cloud (Preview) / Local-first | backend / adapters |
| Federation / Orchestration / Strategy / Network / Commercial | Advanced platform centers | Platform | Various | Preview | varies |

## Administration & Mobile

| Administration | Security/identity/compliance/licensing/config lens | Admin | Review & link to editors | Local-first + Cloud · RC | backend |
| Organization | Cloud org: members/workspaces/roles | Admin | Manage tenancy | Cloud · RC | backend |
| Settings (14 domains) | Configure the product | Any/admin | 40 setting entries | Local-first + Cloud · RC | some Managed |
| Mobile Companion | Paired phone: dashboards/approvals/timeline | Any | Pair→view→approve | Local-first (desktop-served) · RC | desktop LAN gateway |

## Cross-cutting

- **Governance & audit** — approvals, permissions, compliance; audited enterprise mutations (per-domain, not universal).
- **Security** — backend auth (argon2 + JWT), keychain-encrypted refresh token, tenant isolation, no secret logging. No external compliance certifications claimed.
- **Local-first** — your enterprise data stays on the device; the cloud plane handles account-level concerns only.
