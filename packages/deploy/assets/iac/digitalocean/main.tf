# NEMS — DigitalOcean infrastructure (REPRESENTED). Creates nothing on its own; no resources claimed.
terraform {
  required_providers {
    digitalocean = { source = "digitalocean/digitalocean", version = ">= 2.0" }
  }
}
provider "digitalocean" {}

resource "digitalocean_kubernetes_cluster" "nems" {
  name    = "nems-production"
  region  = "nyc1"
  version = "1.30"
  node_pool {
    name       = "default"
    size       = "s-2vcpu-4gb"
    node_count = 3
  }
}
