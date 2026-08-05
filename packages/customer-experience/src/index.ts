/**
 * @neuropause/customer-experience — NeuroPause Enterprise Management System, Launch Workstream 2:
 * Customer Experience & Commercial Platform.
 *
 * An additive package that composes Waves 1-14, Sprints 1-6, and Launch Workstream 1, unchanged, into
 * the complete commercial customer-experience layer: portal, authentication + organization, licensing,
 * billing, desktop downloads, automatic updates, onboarding, documentation, support, customer success,
 * website, marketing, analytics, communications, and governance. The customer portal, authentication,
 * license, download, update, onboarding, documentation, support, and governance runtimes are LIVE-
 * VERIFIED in-process; Stripe/Razorpay/email-providers/Google/Microsoft login are ADAPTER-VERIFIED;
 * customer signups/active-customers/revenue/renewal/adoption are BUSINESS-DATA-PENDING; and public
 * website deployment, the production download CDN, payment-gateway credentials, and email-delivery
 * infrastructure are INFRASTRUCTURE-PENDING. No real signup, successful payment, deployed website,
 * delivered email, or public download CDN is ever claimed. Every operation is audited on the one chain.
 */
export * from './constants';
export * from './types';
export * from './governance';
export * from './auth';
export * from './portal';
export * from './licensing';
export * from './billing';
export * from './downloads';
export * from './updates';
export * from './onboarding';
export * from './documentation';
export * from './support';
export * from './customerSuccess';
export * from './website';
export * from './marketing';
export * from './analytics';
export * from './communications';
export * from './sdk';
export * from './evidence';
export * from './platform';
