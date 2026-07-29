/**
 * Module 13 — Cloud Operations Dashboards. One dashboard per role (CEO / CTO / Platform
 * Engineering / Cloud Operations / SRE / Security), composed from the live in-process registries
 * plus the evidence-matrix readiness. Panels that reflect infrastructure are labelled as
 * descriptor state, never live cloud telemetry.
 */
import type { DeploymentManager } from './deployments';
import type { EnvironmentManager } from './environments';
import type { InfrastructurePolicyEngine } from './policy';
import type { ConfigurationPlatform } from './config';
import type { FleetManagement } from './fleet';
import type { ObservabilityPlatform } from './observability';
import { cloudOpsReadiness, type CloudOpsReadiness } from './evidence';
import type { FleetInventory } from './types';
import { CLOUDOPS_ROLES, type CloudOpsRole } from './constants';

export interface CloudOpsDashboard {
  role: CloudOpsRole;
  panels: {
    deploymentInventory: Record<string, number>;
    environmentHealth: { byTier: Record<string, number>; note: string };
    policyCompliance: { policies: number; note: string };
    configurationStatus: { entries: number; note: string };
    fleetInventory: FleetInventory;
    infrastructureReadiness: CloudOpsReadiness;
    observability: { bySignal: Record<string, number>; note: string };
  };
  focus: string;
}

const FOCUS: Record<CloudOpsRole, string> = {
  CEO: 'fleet inventory, environments, infrastructure readiness',
  CTO: 'deployment inventory, topology, readiness',
  'Platform Engineering': 'environments, deployments, configuration, policy',
  'Cloud Operations': 'fleet, clouds, environments, deployment descriptors (infra-pending live)',
  SRE: 'environment health, observability, backup/DR, drift',
  Security: 'policy compliance, secret references, image policy, isolation',
};

export interface DashboardDeps {
  deployments: DeploymentManager;
  environments: EnvironmentManager;
  policy: InfrastructurePolicyEngine;
  config: ConfigurationPlatform;
  fleet: FleetManagement;
  observability: ObservabilityPlatform;
}

export class CloudOpsDashboards {
  constructor(private readonly deps: DashboardDeps) {}

  build(role: CloudOpsRole): CloudOpsDashboard {
    const byTier: Record<string, number> = {};
    for (const e of this.deps.environments.list()) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
    return {
      role,
      panels: {
        deploymentInventory: this.deps.deployments.inventory(),
        environmentHealth: { byTier, note: 'declared environments — health is descriptor state, not live probes' },
        policyCompliance: { policies: this.deps.policy.count(), note: 'policies evaluated in-process against descriptors' },
        configurationStatus: { entries: this.deps.config.count(), note: 'config entries; secret-backed values encrypted at rest in the reused vault' },
        fleetInventory: this.deps.fleet.inventory(),
        infrastructureReadiness: cloudOpsReadiness(),
        observability: this.deps.observability.overview(),
      },
      focus: FOCUS[role],
    };
  }

  roles(): readonly CloudOpsRole[] {
    return CLOUDOPS_ROLES;
  }
}
