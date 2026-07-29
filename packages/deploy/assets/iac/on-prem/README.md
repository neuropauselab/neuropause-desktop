# NEMS — On-premise / bare-metal deployment (represented)

This describes an intended on-prem topology. It provisions nothing; an operator applies it against
real hardware.

- **Kubernetes**: k3s or kubeadm across 3 control-plane + N worker nodes.
- **Storage**: local-path or Longhorn for the `nems-ssd` StorageClass.
- **Ingress**: MetalLB (L2) + ingress-nginx for a bare-metal load balancer.
- **TLS**: cert-manager with an internal CA or Let's Encrypt (DNS-01).
- **Registry**: an internal registry mirror for the NEMS images.

Real nodes, storage, DNS, and TLS are **infrastructure-pending** until the hardware is configured.
