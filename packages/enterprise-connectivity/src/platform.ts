/**
 * Launch Workstream 3 composition root. `createEnterpriseConnectivity(runtime, …)` assembles the
 * enterprise-connectivity control plane on the EXISTING platform: it reuses the one runtime audit chain
 * + event bus (connectivity governance), the Sprint-3 integration platform (connector frameworks, the
 * real synchronization engine, the transformation engine, AI + identity integration), the security
 * platform (SCIM provisioning), the AI runtime (provider count), and — when provided — infrastructure,
 * operations, platform operations, and reliability. No subsystem is duplicated and no prior package is
 * modified. No successful customer sync, live OAuth, production API traffic, customer data, or external
 * AI usage is ever claimed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { EC_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { EC_MATRIX, ecReadiness, type CapabilityEvidence, type EcReadiness } from './evidence';
import type {
  EcContext,
  IntegrationPlatform,
  SecurityPlatform,
  InfrastructurePlatform,
  AiRuntime,
  OperationsPlatform,
  PlatformOperations,
  ReliabilityPlatform,
} from './types';
import { EnterpriseConnectivityGovernance } from './governance';
import { ConnectorRuntime } from './connectorRuntime';
import { IdentityFederation } from './identityFederation';
import { ConnectorCatalog } from './connectorCatalog';
import { AiProviderPlatform } from './aiProviders';
import { SynchronizationEngine } from './synchronization';
import { DataMapping } from './dataMapping';
import { WorkspaceContext } from './workspaceContext';
import { EnterpriseSearch } from './search';
import { IntegrationMonitoring } from './monitoring';
import { EnterpriseConnectivitySDK } from './sdk';

export interface EnterpriseConnectivityOptions {
  clock?: Clock;
  operator?: string;
  integrationPlatform?: IntegrationPlatform;
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  aiRuntime?: AiRuntime;
  operations?: OperationsPlatform;
  platformOperations?: PlatformOperations;
  reliability?: ReliabilityPlatform;
}

export interface EnterpriseConnectivity {
  version: string;
  connectors(): ConnectorRuntime;
  identity(): IdentityFederation;
  catalog(): ConnectorCatalog;
  aiProviders(): AiProviderPlatform;
  synchronization(): SynchronizationEngine;
  dataMapping(): DataMapping;
  workspaceContext(): WorkspaceContext;
  search(): EnterpriseSearch;
  monitoring(): IntegrationMonitoring;
  sdk(): EnterpriseConnectivitySDK;
  governance(): EnterpriseConnectivityGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): EcReadiness;
}

export function createEnterpriseConnectivity(runtime: EnterpriseRuntime, options: EnterpriseConnectivityOptions = {}): EnterpriseConnectivity {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'connectivity-runtime';
  const ctx: EcContext = {
    ...(options.integrationPlatform ? { integrationPlatform: options.integrationPlatform } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
  };

  const gov = new EnterpriseConnectivityGovernance(runtime, clock);
  const connectors = new ConnectorRuntime(ctx, gov, operator);
  const identity = new IdentityFederation(ctx, gov, operator);
  const catalog = new ConnectorCatalog();
  const aiProviders = new AiProviderPlatform(ctx, gov, operator);
  const synchronization = new SynchronizationEngine(ctx, { connectors }, gov, operator);
  const dataMapping = new DataMapping(ctx, gov, operator);
  const workspaceContext = new WorkspaceContext({ connectors }, gov, operator);
  const search = new EnterpriseSearch({ connectors }, gov, operator);
  const monitoring = new IntegrationMonitoring(ctx, { connectors, sync: synchronization, ai: aiProviders });
  const sdk = new EnterpriseConnectivitySDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: EC_VERSION,
    connectors: () => connectors,
    identity: () => identity,
    catalog: () => catalog,
    aiProviders: () => aiProviders,
    synchronization: () => synchronization,
    dataMapping: () => dataMapping,
    workspaceContext: () => workspaceContext,
    search: () => search,
    monitoring: () => monitoring,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => EC_MATRIX,
    readiness: () => ecReadiness(),
  };
}
