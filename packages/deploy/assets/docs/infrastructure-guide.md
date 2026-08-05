# NEMS Infrastructure Guide

Infrastructure is **represented** through Terraform templates under `iac/` and is never created by
this repository. An operator runs `terraform plan/apply` against a real cloud account.

| Provider | Path | Notes |
|---|---|---|
| AWS | `iac/aws/main.tf` | EKS + RDS Postgres |
| Azure | `iac/azure/main.tf` | AKS |
| Google Cloud | `iac/gcp/main.tf` | GKE |
| DigitalOcean | `iac/digitalocean/main.tf` | DOKS |
| Hetzner | `iac/hetzner/main.tf` | Cloud servers |
| VMware | `iac/vmware/README.md` | vSphere/Tanzu |
| On-prem | `iac/on-prem/README.md` | k3s/kubeadm + MetalLB |

Real clusters, cloud resources, databases, DNS, TLS, and load balancers are **infrastructure-pending**
until you configure credentials and apply. Nothing here asserts that any resource exists.
