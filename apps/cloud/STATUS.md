# NeuroPause Cloud Platform — STATUS

**NCEA Phase 10.2 (consolidated 10.2A) · `0.0.0-preview.1` · PREVIEW FOUNDATION — NOT production-ready.**

This package is an **honest foundation scaffold**, not a deployed production cloud
platform. After the 10.2A consolidation it contains **only the cloud-platform
primitives the backend does not have** — no capability here duplicates
`apps/backend`.

## Consolidation (10.2A)

Identity/auth/sessions, users, organizations, and the device registry are owned
authoritatively by **`apps/backend`** (real persistence, OAuth providers, JWT).
The duplicate in-memory versions were **removed** from this package so every
capability has exactly one source of truth. The one novel primitive that had no
backend equivalent — **HMAC request signing** — was preserved under
`services/security`.

| Change | Detail |
|---|---|
| Removed | `services/devices`, `services/organizations`, `services/identity` (11 files incl. tests) |
| Added | `services/security` (RequestSigner + tests, 3 files) |
| Removed DTOs | `DevicePublic`, `SessionPublic` from `shared-cloud` (backend owns those shapes) |
| Trimmed | `cloud-sdk` device client group (devices are served by `@neuropause/sdk`) |
| Backend | **unmodified** — 293 unit tests still green |

## Module status (post-consolidation)

| Service | Status | Real today | Production follow-up |
|---|---|---|---|
| `events` (Event Bus) | **REAL** | routing, ordering, retry, DLQ, replay, versioning | durable log, partition scaling |
| `sync` | **REAL** | schema-enforced *state-never-secrets*, version-vector merge | encrypted transport |
| `audit` (Federation) | **REAL** | deterministic ids, provenance, verification | federated store, signing authority |
| `timeline` | **REAL** | event-sourced projection | durable projection store |
| `observability` | **REAL** | metrics registry, health aggregator | OTel export |
| `security` | **REAL** | HMAC request signing (zero-trust) | KMS-backed keys |
| `notifications` | **FOUNDATION** | channels, history, delivery tracking | real APNs/FCM/SMTP |
| `gateway` | **FOUNDATION** | versioned routes, authz, rate limit, trace, audit hook | real HTTP server + TLS |

## Constitutional guarantees (NCEA v1.0)

- **Governance stays in NeuroPause OS.** Nothing here decides; the cloud coordinates.
  The gateway *enforces* an already-authenticated context — it does not mint identity.
- **Synchronize state, never secrets.** Schema-enforced in `services/sync` +
  `shared-cloud` (`SECRET_FIELD_PATTERN`).
- **One source of truth.** No capability here duplicates the backend.
- **Local-first preserved / deployable without the cloud.** In-memory modules
  behind interfaces; `standalone` is first-class.

## What this is NOT

No running server, no database, no TLS, no real IdP/push/email, no multi-tenant
deployment, no load or security validation at scale, **no customers**. Persistence
is in-memory; production adapters are the follow-up. Do not represent as certified
or production-ready.

## Run

```
# from repo root
npx tsc --noEmit -p apps/cloud/tsconfig.json
cd apps/cloud && npx vitest run     # 10 files, 49 tests
```
