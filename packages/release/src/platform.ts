/**
 * Sprint 6 composition root. `createReleasePlatform(runtime, …)` assembles the v1.0 GA release-
 * engineering + operational-launch layer on the EXISTING platform: it reuses the one runtime audit
 * chain + event bus (release governance), the Sprint-4 reliability engines (RC validation, GA gate,
 * rollback verification, documentation), the Sprint-5 customer-deployment runtime (deployment inventory
 * + customer success), the commercial platform (licensing), operations (incidents/health), the
 * production installer + documentation, deploy, security, and more. No subsystem is duplicated and no
 * prior package is modified. No marketplace publication, customer growth, revenue, or certification is
 * claimed before it occurs; executive approvals are never fabricated; and no real-world GA is asserted.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { RELEASE_VERSION, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { RELEASE_MATRIX, releaseReadiness, type CapabilityEvidence, type ReleaseReadiness } from './evidence';
import type {
  ReleaseContext,
  ReliabilityPlatform,
  CustomerDeploymentPlatform,
  CommercialPlatform,
  OperationsPlatform,
  DeploymentFoundation,
  ProductionPlatform,
  SecurityPlatform,
  InfrastructurePlatform,
  BusinessPlatform,
  WorkforcePlatform,
  WorkplacePlatform,
  IntegrationPlatform,
} from './types';
import { ReleaseGovernance } from './governance';
import { ReleaseRuntime } from './runtime';
import { PackagingRuntime } from './packaging';
import { RcValidation } from './rcValidation';
import { GaGate } from './gaGate';
import { ReleaseManagement } from './releaseManagement';
import { ReleaseAutomation } from './releaseAutomation';
import { CustomerOperations } from './customerOperations';
import { SupportOperations } from './supportOperations';
import { CustomerSuccessOperations } from './customerSuccessOps';
import { EnterpriseDocumentation } from './documentation';
import { MarketplaceDistribution } from './marketplace';
import { LicenseManagement } from './licenseManagement';
import { OperationalMonitoring } from './monitoring';
import { BusinessAnalytics } from './analytics';
import { ExecutiveDashboard } from './executiveDashboard';
import { ProductionOperations } from './productionOps';
import { ReleaseSDK } from './sdk';

export interface ReleasePlatformOptions {
  clock?: Clock;
  operator?: string;
  reliability?: ReliabilityPlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  commercial?: CommercialPlatform;
  operations?: OperationsPlatform;
  deploy?: DeploymentFoundation;
  production?: ProductionPlatform;
  security?: SecurityPlatform;
  infrastructure?: InfrastructurePlatform;
  business?: BusinessPlatform;
  workforce?: WorkforcePlatform;
  workplace?: WorkplacePlatform;
  integrationPlatform?: IntegrationPlatform;
}

export interface ReleasePlatform {
  version: string;
  runtime(): ReleaseRuntime;
  packaging(): PackagingRuntime;
  rcValidation(): RcValidation;
  gaGate(): GaGate;
  releaseManagement(): ReleaseManagement;
  automation(): ReleaseAutomation;
  customerOperations(): CustomerOperations;
  support(): SupportOperations;
  customerSuccess(): CustomerSuccessOperations;
  documentation(): EnterpriseDocumentation;
  marketplace(): MarketplaceDistribution;
  licenses(): LicenseManagement;
  monitoring(): OperationalMonitoring;
  analytics(): BusinessAnalytics;
  executiveDashboard(): ExecutiveDashboard;
  productionOps(): ProductionOperations;
  sdk(): ReleaseSDK;
  governance(): ReleaseGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): ReleaseReadiness;
}

export function createReleasePlatform(runtime: EnterpriseRuntime, options: ReleasePlatformOptions = {}): ReleasePlatform {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'release-runtime';
  const ctx: ReleaseContext = {
    ...(options.reliability ? { reliability: options.reliability } : {}),
    ...(options.customerDeployment ? { customerDeployment: options.customerDeployment } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.deploy ? { deploy: options.deploy } : {}),
    ...(options.production ? { production: options.production } : {}),
    ...(options.security ? { security: options.security } : {}),
    ...(options.infrastructure ? { infrastructure: options.infrastructure } : {}),
    ...(options.business ? { business: options.business } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
    ...(options.integrationPlatform ? { integrationPlatform: options.integrationPlatform } : {}),
  };

  const gov = new ReleaseGovernance(runtime, clock);
  const releaseRuntime = new ReleaseRuntime(clock, gov, operator);
  const packaging = new PackagingRuntime(ctx, gov, operator);
  const rcValidation = new RcValidation(ctx, gov, operator);
  const gaGate = new GaGate(ctx, gov, operator);
  const releaseManagement = new ReleaseManagement(gov, operator);
  const automation = new ReleaseAutomation(ctx, packaging, gov, operator);
  const customerOperations = new CustomerOperations(clock, ctx, gov, operator);
  const support = new SupportOperations(ctx, gov, operator);
  const customerSuccess = new CustomerSuccessOperations(ctx, gov, operator);
  const documentation = new EnterpriseDocumentation(ctx, gov, operator);
  const marketplace = new MarketplaceDistribution(gov, operator);
  const licenses = new LicenseManagement(clock, ctx, gov, operator);
  const monitoring = new OperationalMonitoring(ctx, gov, operator);
  const analytics = new BusinessAnalytics(ctx, { releaseRuntime, license: licenses, support, customerOps: customerOperations });
  const executiveDashboard = new ExecutiveDashboard(ctx, { releaseRuntime, license: licenses, support });
  const productionOps = new ProductionOperations(gov, operator);
  const sdk = new ReleaseSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: RELEASE_VERSION,
    runtime: () => releaseRuntime,
    packaging: () => packaging,
    rcValidation: () => rcValidation,
    gaGate: () => gaGate,
    releaseManagement: () => releaseManagement,
    automation: () => automation,
    customerOperations: () => customerOperations,
    support: () => support,
    customerSuccess: () => customerSuccess,
    documentation: () => documentation,
    marketplace: () => marketplace,
    licenses: () => licenses,
    monitoring: () => monitoring,
    analytics: () => analytics,
    executiveDashboard: () => executiveDashboard,
    productionOps: () => productionOps,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => RELEASE_MATRIX,
    readiness: () => releaseReadiness(),
  };
}
