/**
 * Sprint 5 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model).
 * Evidence is NEVER promoted without a real, executed basis:
 *   live-verified          — the in-process deployment runtimes that really execute: the customer/
 *                            tenant/deployment lifecycle, onboarding, configuration, migration
 *                            planning/dry-run, user provisioning, workspace + AI-workforce activation,
 *                            operational acceptance (reused end-to-end), UAT, monitoring, hypercare,
 *                            customer success math, the readiness gate, rollback, governance, runbooks,
 *                            the pilot-profile engine, and the SDK.
 *   adapter-verified       — the customer's external systems: identity providers and ERP/CRM/HR/
 *                            finance/manufacturing/healthcare/collaboration platforms; represented and
 *                            active only after credentials AND verification.
 *   business-data-pending  — real customer production users, transactions, AI usage, adoption metrics,
 *                            and business KPIs; never imported or fabricated.
 *   infrastructure-pending — the customer's own production infrastructure: networking, VPNs,
 *                            certificates, and production databases; represented until provided.
 * A test asserts that no adapter, business-data, or infrastructure capability is ever classified live.
 */
import type { DeploymentEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: DeploymentEvidenceLevel;
  note: string;
}

export const CUSTOMER_DEPLOYMENT_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process runtimes that really execute ──
  { capability: 'Customer Deployment Runtime', epic: 'E1', level: 'live-verified', note: 'Customer/tenant/environment registries + governed lifecycle; illegal transitions rejected.' },
  { capability: 'Tenant Lifecycle', epic: 'E1', level: 'live-verified', note: 'Tenant + environment creation with a real deployment history.' },
  { capability: 'Deployment Workflows', epic: 'E1', level: 'live-verified', note: 'registered→…→deployed reached only by explicit gated transitions.' },
  { capability: 'Customer Onboarding', epic: 'E2', level: 'live-verified', note: 'Domain/branding/localization + default roles really created in the reused security platform.' },
  { capability: 'Enterprise Configuration', epic: 'E3', level: 'live-verified', note: 'Business/industry/AI/workspace/identity/storage config applied as real state.' },
  { capability: 'Data Migration Planning', epic: 'E6', level: 'live-verified', note: 'Planning/validation/dry-run over real sample records; migrated data never fabricated.' },
  { capability: 'User Provisioning', epic: 'E7', level: 'live-verified', note: 'Real identity, role, verified permission, and issued license via reused platforms.' },
  { capability: 'Workspace Activation', epic: 'E8', level: 'live-verified', note: 'Dashboards/workspaces activated against the reused workplace runtime.' },
  { capability: 'AI Workforce Activation', epic: 'E9', level: 'live-verified', note: 'Only licensed workers registered in the reused workforce platform.' },
  { capability: 'Operational Acceptance Testing', epic: 'E10', level: 'live-verified', note: 'Reuses the Sprint-4 end-to-end validation for real cross-subsystem workflow evidence.' },
  { capability: 'UAT Runtime', epic: 'E11', level: 'live-verified', note: 'Plans/cases/issues + sign-off workflow; approval never fabricated.' },
  { capability: 'Customer Monitoring Runtime', epic: 'E12', level: 'live-verified', note: 'Health reuses the operations overview; usage metrics reported only when real.' },
  { capability: 'Hypercare Runtime', epic: 'E13', level: 'live-verified', note: 'Reuses operations incidents (open→ack→resolve) and reused SLOs for SLA.' },
  { capability: 'Customer Success Runtime', epic: 'E14', level: 'live-verified', note: 'Adoption/health math over real usage; null score with no data.' },
  { capability: 'Production Readiness Gate', epic: 'E19', level: 'live-verified', note: 'Evidence-based Go/No-Go via the reused RC gate + readiness scoring; ga=false.' },
  { capability: 'Rollback & Recovery', epic: 'E18', level: 'live-verified', note: 'Real rolled-back transition; recovery verified via the reused Sprint-4 engine.' },
  { capability: 'Deployment Governance', epic: 'E15', level: 'live-verified', note: 'Every operation audited on the one hash-chained ledger with a replay id.' },
  { capability: 'Operations Runbooks', epic: 'E16', level: 'live-verified', note: 'Seven guides; reuses the reliability documentation generator for overlapping kinds.' },
  { capability: 'Pilot Profile Engine', epic: 'E17', level: 'live-verified', note: 'Relife Ortho as configuration data; generic for any enterprise; no proprietary data.' },
  // ── Adapter-verified — the customer's external systems, until configured + verified ──
  { capability: 'Identity providers', epic: 'E4', level: 'adapter-verified', note: 'Entra/Google/Okta/LDAP/AD/OIDC/SAML represented; active after credentials + verification.' },
  { capability: 'ERP systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; active only with customer credentials AND verification.' },
  { capability: 'CRM systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; active only with customer credentials AND verification.' },
  { capability: 'Manufacturing systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; no industrial equipment operated.' },
  { capability: 'Healthcare systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; no live medical record accessed or fabricated.' },
  { capability: 'HR systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; active only with customer credentials AND verification.' },
  { capability: 'Finance systems', epic: 'E5', level: 'adapter-verified', note: 'Represented; no real payment processed.' },
  { capability: 'Collaboration platforms', epic: 'E5', level: 'adapter-verified', note: 'Represented; active only with customer credentials AND verification.' },
  // ── Business-data-pending — real customer production data; never fabricated ──
  { capability: 'Customer production users', epic: 'E7', level: 'business-data-pending', note: 'Provisioning is real, but real end-users arrive with the customer’s go-live.' },
  { capability: 'Customer production transactions', epic: 'E5', level: 'business-data-pending', note: 'No real customer transaction is imported or processed here.' },
  { capability: 'AI usage', epic: 'E9', level: 'business-data-pending', note: 'Real AI usage metrics require live production traffic; none is fabricated.' },
  { capability: 'Adoption metrics', epic: 'E14', level: 'business-data-pending', note: 'Adoption/health scored only from real supplied usage; null with no data.' },
  { capability: 'Business KPIs', epic: 'E14', level: 'business-data-pending', note: 'Customer KPIs require real production usage; never invented.' },
  // ── Infrastructure-pending — the customer's own production infrastructure ──
  { capability: 'Customer production infrastructure', epic: 'E1', level: 'infrastructure-pending', note: 'Deployment represented; real customer clusters are provisioned by the customer.' },
  { capability: 'Customer networking', epic: 'E4', level: 'infrastructure-pending', note: 'Customer network topology represented until provided.' },
  { capability: 'Customer VPNs', epic: 'E5', level: 'infrastructure-pending', note: 'Private network connectivity represented; none established here.' },
  { capability: 'Customer certificates', epic: 'E4', level: 'infrastructure-pending', note: 'Customer TLS/mTLS certificates are the customer’s; none issued here.' },
  { capability: 'Customer production databases', epic: 'E6', level: 'infrastructure-pending', note: 'Target databases represented; no external database is connected.' },
];

export interface DeploymentReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function deploymentReadiness(matrix: CapabilityEvidence[] = CUSTOMER_DEPLOYMENT_MATRIX): DeploymentReadiness {
  const by = (l: DeploymentEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 8
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 5
