# NeuroPause — User Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: all users
>
> The complete tour of NeuroPause, organized by the jobs you do. Each section lists its **Purpose**, how to **Open** it, **Key actions**, **Data & permissions**, and **Maturity**. Maturity tags: **Local-first** (on your device), **Cloud** (needs the backend), **External dependency** (needs a third-party you configure), **Preview** (real code on seeded/in-memory data), **RC** (release candidate). Nothing here is fabricated — where capability isn't verified, it says so.

## How NeuroPause is organized

The sidebar is grouped: **Today · Business · Workspace · AI & Operations · System**, with deeper platform/preview/developer surfaces behind an **Advanced** disclosure at the bottom. Press **⌘K** for the Command Palette, which reaches *every* section. Your enterprise data is **local-first**; a small **cloud plane** handles sign-in, the AI Store, org/device/billing, sync, and semantic-search infrastructure.

---

## Getting started

**Purpose:** install, sign in, and orient. **Open:** launch the app. **Key actions:** sign in (email+password, or configured social providers); land on Today. **Data & permissions:** sign-in is authenticated through the cloud plane. **Maturity:** Cloud (sign-in) + Local-first (everything after). See [Quick Start](QUICK-START.md).

## 1. Today / Home
**Purpose:** your entry point — three complementary landings. **Open:** default on launch; **Today** group. **Key actions:** scan Mission Control, Today's Intent, Work Hub. **Data & permissions:** reads your local work + org context. **Maturity:** Local-first · RC.

## 2. Work Hub
**Purpose:** your personal day — tasks, approvals, briefings, recent work. **Open:** Today → Work Hub. **Key actions:** review/act on tasks and approvals; open recent items. **Data:** local. **Maturity:** Local-first · RC.

## 3. Mission Control
**Purpose:** organization-wide operations at a glance. **Open:** Today → Mission Control. **Key actions:** review org status tiles; jump to the underlying centers. **Data:** composed from local + backend health feeds; each tile degrades to an explicit unavailable state (no false green). **Maturity:** Local-first · RC.

## 4. Business
**Purpose:** your ERP workspace — **104 modules across 13 families**, grouped for browsing. **Open:** Business → Business. **Key actions:** pick a family, open a module, create/read/update records. **Data & permissions:** local-first records; module writes are gated by family RBAC scopes (e.g. `sales:manage`, `crm:manage`, `hr:` roles). Empty modules show honest empty states. **Maturity:** Local-first · RC.

## 5. Finance
**Purpose:** money — invoices, payments, ledger/GL, journal entries, periods, tax, AR/AP aging, budgets, fixed assets, FX, cash flow, treasury (**21 modules**). **Open:** Business → Finance. **Key actions:** manage records; post journal entries; review aging/cash flow. **Permissions:** Finance write scope. **Maturity:** Local-first · RC.

## 6. CRM
**Purpose:** customers — contacts, leads, customers, opportunities, activities, health, timeline, campaigns (**8 modules**). **Open:** Business → CRM. **Key actions:** manage the pipeline and customer records. **Permissions:** `crm:manage`. **Maturity:** Local-first · RC.

## 7. HR
**Purpose:** people & payroll — employees, payroll runs, salary/statutory, payslips, attendance, leave, expense claims, candidates, OKRs (**15 modules**). **Open:** Business → HR & Payroll. **Key actions:** manage employee and payroll records. **Permissions:** HR scope is privacy-gated (Manager/Admin only for HR read/manage). **Maturity:** Local-first · RC.

## 8. Procurement
**Purpose:** suppliers, vendor contracts, purchase requests/orders, goods receipts, RFQs, supplier performance (**7 modules**). **Open:** Business → Procurement. **Key actions:** run the procure-to-receive flow. **Permissions:** `procurement:manage`. **Maturity:** Local-first · RC.

