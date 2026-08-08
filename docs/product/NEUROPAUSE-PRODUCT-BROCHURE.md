# NeuroPause — Product Brochure

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: prospective pilots, buyers, evaluators
>
> A premium overview of NeuroPause, written to the actual product. Every capability carries a maturity label; nothing here is aspirational marketing dressed as fact. NeuroPause is a **Release Candidate** — pilot-ready, not general availability.

**Maturity legend** — **Local-first** (runs on the device) · **Cloud** (needs the backend) · **External dependency** (you configure a provider) · **Preview** (seeded/in-memory, evolving) · **RC** (release-candidate quality, GA pending).

---

## 1. What NeuroPause is

NeuroPause is an **AI-native enterprise operating system** delivered as a desktop application. It brings business modules, governed AI, a knowledge layer, and an operations view into one coherent workspace — so a team runs its work, its data, and its AI from a single place instead of a dozen disconnected tabs.

It is deliberately **not another chatbot**. The AI is woven into real business surfaces and is always governed: it acts through approval, permission, and an evidence trail rather than as an open-ended prompt box.

## 2. The problem it addresses

Enterprise AI today is fragmented: capable models sit behind separate web apps, each with its own login, its own data silo, and no shared memory of what the organization is actually doing. Work happens in one place; the AI that could help lives in another; and there is no honest, auditable record tying the two together. NeuroPause collapses that gap into one operating layer that keeps the data close to the user and the AI accountable to the user.

## 3. The core idea — one operating layer, two planes

NeuroPause runs on a clear architectural split that is worth understanding up front, because it governs where your data lives and what needs to be online.

- **Local-first plane (on the device).** All ERP/enterprise records, knowledge, AI memory, automations, and the activity timeline are stored **on each device** as atomic JSON under the OS user-data directory. No cloud database holds your business records. The renderer makes zero network calls; only the desktop main process talks outward.
- **Thin cloud plane (the backend).** A Node.js + Express service (with PostgreSQL and Redis) provides sign-in, the AI Store catalog, organizations and devices, licensing, billing, cross-device sync, and semantic-search infrastructure. It is intentionally thin — it does **not** store your business data.

This is the single most important thing to internalize about NeuroPause: **your operational data is yours, on your machine**, and the cloud plane is a coordination layer, not a data lake.

## 4. Honesty as a product principle

NeuroPause never fabricates success. If an AI provider isn't configured, you see an honest fallback — not a fake result. If a backend is unreachable, the app says so rather than showing a stale "Live" badge. Preview surfaces are labelled as Preview. This brochure follows the same rule: the maturity tags are real, and Section 18 lays out exactly what is verified, what is preview, and what is planned.

## 5. Capability overview

At a glance, NeuroPause organizes ~40 surfaces behind a progressive-disclosure model (a small everyday set up front; advanced centers revealed on demand), grouped into the areas below.

| Area | What it is | Maturity |
|---|---|---|
| Today / Work Hub | Your personal day, mission control, and fast entry | Local-first |
| Business (ERP) | 104 modules across 13 families | Local-first |
| AI Workforce | Governed AI actions with evidence | Local-first + External dependency (provider) |
| Knowledge & AI Memory | Search + recall over your work | Local-first (lexical); semantic is External dependency |
| Operations | Health, risk, incidents — honest status | Local-first |
| Digital Twin Center | Modeled view over your data | Preview |
| Industry Center | 20 vertical solution packs | Preview |
| AI Store & Connectors | Discover apps; connect integrations | Cloud (store) + External dependency (connectors) |
| Administration & Settings | Org, roles, 14 settings domains | Cloud + Local-first |

## 6. Business — the ERP core *(Local-first)*

The heart of NeuroPause is a genuine business suite: **104 modules across 13 families**, all persisting locally.

| Family | Modules | Family | Modules |
|---|---:|---|---:|
| Finance | 21 | Maintenance | 10 |
| Human Resources | 15 | Warehouse | 8 |
| Manufacturing | 12 | CRM | 8 |
| Sales | 7 | Procurement | 7 |
| Inventory | 7 | Projects | 4 |
| Executive | 3 | Helpdesk | 1 |
| Documents | 1 | | |

Records are created, edited, and reopened on-device — real persistence, not a mock. Sensitive families are permission-gated (for example, HR read/manage is restricted to Manager/Admin roles).

## 7. AI Workforce — governed AI *(Local-first + provider)*

AI in NeuroPause follows one disciplined lifecycle: **intent → governance → permission → execution → evidence**. A user expresses intent; governance rules and approval chains apply; permissions are checked; the action executes; and an evidence trail is left behind. With an AI provider configured (Anthropic key or a local Ollama model), actions run live. Without one, NeuroPause shows an honest deterministic fallback — it never invents an AI result.

## 8. Knowledge & AI Memory *(Local-first; semantic optional)*

NeuroPause builds an on-device memory of your work — projects, notes, documents, conversations, and summaries — and lets you search it in natural language. **Local lexical search always works.** If you enable semantic ranking (a vector store plus embeddings), results improve; if that external dependency is absent, search degrades gracefully to lexical rather than failing.

## 9. Operations *(Local-first)*

The Operations surface presents health, risk, and incident views with an honest status indicator: it shows "Live" only when data actually loaded, and shows degraded or empty states truthfully. This is the operational embodiment of the honesty principle.

## 10. Digital Twin Center *(Preview)*

A modeled view layered over your local data, intended to reflect the state of your organization's work. It is a **Preview** surface — useful to explore and shape, running on seeded/in-memory data, and clearly labelled as such in-app.

## 11. Industry Solution Packs *(Preview)*

