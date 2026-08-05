/**
 * Launch Workstream 2 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14
 * model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process customer-experience runtimes: the portal, authentication +
 *                            organization runtime, license runtime, billing registry, download registry,
 *                            update runtime, onboarding wizard, documentation center, support portal,
 *                            customer success, website content registry, marketing registry, analytics,
 *                            communications composer, and governance.
 *   adapter-verified       — external services: Stripe, Razorpay, email providers, and Google/Microsoft
 *                            login; represented until configured.
 *   business-data-pending  — real customer signups, active customers, revenue, renewal metrics, and
 *                            customer adoption; never fabricated.
 *   infrastructure-pending — the public website deployment, the production download CDN, payment-gateway
 *                            credentials, and email-delivery infrastructure; represented until they exist.
 * A test asserts no adapter, business-data, or infrastructure capability is ever classified live, and
 * that no payment is ever marked successful, no email delivered, and the website not publicly live.
 */
import type { CxEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: CxEvidenceLevel;
  note: string;
}

export const CX_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process customer-experience runtimes ──
  { capability: 'Customer Portal', epic: 'E1', level: 'live-verified', note: 'Dashboards + notifications + activity timeline from real in-process state.' },
  { capability: 'Authentication Runtime', epic: 'E2', level: 'live-verified', note: 'Real signup/verify/login/MFA via the reused security platform.' },
  { capability: 'Organization Runtime', epic: 'E2', level: 'live-verified', note: 'Real org creation, member invites, and team membership.' },
  { capability: 'License Runtime', epic: 'E3', level: 'live-verified', note: 'Four tiers via the reused release + commercial licensing; real seats.' },
  { capability: 'Billing Registry', epic: 'E4', level: 'live-verified', note: 'Subscription/invoice/payment registries; a payment is NEVER marked successful.' },
  { capability: 'Download Registry', epic: 'E5', level: 'live-verified', note: 'Installer descriptors with real checksums from the reused packaging.' },
  { capability: 'Update Runtime', epic: 'E6', level: 'live-verified', note: 'Version check + verification + rollback (reused release + reliability).' },
  { capability: 'Onboarding Wizard', epic: 'E7', level: 'live-verified', note: 'Checklist complete ONLY when every step is done; never fabricated.' },
  { capability: 'Documentation Center', epic: 'E8', level: 'live-verified', note: 'Reuses the release documentation generator for overlapping items.' },
  { capability: 'Support Portal', epic: 'E9', level: 'live-verified', note: 'Tickets reuse operations incidents; knowledge search; feedback.' },
  { capability: 'Customer Success', epic: 'E10', level: 'live-verified', note: 'Health/adoption from real usage; null with no data.' },
  { capability: 'Website Content Registry', epic: 'E11', level: 'live-verified', note: 'Pages represented in-process; the site is NOT publicly live.' },
  { capability: 'Marketing Asset Registry', epic: 'E12', level: 'live-verified', note: 'Asset registries; represented until produced + published.' },
  { capability: 'Customer Analytics', epic: 'E13', level: 'live-verified', note: 'Measured in-process counts; production metrics reported pending.' },
  { capability: 'Customer Communications', epic: 'E14', level: 'live-verified', note: 'Emails composed in-process; delivery represented (never sent).' },
  { capability: 'Governance', epic: 'E15', level: 'live-verified', note: 'Every customer operation audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external services, until configured ──
  { capability: 'Stripe', epic: 'E4', level: 'adapter-verified', note: 'Represented; a real charge requires configured gateway credentials.' },
  { capability: 'Razorpay', epic: 'E4', level: 'adapter-verified', note: 'Represented; a real charge requires configured gateway credentials.' },
  { capability: 'Email Providers', epic: 'E14', level: 'adapter-verified', note: 'Represented; email delivery requires a configured provider.' },
  { capability: 'Google Login', epic: 'E2', level: 'adapter-verified', note: 'External IdP represented until configured + verified.' },
  { capability: 'Microsoft Login', epic: 'E2', level: 'adapter-verified', note: 'External IdP represented until configured + verified.' },
  // ── Business-data-pending — real commercial data; never fabricated ──
  { capability: 'Customer Signups', epic: 'E13', level: 'business-data-pending', note: 'Real production customer signups require the live site; none claimed.' },
  { capability: 'Active Customers', epic: 'E13', level: 'business-data-pending', note: 'Real active customers require production usage; never fabricated.' },
  { capability: 'Revenue', epic: 'E4', level: 'business-data-pending', note: 'No revenue is recorded or claimed; no payment succeeds here.' },
  { capability: 'Renewal Metrics', epic: 'E10', level: 'business-data-pending', note: 'Renewal figures require real contracts + usage; not fabricated.' },
  { capability: 'Customer Adoption', epic: 'E10', level: 'business-data-pending', note: 'Adoption requires real production usage; null with no data.' },
  // ── Infrastructure-pending — real launch infrastructure/credentials ──
  { capability: 'Public Website Deployment', epic: 'E11', level: 'infrastructure-pending', note: 'The site is NOT publicly live until deployed to real hosting.' },
  { capability: 'Production Download CDN', epic: 'E5', level: 'infrastructure-pending', note: 'Real public download distribution requires a configured CDN.' },
  { capability: 'Payment Gateway Credentials', epic: 'E4', level: 'infrastructure-pending', note: 'Real charges require configured Stripe/Razorpay credentials.' },
  { capability: 'Email Delivery Infrastructure', epic: 'E14', level: 'infrastructure-pending', note: 'Real email delivery requires a configured email provider + domain.' },
];

export interface CxReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function cxReadiness(matrix: CapabilityEvidence[] = CX_MATRIX): CxReadiness {
  const by = (l: CxEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 5
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 4
