# NEMS — VMware vSphere deployment (represented)

This describes an intended VMware topology. It provisions nothing; a vSphere administrator applies it
against a real cluster.

- **Compute**: 3× VM (4 vCPU / 8 GB) for the Kubernetes control plane + workers (or a vSphere with
  Tanzu supervisor cluster).
- **Storage**: vSAN datastore backing the `nems-ssd` StorageClass (via the vSphere CSI driver).
- **Networking**: NSX-T segment for the `nems-production` namespace; NSX load balancer for ingress.
- **Images**: pull `ghcr.io/neuropause/nems` into a local Harbor registry.

Real cluster creation, datastores, and load balancers are **infrastructure-pending** until configured.
