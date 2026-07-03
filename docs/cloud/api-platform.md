# Enterprise API Platform

> `apps/desktop/src/main/cloud/apiplatform/`

The API gateway deployed as a cloud service: high availability, rate limiting,
monitoring, webhooks, and public APIs.

## Model

- **ApiDeployment** — `{ service, regionId, replicas, healthyReplicas, status
  (healthy|degraded|down), version, uptimePct, p95LatencyMs, deployedAt }`.
- **CloudRateLimitPolicy** — `{ name, scope (global|tenant|key), windowSec,
  limit, burst, enabled }`.
- **WebhookEndpoint** — `{ url, events[], status (active|paused|failing),
  secretLast4, deliveries, failures, lastDeliveryAt }`.
- **PublicApi** — `{ name, basePath, version, visibility (public|partner|
  private), scopes[], rps }`.

## Behavior

`ApiPlatformStore` seeds the gateway across three regions (us-east 3/3,
eu-west 2/2, ap-south 1/2 degraded — exercising HA states), three rate policies
(global / per-tenant / per-key), one webhook, and three public APIs
(Marketplace public, Workforce partner, Admin private). `summary(requests30d)`
rolls up healthy replicas → uptime and folds in **real gateway request volume**.
Operations: create/test/pause/delete webhooks, toggle rate policies.

## Seam

Deployments and replica health are a modeled control-plane view (the gateway
decision engine from Phase 8 runs in-process today). Monitoring request volume
is **real** (sourced from gateway metrics). Webhook delivery is simulated —
`testWebhook` increments the delivery counter rather than making an HTTP call.
