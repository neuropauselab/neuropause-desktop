/**
 * Launch Workstream 2 composition root. `createCustomerExperience(runtime, …)` assembles the commercial
 * customer-experience layer on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (customer governance), the security platform (signup/login/MFA/session), the Sprint-6 release runtime
 * (licensing, packaging, support, customer success, documentation), the commercial platform (licensing),
 * operations (incidents), workplace (workspace setup), the AI runtime (AI-provider setup), and the
 * Sprint-4 reliability recovery (update rollback). No subsystem is duplicated and no prior package is
 * modified. No real signup, successful payment, deployed website, delivered email, or public download
 * CDN is ever claimed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import { CX_VERSION, TARGET_DOMAIN, INFRASTRUCTURE_PENDING_CAPS, type InfrastructurePendingCap } from './constants';
import { CX_MATRIX, cxReadiness, type CapabilityEvidence, type CxReadiness } from './evidence';
import type {
  CxContext,
  SecurityPlatform,
  CommercialPlatform,
  ReleasePlatform,
  CustomerDeploymentPlatform,
  OperationsPlatform,
  WorkplacePlatform,
  AiRuntime,
  ReliabilityPlatform,
  ProductionPlatform,
} from './types';
import { CustomerExperienceGovernance } from './governance';
import { AuthenticationRuntime } from './auth';
import { CustomerPortal } from './portal';
import { LicensingRuntime } from './licensing';
import { BillingPlatform } from './billing';
import { DownloadCenter } from './downloads';
import { UpdateRuntime } from './updates';
import { OnboardingWizardRuntime } from './onboarding';
import { DocumentationCenter } from './documentation';
import { SupportPortal } from './support';
import { CustomerSuccessCenter } from './customerSuccess';
import { WebsitePlatform } from './website';
import { MarketingAssets } from './marketing';
import { CustomerAnalytics } from './analytics';
import { CustomerCommunications } from './communications';
import { CustomerExperienceSDK } from './sdk';

export interface CustomerExperienceOptions {
  clock?: Clock;
  operator?: string;
  security?: SecurityPlatform;
  commercial?: CommercialPlatform;
  release?: ReleasePlatform;
  customerDeployment?: CustomerDeploymentPlatform;
  operations?: OperationsPlatform;
  workplace?: WorkplacePlatform;
  aiRuntime?: AiRuntime;
  reliability?: ReliabilityPlatform;
  production?: ProductionPlatform;
}

export interface CustomerExperience {
  version: string;
  targetDomain: string;
  portal(): CustomerPortal;
  auth(): AuthenticationRuntime;
  licensing(): LicensingRuntime;
  billing(): BillingPlatform;
  downloads(): DownloadCenter;
  updates(): UpdateRuntime;
  onboarding(): OnboardingWizardRuntime;
  documentation(): DocumentationCenter;
  support(): SupportPortal;
  customerSuccess(): CustomerSuccessCenter;
  website(): WebsitePlatform;
  marketing(): MarketingAssets;
  analytics(): CustomerAnalytics;
  communications(): CustomerCommunications;
  sdk(): CustomerExperienceSDK;
  governance(): CustomerExperienceGovernance;
  // reuse + honesty accessors
  reusedPlatformCount(): number;
  infrastructurePendingCaps(): readonly InfrastructurePendingCap[];
  matrix(): CapabilityEvidence[];
  readiness(): CxReadiness;
}

export function createCustomerExperience(runtime: EnterpriseRuntime, options: CustomerExperienceOptions = {}): CustomerExperience {
  const clock = options.clock ?? systemClock;
  const operator = options.operator ?? 'cx-runtime';
  const ctx: CxContext = {
    ...(options.security ? { security: options.security } : {}),
    ...(options.commercial ? { commercial: options.commercial } : {}),
    ...(options.release ? { release: options.release } : {}),
    ...(options.customerDeployment ? { customerDeployment: options.customerDeployment } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
    ...(options.aiRuntime ? { aiRuntime: options.aiRuntime } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
    ...(options.production ? { production: options.production } : {}),
  };

  const gov = new CustomerExperienceGovernance(runtime, clock);
  const auth = new AuthenticationRuntime(ctx, gov, operator);
  const portal = new CustomerPortal({ auth }, gov, operator);
  const licensing = new LicensingRuntime(ctx, gov, operator);
  const billing = new BillingPlatform(gov, operator);
  const downloads = new DownloadCenter(ctx, gov, operator);
  const updates = new UpdateRuntime(ctx, { downloads }, gov, operator);
  const onboarding = new OnboardingWizardRuntime(ctx, gov, operator);
  const documentation = new DocumentationCenter(ctx, gov, operator);
  const support = new SupportPortal(ctx, gov, operator);
  const customerSuccess = new CustomerSuccessCenter(ctx, gov, operator);
  const website = new WebsitePlatform(gov, operator);
  const marketing = new MarketingAssets(gov, operator);
  const analytics = new CustomerAnalytics({ auth, licensing, downloads });
  const communications = new CustomerCommunications(gov, operator);
  const sdk = new CustomerExperienceSDK();

  const reusedPlatformCount = Object.keys(ctx).length;

  return {
    version: CX_VERSION,
    targetDomain: TARGET_DOMAIN,
    portal: () => portal,
    auth: () => auth,
    licensing: () => licensing,
    billing: () => billing,
    downloads: () => downloads,
    updates: () => updates,
    onboarding: () => onboarding,
    documentation: () => documentation,
    support: () => support,
    customerSuccess: () => customerSuccess,
    website: () => website,
    marketing: () => marketing,
    analytics: () => analytics,
    communications: () => communications,
    sdk: () => sdk,
    governance: () => gov,
    reusedPlatformCount: () => reusedPlatformCount,
    infrastructurePendingCaps: () => INFRASTRUCTURE_PENDING_CAPS,
    matrix: () => CX_MATRIX,
    readiness: () => cxReadiness(),
  };
}
