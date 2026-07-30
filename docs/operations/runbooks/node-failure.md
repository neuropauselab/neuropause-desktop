# Runbook — Node failure

**Scenario:** A node in pool `nems-prod-pool-1` is NotReady and pods need to reschedule.
**Fires as:** SEV2 (one node, capacity holds) to SEV1 (multiple nodes)
**Owner:** platform-oncall
**Backing alerts:** NodeNotReady

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `NodeNotReady`; pods Pending or Evicted; `kubectl get nodes` shows a node NotReady.

## Diagnosis

- `kubectl get nodes -o wide` and `kubectl describe node <node>` (conditions: MemoryPressure/DiskPressure/network).
- Scope: one of the three `nems-prod-pool-1` nodes, or several? Affected pods: `kubectl -n nems-prod get pods -o wide`.
- Stateful reattach: confirm the Qdrant PVC can reattach on another node.
- Platform view: DigitalOcean console / status for node health.

## Recovery

- DOKS reschedules pods off a dead node automatically; the 2 backend replicas should spread across surviving nodes.
- Recycle the bad node: `kubectl cordon <node>` → `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` → delete/replace it (DO recycles the node pool).
- If capacity is tight during the outage, temporarily scale the node pool.

## Validation

- 3 nodes `Ready`; all `nems-prod` pods `Running`; `/health` 200; no pending pods.

## Escalation

- Multiple simultaneous node failures → SEV1 and `../dr/DR-PLAN.md` §7/§8; DigitalOcean support.

## Related

`disk-full.md`, `cluster-failure.md`, `../dr/DR-PLAN.md`