## 9. Inventory
**Purpose:** products, warehouses, stock movements, lots, reservations, valuation, serials (**7 modules**; plus **Warehouse**: zones, bins, transfers, picking, packing, shipping, cycle counts — **8 modules**). **Open:** Business → Inventory / Warehouse. **Key actions:** manage stock and movements; reconcile counts. **Permissions:** `inventory:manage` / `warehouse:manage`. **Maturity:** Local-first · RC.

## 10. Manufacturing
**Purpose:** BOMs, production orders, work centers, machines, scheduling, routing, execution, quality, costing (**12 modules**). **Open:** Business → Manufacturing. **Key actions:** plan and run production; inspect quality. **Permissions:** `manufacturing:manage`. **Maturity:** Local-first · RC.

## 11. Projects
**Purpose:** projects, tasks, time entries, billing runs (**4 modules**). **Open:** Business → Projects. **Key actions:** plan projects, track time, run billing. **Maturity:** Local-first · RC.

## 12. Service / Helpdesk
**Purpose:** support tickets (**Helpdesk**), plus **Documents**. **Open:** Business → Helpdesk / Documents. **Key actions:** manage tickets and documents. **Maturity:** Local-first · RC. *(A dedicated field-service suite beyond Helpdesk is not a separate certified family — Not currently verified.)*

## 13. Maintenance
**Purpose:** asset maintenance — assets, plans, preventive/corrective work, work orders, technicians, spares, downtime (**10 modules**). **Open:** Business → Maintenance. **Permissions:** `maintenance:manage`. **Maturity:** Local-first · RC.

## 14. AI Workforce
**Purpose:** run and supervise AI workers. **Open:** AI & Operations → AI Workforce. **Key actions:** discover/configure workers, delegate skills, approve/reject proposals, run automations, use the executive chat. **Data & permissions:** local governance + audit; the pattern is *intent → governance → permission → execution → evidence*. **Maturity:** Local-first governance · RC; **live model execution needs an AI provider (External dependency)**. See [AI Workforce Guide](AI-WORKFORCE-GUIDE.md).

## 15. Knowledge
**Purpose:** one read-only lens over search, AI memory, the knowledge graph, and an enterprise-fabric summary. **Open:** Workspace → Knowledge. **Key actions:** search; jump to Memory/Graph/Enterprise Knowledge. **Data:** local; deep-links out. **Maturity:** Local-first · RC. See [Knowledge Guide](KNOWLEDGE-GUIDE.md).

## 16. Enterprise Knowledge
**Purpose:** the deep enterprise knowledge-fabric explorer — relationships, classification, lineage, evidence, governance. **Open:** Advanced → Enterprise Knowledge. **Maturity:** **Preview**.

## 17. AI Memory
**Purpose:** your AI memory — conversations, notes, saved items. **Open:** Workspace → AI Memory. **Key actions:** save/retrieve; search. **Data:** local source of truth; **semantic ranking = External dependency** (falls back to local lexical). **Maturity:** Local-first · RC.

## 18. Digital Twin
**Purpose:** a modeled representation of the organization to explore and analyze. **Open:** Advanced → Digital Twin Center. **Maturity:** **Preview**. See [Digital Twin Guide](DIGITAL-TWIN-GUIDE.md).

## 19. Operations
**Purpose:** enterprise operational health, risk, dependencies, incidents, recommendations. **Open:** AI & Operations → Operations. **Key actions:** review health/risk; drill into incidents. **Data:** local + backend health; the "Live" indicator only shows when health data actually loaded. **Maturity:** Local-first + Cloud health · RC.

## 20. AI Operations
**Purpose:** the AI operating loop across every AI capability (read-only overview + deep-links). **Open:** AI & Operations → AI Operations. **Maturity:** Local-first · RC.

## 21. Autonomous Operations
**Purpose:** closed-loop autonomous operations — generated plans, coordination, governance. Every action is approval-gated. **Open:** Advanced → Autonomous Operations. **Maturity:** **Preview**.

