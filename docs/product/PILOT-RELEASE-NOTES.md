# NeuroPause — Pilot Release Notes

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilots, IT, evaluators
>
> What a pilot receives in `1.0.0-rc.15`, stated honestly. **Release Candidate — not GA.** For the per-capability view see the [Product Maturity Matrix](PRODUCT-MATURITY-MATRIX.md); for what stands between this and a signed distributable build see the [Release Blockers](RELEASE-BLOCKERS.md).

## What's included

NeuroPause Desktop — an AI-native enterprise operating system: 104 business modules across 13 families, governed AI (AI Workforce), Knowledge + AI Memory, Operations, an AI Store and connectors, and a set of advanced Preview centers — in one desktop workspace, backed by a thin cloud plane.

## Verified capabilities (evidence-backed)

- **Local-first business records** — create/edit/reopen persist on-device (atomic JSON); no data loss on normal restart; corrupt stores are quarantined, not reset.
- **Server-side authentication + tenant isolation + RBAC** — certified in Phase 3 against real PostgreSQL 16 + Redis 7 (cross-tenant access returns not-found; argon2 passwords; keychain-encrypted refresh tokens).
- **Honest operational states** — "Live" only when data actually loaded; automations never report success for a no-op; unconfigured providers show an honest state.
- **Governed AI lifecycle** — intent → governance → permission → execution → evidence, with an evidence trail.
- **Documentation system** — 38/38 governed docs validate clean, with a zero-dependency build toolchain.

Aggregate: **5,703 tests green** on the certified baseline (backend suite re-verified at 418 tests this phase).

## Local-first architecture

Your ERP/enterprise records, knowledge, AI memory, automations, and timeline live **on the device** (userData). The renderer makes no network calls; only the desktop main process talks outward. This is the core of the product — your operational data is yours, on your machine.

## Cloud plane (needs the backend)

Sign-in, the AI Store catalog, organizations/devices, licensing, billing, cross-device sync, and semantic-search infrastructure run on the Express + PostgreSQL + Redis backend. It does **not** hold your business records.

## External dependencies (you configure; off until then)

Live AI (Anthropic key or Ollama), semantic search (Qdrant + embeddings), OAuth sign-in and connectors (per-provider apps), and billing (Razorpay). Each shows an honest state until configured — never a fabricated one.

## Known limitations

- **Cold-launch authentication requires the backend** — an outage strands users on the login screen despite local data.
- **Preview surfaces** (Digital Twin, Industry, Enterprise Marketplace, Cloud, Federation, …) run on seeded/in-memory data.
- **Marketplace install is worker-oriented**; non-worker package install is not implemented.
- **Desktop visual QA on macOS is a human task** and is pending sign-off (no GUI-verified claim is made).
- **No public HTTP Enterprise API** — the enterprise surface is in-process typed IPC/SDK.

## Pilot requirements

macOS (Apple Silicon); Node ≥ 20 and Docker (or a reachable PostgreSQL 16 + Redis 7) for the backend; network reachability from desktops to the backend URL. See the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md).

## Installation

Pilots run **from source** today (`npm install → infra:up → db:migrate → dev`). A **signed/notarized packaged artifact is not yet published** — see the [Download Catalog](../downloads/DOWNLOAD-CATALOG.md) and Release Blockers RB-1/RB-3.

## Update behavior

The desktop uses electron-updater against an operator-hosted feed (`https://neuropause033.com/updates`, channel `beta`). Updates are inert in dev/unpackaged builds. A working update path requires a signed build served from that feed (Release Blocker RB-3); until then, updates are delivered by the operator.

## Security notes

Real security controls are present (server-side auth, DB-enforced tenant isolation, RBAC, keychain-encrypted refresh tokens, per-domain audit, no secrets in logs). **No external compliance certification (SOC 2 / ISO 27001 / GDPR / HIPAA) is claimed.** Before a real-data pilot, the operator must rotate any secrets ever placed in local dotfiles (Release Blocker RB-4). See the [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md) and [Telemetry & Diagnostics Policy](../enterprise/TELEMETRY-POLICY.md).

## Related
[Product Maturity Matrix](PRODUCT-MATURITY-MATRIX.md) · [Release Blockers](RELEASE-BLOCKERS.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [RC Release Notes](CURRENT-RC-RELEASE-NOTES.md)
