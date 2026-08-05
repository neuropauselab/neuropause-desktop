# NEMS On-Call Guide

For the engineer holding the pager. Short by design. Full context is in the
[Operations Guide](./OPERATIONS-GUIDE.md) and [Production Manual](./PRODUCTION-MANUAL.md).

## Your job on-call

Keep the service within its SLO. When paged: acknowledge, assess impact, work the
runbook, communicate, and hand off cleanly.

## First five minutes of a page

1. **Acknowledge** so it stops escalating.
2. **Open the alert's `runbook_url`** — it points straight at the right runbook.
3. **Assess impact** — is `https://api.neuropause033.com/health` returning 200?
   Who/what is affected?
4. **Set severity** (see below) and, if user-facing, **declare an incident**
   ([`../incident/`](../incident/)).
5. **Work Detection → Diagnosis → Recovery → Validation** in the runbook.

## Severity (quick)

- **SEV1** — outage or data-loss risk (`EdgeDown`, `BackendNoHealthyReplicas`,
  `DatabaseUnavailable`, cluster loss). Page, get an IC, all hands.
- **SEV2** — major degradation / SLO at risk (`SLOAvailabilityFastBurn`,
  `HighErrorRateCritical`, `RedisUnavailable`, OAuth outage).
- **SEV3** — minor (`HighLatency`, `HighErrorRate` warning, `RedisFallbackEngaged`).
- **SEV4** — cosmetic / monitoring gap.

## Alert → runbook map

| If you're paged for… | Go to |
|----------------------|-------|
| BackendNoHealthyReplicas / TargetDown / CrashLooping | [backend-down](../runbooks/backend-down.md) |
| DatabaseUnavailable / PoolSaturated | [database-down](../runbooks/database-down.md) |
| RedisUnavailable / FallbackEngaged | [redis-down](../runbooks/redis-down.md) |
| EdgeDown / DenylistLeak | [gateway-failure](../runbooks/gateway-failure.md) |
| CertificateExpiring(Soon/Critical) | [certificate-expiry](../runbooks/certificate-expiry.md) |
| HighLatency / SLOLatencyBudgetBurn | [high-latency](../runbooks/high-latency.md) |
| BackendHighMemory / OOMKilled | [memory-exhaustion](../runbooks/memory-exhaustion.md) |
| Node*/DiskPressure/FilesystemLow/PVFilling | [node-failure](../runbooks/node-failure.md) / [disk-full](../runbooks/disk-full.md) |
| API unreachable / many NodeNotReady | [cluster-failure](../runbooks/cluster-failure.md) |
| Login broken (no alert — reported) | [oauth-outage](../runbooks/oauth-outage.md) |
| Bad release | [deployment-rollback](../runbooks/deployment-rollback.md) |

## Two things you do NOT do alone

Both need the Incident Commander's explicit go/no-go:

- **Restore into production PostgreSQL** (overwrites live data).
- **Rebuild or replace the cluster.**

For a restore, always validate into a **scratch** database first
(`deploy/backup/pg-restore-job.yaml`).

## Escalation

- Can't restore within the SEV target, or you're unsure → page the secondary and
  get an IC. Escalating early is correct, not a failure.
- Platform faults (managed DB, LB, control plane) → DigitalOcean support with the
  relevant id from the [Production Manual](./PRODUCTION-MANUAL.md).

## Communicating

Use [`../incident/comms-templates.md`](../incident/comms-templates.md). State only
what you've verified — "investigating" is fine. Update on cadence (SEV1: 30 min).

## Handy commands

```sh
kubectl -n nems-prod get pods -l app.kubernetes.io/name=nems-backend -o wide
kubectl -n nems-prod rollout status deployment/nems-backend
kubectl -n nems-prod rollout undo deployment/nems-backend
curl -sS -o /dev/null -w '%{http_code}\n' https://api.neuropause033.com/health
kubectl -n nems-prod get gateway nems-gateway -o wide
kubectl -n nems-prod get httproute nems-backend -o wide
```

## Handoff

At end of shift, pass on: open incidents and their state, anything degraded but
not paged, deferred maintenance, and where you left off. Never drop a live
incident without an explicit handover to a named person.
