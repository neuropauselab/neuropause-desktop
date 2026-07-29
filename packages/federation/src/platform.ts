/**
 * Module 15 — Federation APIs / composition root. `createFederationPlatform(runtime, …)`
 * assembles the Wave 6 federation layer on the EXISTING platform: it reuses the one runtime
 * audit chain + event bus (global governance) and, when provided, the Wave 5 execution
 * runtime (connector counts) — no service is duplicated. It wires the federation runtime,
 * organization manager, trust, tenancy, regions, clusters, deployments, exchange, marketplace,
 * global search, observability, analytics, and dashboards, and exposes the named Federation APIs.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { FEDERATION_VERSION, type ArtifactKind, type DeploymentTarget, type MarketplaceKind } from './constants';
import { FEDERATION_MATRIX, federationReadiness, type CapabilityEvidence, type FederationReadiness } from './evidence';
import { FederationGovernance } from './governance';
import { OrganizationManager } from './organizations';
import { FederationRuntime } from './federation';
import { TrustEngine } from './trust';
import { MultiTenantFederation } from './tenancy';
import { RegionManager } from './regions';
import { ClusterManager } from './clusters';
import { DeploymentRuntime } from './deployments';
import { CrossOrgExchange } from './exchange';
import { MarketplaceRuntime } from './marketplace';
import { GlobalSearch, organizationSource, federationSource, exchangeSource, marketplaceSource, type GlobalSearchResult } from './search';
import { FederationObservability, type FederationHealth } from './observability';
import { FederationAnalytics } from './analytics';
import { FederationDashboards } from './dashboards';
import type { Federation, Organization, Region, Cluster, DeploymentDescriptor, SharedArtifact, MarketplaceListing } from './types';

export interface FederationPlatformOptions {
  clock?: Clock;
  execution?: ExecutionPlatform;
}

export interface FederationPlatform {
  version: string;
  // named Federation APIs (Module 15)
  createFederation(name: string, ownerOrgId: string, metadata?: Record<string, unknown>): Promise<Federation>;
  joinFederation(federationId: string, orgId: string): Promise<Federation>;
  leaveFederation(federationId: string, orgId: string): Promise<Federation>;
  registerOrganization(input: { name: string; metadata?: Record<string, unknown>; nemsTenantId?: string }): Promise<Organization>;
  discoverOrganizations(federationId: string): Organization[];
  registerCluster(input: { regionId: string; name: string; services?: string[] }): Promise<Cluster>;
  registerRegion(input: { name: string; provider: string; zones?: string[]; edgeNodes?: string[] }): Promise<Region>;
  shareWorkflow(input: { federationId: string; name: string; fromOrg: string; toOrg: string; payload?: Record<string, unknown> }): Promise<SharedArtifact>;
  shareConnector(input: { federationId: string; name: string; fromOrg: string; toOrg: string; payload?: Record<string, unknown> }): Promise<SharedArtifact>;
  shareDashboard(input: { federationId: string; name: string; fromOrg: string; toOrg: string; payload?: Record<string, unknown> }): Promise<SharedArtifact>;
  searchGlobal(query: string, opts?: { sources?: string[]; limit?: number }): Promise<GlobalSearchResult>;
  observeFederation(federationId: string): FederationHealth;
  listDeployments(target?: DeploymentTarget): DeploymentDescriptor[];
  describeDeployment(target: DeploymentTarget, input: { name: string; image?: string; replicas?: number }): Promise<DeploymentDescriptor>;
  publishListing(input: { kind: MarketplaceKind; name: string; publisherOrg: string; version?: string; description?: string; payload?: Record<string, unknown> }): Promise<MarketplaceListing>;
  // accessors
  federations(): FederationRuntime;
  organizations(): OrganizationManager;
  trust(): TrustEngine;
  tenancy(): MultiTenantFederation;
  exchange(): CrossOrgExchange;
  marketplace(): MarketplaceRuntime;
  search(): GlobalSearch;
  regions(): RegionManager;
  clusters(): ClusterManager;
  deployments(): DeploymentRuntime;
  observability(): FederationObservability;
  analytics(): FederationAnalytics;
  dashboards(): FederationDashboards;
  governance(): FederationGovernance;
  matrix(): CapabilityEvidence[];
  readiness(): FederationReadiness;
}

export function createFederationPlatform(runtime: EnterpriseRuntime, options: FederationPlatformOptions = {}): FederationPlatform {
  const clock = options.clock ?? systemClock;
  const governance = new FederationGovernance(runtime, clock);
  const organizations = new OrganizationManager(clock, governance);
  const federation = new FederationRuntime(clock, governance);
  const trust = new TrustEngine(clock, governance);
  const tenancy = new MultiTenantFederation(federation, organizations, trust);
  const regions = new RegionManager(governance);
  const clusters = new ClusterManager(governance);
  const deployments = new DeploymentRuntime(governance);
  const exchange = new CrossOrgExchange(clock, governance, trust);
  const marketplace = new MarketplaceRuntime(clock, governance);

  const search = new GlobalSearch();
  search.register(organizationSource(organizations));
  search.register(federationSource(federation));
  search.register(exchangeSource(exchange));
  search.register(marketplaceSource(marketplace));

  const observability = new FederationObservability(federation, organizations, trust, exchange, regions, clusters, deployments, marketplace);
  const analytics = new FederationAnalytics({ federation, organizations, trust, exchange, deployments, marketplace, ...(options.execution ? { execution: options.execution } : {}) });
  const dashboards = new FederationDashboards(analytics, observability);

  const shareOf = (kind: ArtifactKind) => (input: { federationId: string; name: string; fromOrg: string; toOrg: string; payload?: Record<string, unknown> }) =>
    exchange.share({ federationId: input.federationId, kind, name: input.name, fromOrg: input.fromOrg, toOrg: input.toOrg, ...(input.payload ? { payload: input.payload } : {}) });

  return {
    version: FEDERATION_VERSION,
    createFederation: (name, ownerOrgId, metadata) => federation.create({ name, ownerOrgId, ...(metadata ? { metadata } : {}) }),
    joinFederation: (federationId, orgId) => federation.join(federationId, orgId),
    leaveFederation: (federationId, orgId) => federation.leave(federationId, orgId),
    registerOrganization: (input) => organizations.create(input),
    discoverOrganizations: (federationId) => tenancy.discover(federationId),
    registerCluster: (input) => clusters.register(input),
    registerRegion: (input) => regions.register(input),
    shareWorkflow: shareOf('workflow'),
    shareConnector: shareOf('connector'),
    shareDashboard: shareOf('dashboard'),
    searchGlobal: (query, opts) => search.search(query, opts ?? {}),
    observeFederation: (federationId) => observability.health(federationId),
    listDeployments: (target) => deployments.list(target),
    describeDeployment: (target, input) => deployments.describe(target, input),
    publishListing: (input) => marketplace.publish(input),
    federations: () => federation,
    organizations: () => organizations,
    trust: () => trust,
    tenancy: () => tenancy,
    exchange: () => exchange,
    marketplace: () => marketplace,
    search: () => search,
    regions: () => regions,
    clusters: () => clusters,
    deployments: () => deployments,
    observability: () => observability,
    analytics: () => analytics,
    dashboards: () => dashboards,
    governance: () => governance,
    matrix: () => FEDERATION_MATRIX,
    readiness: () => federationReadiness(),
  };
}
