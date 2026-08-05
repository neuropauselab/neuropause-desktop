# NEMS — AWS infrastructure (REPRESENTED). `terraform plan/apply` is run by the operator against a
# real AWS account; this template creates nothing on its own and no resources are claimed to exist.
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "region" { default = "us-east-1" }
variable "cluster_name" { default = "nems-production" }

# EKS cluster (represented). Real provisioning requires configured credentials and `apply`.
resource "aws_eks_cluster" "nems" {
  name     = var.cluster_name
  role_arn = var.cluster_role_arn
  vpc_config { subnet_ids = var.subnet_ids }
}

variable "cluster_role_arn" { default = "REPLACE_WITH_ROLE_ARN" }
variable "subnet_ids" { type = list(string), default = [] }

# Managed Postgres (represented).
resource "aws_db_instance" "nems_pg" {
  identifier        = "nems-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = "db.t3.medium"
  allocated_storage = 50
  storage_encrypted = true
  skip_final_snapshot = false
}

output "cluster_endpoint" { value = aws_eks_cluster.nems.endpoint }
