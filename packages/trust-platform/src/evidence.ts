/**
 * Launch Workstream 4 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14
 * model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process trust control plane: the Zero Trust runtime, policy
 *                            evaluation + trust scoring, privileged access + JIT, the secret registry +
 *                            key rotation, security policies, the vulnerability registry, supply-chain
 *                            provenance + SBOM, runtime-security registries, the audit timeline + chain
 *                            of custody, the disaster-recovery runtime + backup catalog, the compliance +
 *                            control registries, the SOC incident queue, the Trust Center, security
 *                            documentation, and governance.
 *   adapter-verified       — external secret stores + SIEM + identity providers (HashiCorp Vault, Azure
 *                            Key Vault, AWS Secrets Manager, Google Secret Manager, External SIEM,
 *                            External Identity Providers); represented until configured, never contacted.
 *   business-data-pending  — production security events, customer incidents, threat intelligence,
 *                            security metrics, and compliance assessments; never harvested or fabricated.
 *   infrastructure-pending — external secret stores, enterprise SIEM, production HSM, a third-party audit
 *                            environment, and a compliance audit engagement; represented until they exist.
 * A test asserts no adapter, business-data, or infrastructure capability is ever classified live — no
 * achieved certification, no completed penetration test, no production incident, no external SIEM.
 */
import type { TpEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: TpEvidenceLevel;
  note: string;
}

export const TP_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process trust control plane (real / reused engines) ──
  { capability: 'Zero Trust Runtime', epic: 'E1', level: 'live-verified', note: 'Policy registry + deny-by-default evaluation; reuses the security authorization engine.' },
  { capability: 'Policy Evaluation', epic: 'E1', level: 'live-verified', note: 'Real permit/deny via the reused RBAC/ABAC engine, gated by trust level.' },
  { capability: 'Trust Scoring', epic: 'E1', level: 'live-verified', note: 'Real weighted score over the posture signals actually supplied.' },
  { capability: 'Privileged Access', epic: 'E2', level: 'live-verified', note: 'Request → approve → activate; reuses the authorization JIT grant.' },
  { capability: 'Just-In-Time Privileges', epic: 'E2', level: 'live-verified', note: 'Expiring, attributed grants via the reused authorization engine.' },
  { capability: 'Secret Registry', epic: 'E3', level: 'live-verified', note: 'Secret REFERENCES only (vault path / key id); no value is ever stored.' },
  { capability: 'Key Rotation', epic: 'E3', level: 'live-verified', note: 'Real key rotation/versioning/revocation via the reused KeyManager.' },
  { capability: 'Security Policies', epic: 'E4', level: 'live-verified', note: 'Password/MFA/device/data/session/connector policies; real password evaluation.' },
  { capability: 'Vulnerability Registry', epic: 'E5', level: 'live-verified', note: 'Manual vulnerability/CVE/dependency/patch registries; no scan is fabricated.' },
  { capability: 'Supply Chain Provenance', epic: 'E6', level: 'live-verified', note: 'Build provenance + release verification via the reused Release platform.' },
  { capability: 'SBOM Registry', epic: 'E6', level: 'live-verified', note: 'Real SBOM generated from the registered dependency inventory.' },
  { capability: 'Runtime Security Policies', epic: 'E7', level: 'live-verified', note: 'Runtime/container/API policy + threat-signature registries; real sample detection.' },
  { capability: 'Audit Runtime', epic: 'E8', level: 'live-verified', note: 'Immutable timeline from the reused hash-linked ledger; real verification.' },
  { capability: 'Chain of Custody', epic: 'E8', level: 'live-verified', note: 'Real provenance id-lineage from the reused audit ledger.' },
  { capability: 'Disaster Recovery Runtime', epic: 'E9', level: 'live-verified', note: 'Recovery plans + validation drill reusing the backup-recovery engine.' },
  { capability: 'Backup Catalog', epic: 'E9', level: 'live-verified', note: 'Real backup records via the reused Launch-Workstream-1 backup-recovery engine.' },
  { capability: 'Compliance Registry', epic: 'E10', level: 'live-verified', note: 'Framework readiness via the reused ComplianceService; certified:false always.' },
  { capability: 'Control Registry', epic: 'E10', level: 'live-verified', note: 'Control registry + gap analysis + policy mapping (incl. NIST CSF).' },
  { capability: 'Security Operations Center', epic: 'E11', level: 'live-verified', note: 'Incident queue reusing the Operations incident registry lifecycle.' },
  { capability: 'Trust Center', epic: 'E12', level: 'live-verified', note: 'Security/architecture/compliance/availability views; published:false until public.' },
  { capability: 'Security Documentation', epic: 'E13', level: 'live-verified', note: 'Deterministic guide outlines; no findings or certification language fabricated.' },
  { capability: 'Governance', epic: 'E14', level: 'live-verified', note: 'Every security event audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external secret stores / SIEM / identity providers, until configured ──
  { capability: 'HashiCorp Vault', epic: 'E3', level: 'adapter-verified', note: 'Represented secret store; never contacted until configured.' },
  { capability: 'Azure Key Vault', epic: 'E3', level: 'adapter-verified', note: 'Represented secret store; never contacted until configured.' },
  { capability: 'AWS Secrets Manager', epic: 'E3', level: 'adapter-verified', note: 'Represented secret store; never contacted until configured.' },
  { capability: 'Google Secret Manager', epic: 'E3', level: 'adapter-verified', note: 'Represented secret store; never contacted until configured.' },
  { capability: 'External SIEM', epic: 'E11', level: 'adapter-verified', note: 'Represented SIEM export; no external SIEM integration is claimed.' },
  { capability: 'External Identity Providers', epic: 'E2', level: 'adapter-verified', note: 'Represented IdPs; no live external identity verification is fabricated.' },
  // ── Business-data-pending — real production security data; never harvested or fabricated ──
  { capability: 'Production Security Events', epic: 'E7', level: 'business-data-pending', note: 'No production security event flows here; sample events only.' },
  { capability: 'Customer Incidents', epic: 'E11', level: 'business-data-pending', note: 'No real customer incident exists; SOC handles exercise incidents.' },
  { capability: 'Threat Intelligence', epic: 'E11', level: 'business-data-pending', note: 'No production threat intel feed; indicators are represented inputs.' },
  { capability: 'Security Metrics', epic: 'E11', level: 'business-data-pending', note: 'No production security metrics exist until go-live.' },
  { capability: 'Compliance Assessments', epic: 'E10', level: 'business-data-pending', note: 'Readiness only; a real assessment requires an audit engagement.' },
  // ── Infrastructure-pending — external audits/infrastructure; represented until they exist ──
  { capability: 'External Secret Stores', epic: 'E3', level: 'infrastructure-pending', note: 'No external secret store is connected until credentials are configured.' },
  { capability: 'Enterprise SIEM', epic: 'E11', level: 'infrastructure-pending', note: 'No enterprise SIEM is deployed or integrated.' },
  { capability: 'Production HSM', epic: 'E3', level: 'infrastructure-pending', note: 'No production HSM backs key material yet.' },
  { capability: 'Third-Party Audit Environment', epic: 'E10', level: 'infrastructure-pending', note: 'No third-party audit environment exists until an engagement begins.' },
  { capability: 'Compliance Audit Engagement', epic: 'E10', level: 'infrastructure-pending', note: 'No ISO 27001 / SOC 2 / HIPAA / GDPR certification is claimed or in progress.' },
];

export interface TpReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function tpReadiness(matrix: CapabilityEvidence[] = TP_MATRIX): TpReadiness {
  const by = (l: TpEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 6
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 5
