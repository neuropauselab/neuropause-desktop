/**
 * Wave 13 composition root. `createCommercialPlatform(runtime, …)` assembles the enterprise
 * commercial layer on the EXISTING platform: it reuses the one runtime audit chain + event bus
 * (commercial governance), and — when provided — the Wave 6 federation (multi-tenancy + marketplace),
 * Wave 7 cloud-ops (deployment), Wave 8 business (customer success), the operations base package
 * (observability), and Wave 9/10/11 industry/workplace/workforce (onboarding), plus the Wave 5
 * execution platform (reused connector count). No subsystem is duplicated. Exposes the commercial
 * API surface, the evidence matrix, and readiness. Live payment settlement, tax remittance,
 * marketplace payouts, and banking reconciliation are represented only — never executed.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { ExecutionPlatform } from '@neuropause/execution';
import { COMMERCIAL_VERSION, REGULATED_COMMERCE, type RegulatedCommerce } from './constants';
import { COMMERCIAL_MATRIX, commercialReadiness, type CapabilityEvidence, type CommercialReadiness } from './evidence';
import type { CommercialContext, FederationPlatform, CloudOpsPlatform, BusinessPlatform, OperationsPlatform, WorkforcePlatform, IndustryPlatform, WorkplacePlatform } from './types';
import { CommercialGovernance } from './governance';
import { PaymentAdapterRegistry } from './adapters';
import { CommercialRuntime } from './runtime';
import { MultiTenantPlatform } from './multiTenant';
import { CustomerOnboarding } from './onboarding';
import { LicensingPlatform } from './licensing';
import { SubscriptionPlatform } from './subscriptions';
import { UsageMetering } from './usage';
import { FeatureFlagPlatform } from './featureFlags';
import { WhiteLabelPlatform } from './whiteLabel';
import { CommercialDeploymentManager } from './deployment';
import { UpgradeManager } from './upgrade';
import { MarketplaceCommerce } from './commerce';
import { CustomerAdministration } from './customerAdmin';
import { CustomerSuccessPlatform } from './customerSuccess';
import { SupportPlatform } from './support';
import { CommercialObservability } from './observability';
import { CommercialAnalytics } from './analytics';
import { BillingRuntime } from './billing';
import { CommercialSDK } from './sdk';

export interface CommercialPlatformOptions {
  clock?: Clock;
  federation?: FederationPlatform;
  cloudops?: CloudOpsPlatform;
  business?: BusinessPlatform;
  operations?: OperationsPlatform;
  workforce?: WorkforcePlatform;
  industry?: IndustryPlatform;
  workplace?: WorkplacePlatform;
  execution?: ExecutionPlatform;
}

export interface CommercialPlatform {
  version: string;
  // commercial API surface (M1–M18)
  runtime(): CommercialRuntime;
  customers(): CommercialRuntime;
  tenants(): MultiTenantPlatform;
  onboarding(): CustomerOnboarding;
  licenses(): LicensingPlatform;
  subscriptions(): SubscriptionPlatform;
  usage(): UsageMetering;
  features(): FeatureFlagPlatform;
  whiteLabel(): WhiteLabelPlatform;
  deployments(): CommercialDeploymentManager;
  upgrades(): UpgradeManager;
  marketplace(): MarketplaceCommerce;
  administration(): CustomerAdministration;
  customerSuccess(): CustomerSuccessPlatform;
  support(): SupportPlatform;
  observability(): CommercialObservability;
  analytics(): CommercialAnalytics;
  billing(): BillingRuntime;
  sdk(): CommercialSDK;
  adapters(): PaymentAdapterRegistry;
  governance(): CommercialGovernance;
  // reuse + honesty accessors
  regulatedOperations(): readonly RegulatedCommerce[];
  reusedConnectorCount(): number;
  matrix(): CapabilityEvidence[];
  readiness(): CommercialReadiness;
}

export function createCommercialPlatform(runtime: EnterpriseRuntime, options: CommercialPlatformOptions = {}): CommercialPlatform {
  const clock = options.clock ?? systemClock;
  const ctx: CommercialContext = {
    ...(options.federation ? { federation: options.federation } : {}),
    ...(options.cloudops ? { cloudops: options.cloudops } : {}),
    ...(options.business ? { business: options.business } : {}),
    ...(options.operations ? { operations: options.operations } : {}),
    ...(options.workforce ? { workforce: options.workforce } : {}),
    ...(options.industry ? { industry: options.industry } : {}),
    ...(options.workplace ? { workplace: options.workplace } : {}),
  };

  const governance = new CommercialGovernance(runtime, clock);
  const adapters = new PaymentAdapterRegistry(governance);

  const commercialRuntime = new CommercialRuntime(clock, governance);
  const tenants = new MultiTenantPlatform(governance, ctx);
  const onboarding = new CustomerOnboarding(clock, governance, ctx);
  const licensing = new LicensingPlatform(clock, governance);
  const subscriptions = new SubscriptionPlatform(clock, governance);
  const usage = new UsageMetering(governance);
  const features = new FeatureFlagPlatform(clock, governance);
  const whiteLabel = new WhiteLabelPlatform(clock, governance);
  const deployments = new CommercialDeploymentManager(clock, governance, ctx);
  const upgrades = new UpgradeManager(clock, governance);
  const marketplace = new MarketplaceCommerce(clock, governance, ctx);
  const administration = new CustomerAdministration(clock, governance);
  const customerSuccess = new CustomerSuccessPlatform(ctx, { subscriptions, usage, licensing });
  const support = new SupportPlatform(clock, governance);
  const observability = new CommercialObservability(ctx, commercialRuntime, usage);
  const analytics = new CommercialAnalytics({ runtime: commercialRuntime, subscriptions, licensing, usage });
  const billing = new BillingRuntime(clock, governance);
  const sdk = new CommercialSDK(clock, governance);

  return {
    version: COMMERCIAL_VERSION,
    runtime: () => commercialRuntime,
    customers: () => commercialRuntime,
    tenants: () => tenants,
    onboarding: () => onboarding,
    licenses: () => licensing,
    subscriptions: () => subscriptions,
    usage: () => usage,
    features: () => features,
    whiteLabel: () => whiteLabel,
    deployments: () => deployments,
    upgrades: () => upgrades,
    marketplace: () => marketplace,
    administration: () => administration,
    customerSuccess: () => customerSuccess,
    support: () => support,
    observability: () => observability,
    analytics: () => analytics,
    billing: () => billing,
    sdk: () => sdk,
    adapters: () => adapters,
    governance: () => governance,
    regulatedOperations: () => REGULATED_COMMERCE,
    reusedConnectorCount: () => options.execution?.connectors().count() ?? 0,
    matrix: () => COMMERCIAL_MATRIX,
    readiness: () => commercialReadiness(),
  };
}
