/**
 * Enterprise Validation Matrix (NCEA 16.0, deliverable 1). One evidence model
 * across every subsystem, with four honest tiers:
 *   VERIFIED           — executed here (tsc/eslint/vitest, real crypto, real
 *                        embedded Postgres, real resource sampling, e2e, benchmarks).
 *   ARCHITECTURE-READY — implemented behind the correct interface, but external
 *                        attestation / control ownership is out of scope.
 *   INFRA-PENDING      — needs external infrastructure not present here (a cluster,
 *                        KMS/HSM, a live IdP, load generators, cloud DR, a collector).
 *   PILOT-VERIFIED     — provable only in a real pilot: customer environment,
 *                        production traffic, real SLOs — not yet executed.
 * A test enforces the invariants — production readiness is never fabricated, and no
 * Phase-14/15 INFRA-PENDING capability is silently upgraded to VERIFIED here.
 */
export type EvidenceTier = 'verified' | 'architecture-ready' | 'infra-pending' | 'pilot-verified';

export const EVIDENCE_TIERS: EvidenceTier[] = ['verified', 'architecture-ready', 'infra-pending', 'pilot-verified'];

export interface SubsystemValidation {
  subsystem: string;
  pkg: string;
  /** VERIFIED test count backing this subsystem (traceable to the suite). */
  tests: number;
  /** The tier of the subsystem's core capability as executed here. */
  status: EvidenceTier;
  verified: string[];
  infraPending: string[];
  pilotVerified: string[];
}

/**
 * Nine subsystems. Test counts are the real per-package suite totals (Mission
 * Control's tests live in the desktop app suite; the rest are in the packages run).
 */
export const VALIDATION_MATRIX: SubsystemValidation[] = [
  {
    subsystem: 'Runtime',
    pkg: '@neuropause/runtime',
    tests: 22,
    status: 'verified',
    verified: ['Composition root, ordered lifecycle', 'One event bus / audit chain / scheduler / observability', 'Service registry + health system'],
    infraPending: ['Multi-node runtime clustering'],
    pilotVerified: ['Sustained multi-tenant runtime under production load'],
  },
  {
    subsystem: 'AI Runtime',
    pkg: '@neuropause/ai-runtime',
    tests: 29,
    status: 'verified',
    verified: ['Provider registry + model router', 'Governed inference through the one audit chain', 'Agents / tools / workflows / sessions / memory'],
    infraPending: ['Live model-provider calls (OpenAI/Anthropic/…)'],
    pilotVerified: ['Cost/latency envelopes against real models at volume'],
  },
  {
    subsystem: 'Connectors',
    pkg: '@neuropause/connectors',
    tests: 29,
    status: 'verified',
    verified: ['Connector SDK + capability contracts', 'Secret vault interface', 'Request construction + response parsing'],
    infraPending: ['Live SaaS API calls (GitHub/Slack/Salesforce/…)'],
    pilotVerified: ['End-to-end sync against a customer tenant'],
  },
  {
    subsystem: 'Persistence',
    pkg: '@neuropause/persistence',
    tests: 21,
    status: 'verified',
    verified: ['Real embedded Postgres (PGlite) — ACID, migrations', 'Repositories, event store, backup/restore round-trip', 'Multi-tenant scoping'],
    infraPending: ['Managed Postgres cluster, object storage, Redis', 'WAL PITR / base backups'],
    pilotVerified: ['Throughput + durability at production data volume'],
  },
  {
    subsystem: 'Workspace',
    pkg: '@neuropause/workspace',
    tests: 27,
    status: 'verified',
    verified: ['Org/dept/team/workspace/project model', 'Human + AI employees, knowledge, collaboration', 'One identity + permission model reused'],
    infraPending: [],
    pilotVerified: ['Real organizational rollout + adoption'],
  },
  {
    subsystem: 'Mission Control',
    pkg: 'apps/desktop (missionControl)',
    tests: 15,
    status: 'verified',
    verified: ['Desktop UI consuming Runtime APIs only', 'Local-first; auditable/observable/replayable', 'No duplicate business logic'],
    infraPending: [],
    pilotVerified: ['Operator UX in a live deployment'],
  },
  {
    subsystem: 'CKDL',
    pkg: '@neuropause/ckdl',
    tests: 25,
    status: 'verified',
    verified: ['Evidence-backed decisions + provenance', 'Explainable relationships; trust freshness', 'No duplicated knowledge'],
    infraPending: [],
    pilotVerified: ['Decision quality against real enterprise corpora'],
  },
  {
    subsystem: 'Security',
    pkg: '@neuropause/security',
    tests: 43,
    status: 'verified',
    verified: ['Real crypto: AES-256-GCM envelope, Ed25519, TOTP, HMAC', 'RBAC+ABAC, policy engine, tenant isolation', 'Signed tamper-evident audit; AI governance'],
    infraPending: ['Live OIDC/SAML IdP federation', 'AWS KMS / CloudHSM', 'WebAuthn hardware attestation'],
    pilotVerified: ['SOC 2 / ISO 27001 external audit', 'Penetration test against a live deployment'],
  },
  {
    subsystem: 'Operations',
    pkg: '@neuropause/operations',
    tests: 53,
    status: 'verified',
    verified: ['Health, reliability, jobs/queues, incidents', 'DR drill against real Postgres; RPO/RTO measured', 'Tracing + unified dashboard; deployment strategies'],
    infraPending: ['Real clustering; cluster/cross-region DR', 'Telemetry export; live secret/cert stores'],
    pilotVerified: ['Production-scale load/stress/soak', 'Live blue/green + canary on a real orchestrator'],
  },
];

