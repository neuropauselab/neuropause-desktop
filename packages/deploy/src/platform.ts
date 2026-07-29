/**
 * Sprint 1 composition root. `createDeploymentFoundation(runtime, …)` assembles the production
 * deployment foundation on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (deployment governance), the real on-disk asset catalog, and — when provided — the Wave 14
 * production, Wave 7 cloud-ops, Wave 12 operations, security, and Wave 13 commercial platforms, plus
 * the Wave 5 execution platform (reused connector count). No subsystem is duplicated and no prior
 * package is modified. Exposes the deployment API surface, the evidence matrix, and readiness. Real
 * clusters/cloud/databases/monitoring/DNS/TLS/load-balancers are infrastructure-pending — represented
 * via validated descriptors, never created.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { DEPLOY_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { DEPLOY_MATRIX, deployReadiness, type CapabilityEvidence, type DeployReadiness } from './evidence';
import type { DeployContext, ProductionPlatform, CloudOpsPlatform, OperationsPlatform, SecurityPlatform, CommercialPlatform } from './types';
import { DeployGovernance } from './governance';
import { InfraAdapterRegistry } from './adapters';
import { AssetCatalog } from './assets';
import { EnvironmentArchitecture } from './environment';
import { InfrastructurePlatform } from './infrastructure';
import { SecretsPlatform } from './secretsPlatform';
import { ObservabilityBootstrap } from './observability';
import { BackupFoundation } from './backupFoundation';
import { SecurityBootstrap } from './securityBootstrap';
import { ReleaseManagement } from './releaseManagement';
import { ContainerPlatform, KubernetesPlatform, HelmPlatform, ReleasePipeline, ConfigurationPlatform, MonitoringStack, StoragePlatform, NetworkArchitecture, DocumentationCatalog } from './assetPlatforms';

export interface DeploymentFoundationOptions {
  clock?: Clock;
  production?: ProductionPlatform;
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  security?: SecurityPlatform;
  commercial?: CommercialPlatform;
  execution?: ExecutionPlatform;
}

export interface DeploymentFoundation {
  version: string;
  // EPIC API surface
  environments(): EnvironmentArchitecture;
  containers(): ContainerPlatform;
  kubernetes(): KubernetesPlatform;
  helm(): HelmPlatform;
  infrastructure(): InfrastructurePlatform;
  pipeline(): ReleasePipeline;
  secrets(): SecretsPlatform;
  config(): ConfigurationPlatform;
  observability(): ObservabilityBootstrap;
  monitoring(): MonitoringStack;
  backups(): BackupFoundation;
  storage(): StoragePlatform;
  network(): NetworkArchitecture;
  security(): SecurityBootstrap;
  releases(): ReleaseManagement;
  documentation(): DocumentationCatalog;
  assets(): AssetCatalog;
  adapters(): InfraAdapterRegistry;
  governance(): DeployGovernance;
  // reuse + honesty accessors
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): DeployReadiness;
}

export function createDeploymentFoundation(runtime: EnterpriseRuntime, options: DeploymentFoundationOptions = {}): DeploymentFoundation {
  const clock = options.clock ?? systemClock;
  const ctx: DeployContext = {
    ...(options.production ? { production: options.production } : {}),
    ...(options.cloudops ? { cloudops: options.cloudops } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
  };

  const governance = new DeployGovernance(runtime, clock);
  const adapters = new InfraAdapterRegistry(governance);
  const catalog = new AssetCatalog();

  const environments = new EnvironmentArchitecture(clock, governance, ctx);
  const containers = new ContainerPlatform(catalog);
  const kubernetes = new KubernetesPlatform(catalog);
  const helm = new HelmPlatform(catalog);
  const infrastructure = new InfrastructurePlatform(governance, catalog, adapters);
  const pipeline = new ReleasePipeline(catalog);
  const secrets = new SecretsPlatform(governance, ctx, catalog);
  const config = new ConfigurationPlatform(catalog);
  const observability = new ObservabilityBootstrap(ctx);
  const monitoring = new MonitoringStack(catalog);
  const backups = new BackupFoundation(governance, ctx);
  const storage = new StoragePlatform(catalog);
  const network = new NetworkArchitecture(catalog);
  const security = new SecurityBootstrap(ctx, catalog);
  const releases = new ReleaseManagement(governance, ctx);
  const documentation = new DocumentationCatalog(catalog);

  return {
    version: DEPLOY_VERSION,
    environments: () => environments,
    containers: () => containers,
    kubernetes: () => kubernetes,
    helm: () => helm,
    infrastructure: () => infrastructure,
    pipeline: () => pipeline,
    secrets: () => secrets,
    config: () => config,
    observability: () => observability,
    monitoring: () => monitoring,
    backups: () => backups,
    storage: () => storage,
    network: () => network,
    security: () => security,
    releases: () => releases,
    documentation: () => documentation,
    assets: () => catalog,
    adapters: () => adapters,
    governance: () => governance,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => DEPLOY_MATRIX,
    readiness: () => deployReadiness(),
  };
}
