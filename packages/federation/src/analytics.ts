/**
 * Module 13 — Federation Analytics. Organization count, connector count (reused from the
 * Wave 5 execution runtime when provided), federation topology, deployment inventory, and
 * exchange metrics — all from REAL runtime data. Deployment inventory counts descriptors,
 * not live deployments.
 */
import type { ExecutionPlatform } from '@neuropause/execution';
import type { FederationRuntime } from './federation';
import type { OrganizationManager } from './organizations';
import type { TrustEngine } from './trust';
import type { CrossOrgExchange } from './exchange';
import type { DeploymentRuntime } from './deployments';
import type { MarketplaceRuntime } from './marketplace';

export interface FederationAnalyticsReport {
  organizations: number;
  federations: number;
  trustEdges: number;
  topology: Array<{ federation: string; members: number; trustEdges: number }>;
  deploymentInventory: Record<string, number>;
  exchanges: number;
  marketplaceListings: number;
  connectors: number;
}

export interface AnalyticsDeps {
  federation: FederationRuntime;
  organizations: OrganizationManager;
  trust: TrustEngine;
  exchange: CrossOrgExchange;
  deployments: DeploymentRuntime;
  marketplace: MarketplaceRuntime;
  execution?: ExecutionPlatform;
}

export class FederationAnalytics {
  constructor(private readonly deps: AnalyticsDeps) {}

  report(): FederationAnalyticsReport {
    return {
      organizations: this.deps.organizations.count(),
      federations: this.deps.federation.count(),
      trustEdges: this.deps.trust.allTrusts().length,
      topology: this.deps.federation.list().map((f) => ({ federation: f.name, members: f.members.length, trustEdges: this.deps.trust.trustsOf(f.id).length })),
      deploymentInventory: this.deps.deployments.inventory(),
      exchanges: this.deps.exchange.count(),
      marketplaceListings: this.deps.marketplace.count(),
      // reuse the Wave 5 execution connector runtime when available (22 universal connectors)
      connectors: this.deps.execution ? this.deps.execution.connectors().count() : 0,
    };
  }
}
