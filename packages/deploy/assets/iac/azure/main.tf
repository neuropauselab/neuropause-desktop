# NEMS — Azure infrastructure (REPRESENTED). Creates nothing on its own; no resources are claimed.
terraform {
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = ">= 3.0" }
  }
}
provider "azurerm" { features {} }

variable "location" { default = "eastus" }

resource "azurerm_resource_group" "nems" {
  name     = "nems-production"
  location = var.location
}

resource "azurerm_kubernetes_cluster" "nems" {
  name                = "nems-aks"
  location            = azurerm_resource_group.nems.location
  resource_group_name = azurerm_resource_group.nems.name
  dns_prefix          = "nems"
  default_node_pool {
    name       = "default"
    node_count = 3
    vm_size    = "Standard_D2s_v3"
  }
  identity { type = "SystemAssigned" }
}
