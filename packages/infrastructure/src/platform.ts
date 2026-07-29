/**
 * Sprint 2 composition root. `createInfrastructurePlatform(runtime, …)` assembles the infrastructure
 * activation + enterprise identity/security/observability layer on the EXISTING platform: it reuses
 * the one runtime audit chain + event bus (infrastructure governance), and — when provided — the
 * security platform (identity/auth/authz/keys/sessions), the Sprint-1 deploy foundation (manifests,
 * monitoring config, backups, secrets references), cloud-ops, operations, production, federation, and
 * commercial platforms, plus the Wave 5 execution platform (reused connector count). No subsystem is
 * duplicated and no prior package is modified. Evidence is never promoted without real running
 * infrastructure: clusters/cloud/DNS/certs/databases/load-balancers stay infrastructure-pending.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { INFRA_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { INFRA_MATRIX, infraReadiness, type CapabilityEvidence, type InfraReadiness } from './evidence';
import type { InfraContext, SecurityPlatform, DeploymentFoundation, CloudOpsPlatform, OperationsPlatform, ProductionPlatform, FederationPlatform, CommercialPlatform } from './types';
import { InfraGovernance } from './governance';
import { ProviderAdapterRegistry } from './adapters';
import { InfrastructureActivationRuntime } from './activation';
import { KubernetesClusterActivation } from './clusters';
import { CloudPlatformActivation } from './cloud';
import { DatabaseActivation } from './database';
import { DnsNetworking } from './dns';
import { EnterpriseIdentity } from './identity';
import { AuthenticationPlatform } from './authentication';
import { AuthorizationPlatform } from './authorization';
import { ZeroTrust } from './zeroTrust';
import { SecretsActivation } from './secrets';
import { CertificateLifecycle } from './certificates';
import { MonitoringActivation } from './monitoring';
import { TelemetryPlatform } from './telemetry';
import { AlertingPlatform } from './alerting';
import { LoggingPlatform } from './logging';
import { InfrastructureSecurity } from './infraSecurity';
import { DisasterRecoveryActivation } from './disasterRecovery';
import { InfraDocumentation } from './documentation';

export interface InfrastructurePlatformOptions {
  clock?: Clock;
  security?: SecurityPlatform;
  deploy?: DeploymentFoundation;
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  federation?: FederationPlatform;
  commercial?: CommercialPlatform;
  execution?: ExecutionPlatform;
}

export interface InfrastructurePlatform {
  version: string;
  // EPIC API surface
  activation(): InfrastructureActivationRuntime;
  clusters(): KubernetesClusterActivation;
  cloud(): CloudPlatformActivation;
  databases(): DatabaseActivation;
  dns(): DnsNetworking;
  identity(): EnterpriseIdentity;
  authentication(): AuthenticationPlatform;
  authorization(): AuthorizationPlatform;
  zeroTrust(): ZeroTrust;
  secrets(): SecretsActivation;
  certificates(): CertificateLifecycle;
  monitoring(): MonitoringActivation;
  telemetry(): TelemetryPlatform;
  alerting(): AlertingPlatform;
  logging(): LoggingPlatform;
  infraSecurity(): InfrastructureSecurity;
  disasterRecovery(): DisasterRecoveryActivation;
  documentation(): InfraDocumentation;
  adapters(): ProviderAdapterRegistry;
  governance(): InfraGovernance;
  // reuse + honesty accessors
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): InfraReadiness;
}

export function createInfrastructurePlatform(runtime: EnterpriseRuntime, options: InfrastructurePlatformOptions = {}): InfrastructurePlatform {
  const clock = options.clock ?? systemClock;
  const ctx: InfraContext = {
    ...(options.security ? { security: options.security } : {}),
    ...(options.deploy ? { deploy: options.deploy } : {}),
    ...(options.cloudops ? { cloudops: options.cloudops } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.federation ? { federation: options.federation } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
  };

  const governance = new InfraGovernance(runtime, clock);
  const adapters = new ProviderAdapterRegistry(governance);

  const activation = new InfrastructureActivationRuntime(clock, governance);
  const clusters = new KubernetesClusterActivation(governance, ctx);
  const cloud = new CloudPlatformActivation(governance, ctx, adapters);
  const databases = new DatabaseActivation(governance, ctx);
  const dns = new DnsNetworking(governance);
  const identity = new EnterpriseIdentity(governance, ctx, adapters);
  const authentication = new AuthenticationPlatform(governance, ctx);
  const authorization = new AuthorizationPlatform(governance, ctx);
  const zeroTrust = new ZeroTrust(governance, ctx);
  const secrets = new SecretsActivation(governance, ctx, adapters);
  const certificates = new CertificateLifecycle(clock, governance);
  const monitoring = new MonitoringActivation(governance, ctx);
  const telemetry = new TelemetryPlatform(governance, ctx);
  const alerting = new AlertingPlatform(clock, governance);
  const logging = new LoggingPlatform(clock, runtime);
  const infraSecurity = new InfrastructureSecurity(governance, ctx);
  const disasterRecovery = new DisasterRecoveryActivation(governance, ctx);
  const documentation = new InfraDocumentation(governance, ctx);

  return {
    version: INFRA_VERSION,
    activation: () => activation,
    clusters: () => clusters,
    cloud: () => cloud,
    databases: () => databases,
    dns: () => dns,
    identity: () => identity,
    authentication: () => authentication,
    authorization: () => authorization,
    zeroTrust: () => zeroTrust,
    secrets: () => secrets,
    certificates: () => certificates,
    monitoring: () => monitoring,
    telemetry: () => telemetry,
    alerting: () => alerting,
    logging: () => logging,
    infraSecurity: () => infraSecurity,
    disasterRecovery: () => disasterRecovery,
    documentation: () => documentation,
    adapters: () => adapters,
    governance: () => governance,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => INFRA_MATRIX,
    readiness: () => infraReadiness(),
  };
}