NeuroPause ships a catalog of **20 industry solution packs** that reuse the enterprise core for specific verticals. The catalog is at Preview maturity (catalog version `0.0.0-preview.1`); packs are scoped configurations over the same real modules, not separate products.

## 12. AI Store & Connectors *(Cloud + provider)*

The **AI Store** is a discoverable catalog served by the backend, where you install and launch AI apps. **Connectors** cover **22 integrations — 13 production-ready and 9 Preview**:

- **Production (13):** GitHub, Notion, Slack, Atlassian, Google Workspace, Microsoft Entra, Salesforce, HubSpot, ServiceNow, SAP, Oracle, Dynamics 365, Workday.
- **Preview (9):** ChatGPT, Claude, Gemini, Perplexity, Cursor, Canva, Figma, Linear, Zapier.

Every connector uses official APIs and OAuth where available. A connector is listed but not connectable until you supply its OAuth app credentials — NeuroPause never fabricates a "connected" state.

## 13. Automations & Runtime *(Local-first)*

A visual automation model (trigger → condition → action) and a local runtime let you wire repetitive work together. Automations run against local data and honor the same governance and honesty rules — an automation never reports success for a step that did nothing.

## 14. Security & data model *(Local-first + Cloud)*

Security is designed in, not bolted on. Passwords are argon2-hashed server-side; sessions use short-lived JWT access tokens with rotatable refresh tokens. On the desktop, the **refresh token is encrypted in the OS keychain**, and the access token never leaves the main process. Cloud records are scoped to your organization with **DB-enforced tenant isolation** (verified: cross-tenant access returns not-found), enterprise writes are gated by **RBAC scopes**, and sensitive mutations are audited where the domain supports it. Secrets live server-side only and never appear in logs or error responses.

**Honest posture:** NeuroPause makes **no claim** of SOC 2, ISO 27001, GDPR, or HIPAA certification. The controls above are real; formal certifications, a DPA, and penetration-test attestations are not part of this build and must not be represented as such.

## 15. Architecture at a glance

The desktop is **Electron + React + TypeScript + Vite + Tailwind + Framer Motion**, with secure context isolation and validated IPC between renderer and main process. Business data flows renderer → IPC → main process → the local record store. The cloud plane is **Node.js + Express (:4000) + PostgreSQL 16 (12 migrations, 36 tables) + Redis 7**, with an optional Qdrant vector store for semantic search and Razorpay for billing (disabled unless configured).

## 16. Platform support

macOS (Apple Silicon) is the **first target platform** and the certified surface for a pilot today. Windows and Linux are **planned**, consistent with the cross-platform Electron foundation, but are not certified in this build.

## 17. Quality & engineering discipline

NeuroPause is TypeScript end-to-end with a release gate spanning the shared, protocol, cloud-core, backend, and desktop packages — **5,703 automated tests across 631 files** run green on the certified baseline. Desktop renderer logic is covered by view-model tests; visual QA on macOS is treated honestly as a human task.

## 18. What's verified vs Preview vs Planned

| Capability | Status |
|---|---|
| Local-first business records (persist/reload) | **Verified** |
| Server-side auth, tenant isolation, RBAC | **Verified — real Postgres+Redis backend, no mocks** |
| Honest Operations status / no false "Live" | **Verified** |
| Governed AI Workforce (with provider) | **Works; provider is an External dependency** |
| Semantic search | **External dependency (falls back to lexical)** |
| Connectors | **13 production-ready + 9 Preview; each needs OAuth config** |
| Digital Twin, Industry, Enterprise Marketplace, Cloud, Federation | **Preview (seeded/in-memory)** |
| Desktop visual QA on macOS | **Human task (pending sign-off)** |
| Windows / Linux builds | **Planned** |
| Signed/notarized packaged artifact | **Not yet published** |
| Public HTTP Enterprise API | **Does not exist (in-process IPC/SDK only)** |
| SOC 2 / ISO / GDPR / HIPAA certification | **Not claimed** |

## 19. Deploying a pilot

A pilot is a repeatable, functional evaluation: stand up the backend, create an organization, invite a small cross-functional group, and run representative workflows on your own data. The [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) gives the verified setup path, the dependency-gating table, a security checklist, and acceptance/exit criteria; the [Trial Experience](TRIAL-EXPERIENCE.md) and [Trial Checklist](TRIAL-CHECKLIST.md) provide a progressive cadence.

## 20. What NeuroPause is not

To keep expectations honest: it is not a chatbot; it does not expose a public HTTP Enterprise API; it does not ship with any external compliance certification; it does not publish a signed/notarized installer yet; and it does not quote pricing, SLAs, or trial durations in this documentation — those are operator/commercial decisions, not product-enforced values. Anything not operational in your environment shows its honest state rather than a fabricated one.

## 21. Where to go next

New users start with the [Quick Start](../user/QUICK-START.md) and [First 30 Minutes](../user/FIRST-30-MINUTES.md). Evaluators and IT read the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) and [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md). Developers read the [Developer Guide](../developer/DEVELOPER-GUIDE.md) and [API/SDK Guide](../developer/API-SDK-GUIDE.md). For the machine-readable record of everything above, see [PRODUCT-DATA.json](PRODUCT-DATA.json) and the [Product Catalog](PRODUCT-CATALOG.md).

## Related
[One-Page Product Sheet](ONE-PAGE-PRODUCT-SHEET.md) · [RC Release Notes](CURRENT-RC-RELEASE-NOTES.md) · [Product Catalog](PRODUCT-CATALOG.md) · [Industry Catalog](INDUSTRY-CATALOG.md)
