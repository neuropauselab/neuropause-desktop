/**
 * Module 11 — Federation Observability. Health of organizations, federations, trust,
 * exchange, regions, clusters, and deployments — all derived from REAL in-process state.
 * NOT cloud metrics: region/cluster/deployment counts are descriptor counts, explicitly not
 * live infrastructure telemetry.
 */
import type { FederationRuntime } from './federation';
import type { OrganizationManager } from './organizations';
import type { TrustEngine } from './trust';
import type { CrossOrgExchange } from './exchange';
import type { RegionManager } from './regions';
import type { ClusterManager } from './clusters';
import type { DeploymentRuntime } from './deployments';
import type { MarketplaceRuntime } from './marketplace';
import type { FederationStatus } from './types';

export interface FederationHealth {
  federationId: string;
  status: FederationStatus | 'unknown';
  members: number;
  trustEdges: number;
  sharedArtifacts: number;
}

export interface PlatformOverview {
  federations: number;
  organizations: number;
  trustEdges: number;
  exchanges: number;
  regions: number;
  clusters: number;
  deployments: number;
  marketplaceListings: number;
  note: string;
}

export class FederationObservability {
  constructor(
    private readonly federation: FederationRuntime,
    private readonly organizations: OrganizationManager,
    private readonly trust: TrustEngine,
    private readonly exchange: CrossOrgExchange,
    private readonly regions: RegionManager,
    private readonly clusters: ClusterManager,
    private readonly deployments: DeploymentRuntime,
    private readonly marketplace: MarketplaceRuntime,
  ) {}

  health(federationId: string): FederationHealth {
    const fed = this.federation.get(federationId);
    return {
      federationId,
      status: fed?.status ?? 'unknown',
      members: fed?.members.length ?? 0,
      trustEdges: this.trust.trustsOf(federationId).length,
      sharedArtifacts: this.exchange.forFederation(federationId).length,
    };
  }

  overview(): PlatformOverview {
    return {
      federations: this.federation.count(),
      organizations: this.organizations.count(),
      trustEdges: this.trust.allTrusts().length,
      exchanges: this.exchange.count(),
      regions: this.regions.count(),
      clusters: this.clusters.count(),
      deployments: this.deployments.count(),
      marketplaceListings: this.marketplace.count(),
      note: 'region/cluster/deployment counts are DESCRIPTORS — not live cloud metrics',
    };
  }
}
