/**
 * @neuropause/commercial — NeuroPause Enterprise Management System, Wave 13: the Enterprise
 * Commercial Platform. The layer that makes NEMS a purchasable, multi-tenant SaaS product —
 * customers, tenants, onboarding, licensing, subscriptions, usage, feature flags, white-labeling,
 * deployment, upgrades, marketplace commerce, customer administration, customer success, support,
 * observability, analytics, billing, and an SDK — by COMPOSING Waves 1–12 (unchanged) on the
 * existing runtime, audit chain, event bus, federation, cloud-ops, business, and operations planes.
 *
 * HONESTY BOUNDARY (see COMMERCIAL_MATRIX):
 *   live-verified          — commercial runtime/tenants/onboarding/licensing/subscriptions/usage/
 *                            feature-flags/white-label/deployment/upgrade/marketplace-commerce/
 *                            administration/customer-success/support/observability/SDK/governance.
 *   adapter-verified       — Stripe/Razorpay/PayPal/Azure/AWS/GCP marketplaces (until configured).
 *   business-data-pending  — customers, revenue, contracts, billing, renewals, usage — never fabricated.
 *   regulated-external     — live payment settlement, tax remittance, marketplace payouts, banking
 *                            reconciliation — represented only, never executed.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './adapters';
export * from './runtime';
export * from './multiTenant';
export * from './onboarding';
export * from './licensing';
export * from './subscriptions';
export * from './usage';
export * from './featureFlags';
export * from './whiteLabel';
export * from './deployment';
export * from './upgrade';
export * from './commerce';
export * from './customerAdmin';
export * from './customerSuccess';
export * from './support';
export * from './observability';
export * from './analytics';
export * from './billing';
export * from './sdk';
export * from './evidence';
export * from './platform';
