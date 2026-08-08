# NeuroPause — Frequently Asked Questions

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: users, evaluators, IT
>
> Honest answers grounded in the actual build. Maturity tags: **Local-first**, **Cloud**, **External dependency**, **Preview**, **RC**.

## About the product

**What is NeuroPause?**
An AI-native enterprise operating system delivered as a desktop app — business modules, governed AI, knowledge, and operations in one workspace. It is not a chatbot.

**Is it finished / generally available?**
No. It is a **Release Candidate** (`1.0.0-rc.15`): pilot-ready quality, general availability pending. RC is not GA.

**What can I actually rely on today?**
Local-first business records (create/edit/reopen, persisted on-device), server-side authentication with tenant isolation and RBAC, and honest operational status. AI, semantic search, connectors, and billing are real but depend on providers you configure. Several advanced centers are **Preview** (seeded/in-memory).

## Data & privacy

**Where does my data live?**
Your ERP/enterprise records, knowledge, AI memory, automations, and activity timeline are stored **on your device** as atomic JSON under the OS user-data directory. The cloud backend does **not** store your business records — it handles sign-in, the AI Store, organizations/devices, licensing, billing, sync, and semantic-search infrastructure.

**Is any of my business data sent to the cloud?**
Not your business records. Only cloud-plane data (accounts, sessions, org/device records, subscription state, connector-account records, sync/embedding state) lives server-side. If you enable cross-device sync or semantic search, those specific features move the relevant data through the backend — each is opt-in.

**How do I back up my data?**
The device keeps a local backup registry that enumerates the local stores; it deliberately **excludes** the server-side database. See the [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md).

## Connectivity

**Do I need an internet connection?**
Sign-in at launch needs the backend to be reachable (a **known limitation** — an outage at cold launch strands you on the login screen). Once you're in, local-first work continues offline; sync defers and semantic search falls back to local lexical search.

**Which platforms are supported?**
macOS (Apple Silicon) is the **first target** and the certified surface for pilots today. Windows and Linux are **planned**, not certified in this build.

## AI, search & connectors

**Do I need to configure an AI provider?**
Only if you want live AI. Configure an Anthropic key or a local Ollama model in Settings. Without a provider, AI Workforce shows an honest deterministic fallback — it never fabricates an AI result.

**Why are my search results basic?**
Local lexical search always works. Richer semantic ranking needs a vector store plus embeddings (an **external dependency**); if it isn't enabled, search degrades gracefully to lexical.

**Are the connectors live?**
There are 22 connectors — 13 production-ready and 9 Preview. Each uses official APIs/OAuth and is listed but **not connectable until you supply its OAuth app credentials**. A "not configured" state is honest.

## Integration & security

**Is there a public API I can call?**
There is a **verified cloud HTTP API** for the cloud plane (auth, store, organizations, devices, billing, license, sync, semantic-memory, health/metrics). There is **no public HTTP Enterprise API** — the enterprise/business surface is in-process typed IPC/SDK inside the desktop app. See the [API/SDK Guide](../developer/API-SDK-GUIDE.md).

**Is NeuroPause SOC 2 / ISO / GDPR / HIPAA certified?**
No. No external compliance certification is claimed. The build includes real controls (server-side auth, keychain-encrypted refresh tokens, DB-enforced tenant isolation, RBAC, per-domain audit, no secrets in logs), but formal certifications, a DPA, and penetration-test attestations are not part of this build. Engage your security team before production.

**How are passwords and tokens handled?**
Passwords are argon2-hashed server-side. Sessions use short-lived JWT access tokens with rotatable refresh tokens; on the desktop the refresh token is encrypted in the OS keychain and the access token never leaves the main process.

## Commercial

**How much does it cost? What are the SLAs? How long is the trial?**
This documentation intentionally quotes no pricing, SLAs, or trial durations — they are operator/commercial decisions and are **not hard-coded** in this build. Your operator configures trial length and any entitlement limits.

**Where can I download a packaged installer?**
No signed/notarized packaged artifact is published yet. Pilots run from source. See the [Download Catalog](../downloads/DOWNLOAD-CATALOG.md) — and do not trust any third-party "NeuroPause" download.

## Related
[Troubleshooting](TROUBLESHOOTING.md) · [Quick Start](../user/QUICK-START.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [Data & Security Guide](../enterprise/DATA-AND-SECURITY-GUIDE.md)
