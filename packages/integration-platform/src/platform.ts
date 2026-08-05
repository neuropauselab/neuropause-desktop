/**
 * Sprint 3 composition root. `createIntegrationPlatform(runtime, …)` assembles the universal
 * enterprise integration layer on the EXISTING platform: it reuses the one runtime audit chain +
 * event bus (integration governance), and — when provided — the Sprint-2 infrastructure (identity),
 * the security platform (tokens/secrets), operations (health), the base connectors platform, the AI
 * runtime, production (documentation), and the business platform. No subsystem is duplicated and no
 * prior package is modified. Named integration-platform because packages/integrations already exists.
 * Evidence is never promoted without configuration and verification.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { INTEGRATION_VERSION, INFRASTRUCTURE_PENDING_CAPS, FRAMEWORKS, type InfrastructurePendingCap, type FrameworkCategory } from './constants';
import { INTEGRATION_MATRIX, integrationReadiness, type CapabilityEvidence, type IntegrationReadiness } from './evidence';
import type { IntegrationContext, InfrastructurePlatform, SecurityPlatform, OperationsPlatform, ConnectorPlatform, AiRuntime, ProductionPlatform, BusinessPlatform } from './types';
import { IntegrationGovernance } from './governance';
import { IntegrationRuntime } from './runtime';
import { ApiGateway } from './gateway';
import { SynchronizationEngine } from './sync';
import { TransformationEngine } from './transformation';
import { MessagingPlatform } from './messaging';
import { AdapterFramework } from './frameworks';
import { IdentityIntegration } from './identityIntegration';
import { AiIntegration } from './ai';
import { IntegrationSecurity } from './integrationSecurity';
import { IntegrationMonitoring } from './monitoring';
import { IntegrationDocumentation } from './documentation';

export interface IntegrationPlatformOptions {
  clock?: Clock;
  infrastructure?: InfrastructurePlatform;
  security?: SecurityPlatform;
  operations?: OperationsPlatform;
  connectors?: ConnectorPlatform;
  aiRuntime?: AiRuntime;
  production?: ProductionPlatform;
  business?: BusinessPlatform;
  execution?: ExecutionPlatform;
}

export interface IntegrationPlatform {
  version: string;
  runtime(): IntegrationRuntime;
  gateway(): ApiGateway;
  sync(): SynchronizationEngine;
  transformation(): TransformationEngine;
  messaging(): MessagingPlatform;
  identity(): IdentityIntegration;
  ai(): AiIntegration;
  security(): IntegrationSecurity;
  monitoring(): IntegrationMonitoring;
  documentation(): IntegrationDocumentation;
  /** The reusable adapter framework for a category (erp/crm/collaboration/storage/database/hr/finance/manufacturing/healthcare). */
  framework(category: FrameworkCategory): AdapterFramework;
  frameworks(): AdapterFramework[];
  governance(): IntegrationGovernance;
  // reuse + honesty accessors
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): IntegrationReadiness;
}

export function createIntegrationPlatform(runtime: EnterpriseRuntime, options: IntegrationPlatformOptions = {}): IntegrationPlatform {
  const clock = options.clock ?? systemClock;
  const ctx: IntegrationContext = {
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.connectors ? { connectors: options.connectors } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.business ? { business: options.business } : {}),
  };

  const governance = new IntegrationGovernance(runtime, clock);
  const integrationRuntime = new IntegrationRuntime(clock, governance, ctx);
  const gateway = new ApiGateway(clock, governance);
  const sync = new SynchronizationEngine(clock, governance);
  const transformation = new TransformationEngine(governance);
  const messaging = new MessagingPlatform(clock, governance);
  const identity = new IdentityIntegration(governance, ctx);
  const ai = new AiIntegration(governance, ctx);
  const security = new IntegrationSecurity(governance, ctx);
  const monitoring = new IntegrationMonitoring(ctx, integrationRuntime, sync);
  const documentation = new IntegrationDocumentation(governance, ctx);

  const frameworks = new Map<FrameworkCategory, AdapterFramework>();
  for (const config of FRAMEWORKS) {
    if (config.category === 'ai') continue; // AI handled by the AI integration (reuses the AI runtime)
    frameworks.set(config.category, new AdapterFramework(config, governance));
  }

  return {
    version: INTEGRATION_VERSION,
    runtime: () => integrationRuntime,
    gateway: () => gateway,
    sync: () => sync,
    transformation: () => transformation,
    messaging: () => messaging,
    identity: () => identity,
    ai: () => ai,
    security: () => security,
    monitoring: () => monitoring,
    documentation: () => documentation,
    framework: (category: FrameworkCategory) => {
      const f = frameworks.get(category);
      if (!f) throw new Error(`no adapter framework for category ${category}`);
      return f;
    },
    frameworks: () => [...frameworks.values()],
    governance: () => governance,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => INTEGRATION_MATRIX,
    readiness: () => integrationReadiness(),
  };
}
