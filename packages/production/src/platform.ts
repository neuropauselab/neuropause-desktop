/**
 * Wave 14 composition root. `createProductionPlatform(runtime, …)` assembles the enterprise
 * production/reliability/deployment layer on the EXISTING platform: it reuses the one runtime audit
 * chain + event bus (production governance), and — when provided — the Wave 7 cloud-ops (deployment,
 * backups, HA, secret vault), the operations base (observability, health, performance, incidents),
 * the Wave 14 security platform (keys, sessions), the Wave 12 autonomous-ops (mission control), and
 * the Wave 13 commercial / Wave 8 business / Wave 11 workforce / Wave 10 workplace platforms
 * (health), plus the Wave 5 execution platform (reused connector count). No subsystem is duplicated.
 * Exposes the production API surface, the evidence matrix, and readiness. Real HA clusters,
 * multi-region failover, production DR, and global replication are infrastructure-pending — never
 * claimed as running. No certification is claimed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { PRODUCTION_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { PRODUCTION_MATRIX, productionReadiness, type CapabilityEvidence, type ProductionReadiness } from './evidence';
import type { ProductionContext, CloudOpsPlatform, OperationsPlatform, SecurityPlatform, AutonomousOpsPlatform, CommercialPlatform, BusinessPlatform, WorkforcePlatform, WorkplacePlatform } from './types';
import { ProductionGovernance } from './governance';
import { DeploymentAdapterRegistry } from './adapters';
import { ProductionRuntime } from './runtime';
import { EnterpriseDeploymentManager } from './deployment';
import { ReleaseManagement } from './release';
import { ZeroDowntimeUpgrade } from './upgradeStrategy';
import { BackupPlatform } from './backup';
import { DisasterRecoveryPlatform } from './disasterRecovery';
import { HighAvailabilityPlatform } from './highAvailability';
import { ObservabilityPlatform } from './observability';
import { SecurityHardening } from './security';
import { ComplianceVerification } from './compliance';
import { PerformancePlatform } from './performance';
import { ChaosEngineering } from './chaos';
import { HealthMonitoring } from './health';
import { EnterpriseDiagnostics } from './diagnostics';
import { UpgradeAssistant } from './upgradeAssistant';
import { InstallerPlatform } from './installer';
import { EnterpriseDocumentation } from './documentation';
import { ProductionSupport } from './support';
import { ProductionSDK } from './sdk';

export interface ProductionPlatformOptions {
  clock?: Clock;
  cloudops?: CloudOpsPlatform;
  operations?: OperationsPlatform;
  security?: SecurityPlatform;
  autonomousOps?: AutonomousOpsPlatform;
  commercial?: CommercialPlatform;
  business?: BusinessPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
  execution?: ExecutionPlatform;
}

export interface ProductionPlatform {
  version: string;
  // production API surface (M1–M21)
  runtime(): ProductionRuntime;
  deployments(): EnterpriseDeploymentManager;
  releases(): ReleaseManagement;
  upgrades(): ZeroDowntimeUpgrade;
  backups(): BackupPlatform;
  disasterRecovery(): DisasterRecoveryPlatform;
  highAvailability(): HighAvailabilityPlatform;
  monitoring(): ObservabilityPlatform;
  security(): SecurityHardening;
  compliance(): ComplianceVerification;
  performance(): PerformancePlatform;
  chaos(): ChaosEngineering;
  health(): HealthMonitoring;
  diagnostics(): EnterpriseDiagnostics;
  upgradeAssistant(): UpgradeAssistant;
  installer(): InstallerPlatform;
  documentation(): EnterpriseDocumentation;
  support(): ProductionSupport;
  sdk(): ProductionSDK;
  adapters(): DeploymentAdapterRegistry;
  governance(): ProductionGovernance;
  // reuse + honesty accessors
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): ProductionReadiness;
}

export function createProductionPlatform(runtime: EnterpriseRuntime, options: ProductionPlatformOptions = {}): ProductionPlatform {
  const clock = options.clock ?? systemClock;
  const ctx: ProductionContext = {
    ...(options.cloudops ? { cloudops: options.cloudops } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.autonomousOps ? { autonomousOps: options.autonomousOps } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
    ...(options.business ? { business: options.business } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
  };

  const governance = new ProductionGovernance(runtime, clock);
  const adapters = new DeploymentAdapterRegistry(governance);

  const productionRuntime = new ProductionRuntime(clock, governance);
  const deployments = new EnterpriseDeploymentManager(governance, ctx, productionRuntime);
  const releases = new ReleaseManagement(clock, governance, productionRuntime);
  const upgrades = new ZeroDowntimeUpgrade(clock, governance);
  const backups = new BackupPlatform(clock, governance, ctx);
  const disasterRecovery = new DisasterRecoveryPlatform(clock, governance, ctx);
  const highAvailability = new HighAvailabilityPlatform(governance, ctx);
  const monitoring = new ObservabilityPlatform(clock, governance, ctx);
  const security = new SecurityHardening(clock, governance, ctx);
  const compliance = new ComplianceVerification(clock, governance, ctx);
  const performance = new PerformancePlatform(governance, ctx);
  const chaos = new ChaosEngineering(clock, governance);
  const health = new HealthMonitoring(ctx);
  const diagnostics = new EnterpriseDiagnostics(clock, governance, productionRuntime);
  const upgradeAssistant = new UpgradeAssistant(clock, governance);
  const installer = new InstallerPlatform(clock, governance);
  const documentation = new EnterpriseDocumentation(clock, governance);
  const support = new ProductionSupport(clock, governance, productionRuntime, ctx);
  const sdk = new ProductionSDK(clock, governance);

  return {
    version: PRODUCTION_VERSION,
    runtime: () => productionRuntime,
    deployments: () => deployments,
    releases: () => releases,
    upgrades: () => upgrades,
    backups: () => backups,
    disasterRecovery: () => disasterRecovery,
    highAvailability: () => highAvailability,
    monitoring: () => monitoring,
    security: () => security,
    compliance: () => compliance,
    performance: () => performance,
    chaos: () => chaos,
    health: () => health,
    diagnostics: () => diagnostics,
    upgradeAssistant: () => upgradeAssistant,
    installer: () => installer,
    documentation: () => documentation,
    support: () => support,
    sdk: () => sdk,
    adapters: () => adapters,
    governance: () => governance,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => PRODUCTION_MATRIX,
    readiness: () => productionReadiness(),
  };
}
