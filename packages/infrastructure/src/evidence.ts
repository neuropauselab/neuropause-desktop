/**
 * Sprint 2 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model).
 * Evidence is NEVER promoted without real running infrastructure:
 *   live-verified          — the in-process runtimes that really execute: infrastructure activation,
 *                            identity, authentication, authorization, monitoring, logging, telemetry
 *                            runtimes, governance, documentation, and the security policy set.
 *   adapter-verified       — AWS / Azure / GCP / DigitalOcean / Hetzner / VMware / Vault / Entra ID /
 *                            Google Workspace / Okta; represented until configured, never contacted.
 *   business-data-pending  — customer users, organizations, production usage, customer activity, and
 *                            operational / AI business metrics; empty until real environments run.
 *   infrastructure-pending — un-provisioned cloud resources, undeployed clusters, unconfigured DNS,
 *                            un-issued certificates, un-provisioned databases, and load balancers.
 * A test asserts no infrastructure and no adapter is classified live, and that the pending sets match
 * the declared catalogs exactly.
 */
import type { InfraEvidenceLevel } from './types';
import { PROVIDER_ADAPTER_CATALOG, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: InfraEvidenceLevel;
  note: string;
}

export const INFRA_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — in-process runtimes that really execute ──
  { capability: 'Infrastructure Runtime', epic: 'E1', level: 'live-verified', note: 'Registry/activation/history; promotes to active only with a verified real-infra proof.' },
  { capability: 'Identity Runtime', epic: 'E6', level: 'live-verified', note: 'REUSES the security identity registry — real identity records + OIDC/SAML provider config.' },
  { capability: 'Authentication', epic: 'E7', level: 'live-verified', note: 'REUSES security MFA/tokens/passwordless/sessions; a wrong MFA code really fails.' },
  { capability: 'Authorization', epic: 'E8', level: 'live-verified', note: 'REUSES the security RBAC/ABAC engine; real permit/deny decisions + JIT grants.' },
  { capability: 'Monitoring Runtime', epic: 'E12', level: 'live-verified', note: 'Activation runtime + reused deploy config + operations dashboard; components not marked running.' },
  { capability: 'Logging Runtime', epic: 'E15', level: 'live-verified', note: 'Real in-process log streams + search; audit logs remain the one runtime audit chain.' },
  { capability: 'Telemetry Runtime', epic: 'E13', level: 'live-verified', note: 'Collects only real values with a real source; fabricates nothing (data is business-data-pending).' },
  { capability: 'Governance', epic: 'E18', level: 'live-verified', note: 'Every action records org/cluster/environment/operator/evidence/approval/replay id/timestamp.' },
  { capability: 'Documentation', epic: 'E19', level: 'live-verified', note: 'Eleven guide outlines generated; REUSES the production documentation generator.' },
  { capability: 'Security Policies', epic: 'E16', level: 'live-verified', note: 'Real in-process policy set (pod-security/network/firewall/admission/supply-chain/runtime).' },
  // ── Adapter-verified — external providers, until configured ──
  { capability: 'AWS', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Azure', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Google Cloud', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'DigitalOcean', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Hetzner', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'VMware', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no VM created here.' },
  { capability: 'Vault', epic: 'E10', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; secret backend not contacted here.' },
  { capability: 'Entra ID', epic: 'E6', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; IdP not called here.' },
  { capability: 'Google Workspace', epic: 'E6', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; IdP not called here.' },
  { capability: 'Okta', epic: 'E6', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; IdP not called here.' },
  // ── Business-data-pending — real content/metrics; empty until environments run ──
  { capability: 'Customer Users', epic: 'E6', level: 'business-data-pending', note: 'Empty until real customer users are provisioned.' },
  { capability: 'Organizations', epic: 'E6', level: 'business-data-pending', note: 'Empty until real customer organizations onboard.' },
  { capability: 'Production Usage', epic: 'E13', level: 'business-data-pending', note: 'Empty until a real deployed environment is used.' },
  { capability: 'Customer Activity', epic: 'E13', level: 'business-data-pending', note: 'Empty until real customer activity occurs.' },
  { capability: 'Operational Metrics', epic: 'E13', level: 'business-data-pending', note: 'Telemetry reads no value until a real source emits it — never fabricated.' },
  { capability: 'AI Business Metrics', epic: 'E13', level: 'business-data-pending', note: 'Empty until real AI workloads run in a deployed environment.' },
  // ── Infrastructure-pending — represented; NEVER classified live ──
  { capability: 'Cloud Resources not provisioned', epic: 'E3', level: 'infrastructure-pending', note: 'Accounts/networks represented; no resource is provisioned here.' },
  { capability: 'Clusters not deployed', epic: 'E2', level: 'infrastructure-pending', note: 'Clusters represented with 0 running nodes; none deployed here.' },
  { capability: 'DNS not configured', epic: 'E5', level: 'infrastructure-pending', note: 'Domains represented; no DNS record resolves.' },
  { capability: 'Certificates not issued', epic: 'E11', level: 'infrastructure-pending', note: 'Certificate slots represented; none issued (issued=false) until a real CA issues.' },
  { capability: 'Databases not provisioned', epic: 'E4', level: 'infrastructure-pending', note: 'Databases represented; health unknown until a real probe; never fabricated healthy.' },
  { capability: 'Load Balancers not provisioned', epic: 'E5', level: 'infrastructure-pending', note: 'Load balancers represented; none provisioned here.' },
];

export interface InfraReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function infraReadiness(matrix: CapabilityEvidence[] = INFRA_MATRIX): InfraReadiness {
  const by = (l: InfraEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = PROVIDER_ADAPTER_CATALOG.length;
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length;
