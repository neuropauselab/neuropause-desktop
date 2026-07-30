# Runbook — Cluster / control-plane failure

**Scenario:** The Kubernetes API is unreachable or the cluster is lost.
**Fires as:** SEV1
**Owner:** platform-oncall
**Backing alerts:** (external: total probe loss, many NodeNotReady, API unreachable)

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `kubectl` to `nems-prod-cluster` times out; all edge probes down; many `NodeNotReady`; DigitalOcean status shows an incident.

## Diagnosis

- Control-plane vs. total loss: `doctl kubernetes cluster get nems-prod-cluster` (id `7750e61a-2636-4220-85ea-aec4120bae40`); DO status page.
- Confirm it is not a local kubeconfig/network problem (try from another network/operator).

## Recovery

- **Transient control-plane** (managed by DO) → engage DigitalOcean support and wait; do not rebuild prematurely.
- **Total / unrecoverable loss** → rebuild from Git + backups following `../dr/cluster-rebuild.md` (DR-PLAN §8). This is destructive and gated on Incident-Commander authorization.

## Validation

- API reachable, nodes Ready; then the full end-to-end checklist in `../dr/cluster-rebuild.md` Step 8.

## Escalation

- Declare SEV1 immediately; Incident Commander owns the go/no-go on a rebuild; DigitalOcean support in parallel.

## Related

`node-failure.md`, `../dr/cluster-rebuild.md`, `../dr/DR-PLAN.md`
