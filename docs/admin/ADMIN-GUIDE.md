# NeuroPause — Administrator Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: administrators
>
> Only implemented capability is documented. Tags: **Local-first**, **Cloud** (needs the backend), **External dependency** (a third-party you configure), **Managed** (governed value shown read-only in Settings), **Preview**, **Not currently verified**.

## The two planes you administer

- **Local-first plane** — the desktop's own data (all ERP/enterprise records, knowledge, AI memory, automations) stored as atomic JSON under the OS user-data directory. Administered per-device.
- **Cloud plane** — the Express + PostgreSQL + Redis backend that owns **authentication, users, organizations, devices, billing, licensing, sync, and semantic-search infrastructure**. Administered centrally.

Most administration happens in **Settings** (14 domains) and **Administration** (a read-only lens that links out to the editors: Organization, Settings, Cloud, Developer, Connectors).

## Authentication & identity (Cloud)
Sign-in is via the backend: **email/password** (argon2-hashed) and, when configured, **OAuth** (Google, GitHub, Microsoft, Apple). OAuth providers are **disabled until you set their server-side credentials** (client id + secret; Apple uses a generated JWT). Tokens: the refresh token is stored **encrypted in the OS keychain** on the device; the access token stays in the main process and is never exposed to the renderer. Configure two-factor policy, trusted devices, and recovery under **Settings → Security** (2FA policy is **Managed**).

## Organizations, members, workspaces, roles (Cloud)
Create and manage the cloud organization, invite/accept members, assign roles (owner/admin/member/viewer, DB-enforced), and manage workspaces under **Settings → Organization** and the **Organization** section. Tenant isolation is enforced server-side (one org cannot access another's records — verified in Phase 3). Enterprise **role/permission** scopes (RBAC) gate module writes (e.g. `sales:manage`, `crm:manage`; HR read/manage is privacy-gated to Manager/Admin).

## Devices, licensing, billing (Cloud)
- **Devices** — the device registry (Settings → System → Device management).
- **Licensing** — license/entitlement records (**Managed**).
- **Billing** — Razorpay subscriptions; **disabled until Razorpay keys are configured** (**External dependency**). Do not expect billing flows without them.

## Security, governance, privacy, configuration
Under **Settings**: **Governance** (approval policies, feature flags, compliance, audit — compliance/audit are **Managed**), **Privacy** (telemetry, memory data, data sharing, residency — residency **Managed**), **Security** (API keys, MFA, devices). Enterprise mutations are **audited** (actor / tenant / timestamp / action / result) where the domain supports it — do not assume universal audit coverage.

## Connectors (Local-first runtime + External providers)
**13 connectable** integrations + **9 Preview**. For a connection to work you must configure the provider's **OAuth app/credentials** (client ids, and server-side secrets where applicable) — otherwise the connector is listed but not connectable. Manage under **Settings → Integrations** and the **Connector Center**. See [Connectors Guide](../user/CONNECTORS-GUIDE.md).

## AI administration (External model backend)
Set the **AI provider & model** in **Settings → AI**: **Claude** (needs `ANTHROPIC_API_KEY`) or **Ollama** (local server). Execution & approval policy is **Managed**. With no provider, AI features fall back to a deterministic path. Administer AI workers in depth via **Workforce Admin**.

## Marketplace (governance)
**AI Store** (consumer catalog, Cloud) and **Enterprise Marketplace** (governed packages, **Preview**). Set the org marketplace policy (require approval / signature / minimum publisher tier / blocked types) under the Marketplace Governance tab (RBAC: `marketplace:manage`).

## Updates, logs, diagnostics
- **Updates** — release channel + updater under **Settings → System** (Local-first app; update feed hosting is an operator/release task).
- **Logs / diagnostics** — runtime health, crash capture, recovery, and diagnostics live under **Runtime** (Advanced) and **Settings → System**. Developer-only diagnostic surfaces are gated out of packaged pilot builds.

## Backup, export & data handling
Durable local stores are enumerated in a single backup registry and backed up automatically (backup coverage is derived from that registry). The **backend database is server-side and out of the desktop's local backup scope**. Configure backup/recovery under **Settings → System**. See [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md). *(Per-domain export UIs vary — verify in Settings; where absent, treat as Not currently verified.)*

## Offline behavior & cloud dependency
- **Hard dependency:** sign-in at **cold launch** needs the backend — an outage strands users on the login screen despite local data (**Known limitation**).
- **Graceful offline:** in-session work, sync (deferred), and semantic search (falls back to local lexical) degrade cleanly.
- **Per-feature:** the AI Store hard-fails when the backend is down; the rest of the app keeps working on local data once signed in.

## Secrets hygiene (operator action)
Never commit real secrets. `.env` files are git-ignored. **Rotate any provider secrets that were ever placed in dotfiles** (`.env.entra`, `.env.github`) — move them to secret management, verify they were never committed, and revoke the old ones. NeuroPause never prints secret values in logs or errors (errors carry a request id, not secrets).

## Troubleshooting
See [Troubleshooting](../support/TROUBLESHOOTING.md) for sign-in, backend/Postgres/Redis outages, AI/OAuth/connector/semantic unavailability, permissions, and update issues — each with symptom → cause → user action → admin action → when to escalate.

## Related
[Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md) · [Developer Guide](../developer/DEVELOPER-GUIDE.md)
