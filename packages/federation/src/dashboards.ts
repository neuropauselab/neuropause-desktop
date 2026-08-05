/**
 * Module 14 — Executive Federation Dashboards. One dashboard per role (CEO / CTO / CISO /
 * Platform Operations / Cloud Operations / Partner Operations), composed from live analytics
 * + observability. Cloud-Operations panels are explicitly labelled as descriptor counts, not
 * live cloud telemetry.
 */
import type { FederationAnalytics } from './analytics';
import type { FederationObservability } from './observability';
import type { FederationRole } from './constants';

export interface FederationDashboard {
  role: FederationRole;
  panels: {
    organizations: number;
    federations: number;
    connectors: number;
    trustEdges: number;
    exchanges: number;
    marketplaceListings: number;
    deployments: { inventory: Record<string, number>; note: string };
    infrastructure: { regions: number; clusters: number; note: string };
  };
  focus: string;
}

const FOCUS: Record<FederationRole, string> = {
  CEO: 'organizations, federations, marketplace reach',
  CTO: 'connectors, deployments, topology',
  CISO: 'trust edges, governance, policy',
  'Platform Operations': 'federation health, exchange, search',
  'Cloud Operations': 'regions, clusters, deployment descriptors (infra-pending live)',
  'Partner Operations': 'cross-org exchange, marketplace, partner trust',
};

export class FederationDashboards {
  constructor(
    private readonly analytics: FederationAnalytics,
    private readonly observability: FederationObservability,
  ) {}

  build(role: FederationRole): FederationDashboard {
    const a = this.analytics.report();
    const o = this.observability.overview();
    return {
      role,
      panels: {
        organizations: a.organizations,
        federations: a.federations,
        connectors: a.connectors,
        trustEdges: a.trustEdges,
        exchanges: a.exchanges,
        marketplaceListings: a.marketplaceListings,
        deployments: { inventory: a.deploymentInventory, note: 'descriptors only — real deployment infra-pending' },
        infrastructure: { regions: o.regions, clusters: o.clusters, note: 'simulation metadata — not live cloud' },
      },
      focus: FOCUS[role],
    };
  }
}
