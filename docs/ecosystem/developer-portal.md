# Developer Portal

The developer's home on the platform. One seeded developer account is bound to
the organization owner at boot; the portal manages everything that account needs
to build on NeuroPause.

## Surfaces (renderer/src/developer)

- **Dashboard** — account + organization, the active plan, headline metrics
  (30-day requests, error rate, key/listing/published/in-review counts), a
  request trend, and the recent submission-pipeline activity.
- **API Keys** — mint scoped keys, revoke them, and register/remove OAuth apps.
- **Marketplace** — the publishing pipeline (its own document).
- **API Gateway** — versions, a live request tester, metrics, audit.
- **Billing** — plans, usage summary, seats, licenses, purchases, invoice.
- **SDKs & Docs** — the SDK catalog and quickstarts.

## API keys

A key is minted with a name and a set of **scopes** drawn from
`marketplace:read|publish`, `workers:read|manage`, `connectors:read|manage`,
`plugins:read|manage`, `usage:read`, and `billing:read`. On creation the store
returns the **full token exactly once** (`npk_live_<prefix>.<secret>`); only a
SHA-256 hash is persisted. Verification hashes the presented token and checks
revocation + expiry, recording last-used. Revoked or expired keys never
authenticate.

## OAuth applications

An OAuth app has a `clientId` (`npc_…`) and a client secret (`nps_…`, shown
once, hashed at rest), redirect URIs, scopes, and grant types
(`authorization_code`, `client_credentials`, `refresh_token`). This models the
registration surface; token issuance flows through the gateway contract.

## Usage analytics

Every gateway request is metered into a per-developer usage ledger
(`method`, `path`, `version`, `status`, `latencyMs`, `computeUnits`). The
analytics view (`developer/analytics.ts`, pure) aggregates a window into total
requests, error rate, p50/p95 latency, per-day and per-route breakdowns, and a
status histogram. The dashboard renders the per-day series as a trend.

## IPC

`ipc.ecosystem.dashboard | account | setPlan | keys | createKey | revokeKey |
oauthApps | createOAuthApp | deleteOAuthApp | usage | sdks`. All inputs are
validated by zod contracts in the main process before any work is done.
