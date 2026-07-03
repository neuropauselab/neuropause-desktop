# API Gateway

The single decision authority for every API request. Given a request, the
resolved API key, the caller's rate/quota state, and the target version's status,
it returns exactly one decision: **200 / 401 / 403 / 410 / 429**.

## Decision order (`gateway/gateway.ts`, pure)

1. **Versioning** — a `sunset` version → `410 Gone`.
2. **Authentication** — no / invalid key → `401 Unauthorized`.
3. **Authorization** — the route's required scope not in the key's scopes →
   `403 Forbidden`.
4. **Rate limit** — window exhausted → `429` with `retryAfterMs` = the window.
5. **Quota** — period quota exhausted → `429` (quota exceeded).
6. Otherwise **200 OK**, reflecting the post-commit remaining rate + quota. A
   `deprecated` version is allowed but flagged in the reason.

The pure function is the authority; the store does the I/O around it.

## State (`gateway/gatewayStore.ts`)

- **Rate** — a fixed-window counter per key. `peek` reports remaining without
  consuming (so a *denied* request costs nothing); `commit` records one allowed
  request.
- **Quota** — a per-period counter (day/month) per developer.
- **Audit** — every decision is appended (key, developer, method, path, version,
  status, reason, latency), capped, and surfaced newest-first.
- **Metrics** — over a window: total, allowed, denied, rate-limited,
  unauthorized, status + version histograms, and p95 latency.

## The real request path (`ecosystem/index.ts`)

`runGateway` is what the renderer's request tester and any embedded caller hit:
resolve the key → look up the developer → resolve the plan's rate + quota →
`peek` → `decideGateway` → if allowed, `commit` and meter one request (with
compute units) into the developer usage ledger → always write the gateway audit
entry. This is the same flow a deployed edge service would run; the engine is
in-process today and structured to be fronted by the Express backend unchanged.

## Versions

`v1` is current (GA); `v2` is beta. Version status drives routing (current /
beta / deprecated / sunset) and is shown in the portal.

## IPC

`ipc.ecosystem.gatewayVersions | gatewayRequest | gatewayAudit | gatewayMetrics`.
