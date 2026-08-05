/**
 * Sprint 4 constants. Isolated module (no imports). Enumerates the validation, chaos, recovery,
 * security-scan, penetration-test, compliance, and SLO vocabularies, plus the catalog of EXTERNAL
 * tools that stay adapter-verified until configured, and the customer-infrastructure capabilities
 * that stay infrastructure-pending until provided. Nothing here contacts an external system,
 * fabricates a measurement, or claims a certification.
 */
export const RELIABILITY_VERSION = '0.0.0-preview.1';

/** The one honest answer reliability analytics gives when no real data exists. */
export const NO_RELIABILITY_DATA = 'No reliability data available';

/** EPIC 1 — validation lifecycle. 'passed'/'failed' only after a real run; never assumed. */
export const VALIDATION_STATUS = ['registered', 'running', 'passed', 'failed', 'skipped'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUS)[number];

/** EPIC 1/2 — the validation suites this runtime really executes in-process. */
export const VALIDATION_KINDS = [
  'end-to-end',
  'performance',
  'load',
  'stress',
  'endurance',
  'chaos',
  'recovery',
  'security',
  'compliance',
  'observability',
] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];

/** EPIC 5 — chaos experiment kinds. Injected ONLY into an in-process sandbox target, never production. */
export const CHAOS_KINDS = ['latency-injection', 'error-injection', 'resource-pressure', 'dependency-failure', 'clock-skew'] as const;
export type ChaosKind = (typeof CHAOS_KINDS)[number];

/** EPIC 6 — recovery drills. Each records measured recovery evidence on the one chain. */
export const RECOVERY_KINDS = ['backup-restore', 'database', 'configuration', 'rollback', 'service-restart', 'connector'] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

/** EPIC 7 — security hardening scan kinds. Static/secret/config scans run for real over the source tree; the rest are adapter-verified. */
export const SECURITY_SCAN_KINDS = ['dependency', 'container', 'static-analysis', 'secret', 'configuration', 'image', 'supply-chain', 'runtime'] as const;
export type SecurityScanKind = (typeof SECURITY_SCAN_KINDS)[number];

/** EPIC 8 — penetration-test categories (OWASP-style). Represented as a framework; never executed against third parties, never certified. */
export const PENTEST_CATEGORIES = [
  'injection',
  'broken-authentication',
  'sensitive-data-exposure',
  'xml-external-entities',
  'broken-access-control',
  'security-misconfiguration',
  'cross-site-scripting',
  'insecure-deserialization',
  'vulnerable-components',
  'insufficient-logging',
] as const;
export type PentestCategory = (typeof PENTEST_CATEGORIES)[number];

/** EPIC 9 — compliance frameworks. Evidence packages are generated; compliance is NEVER claimed. */
export const COMPLIANCE_FRAMEWORKS = ['ISO 27001', 'SOC 2', 'HIPAA', 'GDPR', 'PCI DSS'] as const;
export type ComplianceFramework = (typeof COMPLIANCE_FRAMEWORKS)[number];

/** A generated compliance artifact is only ever one of these — 'certified'/'compliant' is intentionally absent. */
export const COMPLIANCE_OUTCOMES = ['evidence-collected', 'readiness-assessed', 'gap-identified'] as const;
export type ComplianceOutcome = (typeof COMPLIANCE_OUTCOMES)[number];

/** EPIC 11 — SLO/SLA objective kinds. */
export const SLO_KINDS = ['availability', 'latency', 'error-rate', 'throughput', 'durability'] as const;
export type SloKind = (typeof SLO_KINDS)[number];

/** EPIC 12 — operational-readiness artifact kinds. */
export const READINESS_ARTIFACTS = ['runbook', 'playbook', 'dr-plan', 'on-call', 'escalation', 'maintenance'] as const;
export type ReadinessArtifact = (typeof READINESS_ARTIFACTS)[number];

/** EPIC 13 — release-candidate gate decisions. 'rc-approved' is the ceiling; GA is NEVER declared here. */
export const RC_DECISIONS = ['rc-approved', 'rc-blocked'] as const;
export type RcDecision = (typeof RC_DECISIONS)[number];

/**
 * EPIC 7/8/9/15/4 — external tools the industry uses. Every one is REPRESENTED here and stays
 * adapter-verified until the customer configures it against their own account; none is invoked.
 */
export interface ExternalTool {
  name: string;
  category: 'sast' | 'dependency' | 'container' | 'dast' | 'compliance' | 'monitoring' | 'security-platform' | 'load-generator';
  epic: string;
}
export const EXTERNAL_TOOLS: ExternalTool[] = [
  { name: 'Snyk', category: 'dependency', epic: 'E7' },
  { name: 'Trivy', category: 'container', epic: 'E7' },
  { name: 'Grype', category: 'container', epic: 'E7' },
  { name: 'Semgrep', category: 'sast', epic: 'E7' },
  { name: 'CodeQL', category: 'sast', epic: 'E7' },
  { name: 'OWASP ZAP', category: 'dast', epic: 'E8' },
  { name: 'Burp Suite', category: 'dast', epic: 'E8' },
  { name: 'Vanta', category: 'compliance', epic: 'E9' },
  { name: 'Drata', category: 'compliance', epic: 'E9' },
  { name: 'OneTrust', category: 'compliance', epic: 'E9' },
  { name: 'Datadog', category: 'monitoring', epic: 'E15' },
  { name: 'New Relic', category: 'monitoring', epic: 'E15' },
  { name: 'Prometheus', category: 'monitoring', epic: 'E15' },
  { name: 'Grafana Cloud', category: 'monitoring', epic: 'E15' },
  { name: 'Falco', category: 'security-platform', epic: 'E7' },
  { name: 'Wiz', category: 'security-platform', epic: 'E7' },
  { name: 'k6', category: 'load-generator', epic: 'E4' },
  { name: 'Locust', category: 'load-generator', epic: 'E4' },
  { name: 'Gatling', category: 'load-generator', epic: 'E4' },
] as const;

/** The named external tools tracked as rows in the evidence matrix (a representative subset). */
export const MATRIX_ADAPTERS = ['External SAST scanners', 'External dependency scanners', 'External DAST / pentest tools', 'External compliance platforms', 'Cloud monitoring services', 'External load generators'] as const;

/** Capabilities that require the customer's own production infrastructure — represented until provided. */
export const INFRASTRUCTURE_PENDING_CAPS = [
  'customer-production-clusters',
  'production-scale-traffic',
  'multi-region-failover',
  'external-dr-sites',
  'production-pentest-targets',
] as const;
export type InfrastructurePendingCap = (typeof INFRASTRUCTURE_PENDING_CAPS)[number];

/** The nine documentation guides EPIC 19 outlines. */
export const DOC_GUIDES = [
  'validation-strategy',
  'performance-engineering',
  'chaos-engineering',
  'recovery-runbook',
  'security-hardening',
  'compliance-readiness',
  'reliability-slo',
  'operational-readiness',
  'release-candidate',
] as const;
export type DocGuide = (typeof DOC_GUIDES)[number];
