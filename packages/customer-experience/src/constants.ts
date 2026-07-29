/**
 * Launch Workstream 2 constants. Isolated module (no imports). Enumerates the portal views, auth
 * methods, license tiers, billing providers, download targets, onboarding steps, documentation items,
 * website pages, marketing assets, analytics metrics, and email kinds — plus the catalog of EXTERNAL
 * services that stay adapter-verified until configured, and the launch infrastructure that stays
 * infrastructure-pending until it exists.
 *
 * HONESTY: this package is the customer-experience layer (software). It NEVER claims a real customer
 * signup, a successful payment, a deployed public website, a delivered email, or a public download
 * CDN — those are represented until the external services are configured and verified.
 */
export const CX_VERSION = '1.0.0-rc.1';

/** The intended public domain. REPRESENTED — the website is NOT publicly live until deployed. */
export const TARGET_DOMAIN = 'app.neuropause033.com';

/** The one honest answer customer analytics gives when no real data exists. */
export const NO_CUSTOMER_DATA = 'No customer data available';

/** EPIC 1 — customer portal views. */
export const PORTAL_VIEWS = ['landing', 'customer-dashboard', 'organization-dashboard', 'user-profile', 'account-settings', 'notification-center', 'activity-timeline'] as const;
export type PortalView = (typeof PORTAL_VIEWS)[number];

/** EPIC 2 — authentication methods. Google/Microsoft are external IdPs (adapter-verified). */
export const AUTH_METHODS = ['email', 'google', 'microsoft'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** EPIC 2 — signup/account lifecycle. 'verified' requires a real verification step, never assumed. */
export const ACCOUNT_STATUS = ['registered', 'verification-pending', 'verified', 'active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUS)[number];

/** EPIC 3 — commercial license tiers. */
export const LICENSE_TIERS = ['trial', 'community', 'professional', 'enterprise'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

/** EPIC 4 — billing providers. Represented; a real charge requires configured gateway credentials. */
export const BILLING_PROVIDERS = ['stripe', 'razorpay'] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

/** EPIC 4 — payment status. 'succeeded' is intentionally ABSENT — a real payment is never fabricated. */
export const PAYMENT_STATUS = ['represented', 'pending-gateway', 'requires-credentials', 'failed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

/** EPIC 5 — desktop download targets. */
export const DOWNLOAD_TARGETS = ['windows', 'macos', 'linux-appimage', 'linux-deb', 'linux-rpm'] as const;
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

/** EPIC 7 — onboarding wizard steps. */
export const ONBOARDING_STEPS = ['welcome', 'workspace-setup', 'ai-provider-setup', 'organization-config', 'first-project', 'invite-team'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** EPIC 8 — documentation center items. */
export const DOC_ITEMS = ['user-guide', 'quick-start', 'installation', 'faq', 'video-library', 'knowledge-base', 'api-links'] as const;
export type DocItem = (typeof DOC_ITEMS)[number];

/** EPIC 11 — website pages. Represented; the site is NOT publicly live until deployed. */
export const WEBSITE_PAGES = ['home', 'products', 'solutions', 'pricing', 'enterprise', 'downloads', 'documentation', 'blog', 'contact', 'login', 'signup'] as const;
export type WebsitePage = (typeof WEBSITE_PAGES)[number];

/** EPIC 12 — marketing asset kinds. Represented until published. */
export const MARKETING_ASSETS = ['product-screenshots', 'demo-videos', 'release-notes', 'feature-highlights', 'product-comparisons'] as const;
export type MarketingAsset = (typeof MARKETING_ASSETS)[number];

/** EPIC 13 — customer analytics metrics. Only measured data is reported. */
export const ANALYTICS_METRICS = ['signups', 'downloads', 'active-organizations', 'license-counts', 'installations', 'onboarding-completion'] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

/** EPIC 14 — customer email kinds. Delivery is represented until an email provider is configured. */
export const EMAIL_KINDS = ['welcome', 'password-reset', 'invitation', 'license', 'release-notification'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** The named external services tracked as rows in the evidence matrix. */
export const MATRIX_ADAPTERS = ['Stripe', 'Razorpay', 'Email Providers', 'Google Login', 'Microsoft Login'] as const;

/** Capabilities that require real launch infrastructure/credentials — represented until they exist. */
export const INFRASTRUCTURE_PENDING_CAPS = ['public-website-deployment', 'production-download-cdn', 'payment-gateway-credentials', 'email-delivery-infrastructure'] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
