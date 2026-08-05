/**
 * Wave 13 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — commercial runtime + customer/tenant registry, multi-tenant platform
 *                            (reuses federation), onboarding (reuses workplace/workforce/industry),
 *                            licensing (real seat enforcement), subscription representation, usage
 *                            metering, feature flags, white-label, the deployment manager (reuses
 *                            cloud-ops), the upgrade manager, marketplace commerce (reuses the
 *                            federation marketplace), customer administration, customer success
 *                            (reuses business churn), the support platform, observability (reuses
 *                            operations), the SDK, and governance — all executed in-process.
 *   adapter-verified       — Stripe / Razorpay / PayPal and the Azure / AWS / Google Cloud
 *                            marketplaces; represented until configured, never charged here.
 *   business-data-pending  — customers, revenue (MRR/ARR), contracts, billing/invoices, renewals,
 *                            and usage; all start empty and analytics show real data only.
 *   regulated-external     — live payment settlement, tax remittance, marketplace payouts, and
 *                            banking reconciliation; represented only, never executed.
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified, and
 * that every regulated financial operation appears exactly once as regulated-external.
 */
import type { EvidenceLevel } from './types';
import { REGULATED_COMMERCE, PAYMENT_ADAPTER_CATALOG } from './constants';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const COMMERCIAL_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — executed in-process, through the one runtime and governance ──
  { capability: 'Commercial Runtime + Customer/Tenant Registry', module: 'M1', level: 'live-verified', note: 'Customers/tenants/context governed on the one audit chain; starts empty.' },
  { capability: 'Multi-Tenant Platform', module: 'M2', level: 'live-verified', note: 'Regions, org linking, and per-tenant isolated storage; REUSES the Wave 6 federation.' },
  { capability: 'Customer Onboarding', module: 'M3', level: 'live-verified', note: 'Wizard REUSES workplace (workspace), workforce (AI agents), industry (packs) — real when connected.' },
  { capability: 'Licensing Platform', module: 'M4', level: 'live-verified', note: 'Seat/AI-worker/industry/feature/enterprise/trial licenses; seat capacity really enforced.' },
  { capability: 'Subscription Platform (represented)', module: 'M5', level: 'live-verified', note: 'Plans/renewals/upgrades/suspension; represented — no card charged; MRR/ARR from real records.' },
  { capability: 'Usage Metering', module: 'M6', level: 'live-verified', note: 'Real per-tenant counters for AI/storage/API/workflows/documents/activity/automation; 0 when unused.' },
  { capability: 'Feature Flag Platform', module: 'M7', level: 'live-verified', note: 'Flags/canary/beta with deterministic org→env→default override resolution.' },
  { capability: 'White Label Platform', module: 'M8', level: 'live-verified', note: 'Per-tenant logo/theme/colors/fonts/login/domain/email templates; unset stays unset.' },
  { capability: 'Deployment Manager', module: 'M9', level: 'live-verified', note: 'Cloud/on-prem/hybrid/edge targets; REUSES the Wave 7 cloud-ops plane for real infrastructure.' },
  { capability: 'Upgrade Manager', module: 'M10', level: 'live-verified', note: 'Version registry/migration/rollback; compatibility really validated against the registry.' },
  { capability: 'Marketplace Commerce', module: 'M11', level: 'live-verified', note: 'Purchase packs/workers/templates/extensions; REUSES the Wave 6 federation marketplace to install.' },
  { capability: 'Customer Administration', module: 'M12', level: 'live-verified', note: 'Orgs/users/roles/contacts/security/regional settings; governed on the one chain.' },
  { capability: 'Customer Success Platform', module: 'M13', level: 'live-verified', note: 'Health/adoption/renewals/expansion from real signals; REUSES Wave 8 churn risk when linked.' },
  { capability: 'Support Platform', module: 'M14', level: 'live-verified', note: 'Tickets/cases/timeline/SLA; SLA computed from real timestamps.' },
  { capability: 'Commercial Observability', module: 'M15', level: 'live-verified', note: 'Tenant/platform health, usage, capacity; REUSES the operations base incident registry.' },
  { capability: 'Commercial SDK', module: 'M18', level: 'live-verified', note: 'Register extensions/licensing/billing/marketplace/integrations; each must reuse ≥1 capability.' },
  { capability: 'Commercial Governance', module: 'M19', level: 'live-verified', note: 'Every commercial action records actor/org/tenant/evidence/approval/replay id on the one chain.' },
  // ── Adapter-verified — external payment / marketplace-billing providers, until configured ──
  { capability: 'Stripe', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no charge performed here.' },
  { capability: 'Razorpay', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no charge performed here.' },
  { capability: 'PayPal', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no charge performed here.' },
  { capability: 'Azure Marketplace', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no billing performed here.' },
  { capability: 'AWS Marketplace', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no billing performed here.' },
  { capability: 'Google Cloud Marketplace', module: 'M19', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no billing performed here.' },
  // ── Business-data-pending — real commercial content; starts empty; never fabricated ──
  { capability: 'Customers', module: 'M1', level: 'business-data-pending', note: 'Empty until real customers are registered.' },
  { capability: 'Revenue (MRR/ARR)', module: 'M16', level: 'business-data-pending', note: 'Computed from real subscriptions; "No commercial data available" until they exist.' },
  { capability: 'Contracts', module: 'M5', level: 'business-data-pending', note: 'Enterprise contracts are represented; none exist until real ones are created.' },
  { capability: 'Billing / invoices', module: 'M17', level: 'business-data-pending', note: 'Invoices are represented (no charge); revenue pending real settlement.' },
  { capability: 'Renewals', module: 'M13', level: 'business-data-pending', note: 'Tracked from real subscription state; empty until subscriptions exist.' },
  { capability: 'Usage', module: 'M6', level: 'business-data-pending', note: 'Meters read real recorded usage; 0 until real activity occurs.' },
  // ── Regulated-external — represented only, never executed ──
  { capability: 'Live payment settlement', module: 'M17/M19', level: 'regulated-external', note: 'Represented only. Requires a configured PSP + authorization; never charged/captured here.' },
  { capability: 'Tax remittance', module: 'M17/M19', level: 'regulated-external', note: 'Represented only. Requires a tax authority + filing; never remitted autonomously.' },
  { capability: 'Marketplace payouts', module: 'M11/M19', level: 'regulated-external', note: 'Represented only. Requires a marketplace/bank rail; never paid out here.' },
  { capability: 'Banking reconciliation', module: 'M17/M19', level: 'regulated-external', note: 'Represented only. Requires bank statements + ledger authority; never reconciled autonomously.' },
];

export interface CommercialReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function commercialReadiness(matrix: CapabilityEvidence[] = COMMERCIAL_MATRIX): CommercialReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = PAYMENT_ADAPTER_CATALOG.length;
export const REGULATED_OPERATIONS = REGULATED_COMMERCE;
