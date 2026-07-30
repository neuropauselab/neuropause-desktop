# Runbook — Deployment rollback

**Scenario:** A release regressed production (errors, latency, or crashloop) and must be rolled back.
**Fires as:** SEV1/SEV2 depending on impact
**Owner:** platform-oncall
**Backing alerts:** (usually a consequence — BackendCrashLooping, HighErrorRate, SLO*FastBurn after a change)

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- Error/latency spike or crashloop beginning right after a rollout; SLO burn correlated with a deploy.

## Diagnosis

- History: `kubectl -n nems-prod rollout history deployment/nems-backend` and `... rollout history ... --revision=<n>`.
- Running vs. good image: current digest vs. last known-good `sha256:997f8737…d00bbe6` (`backend-v0.1.0-rc.4`).
- Logs of the new revision for the failure signature.
- **Schema check:** did the new release change the database schema? Migrations are **not** auto-run on boot (`RUN_MIGRATIONS_ON_BOOT=false`), so a schema change is deliberate and a code rollback may be incompatible with an already-migrated database — confirm before rolling back across a migration.

## Recovery

- Straight rollback: `kubectl -n nems-prod rollout undo deployment/nems-backend` (optionally `--to-revision=<n>`).
- Or pin the known-good digest: `kubectl -n nems-prod set image deployment/nems-backend backend=registry.digitalocean.com/neuropause033/backend@sha256:997f8737…d00bbe6`.
- RollingUpdate `maxUnavailable=0 / maxSurge=1` keeps the service available during the swap.
- If a forward migration is incompatible with the old code, coordinate a DB remediation with the DR/database runbook before rolling back — do not roll back blindly.

## Validation

- `kubectl -n nems-prod rollout status deployment/nems-backend` succeeds; `/health` 200; error ratio and latency back to baseline; targets UP.

## Escalation

- Rollback fails, or code/schema are incompatible → Incident Commander and `../dr/DR-PLAN.md`.

## Related

`backend-down.md`, `high-latency.md`, `../dr/DR-PLAN.md`
