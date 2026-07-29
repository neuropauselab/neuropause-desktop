# NEMS — Google Cloud infrastructure (REPRESENTED). Creates nothing on its own; no resources claimed.
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = ">= 5.0" }
  }
}
provider "google" {
  project = var.project
  region  = var.region
}
variable "project" { default = "REPLACE_WITH_PROJECT" }
variable "region" { default = "us-central1" }

resource "google_container_cluster" "nems" {
  name               = "nems-production"
  location           = var.region
  initial_node_count = 3
  node_config { machine_type = "e2-standard-2" }
}
