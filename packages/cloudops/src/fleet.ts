/**
 * Module 12 — Fleet Management. One unified inventory across organizations, regions, clusters,
 * clouds, environments, deployments, and applications. Organizations / regions / clusters are
 * read from the REUSED Wave 6 federation platform (when provided) — no data is duplicated;
 * clouds / environments / deployments come from this wave's registries. Every entry is an
 * in-process descriptor, not live infrastructure.
 */
import type { FederationPlatform } from '@neuropause/federation';
import type { CloudRegistry } from './cloud';
import type { EnvironmentManager } from './environments';
import type { DeploymentManager } from './deployments';
import type { FleetInventory } from './types';

export interface FleetDeps {
  clouds: CloudRegistry;
  environments: EnvironmentManager;
  deployments: DeploymentManager;
  federation?: FederationPlatform;
}

export class FleetManagement {
  constructor(private readonly deps: FleetDeps) {}

  inventory(): FleetInventory {
    const fed = this.deps.federation;
    return {
      organizations: fed ? fed.organizations().count() : 0,
      regions: fed ? fed.regions().count() : 0,
      clusters: fed ? fed.clusters().count() : 0,
      clouds: this.deps.clouds.count(),
      environments: this.deps.environments.count(),
      deployments: this.deps.deployments.count(),
      applications: this.deps.deployments.byKind('application').length,
      note: 'unified inventory over in-process registries — organizations/regions/clusters/clouds are descriptors, not live infrastructure',
    };
  }
}
