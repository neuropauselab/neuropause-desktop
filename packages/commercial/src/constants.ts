/**
 * Wave 13 constants. Isolated module (no imports).
 */
export const COMMERCIAL_VERSION = '0.0.0-preview.1';

/** The one honest answer commercial analytics gives when no real data exists. */
export const NO_COMMERCIAL_DATA = 'No commercial data available';

/** Module 4 — license types. */
export const LICENSE_TYPES = ['seat', 'ai-worker', 'industry', 'feature', 'enterprise', 'trial'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

/** Module 5 — subscription plans (represented, never charged here). */
export const SUBSCRIPTION_PLANS = ['monthly', 'annual', 'enterprise-contract'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** Module 5 — subscription lifecycle states. */
export const SUBSCRIPTION_STATES = ['trialing', 'active', 'past-due', 'suspended', 'cancelled'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** Module 6 — usage meters. */
export const USAGE_METERS = ['ai-usage', 'storage', 'api-calls', 'workflows', 'documents', 'workspace-activity', 'automation-runs'] as const;
export type UsageMeter = (typeof USAGE_METERS)[number];

/** Module 2 — tenant lifecycle states. */
export const TENANT_STATES = ['provisioning', 'active', 'suspended', 'deprovisioned'] as const;
export type TenantState = (typeof TENANT_STATES)[number];

/** Module 9 — deployment targets. */
export const DEPLOYMENT_TARGETS = ['cloud', 'on-premise', 'hybrid', 'edge'] as const;
export type DeploymentTarget = (typeof DEPLOYMENT_TARGETS)[number];

/** Module 7 — feature-flag release stages. */
export const FEATURE_STAGES = ['ga', 'canary', 'beta'] as const;
export type FeatureStage = (typeof FEATURE_STAGES)[number];

/** Module 11 — marketplace-commerce item kinds. */
export const COMMERCE_KINDS = ['industry-pack', 'ai-worker', 'template', 'extension'] as const;
export type CommerceKind = (typeof COMMERCE_KINDS)[number];

/** Module 18 — commercial SDK extension kinds. */
export const COMMERCIAL_SDK_KINDS = ['commercial-extension', 'licensing-provider', 'billing-provider', 'marketplace-app', 'customer-integration'] as const;
export type CommercialSdkKind = (typeof COMMERCIAL_SDK_KINDS)[number];

/** Module 14 — support ticket states. */
export const SUPPORT_STATES = ['open', 'pending', 'resolved', 'closed'] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

/** Module 19 — external payment / marketplace-billing providers (adapter-verified). */
export const PAYMENT_ADAPTER_CATALOG: Array<{ system: string; category: string }> = [
  { system: 'Stripe', category: 'payment' },
  { system: 'Razorpay', category: 'payment' },
  { system: 'PayPal', category: 'payment' },
  { system: 'Azure Marketplace', category: 'marketplace-billing' },
  { system: 'AWS Marketplace', category: 'marketplace-billing' },
  { system: 'Google Cloud Marketplace', category: 'marketplace-billing' },
];

/** Regulated financial operations — represented only, never executed autonomously. */
export const REGULATED_COMMERCE = ['payment-settlement', 'tax-remittance', 'marketplace-payout', 'banking-reconciliation'] as const;
export type RegulatedCommerce = (typeof REGULATED_COMMERCE)[number];
