/**
 * Wave 9 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — Industry SDK, 20 solution packs, configuration engine, low-code
 *                            builders, industry copilots (reusing Enterprise AI), compliance-pack
 *                            models, and analytics KPI computation — executed in-process
 *   adapter-verified       — connector marketplace (SAP/Oracle/Epic/Shopify/Stripe/…), adapter-
 *                            verified until a tenant configures real credentials
 *   business-data-pending  — real industry data (patients/students/policies/shipments/subscribers/
 *                            …); registries start empty and are never fabricated
 *   regulated-external     — FDA/GMP/GLP submissions, medical-device & pharma regulatory filings,
 *                            real EHR/PHI, AML/KYC screening, government permit issuance, payment
 *                            settlement, airworthiness sign-off, and certification
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  area: string;
  level: EvidenceLevel;
  note: string;
}

export const INDUSTRY_MATRIX: CapabilityEvidence[] = [
  // Live-verified — executed in-process
  { capability: 'Industry SDK (register / activate)', area: 'SDK', level: 'live-verified', note: 'Register objects/workflows/forms/dashboards/KPIs/compliance/connectors; activate per tenant.' },
  { capability: '20 Industry Solution Packs', area: 'Verticals', level: 'live-verified', note: 'Each pack composes on Wave 8 domains — no duplicated business logic.' },
  { capability: 'Universal Configuration Engine', area: 'Config', level: 'live-verified', note: 'Branding, permissions, business rules, custom fields, approval policies — data, no code change.' },
  { capability: 'Multi-Tenant Configuration', area: 'Config', level: 'live-verified', note: 'Industry / country / language / currency / compliance packs per tenant.' },
  { capability: 'Low-Code Platform (7 builders)', area: 'Low-code', level: 'live-verified', note: 'Object/form/workflow/report/dashboard/automation/document definitions in-process.' },
  { capability: 'Industry AI Copilots', area: 'AI', level: 'live-verified', note: 'Reuse the Wave 8 Enterprise AI; grounded in real objects; "No business data available" when empty.' },
  { capability: 'Compliance Pack Library', area: 'Compliance', level: 'live-verified', note: 'ISO 9001/13485, HIPAA, GDPR, SOC 2, PCI-DSS, FDA, GMP, GLP — frameworks represented, never certified.' },
  { capability: 'Industry Analytics (KPI compute)', area: 'Analytics', level: 'live-verified', note: 'KPIs computed over real business data — 0 / "No business data available" when empty.' },
  { capability: 'Industry Governance', area: 'Governance', level: 'live-verified', note: 'Every industry operation audited on the one runtime chain with a replay id and evidence.' },
  // Adapter-verified — external systems, adapter-verified until configured
  { capability: 'ERP connectors (SAP / Oracle / Dynamics)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until a tenant configures real credentials.' },
  { capability: 'CRM connector (Salesforce)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until configured.' },
  { capability: 'Healthcare connectors (Epic / Cerner)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until configured; never executed against a real EHR.' },
  { capability: 'Commerce connectors (Shopify / WooCommerce)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until configured.' },
  { capability: 'Payment connectors (Stripe / Razorpay)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until configured; no money moves.' },
  { capability: 'Accounting / HR connectors (QuickBooks / Xero / Workday / ADP)', area: 'Marketplace', level: 'adapter-verified', note: 'Adapter-verified until configured.' },
  // Business-data-pending — real industry data; registries start empty
  { capability: 'Patients / clinical records (healthcare)', area: 'Data', level: 'business-data-pending', note: 'Empty until real (synthetic-only) data is entered.' },
  { capability: 'Customers / orders (retail, banking, insurance)', area: 'Data', level: 'business-data-pending', note: 'Empty until real customers/orders exist.' },
  { capability: 'Students / faculty (education)', area: 'Data', level: 'business-data-pending', note: 'Empty until real enrolment data exists.' },
  { capability: 'Shipments / fleet (logistics)', area: 'Data', level: 'business-data-pending', note: 'Empty until real shipments are recorded.' },
  { capability: 'Subscribers / tickets (telecom)', area: 'Data', level: 'business-data-pending', note: 'Empty until real subscribers exist.' },
  { capability: 'Properties / leases (real estate, hospitality)', area: 'Data', level: 'business-data-pending', note: 'Empty until real properties are registered.' },
  { capability: 'Cases / engagements (government, professional services)', area: 'Data', level: 'business-data-pending', note: 'Empty until real cases/engagements exist.' },
  // Regulated-external — requires regulated infrastructure/authority; never executed
  { capability: 'FDA / GMP / GLP submissions', area: 'Regulated', level: 'regulated-external', note: 'Requires government/agency systems. Documentation prepared, never submitted.' },
  { capability: 'Medical-device regulatory filing (UDI / CAPA)', area: 'Regulated', level: 'regulated-external', note: 'Requires regulatory bodies. Represented, never filed.' },
  { capability: 'Pharma batch release', area: 'Regulated', level: 'regulated-external', note: 'Requires a qualified person + regulated release. Never executed.' },
  { capability: 'Real EHR / PHI (healthcare)', area: 'Regulated', level: 'regulated-external', note: 'Requires a certified EHR. Never connected; no real PHI.' },
  { capability: 'AML / KYC screening (banking)', area: 'Regulated', level: 'regulated-external', note: 'Requires regulated screening providers. Assisted, never performed.' },
  { capability: 'Government permit issuance / benefits', area: 'Regulated', level: 'regulated-external', note: 'Requires government authority. Represented, never issued.' },
  { capability: 'Payment settlement / bank transfers', area: 'Regulated', level: 'regulated-external', note: 'Requires bank rails + credentials. Never settled.' },
  { capability: 'Airworthiness / vehicle regulatory sign-off', area: 'Regulated', level: 'regulated-external', note: 'Requires accredited authorities. Never signed off.' },
  { capability: 'Compliance certification', area: 'Regulated', level: 'regulated-external', note: 'Requires an accredited external auditor. Readiness tracked, certification never claimed.' },
];

export interface IndustryReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function industryReadiness(matrix: CapabilityEvidence[] = INDUSTRY_MATRIX): IndustryReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}
