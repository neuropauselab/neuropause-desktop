/**
 * Version 1.1 Program 1B composition root. `createPlatformAutomation(runtime, …)` assembles the
 * infrastructure-automation control plane on the EXISTING platform: it reuses the one runtime audit chain
 * + event bus (automation governance), the trust-platform supply-chain module (SBOM/provenance evidence),
 * the platform-operations backup-recovery engine (recovery validation), and — where wired — the
 * deployment-orchestrator and release platforms. No subsystem is duplicated and no prior package is
 * modified. Preview never mutates infrastructure; Execute requires explicit operator approval and only
 * prepares the operator execution package — nothing is applied, deployed, or claimed successful.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { PA_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { PA_MATRIX, paReadiness, type CapabilityEvidence, type PaReadiness } from './evidence';
import type { PaContext, TrustPlatform, DeploymentOrchestratorPlatform, ReleasePlatform, PlatformOperations } from './types';
import { PlatformAutomationGovernance } from './governance';
import { InfrastructureAutomationEngine } from './engine';
import { TerraformGenerator } from './terraform';
import { KubernetesAutomation } from './kubernetes';
import { DatabaseAutomation } from './database';
import { DnsTlsAutomation } from './dnsTls';
import { SecretsAutomation } from './secrets';
import { MonitoringAutomation } from './monitoring';
import { BackupAutomation } from './backup';
import { CicdAutomation } from './cicd';
import { ProductionValidationAutomation } from './validation';
import { EvidenceCollector } from './evidenceCollector';
import { OperationsDashboard } from './opsDashboard';
import { PlatformAutomationSDK } from './sdk';

export interface PlatformAutomationOptions {
  clock?: Clock;
  operator?: string;
  trustPlatform?: TrustPlatform;
  deploymentOrchestrator?: DeploymentOrchestratorPlatform;
  release?: ReleasePlatform;
  platformOperations?: PlatformOperations;
}

export interface PlatformAutomation {
  version: string;
  engine(): InfrastructureAutomationEngine;
  terraform(): TerraformGenerator;
  kubernetes(): KubernetesAutomation;
  database(): DatabaseAutomation;
  dnsTls(): DnsTlsAutomation;
  secrets(): SecretsAutomation;
  monitoring(): MonitoringAutomation;
  backup(): BackupAutomation;
  cicd(): CicdAutomation;
  validation(): ProductionValidationAutomation;
  evidenceCollector(): EvidenceCollector;
  opsDashboard(): OperationsDashboard;
  sdk(): PlatformAutomationSDK;
  governance(): PlatformAutomationGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): PaReadiness;
}

export function createPlatformAutomation(runtime: EnterpriseRuntime, options: PlatformAutomationOptions = {}): PlatformAutomation {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'automation-runtime';
  const ctx: PaContext = {
    ...(options.trustPlatform ? { trustPlatform: options.trustPlatform } : {}),
    ...(options.deploymentOrchestrator ? { deploymentOrchestrator: options.deploymentOrchestrator } : {}),
    ...(options.release ? { release: options.release } : {}),
    ...(options.platformOperations ? { platformOperations: options.platformOperations } : {}),
  };

  const gov = new PlatformAutomationGovernance(runtime, clock);
  const engine = new InfrastructureAutomationEngine(gov, operator);
  const terraform = new TerraformGenerator(gov, operator);
  const kubernetes = new KubernetesAutomation(gov, operator);
  const database = new DatabaseAutomation(gov, operator);
  const dnsTls = new DnsTlsAutomation(gov, operator);
  const secrets = new SecretsAutomation(gov, operator);
  const monitoring = new MonitoringAutomation(gov, operator);
  const backup = new BackupAutomation(ctx, gov, operator);
  const cicd = new CicdAutomation(ctx, gov, operator);
  const validation = new ProductionValidationAutomation(gov, operator);
  const evidenceCollector = new EvidenceCollector(ctx, gov, operator);
  const opsDashboard = new OperationsDashboard({ engine });
  const sdk = new PlatformAutomationSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: PA_VERSION,
    engine: () => engine,
    terraform: () => terraform,
    kubernetes: () => kubernetes,
    database: () => database,
    dnsTls: () => dnsTls,
    secrets: () => secrets,
    monitoring: () => monitoring,
    backup: () => backup,
    cicd: () => cicd,
    validation: () => validation,
    evidenceCollector: () => evidenceCollector,
    opsDashboard: () => opsDashboard,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => PA_MATRIX,
    readiness: () => paReadiness(),
  };
}