export interface CertificationArea {
  area: string;
  status: EvidenceTier;
  evidence: string;
  caveats: string[];
}

/** The final certifications — granted only at the tier the evidence supports. */
export const CERTIFICATION_AREAS: CertificationArea[] = [
  { area: 'Enterprise Architecture', status: 'verified', evidence: 'Constitutional composition; additive packages; one runtime/audit chain; full regression green', caveats: [] },
  { area: 'Runtime', status: 'verified', evidence: 'Runtime + AI Runtime + Workspace + CKDL suites; e2e composition proof', caveats: ['Multi-node clustering INFRA-PENDING'] },
  { area: 'Security', status: 'verified', evidence: 'Real-crypto security suite (43) + governance on the one audit chain', caveats: ['Live IdP/KMS/attestation INFRA-PENDING', 'External SOC 2/ISO audit PILOT-VERIFIED'] },
  { area: 'Reliability', status: 'verified', evidence: 'Operations suite (53) incl. DR drill vs real Postgres; RPO/RTO measured', caveats: ['Production-scale load PILOT-VERIFIED', 'Cluster/cross-region DR INFRA-PENDING'] },
  { area: 'Integration', status: 'verified', evidence: 'Integrations suite (40): adapter-verified + real Postgres connector', caveats: ['Live SaaS/model calls INFRA-PENDING'] },
  { area: 'Operational', status: 'verified', evidence: 'Health/incident/deployment/backup evidence; benchmark harness', caveats: ['Live orchestrator + collector INFRA-PENDING'] },
  { area: 'Production Readiness', status: 'pilot-verified', evidence: 'All in-container validation passes; the production cutover is gated on a real pilot + infrastructure', caveats: ['Customer environment + production traffic PILOT-VERIFIED', 'Cloud/cluster/audit dependencies INFRA-PENDING'] },
];

export interface MatrixSummary {
  subsystems: number;
  verifiedSubsystems: number;
  totalVerifiedTests: number;
  certifications: number;
  certifiedVerified: number;
}

export function matrixSummary(): MatrixSummary {
  return {
    subsystems: VALIDATION_MATRIX.length,
    verifiedSubsystems: VALIDATION_MATRIX.filter((s) => s.status === 'verified').length,
    totalVerifiedTests: VALIDATION_MATRIX.reduce((n, s) => n + s.tests, 0),
    certifications: CERTIFICATION_AREAS.length,
    certifiedVerified: CERTIFICATION_AREAS.filter((c) => c.status === 'verified').length,
  };
}
