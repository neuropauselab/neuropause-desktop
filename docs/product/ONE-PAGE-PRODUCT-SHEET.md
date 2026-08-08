# NeuroPause — One-Page Product Sheet

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: quick reference for buyers, pilots, partners

**What it is.** NeuroPause is an **AI-native enterprise operating system** delivered as a desktop app — business modules, governed AI, knowledge, and operations in one workspace. Not a chatbot. Maturity: **Release Candidate** (pilot-ready, not GA).

**The one thing to know.** NeuroPause is **local-first**: your ERP/enterprise records, knowledge, AI memory, and automations live **on the device** (atomic JSON under the OS user-data dir). A **thin cloud plane** handles only sign-in, the AI Store, organizations/devices, licensing, billing, sync, and semantic-search infrastructure — it does not hold your business data.

## At a glance

| | |
|---|---|
| **Business (ERP)** | 104 modules across 13 families — Finance 21, HR 15, Manufacturing 12, Maintenance 10, Warehouse 8, CRM 8, Sales 7, Procurement 7, Inventory 7, Projects 4, Executive 3, Helpdesk 1, Documents 1 *(Local-first)* |
| **AI Workforce** | Governed AI: intent → governance → permission → execution → evidence *(Local-first + AI provider)* |
| **Knowledge & AI Memory** | Natural-language search over your work; lexical always on, semantic optional *(Local-first; semantic = External dependency)* |
| **Operations** | Health / risk / incidents with honest status (no false "Live") *(Local-first)* |
| **Industry Packs** | 20 vertical solution packs reusing the enterprise core *(Preview)* |
| **AI Store & Connectors** | 22 connectors — 13 production-ready + 9 Preview; official APIs/OAuth *(Cloud + External dependency)* |
| **Surfaces** | ~40 surfaces behind progressive disclosure; 14 settings domains |

## Architecture

**Desktop:** Electron + React + TypeScript + Vite + Tailwind + Framer Motion; secure context isolation; validated IPC. **Cloud plane:** Node.js + Express (:4000) + PostgreSQL 16 (12 migrations, 36 tables) + Redis 7; optional Qdrant (semantic) and Razorpay (billing, off unless configured). **Auth:** argon2 passwords, short-lived JWT + keychain-encrypted refresh tokens. **Quality:** TypeScript throughout; 5,703 tests / 631 files green on the certified baseline.

## Security posture (honest)

Server-side auth, DB-enforced tenant isolation (verified), RBAC scopes, keychain-encrypted refresh tokens, per-domain audit, no secrets in logs. **No SOC 2 / ISO 27001 / GDPR / HIPAA certification is claimed** — the controls are real; formal certifications are not part of this build.

## Verified · Preview · Planned

- **Verified:** local-first record persistence; server-side auth, tenant isolation, RBAC (real Postgres+Redis backend, no mocks); honest Operations status.
- **Preview:** Digital Twin, Industry Center, Enterprise Marketplace, Cloud, Federation (seeded/in-memory).
- **External dependency (you configure):** live AI provider, semantic search, connector OAuth, social sign-in, billing.
- **Planned / not in this build:** Windows & Linux builds; signed/notarized installer; a public HTTP Enterprise API (today it's in-process IPC/SDK only).

## Platform
macOS (Apple Silicon) first and certified for pilots today. Windows and Linux planned.

## Not in this sheet (by design)
No pricing, SLAs, trial durations, customer logos, or compliance certifications — those are operator/commercial decisions, not product-enforced values.

## Start here
[Quick Start](../user/QUICK-START.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) · [RC Release Notes](CURRENT-RC-RELEASE-NOTES.md)
