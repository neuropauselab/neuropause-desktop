/**
 * Launch Workstream 4 constants. Isolated module (no imports). Enumerates the Zero Trust vocabulary,
 * secret/key kinds, security-policy categories, vulnerability severities, compliance frameworks, SOC
 * severities, disaster-recovery kinds, and the catalogs of EXTERNAL systems that stay adapter-verified
 * until configured plus the customer infrastructure that stays infrastructure-pending until it exists.
 *
 * HONESTY: this package is the enterprise trust CONTROL PLANE (software). It NEVER claims an achieved
 * ISO 27001 / SOC 2 / HIPAA / GDPR certification, a completed penetration test, a production security
 * incident, or an external SIEM integration — those are represented until real audits, credentials, and
 * infrastructure are configured and verified.
 */
export const TP_VERSION = '1.0.0-rc.1';

/** The one honest answer trust analytics gives when no real production security data exists. */
export const NO_SECURITY_DATA = 'No production security data available';

/** EPIC 1 — resource classification (Zero Trust: classify before you trust). */
export const RESOURCE_CLASSES = ['public', 'internal', 'confidential', 'restricted'] as const;
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

/** EPIC 1 — trust levels a subject/device/session can hold after evaluation. */
export const TRUST_LEVELS = ['untrusted', 'low', 'medium', 'high', 'verified'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** EPIC 1 — the continuous-verification signals the trust score is computed from. */
export const TRUST_SIGNALS = ['identity', 'device-posture', 'session-age', 'network', 'behavior'] as const;
export type TrustSignal = (typeof TRUST_SIGNALS)[number];

/** EPIC 2 — privileged access grant states. Elevation is never assumed; it is granted then expires. */
export const PRIVILEGE_STATES = ['requested', 'approved', 'active', 'expired', 'revoked', 'denied'] as const;
export type PrivilegeState = (typeof PRIVILEGE_STATES)[number];

/** EPIC 3 — secret kinds. A secret is a REFERENCE (vault path / key id), never a plaintext value. */
export const SECRET_KINDS = ['api-key', 'certificate', 'encryption-key', 'oauth-token', 'connection-string'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** EPIC 3 — external secret stores (adapter-verified until configured; never contacted here). */
export const SECRET_STORES = ['HashiCorp Vault', 'Azure Key Vault', 'AWS Secrets Manager', 'Google Secret Manager'] as const;
export type SecretStore = (typeof SECRET_STORES)[number];

/** EPIC 4 — security-policy categories. */
export const POLICY_CATEGORIES = ['password', 'mfa', 'device', 'data-classification', 'session', 'connector-security'] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

/** EPIC 5 — vulnerability severity (CVSS-aligned bands). Manual registration only — no scan is fabricated. */
export const VULN_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export type VulnSeverity = (typeof VULN_SEVERITIES)[number];

/** EPIC 5 — mitigation workflow states. */
export const MITIGATION_STATES = ['open', 'triaged', 'in-progress', 'mitigated', 'accepted-risk', 'resolved'] as const;
export type MitigationState = (typeof MITIGATION_STATES)[number];

/** EPIC 7 — runtime security domains (represented until production traffic flows). */
export const RUNTIME_DOMAINS = ['runtime-policy', 'container-policy', 'api-protection', 'process-monitoring', 'security-event', 'threat-detection'] as const;
export type RuntimeDomain = (typeof RUNTIME_DOMAINS)[number];

/** EPIC 9 — disaster-recovery backup kinds (aligned to the reused backup-recovery engine). */
export const BACKUP_KINDS = ['database', 'configuration', 'tenant'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** EPIC 10 — compliance frameworks whose READINESS is represented (never a certification). */
export const COMPLIANCE_FRAMEWORKS = ['ISO27001', 'SOC2', 'GDPR', 'HIPAA', 'NIST-CSF'] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

/**
 * The frameworks whose readiness is computed by the REUSED security ComplianceService. NIST-CSF is not
 * modelled there, so it is represented in this package's own control registry (clearly, as readiness —
 * never a certification).
 */
export const REUSED_COMPLIANCE_FRAMEWORKS: Record<Exclude<ComplianceFramework, 'NIST-CSF'>, 'ISO27001' | 'SOC2' | 'GDPR' | 'HIPAA'> = {
  ISO27001: 'ISO27001',
  SOC2: 'SOC2',
  GDPR: 'GDPR',
  HIPAA: 'HIPAA',
};

/** EPIC 11 — SOC incident severities (mapped to the reused Operations incident registry). */
export const SOC_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4', 'sev5'] as const;
export type SocSeverity = (typeof SOC_SEVERITIES)[number];

/** EPIC 13 — the security guides generated (outlines/metadata; no external content is fabricated). */
export const SECURITY_GUIDES = [
  'Security Architecture Guide',
  'Administrator Security Guide',
  'Identity Guide',
  'Encryption Guide',
  'Disaster Recovery Guide',
  'Incident Response Guide',
  'Secure Deployment Guide',
  'Compliance Readiness Guide',
] as const;
export type SecurityGuide = (typeof SECURITY_GUIDES)[number];

/** The named external systems tracked as ADAPTER-VERIFIED rows in the evidence matrix. */
export const MATRIX_ADAPTERS = [
  'HashiCorp Vault',
  'Azure Key Vault',
  'AWS Secrets Manager',
  'Google Secret Manager',
  'External SIEM',
  'External Identity Providers',
] as const;

/** Capabilities that require real external audits/infrastructure — represented until they exist. */
export const INFRASTRUCTURE_PENDING_CAPS = [
  'external-secret-stores',
  'enterprise-siem',
  'production-hsm',
  'third-party-audit-environment',
  'compliance-audit-engagement',
] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];
