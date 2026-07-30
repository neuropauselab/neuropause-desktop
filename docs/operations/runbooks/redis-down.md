# Runbook — Valkey (cache / rate-limit) unavailable

**Scenario:** The managed Valkey `nems-prod-cache` is unreachable and the backend has engaged its per-instance rate-limit fallback.
**Fires as:** SEV2/SEV3 — usually degradation, not outage
**Owner:** platform-oncall
**Backing alerts:** RedisUnavailable, RedisFallbackEngaged

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- Pager/ticket: `RedisUnavailable` or `RedisFallbackEngaged`.
- `neuropause_ratelimit_fallback_total{bucket}` increasing — Valkey is unavailable and the backend fell back to per-instance limiting.

## Diagnosis

- The backend **degrades safely** when Valkey is down (it does not hard-fail), so confirm scope: is this a user-visible outage or just degraded rate limiting?
- Instance health: `doctl databases get a5829ae2-293f-40ad-ba57-bfc1609241e9` (managed Valkey `nems-prod-cache`, `:25061`).
- Trusted sources / connectivity as for PostgreSQL; check backend logs for cache connection errors.

## Recovery

- Reconnect or restart the managed Valkey; if replaced, repoint the cache connection secret and `rollout restart` the backend.
- A **cold cache is expected** after recovery and self-heals; no data restore is required (rate-limit counters and cache entries are ephemeral — RPO loss is tolerated).

## Validation

- `neuropause_ratelimit_fallback_total` stops increasing; `RedisUnavailable` clears.
- `/health` returns 200 (health requires both DB and Valkey up).

## Escalation

- If fallback rate-limiting causes user-visible inconsistency, raise to the Incident Commander.
- Managed-instance fault → DigitalOcean support with database id `a5829ae2-…`.

## Related

`backend-down.md`, `database-down.md`
