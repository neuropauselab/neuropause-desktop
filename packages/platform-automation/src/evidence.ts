/**
 * Version 1.1 Program 1B capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave
 * 14 model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process automation control plane: the engine (registry, planner,
 *                            dependency resolver, dry-run, rollback planner, preview), every artifact
 *                            generator (Terraform, Kubernetes, database, DNS/TLS, secrets, monitoring,
 *                            backup, CI/CD), the validation runtime, the evidence generator, the
 *                            operations dashboard, and governance.
 *   adapter-verified       — the external tools the automation targets (Terraform providers, Vault,
 *                            cloud secret managers, GitHub Actions, cert-manager); represented until an
 *                            operator wires a real one.
 *   business-data-pending  — production automation runs, deployment metrics, and operational KPIs; no
 *                            real run has executed.
 *   infrastructure-pending — cloud accounts, Kubernetes clusters, DNS zones, TLS certificates, and
 *                            production networks; none exist until operators create them.
 * A test asserts no external tool, production-run metric, or real-infrastructure row is ever classified
 * live — Preview never mutates, Execute only prepares, and nothing is ever called deployed.
 */
import type { PaEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: PaEvidenceLevel;
  note: string;
}

export const PA_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process automation control plane ──
  { capability: 'Automation Engine', epic: 'E1', level: 'live-verified', note: 'Registry + run history; preview mutates nothing, execute only prepares.' },
  { capability: 'Execution Planner', epic: 'E1', level: 'live-verified', note: 'Real topological plan over registered automations.' },
  { capability: 'Dependency Resolver', epic: 'E1', level: 'live-verified', note: 'Kahn topological sort; rejects cycles + missing deps.' },
  { capability: 'Dry Run Engine', epic: 'E1', level: 'live-verified', note: 'Generates artifacts with no infrastructure mutation.' },
  { capability: 'Preview Mode', epic: 'E1', level: 'live-verified', note: 'Strictly side-effect-free; returns mutated:false.' },
  { capability: 'Rollback Planner', epic: 'E1', level: 'live-verified', note: 'Returns rollback steps; executes nothing.' },
  { capability: 'Terraform Generator', epic: 'E2', level: 'live-verified', note: 'Emits AWS/Azure/GCP/self-hosted HCL plans; never applies.' },
  { capability: 'Kubernetes Automation', epic: 'E3', level: 'live-verified', note: 'Valid manifests reusing the Helm conventions; never applied.' },
  { capability: 'Database Descriptors', epic: 'E4', level: 'live-verified', note: 'Postgres/Redis/Qdrant descriptors + backup CronJob; never provisions.' },
  { capability: 'DNS and TLS Automation', epic: 'E5', level: 'live-verified', note: 'cert-manager + DNS descriptors; nothing published or issued.' },
  { capability: 'Secrets Automation', epic: 'E6', level: 'live-verified', note: 'SecretStore + rotation policy; no secret value ever emitted.' },
  { capability: 'Monitoring Automation', epic: 'E7', level: 'live-verified', note: 'Prometheus/Grafana descriptors + dashboards; no metric fabricated.' },
  { capability: 'Backup Automation', epic: 'E8', level: 'live-verified', note: 'Backup/DR workflows reusing the backup-recovery engine.' },
  { capability: 'CI/CD Generator', epic: 'E9', level: 'live-verified', note: 'GitHub Actions; deploy-validation approval-gated, never applies.' },
  { capability: 'Validation Runtime', epic: 'E10', level: 'live-verified', note: 'Machine-readable reports; every target pending, no pass fabricated.' },
  { capability: 'Evidence Generator', epic: 'E11', level: 'live-verified', note: 'Evidence packages; slots pending, never auto-promoted.' },
  { capability: 'Operations Dashboard', epic: 'E12', level: 'live-verified', note: 'Real run status; verified always 0; no simulated production metrics.' },
  { capability: 'Governance', epic: 'E13', level: 'live-verified', note: 'Every execution audited on the one ledger with a replay id.' },
  // ── Adapter-verified — the external tools automation targets, until an operator wires a real one ──
  { capability: 'Terraform Providers', epic: 'E2', level: 'adapter-verified', note: 'AWS/Azure/GCP providers targeted by the plans; not authenticated.' },
  { capability: 'Vault', epic: 'E6', level: 'adapter-verified', note: 'HashiCorp Vault referenced by the SecretStore; not contacted.' },
  { capability: 'Cloud Secret Managers', epic: 'E6', level: 'adapter-verified', note: 'AWS/Azure/GCP secret managers referenced; not contacted.' },
  { capability: 'GitHub Actions', epic: 'E9', level: 'adapter-verified', note: 'The generated workflow runs only in a real repo with runners.' },
  { capability: 'cert-manager', epic: 'E5', level: 'adapter-verified', note: 'Issuer/Certificate target a real cert-manager install; none here.' },
  // ── Business-data-pending — real production automation activity; never fabricated ──
  { capability: 'Production Automation Runs', epic: 'E1', level: 'business-data-pending', note: 'No automation has been applied to real infrastructure.' },
  { capability: 'Deployment Metrics', epic: 'E12', level: 'business-data-pending', note: 'No deployment metric exists; verified is 0.' },
  { capability: 'Operational KPIs', epic: 'E12', level: 'business-data-pending', note: 'No production KPI exists until real runs occur.' },
  // ── Infrastructure-pending — real infrastructure the automation targets ──
  { capability: 'Cloud Accounts', epic: 'E2', level: 'infrastructure-pending', note: 'No cloud account is created or authenticated.' },
  { capability: 'Kubernetes Clusters', epic: 'E3', level: 'infrastructure-pending', note: 'No cluster is provisioned or connected.' },
  { capability: 'DNS Zones', epic: 'E5', level: 'infrastructure-pending', note: 'No DNS zone is owned or published.' },
  { capability: 'TLS Certificates', epic: 'E5', level: 'infrastructure-pending', note: 'No certificate is issued.' },
  { capability: 'Production Networks', epic: 'E3', level: 'infrastructure-pending', note: 'No production network exists.' },
];

export interface PaReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function paReadiness(matrix: CapabilityEvidence[] = PA_MATRIX): PaReadiness {
  const by = (l: PaEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
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
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 5
