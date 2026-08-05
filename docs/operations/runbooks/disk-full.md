# Runbook — Disk pressure / volume filling

**Scenario:** A node or a PersistentVolume is running out of space.
**Fires as:** SEV2 (approaching) to SEV1 (full → writes failing)
**Owner:** platform-oncall
**Backing alerts:** NodeDiskPressure, NodeFilesystemLow, PersistentVolumeFillingUp

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `NodeDiskPressure`, `NodeFilesystemLow` (<15% free), or `PersistentVolumeFillingUp` (<15%).

## Diagnosis

- Which node/mount: `node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes` by instance/mountpoint.
- Which PVC: `kubelet_volume_stats_available_bytes / kubelet_volume_stats_capacity_bytes` — likely the monitoring volumes (Prometheus 50Gi with `retentionSize=40GB`, Grafana 5Gi, Alertmanager 5Gi).
- Prometheus TSDB: `retentionSize=40GB` bounds growth below the 50Gi PVC, but verify it is being honored; a runaway cardinality can still fill `/tmp` or WAL.
- Node ephemeral storage: large container logs or images.

## Recovery

- Monitoring PVC filling → expand the PVC (DO block storage supports online expansion) or lower Prometheus retention; confirm `retentionSize` < PVC size.
- Node ephemeral pressure → prune unused images/logs; cordon+drain and recycle the node if needed (`node-failure.md`).
- Managed database storage is **separate** and grows via the DO console — not covered by these node/PV alerts.

## Validation

- Free space back above 15% on the affected node/PVC; alert clears; Prometheus still ingesting.

## Escalation

- Repeated disk pressure → capacity review (`../capacity/`); if writes were failing (data risk), Incident Commander.

## Related

`node-failure.md`, `../capacity/CAPACITY-PLAN.md`
