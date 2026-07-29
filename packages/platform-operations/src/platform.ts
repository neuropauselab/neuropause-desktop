/**
 * Launch Workstream 1 composition root. `createPlatformOperations(runtime, …)` assembles the production
 * operations CONTROL PLANE on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (platform-ops governance), the Sprint-2 infrastructure (clusters/databases/secrets/certificates), the
 * Sprint-1 deploy assets, the Sprint-4 reliability engines (end-to-end validation, recovery, scoring,
 * docs), the Sprint-6 release automation + documentation, operations (incidents/health), production
 * (backups/installer), security (identity/MFA/keys), and the AI runtime. No subsystem is duplicated and
 * no prior package is modified. No live infrastructure, running cluster, provisioned database, issued
 * certificate, or live domain is ever claimed unless configured and verified.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { PLATFORM_OPS_VERSION, TARGET_DOMAIN, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { PLATFORM_OPS_MATRIX, platformOpsReadiness, type CapabilityEvidence, type PlatformOpsReadiness } from './evidence';
import type {
  PlatformOpsContext,
  InfrastructurePlatform,
  DeploymentFoundation,
  ReliabilityPlatform,
  ReleasePlatform,
  CustomerDeploymentPlatform,
  OperationsPlatform,
  ProductionPlatform,
  SecurityPlatform,
  AiRuntime,
  IntegrationPlatform,
  CommercialPlatform,
} from './types';
import { PlatformOpsGovernance } from './governance';
import { CloudEnvironmentRuntime } from './cloudEnvironment';
import { KubernetesPlatform } from './kubernetes';
import { DatabasePlatform } from './databases';
import { ApiPlatform } from './apiPlatform';
import { NetworkingPlatform } from './networking';
import { IdentityActivation } from './identityActivation';
import { AiRuntimeOperations } from './aiOps';
import { StoragePlatform } from './storage';
import { CicdOperations } from './cicd';
import { MonitoringPlatform } from './monitoring';
import { OperationsCenter } from './operationsCenter';
import { BackupRecovery } from './backupRecovery';
import { ProductionSecurity } from './productionSecurity';
import { DeploymentAutomation } from './deploymentAutomation';
import { ProductionValidation } from './validation';
import { OperationsDocumentation } from './documentation';
import { ExecutiveOperationsDashboard } from './executiveDashboard';
import { PlatformOpsSDK } from './sdk';

export interface PlatformOperationsOptions {
  clock?: Clock;
  operator?: string;
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  reliability?: ReliabilityPlatform;
  release?: ReleasePlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  operations?: OperationsPlatform;
  production?: ProductionPlatform;
  security?: SecurityPlatform;
  aiRuntime?: AiRuntime;
  integrationPlatform?: IntegrationPlatform;
  commercial?: CommercialPlatform;
}

export interface PlatformOperations {
  version: string;
  targetDomain: string;
  cloud(): CloudEnvironmentRuntime;
  kubernetes(): KubernetesPlatform;
  databases(): DatabasePlatform;
  api(): ApiPlatform;
  networking(): NetworkingPlatform;
  identity(): IdentityActivation;
  aiOps(): AiRuntimeOperations;
  storage(): StoragePlatform;
  cicd(): CicdOperations;
  monitoring(): MonitoringPlatform;
  operationsCenter(): OperationsCenter;
  backupRecovery(): BackupRecovery;
  security(): ProductionSecurity;
  deploymentAutomation(): DeploymentAutomation;
  validation(): ProductionValidation;
  documentation(): OperationsDocumentation;
  executiveDashboard(): ExecutiveOperationsDashboard;
  sdk(): PlatformOpsSDK;
  governance(): PlatformOpsGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): PlatformOpsReadiness;
}

export function createPlatformOperations(runtime: EnterpriseRuntime, options: PlatformOperationsOptions = {}): PlatformOperations {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'platform-ops-runtime';
  const ctx: PlatformOpsContext = {
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.deploy ? { deploy: options.deploy } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
    ...(options.release ? { release: options.release } : {}),
    ...(options.customerDeployment ? { customerDeployment: options.customerDeployment } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
    ...(options.integrationPlatform ? { integrationPlatform: options.integrationPlatform } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
  };

  const gov = new PlatformOpsGovernance(runtime, clock);
  const cloud = new CloudEnvironmentRuntime(ctx, gov, operator);
  const kubernetes = new KubernetesPlatform(ctx, gov, operator);
  const databases = new DatabasePlatform(ctx, gov, operator);
  const api = new ApiPlatform(gov, operator);
  const networking = new NetworkingPlatform(ctx, gov, operator);
  const identity = new IdentityActivation(ctx, gov, operator);
  const aiOps = new AiRuntimeOperations(ctx, gov, operator);
  const storage = new StoragePlatform(gov, operator);
  const cicd = new CicdOperations(ctx, gov, operator);
  const monitoring = new MonitoringPlatform(ctx, gov, operator);
  const operationsCenter = new OperationsCenter(ctx, { cloud, databases }, gov, operator);
  const backupRecovery = new BackupRecovery(ctx, gov, operator);
  const security = new ProductionSecurity(ctx, gov, operator);
  const deploymentAutomation = new DeploymentAutomation(ctx, gov, operator);
  const validation = new ProductionValidation(ctx, gov, operator);
  const documentation = new OperationsDocumentation(ctx, gov, operator);
  const executiveDashboard = new ExecutiveOperationsDashboard(ctx, { cloud, center: operationsCenter });
  const sdk = new PlatformOpsSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: PLATFORM_OPS_VERSION,
    targetDomain: TARGET_DOMAIN,
    cloud: () => cloud,
    kubernetes: () => kubernetes,
    databases: () => databases,
    api: () => api,
    networking: () => networking,
    identity: () => identity,
    aiOps: () => aiOps,
    storage: () => storage,
    cicd: () => cicd,
    monitoring: () => monitoring,
    operationsCenter: () => operationsCenter,
    backupRecovery: () => backupRecovery,
    security: () => security,
    deploymentAutomation: () => deploymentAutomation,
    validation: () => validation,
    documentation: () => documentation,
    executiveDashboard: () => executiveDashboard,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => PLATFORM_OPS_MATRIX,
    readiness: () => platformOpsReadiness(),
  };
}
