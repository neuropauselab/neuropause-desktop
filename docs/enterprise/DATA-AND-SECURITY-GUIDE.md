# NeuroPause — Data & Security Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: enterprise security, IT, evaluators
>
> Describes how data is handled based on the actual implementation. **No external compliance certifications are claimed** (see the note at the end).

## Where your data lives

| Data | Location | Notes |
|---|---|---|
| ERP/enterprise records, knowledge, AI memory, automations, timeline | **On the device** (atomic JSON under the OS user-data dir) | Local-first; enumerated in one backup registry |
| Accounts, sessions, organizations, memberships, devices, subscriptions, connector-account records, sync/embedding state, AI Store catalog | **Cloud plane** (PostgreSQL) | The cloud plane does **not** hold your business records |
| Semantic embeddings (optional) | Vector store (Qdrant) via the backend | Only if semantic search is enabled (External dependency) |

The device's local backup **excludes the backend database** (server-side) by design.

## Authentication & tokens

- Sign-in via the backend: **email/password** (argon2-hashed) and, if configured, **OAuth**.
- **JWT**: short-lived access token + rotatable refresh token.
- On the desktop: the **refresh token is encrypted in the OS keychain** (`safeStorage`); if OS encryption is unavailable, it refuses to persist plaintext. The **access token stays in the main process memory** and is never exposed to the renderer — the renderer only sees a minimal auth status.

## Tenant isolation & authorization

- Cloud records are scoped to your **organization**; one org cannot access another's (DB-enforced; verified in Phase 3 — cross-tenant access returns not-found).
- Enterprise module writes are gated by **RBAC scopes** (e.g. `sales:manage`, `crm:manage`); **HR read/manage is privacy-gated** to Manager/Admin.
- Authorization is enforced **server-side and in the main process**, not just by hiding UI.

## Audit & governance

- Enterprise mutations are **audited** (actor / tenant / timestamp / action / result) where the domain supports it — coverage is per-domain, **not** claimed universal.
- Sensitive AI/enterprise actions run through **governance** (approval chains, compliance rules) and leave evidence.

## Secrets handling

- Real provider secrets live **server-side only**; `.env` files are git-ignored; `.env.example` is the template.
- Logs/error responses **never contain secrets** — backend errors carry a `requestId`, not secret values.
- **Operator action:** rotate any secrets ever placed in dotfiles (`.env.entra`, `.env.github`), move them to secret management, verify they were never committed, and revoke the old ones.

## Data transmission

- The **renderer makes no network calls**; only the desktop **main process** talks to the backend (HTTPS in a real deployment), always with a bearer token.
- The **mobile companion** talks to the **desktop's** sealed LAN gateway (end-to-end sealed envelopes, pinned trust root) — it does not reach the backend, and receives **view-models, never raw record CRUD**.

## Offline behavior

- **Hard dependency:** sign-in at cold launch needs the backend (**Known limitation** — stranded on login if unreachable).
- **Graceful:** in-session work continues; sync defers; semantic search falls back to local lexical; the AI Store hard-fails per-feature but the rest of the app keeps working on local data.

## External providers (you control these)

AI provider (Anthropic/Ollama), OAuth (Google/GitHub/Microsoft/Apple), Qdrant + embeddings, connector OAuth apps, Razorpay billing. Each is optional and off until you configure it; NeuroPause never fabricates a connected/enabled state.

## Compliance posture (honest)

NeuroPause is a **Release Candidate**. This documentation makes **no claim** of SOC 2, ISO 27001, GDPR, or HIPAA certification. The design includes real security controls (server-side auth, keychain-encrypted refresh tokens, tenant isolation, RBAC, audit, no-secret-logging), but formal certifications, a DPA, data-residency guarantees beyond what Settings exposes, and penetration-test attestations are **not part of this build** and must not be represented as such. Engage your security team for a formal review before production.

## Related
[Enterprise Pilot Guide](ENTERPRISE-PILOT-GUIDE.md) · [Admin Guide](../admin/ADMIN-GUIDE.md) · `claude/PHASE-3-AUTH-CERTIFICATION.md`
