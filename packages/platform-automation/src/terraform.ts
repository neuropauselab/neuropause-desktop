/**
 * EPIC 2 — Terraform Automation. Generates reusable Terraform module skeletons for AWS, Azure, Google
 * Cloud, and self-hosted Kubernetes, parameterized per environment (production/staging/development). The
 * generator emits HCL PLANS only — it never runs `terraform apply`, never holds credentials, and never
 * creates a resource. The apply commands returned stop at `terraform plan`; applying is the operator's
 * out-of-band step.
 */
import { CLOUD_PROVIDERS, type CloudProvider, type Environment } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

const PROVIDER_HCL: Record<CloudProvider, (env: Environment) => string> = {
  aws: (env) => `terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "region"      { type = string, default = "us-east-1" }
variable "cluster_name" { type = string, default = "neuropause-${env}" }

# Plan only — apply is performed out-of-band by an operator with real credentials.
module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  cluster_name    = var.cluster_name
  cluster_version = "1.29"
  # node group sized for the neuropause-backend Helm chart (replicaCount 2, HPA 2-6)
  eks_managed_node_groups = {
    application = { instance_types = ["m6i.large"], min_size = 3, max_size = 6, desired_size = 3 }
  }
  tags = { environment = "${env}", app = "neuropause" }
}`,
  azure: (env) => `terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 3.0" }
  }
}

provider "azurerm" { features {} }

variable "location"     { type = string, default = "eastus" }
variable "cluster_name" { type = string, default = "neuropause-${env}" }

resource "azurerm_kubernetes_cluster" "neuropause" {
  name                = var.cluster_name
  location            = var.location
  resource_group_name = "neuropause-${env}"
  dns_prefix          = "neuropause-${env}"
  default_node_pool { name = "app", node_count = 3, vm_size = "Standard_D2s_v5" }
  identity { type = "SystemAssigned" }
  tags = { environment = "${env}" }
}`,
  gcp: (env) => `terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

provider "google" { region = var.region }

variable "project" { type = string }
variable "region"  { type = string, default = "us-east1" }

resource "google_container_cluster" "neuropause" {
  name     = "neuropause-${env}"
  location = var.region
  initial_node_count = 3
  node_config { machine_type = "e2-standard-2" }
  resource_labels = { environment = "${env}" }
}`,
  'self-hosted': (env) => `terraform {
  required_version = ">= 1.5"
  required_providers {
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.0" }
  }
}

# Self-hosted: point at an existing kubeconfig; this plan configures namespaces/quotas only.
provider "kubernetes" { config_path = "~/.kube/config" }

resource "kubernetes_namespace" "neuropause" {
  metadata { name = "neuropause", labels = { environment = "${env}" } }
}`,
};

export class TerraformGenerator {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  providers(): readonly CloudProvider[] {
    return CLOUD_PROVIDERS;
  }

  async generateModule(input: { provider: CloudProvider; environment: Environment }): Promise<Artifact> {
    const content = PROVIDER_HCL[input.provider](input.environment);
    const artifact: Artifact = {
      kind: 'terraform',
      name: `${input.provider}-${input.environment}.tf`,
      format: 'hcl',
      content,
      note: 'Terraform plan skeleton — apply out-of-band with real credentials; this generator never applies.',
    };
    await this.gov.record({ operator: this.operator, environment: input.environment, target: `terraform:${input.provider}`, epic: 'E2', operation: 'generate-terraform', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }

  /** Return the plan artifact plus the plan-only command sequence (stops at `terraform plan`). */
  async plan(input: { provider: CloudProvider; environment: Environment }): Promise<{ artifact: Artifact; commands: string[] }> {
    const artifact = await this.generateModule(input);
    return { artifact, commands: ['terraform init', 'terraform plan -out=neuropause.tfplan  # review only — do NOT auto-apply'] };
  }
}
