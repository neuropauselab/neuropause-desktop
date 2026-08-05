/**
 * Sprint 5 composition root. `createCustomerDeploymentPlatform(runtime, …)` assembles the enterprise
 * customer-deployment layer on the EXISTING platform: it reuses the one runtime audit chain + event
 * bus (deployment governance), the security platform (identity/authz/licensing of roles), the Sprint-4
 * reliability engines (end-to-end acceptance, recovery, readiness scoring, RC gate, SLOs, docs),
 * operations (incidents/health), the integration platform, commercial (licensing), workplace,
 * workforce, business, industry, and — when provided — infrastructure, deploy, production, and the AI
 * runtime. No subsystem is duplicated and no prior package is modified. No proprietary customer data is
 * imported, no UAT approval is fabricated, and no GA is declared.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { CUSTOMER_DEPLOYMENT_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap, type CustomerProfile } from './constants';
import { CUSTOMER_DEPLOYMENT_MATRIX, deploymentReadiness, type CapabilityEvidence, type DeploymentReadiness } from './evidence';
import type {
  CustomerDeploymentContext,
  SecurityPlatform,
  InfrastructurePlatform,
  DeploymentFoundation,
  ReliabilityPlatform,
  IntegrationPlatform,
  BusinessPlatform,
  IndustryPlatform,
  WorkplacePlatform,
  WorkforcePlatform,
  OperationsPlatform,
  CommercialPlatform,
  ProductionPlatform,
  AiRuntime,
} from './types';
import { DeploymentGovernance } from './governance';
import { CustomerDeploymentRuntime } from './runtime';
import { CustomerOnboarding } from './onboarding';
import { EnterpriseConfiguration } from './configuration';
import { IdentityFederation } from './identityFederation';
import { IntegrationActivation } from './integrationActivation';
import { DataMigration } from './migration';
import { UserProvisioning } from './provisioning';
import { WorkspaceActivation } from './workspaceActivation';
import { AiWorkforceActivation } from './aiWorkforceActivation';
import { OperationalAcceptance } from './acceptance';
import { UserAcceptanceTesting } from './uat';
import { CustomerMonitoring } from './monitoring';
import { HypercarePlatform } from './hypercare';
import { CustomerSuccess } from './customerSuccess';
import { OperationsRunbooks } from './runbooks';
import { PilotProfile } from './pilotProfile';
import { RollbackRecovery } from './rollback';
import { ProductionReadinessGate } from './readinessGate';
import { CustomerDeploymentSDK } from './sdk';

export interface CustomerDeploymentPlatformOptions {
  clock?: Clock;
  operator?: string;
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  deploy?: DeploymentFoundation;
  reliability?: ReliabilityPlatform;
  integrationPlatform?: IntegrationPlatform;
  business?: BusinessPlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
  workforce?: WorkforcePlatform;
  operations?: OperationsPlatform;
  commercial?: CommercialPlatform;
  production?: ProductionPlatform;
  aiRuntime?: AiRuntime;
}

export interface CustomerDeploymentPlatform {
  version: string;
  runtime(): CustomerDeploymentRuntime;
  onboarding(): CustomerOnboarding;
  configuration(): EnterpriseConfiguration;
  identityFederation(): IdentityFederation;
  integrationActivation(): IntegrationActivation;
  migration(): DataMigration;
  provisioning(): UserProvisioning;
  workspaceActivation(): WorkspaceActivation;
  aiWorkforce(): AiWorkforceActivation;
  acceptance(): OperationalAcceptance;
  uat(): UserAcceptanceTesting;
  monitoring(): CustomerMonitoring;
  hypercare(): HypercarePlatform;
  customerSuccess(): CustomerSuccess;
  readinessGate(): ProductionReadinessGate;
  rollback(): RollbackRecovery;
  runbooks(): OperationsRunbooks;
  pilotProfile(): PilotProfile;
  sdk(): CustomerDeploymentSDK;
  governance(): DeploymentGovernance;
  // reuse + honesty accessors
  profiles(): CustomerProfile[];
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): DeploymentReadiness;
}

export function createCustomerDeploymentPlatform(runtime: EnterpriseRuntime, options: CustomerDeploymentPlatformOptions = {}): CustomerDeploymentPlatform {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'deployment-runtime';
  const ctx: CustomerDeploymentContext = {
    ...(options.security ? { security: options.security } : {}),
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.deploy ? { deploy: options.deploy } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
    ...(options.integrationPlatform ? { integrationPlatform: options.integrationPlatform } : {}),
    ...(options.business ? { business: options.business } : {}),
    ...(options.industry ? { industry: options.industry } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
  };

  const gov = new DeploymentGovernance(runtime, clock);
  const cdRuntime = new CustomerDeploymentRuntime(clock, gov, operator);
  const onboarding = new CustomerOnboarding(ctx, cdRuntime, gov, operator);
  const configuration = new EnterpriseConfiguration(ctx, cdRuntime, gov, operator);
  const identityFederation = new IdentityFederation(ctx, cdRuntime, gov, operator);
  const integrationActivation = new IntegrationActivation(ctx, cdRuntime, gov, operator);
  const migration = new DataMigration(clock, cdRuntime, gov, operator);
  const provisioning = new UserProvisioning(ctx, cdRuntime, gov, operator);
  const workspaceActivation = new WorkspaceActivation(ctx, cdRuntime, gov, operator);
  const aiWorkforce = new AiWorkforceActivation(ctx, cdRuntime, gov, operator);
  const acceptance = new OperationalAcceptance(ctx, cdRuntime, gov, operator);
  const uat = new UserAcceptanceTesting(clock, cdRuntime, gov, operator);
  const monitoring = new CustomerMonitoring(ctx, cdRuntime, gov, operator);
  const hypercare = new HypercarePlatform(ctx, cdRuntime, gov, operator);
  const customerSuccess = new CustomerSuccess(cdRuntime, gov, operator);
  const runbooks = new OperationsRunbooks(ctx, gov, operator);
  const pilotProfile = new PilotProfile(cdRuntime, gov, operator);
  const rollback = new RollbackRecovery(ctx, cdRuntime, gov, operator);
  const readinessGate = new ProductionReadinessGate(ctx, cdRuntime, gov, operator);
  const sdk = new CustomerDeploymentSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: CUSTOMER_DEPLOYMENT_VERSION,
    runtime: () => cdRuntime,
    onboarding: () => onboarding,
    configuration: () => configuration,
    identityFederation: () => identityFederation,
    integrationActivation: () => integrationActivation,
    migration: () => migration,
    provisioning: () => provisioning,
    workspaceActivation: () => workspaceActivation,
    aiWorkforce: () => aiWorkforce,
    acceptance: () => acceptance,
    uat: () => uat,
    monitoring: () => monitoring,
    hypercare: () => hypercare,
    customerSuccess: () => customerSuccess,
    readinessGate: () => readinessGate,
    rollback: () => rollback,
    runbooks: () => runbooks,
    pilotProfile: () => pilotProfile,
    sdk: () => sdk,
    governance: () => gov,
    profiles: () => pilotProfile.profiles_(),
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => CUSTOMER_DEPLOYMENT_MATRIX,
    readiness: () => deploymentReadiness(),
  };
}
