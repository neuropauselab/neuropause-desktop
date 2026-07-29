# NEMS — Hetzner Cloud infrastructure (REPRESENTED). Creates nothing on its own; no resources claimed.
terraform {
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = ">= 1.45" }
  }
}
provider "hcloud" {}

resource "hcloud_server" "nems_node" {
  count       = 3
  name        = "nems-node-${count.index}"
  image       = "debian-12"
  server_type = "cx31"
  location    = "nbg1"
}