## 22. Industry
**Purpose:** vertical solution packs (healthcare, retail, banking, manufacturing, and more) that reuse the enterprise core — **20 packs**. **Open:** Advanced → Industry Center. **Key actions:** browse the catalog, view pack metadata, select a pack. **Maturity:** **Preview** (catalog at `0.0.0-preview.1`; declarations verified, per-vertical business data pending, regulated operations external). See [Industry Catalog](../product/INDUSTRY-CATALOG.md).

## 23. AI Store
**Purpose:** discover, install, and launch AI apps. **Open:** Workspace → AI Store. **Key actions:** browse catalog, view app detail, install/launch. **Data:** catalog served by the cloud plane; **hard-fails per-feature if the backend is down**. **Maturity:** Cloud · RC.

## 24. Enterprise Marketplace
**Purpose:** signed, governed enterprise packages — workers, connectors, templates, packs — with a Trust Center and org policy. **Open:** Workspace → Enterprise Marketplace. **Maturity:** **Preview** (install success is not claimed unless the package operation actually succeeds).

## 25. Connectors
**Purpose:** connect outside systems. **Open:** Workspace → Connectors. **Key actions:** browse, connect (sign in to the provider), manage, inspect health, sync, disconnect. **Data & permissions:** **13 connectable** integrations + **9 Preview** (catalog-only). Real connections need each provider's OAuth/credentials (**External dependency**); nothing shows "connected" unless it is. **Maturity:** Local-first runtime + External providers · RC. See [Connectors Guide](CONNECTORS-GUIDE.md).

## 26. Administration
**Purpose:** the read-only admin lens — security, identity, compliance, licensing, configuration — that links out to the editors. **Open:** Business → Administration. **Permissions:** admin roles. **Maturity:** Local-first + Cloud · RC. See [Admin Guide](../admin/ADMIN-GUIDE.md).

## 27. Settings
**Purpose:** configure NeuroPause. **Open:** System → Settings (or ⌘K). **Key actions:** Identity, Security, Governance, Privacy, **AI provider & model**, Workspace (appearance/scale/startup), Organization, Business areas, Integrations, Companion, Developer, Billing, System, Capabilities (the honesty ledger of what's available/managed/not-built) — **14 domains**. **Maturity:** Local-first + Cloud · RC.

## 28. Search
**Purpose:** one query across your indexes (records, memory, timeline, graph, federation). **Open:** Today → Search (or ⌘K). **Data:** local; **semantic ranking = External dependency**. **Maturity:** Local-first · RC.

## 29. Command Palette
**Purpose:** jump anywhere, run commands, hand a question to the Assistant. **Open:** **⌘K**. **Key actions:** navigate to any section (incl. Advanced), search content, switch appearance, toggle sidebar. **Maturity:** Local-first · RC.

## 30. Notifications
**Purpose:** your notifications feed (reminders, workflow, insights). **Open:** System → Notifications, or the toolbar bell. **Data:** local; honest empty state when caught up. **Maturity:** Local-first · RC.

## 31. Security
**Purpose:** how NeuroPause protects you (cross-cutting, not a single screen). Sign-in via the cloud plane; refresh token encrypted in the OS keychain; access token never leaves the main process; tenant isolation on cloud records; audit trail on enterprise mutations. **Where to look:** Settings → Security / Governance / Privacy; Administration. **Maturity:** RC. See [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md). *(No formal external certifications — SOC 2 / ISO / HIPAA / GDPR — are claimed.)*

## 32. Mobile Companion
**Purpose:** a paired phone that views dashboards, approvals, timeline, search, notifications. **Open:** Settings → Companion to pair a device. **Data:** the phone talks to **your desktop's** sealed local gateway (not the backend), receiving view-models — never raw record CRUD. **Maturity:** Local-first (desktop-served) · RC; on-device use is **Pending GUI** verification.

---

## Common problems (quick index)
Can't sign in, backend unavailable, AI unavailable, connector won't connect, semantic search unavailable, empty workspace, permission denied, slow app, update problems — all covered in **[Troubleshooting](../support/TROUBLESHOOTING.md)**. Definitions in the **[Glossary](GLOSSARY.md)**.
