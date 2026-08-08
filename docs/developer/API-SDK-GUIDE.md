# NeuroPause — API & SDK Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: developers & integrators
>
> **Read this first — the honest surface distinction.** NeuroPause has **two different programmatic surfaces**, and it matters which one you mean:
>
> 1. **Cloud HTTP API** — the Express backend (`apps/backend`, port 4000). Real HTTP, verified end-to-end in Phase 3. This is what the desktop main process calls.
> 2. **Enterprise in-process API / SDK** — the typed **IPC** client inside the desktop app (`ipc.<domain>.<method>()`) and the `@neuropause/sdk` / industry packages. This is **in-process and typed — NOT a public HTTP "Enterprise API."** There is **no** `/enterprise` HTTP endpoint on the backend.
>
> Don't market the in-process surface as a public HTTP API.

## 1. Cloud HTTP API (verified)

Base URL from `PUBLIC_BACKEND_URL` (default `http://127.0.0.1:4000`). JSON. Bearer-JWT auth for protected routes. Errors are `{ "error": { "code", "message" }, "requestId" }`.

| Area | Representative endpoints | Auth | Notes |
|---|---|---|---|
| Liveness/health | `GET /live`, `GET /health` | none | `/health` reports `database`/`redis` component status (503 when degraded) |
| Metrics | `GET /metrics` | none | Prometheus text |
| Auth | `POST /auth/email/register`, `POST /auth/email/login`, `POST /auth/token/refresh`, `POST /auth/logout`, `GET /auth/me` | mixed | argon2 + JWT; `me` requires Bearer; OAuth via `/auth/:provider/start` + `/auth/token` (providers off unless configured) |
| Store | `GET /store/apps` (+ catalog reads) | public read | AI Store catalog (seeded) |
| Organizations | `/organizations…` | Bearer | org/tenancy CRUD; role-gated; tenant-isolated |
| Devices | `/devices…` | Bearer | device registry |
| Billing | `/billing…` | Bearer | Razorpay; **disabled unless configured (External dependency)** |
| License | `/license…` | Bearer | entitlement records |
| Sync | `/sync/:orgId/push`, `/sync/:orgId/pull` | Bearer | cross-device sync of local stores |
| Semantic memory | `/memory/semantic/:orgId/search`, `/backfill` | Bearer | **needs Qdrant + embedding provider (External dependency)** |

Auth flow (verified in Phase 3): register/login → `{ user, tokens: { accessToken, refreshToken } }`; call protected routes with `Authorization: Bearer <accessToken>`; rotate with `/auth/token/refresh`; `/auth/logout` revokes the refresh token. Invalid credentials are rejected (status 400); unauthenticated protected calls → 401.

Minimal example:
```bash
curl -sX POST "$BACKEND/auth/email/login" -H 'content-type: application/json' \
  -d '{"email":"you@org.test","password":"…"}'          # → { user, tokens }
curl -s "$BACKEND/organizations" -H "authorization: Bearer $ACCESS"   # → { organizations: [...] }
```

## 2. Enterprise in-process API / SDK (in-process, not HTTP)

Inside the desktop, the renderer reaches enterprise capability through the **typed IPC client** — e.g. `ipc.enterprise.dashboard()`, `ipc.workforce.jobs()`, `ipc.connectors.list()`. These are:

- **In-process** — main-process handlers over local stores, behind the secure preload bridge. No network hop, no HTTP server for enterprise data.
- **Typed & validated** — Zod-validated requests; compile-time response contract (`IpcResponseMap`).
- **The integration point for extending the desktop**, not a remotely-callable API.

`@neuropause/sdk` and the industry packages (`@neuropause/industry`, `@neuropause/solution-packs`) provide typed building blocks (e.g. `defineIndustrySolution`, manifest/validation/lifecycle) consumed **in-process**. They are unit-tested in their own suites (outside the release gate). **Do not treat the SDK as an HTTP client for a public Enterprise API — that surface does not exist in this build.**

## Authentication & security notes

- HTTP API: Bearer JWT; access token short-lived, refresh token rotated and revocable.
- In the desktop, tokens are held in the **main process** (refresh token encrypted in the OS keychain); the renderer never sees them.
- Never log tokens/secrets; backend errors carry a `requestId`, not secret values.

## What is NOT available (honest)

- A public, documented **HTTP Enterprise/ERP API** — **Not currently verified / not present** (`/enterprise` is not a backend route).
- OAuth login, billing, and semantic search over HTTP require external configuration (**External dependency**).

## Related
[Developer Guide](DEVELOPER-GUIDE.md) · `claude/PHASE-3-BACKEND-ARCHITECTURE.md` · `claude/PHASE-3-AUTH-CERTIFICATION.md`
