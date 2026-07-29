/**
 * Sprint 1 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14 model):
 *   live-verified          — the real, validated deployment assets and the foundation that governs
 *                            them: environment registry, Docker config, Kubernetes manifests, the
 *                            Helm chart, GitHub Actions workflows, environment configuration,
 *                            monitoring configuration, backup policies, secrets policies, network &
 *                            storage config, security bootstrap, release management, observability
 *                            bootstrap, documentation, and governance.
 *   adapter-verified       — AWS / Azure / GCP / DigitalOcean / Hetzner / VMware / Kubernetes / MinIO
 *                            / Vault; represented until configured, never contacted.
 *   business-data-pending  — deployment history, production/release/runtime metrics, and customer
 *                            deployments; empty until real environments run.
 *   infrastructure-pending — real clusters, cloud resources, databases, monitoring, DNS, TLS, and
 *                            load balancers; represented via validated descriptors, never created.
 * A test asserts NOTHING infrastructure is classified live, that every infrastructure capability is
 * infrastructure-pending, and that no adapter is classified live.
 */
import type { DeployEvidenceLevel } from './types';
import { INFRA_ADAPTER_CATALOG, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: DeployEvidenceLevel;
  note: string;
}

export const DEPLOY_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — real, validated assets + the foundation that governs them ──
  { capability: 'Environment Registry', epic: 'E1', level: 'live-verified', note: 'Dev/QA/staging/production/DR records; production starts not-deployed — never faked.' },
  { capability: 'Docker configuration', epic: 'E2', level: 'live-verified', note: 'Multi-stage Dockerfile (8 targets) + dev/production compose; real, parseable files.' },
  { capability: 'Kubernetes manifests', epic: 'E3', level: 'live-verified', note: 'Namespaces→CronJobs across 9 manifests; represented only, no cluster claimed.' },
  { capability: 'Helm chart', epic: 'E4', level: 'live-verified', note: 'Chart + 4 values files + templates; renders manifests, provisions nothing.' },
  { capability: 'GitHub Actions workflows', epic: 'E6', level: 'live-verified', note: 'CI/release/container/nightly/rollback/tag; real, parseable YAML.' },
  { capability: 'Environment configuration', epic: 'E8', level: 'live-verified', note: 'Production/staging/QA/development JSON; feature flags/AI/storage/db/logging/security.' },
  { capability: 'Monitoring configuration', epic: 'E10', level: 'live-verified', note: 'Prometheus/Alertmanager/Loki/exporters/Grafana; config only, no running server.' },
  { capability: 'Backup policies & jobs', epic: 'E11', level: 'live-verified', note: 'Policies + jobs; REUSES production backups; never claims a successful backup.' },
  { capability: 'Secrets policies & references', epic: 'E7', level: 'live-verified', note: 'Rotation policies + reference keys only; NEVER a secret value; REUSES security rotation.' },
  { capability: 'Network configuration', epic: 'E13', level: 'live-verified', note: 'Nginx edge: TLS/HTTPS-redirect/rate-limit/HSTS/CSP; certs mounted at deploy time.' },
  { capability: 'Storage configuration', epic: 'E12', level: 'live-verified', note: 'Object/file/cache/volume config; provider adapters represented.' },
  { capability: 'Security bootstrap', epic: 'E14', level: 'live-verified', note: 'HSTS/CSP/cookies/sessions/container-security from real config; REUSES security platform.' },
  { capability: 'Release management', epic: 'E15', level: 'live-verified', note: 'Semver + compatibility matrix; REUSES production release/upgrade-assistant.' },
  { capability: 'Observability bootstrap', epic: 'E9', level: 'live-verified', note: 'OTel + health endpoints; REUSES operations health; no telemetry fabricated.' },
  { capability: 'Documentation', epic: 'E16', level: 'live-verified', note: 'Ten operator guides; real markdown; REUSES production documentation.' },
  { capability: 'Deployment Governance', epic: 'E21', level: 'live-verified', note: 'Every action records operator/org/environment/epic/evidence/replay id on the one chain.' },
  // ── Adapter-verified — external providers, until configured ──
  { capability: 'AWS', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Azure', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Google Cloud', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'DigitalOcean', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'Hetzner', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no resource created here.' },
  { capability: 'VMware', epic: 'E5', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no VM created here.' },
  { capability: 'Kubernetes', epic: 'E3', level: 'adapter-verified', note: 'Represented; adapter-verified until a real cluster/context is configured.' },
  { capability: 'MinIO', epic: 'E12', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no bucket created here.' },
  { capability: 'Vault', epic: 'E7', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no secret backend contacted here.' },
  // ── Business-data-pending — real history/metrics; empty until environments run ──
  { capability: 'Deployment History', epic: 'E1', level: 'business-data-pending', note: 'Empty until real deployments run.' },
  { capability: 'Production Metrics', epic: 'E9', level: 'business-data-pending', note: 'Counters read 0 until a deployed environment emits telemetry.' },
  { capability: 'Release Metrics', epic: 'E15', level: 'business-data-pending', note: 'Empty until real releases ship.' },
  { capability: 'Runtime Metrics', epic: 'E9', level: 'business-data-pending', note: 'Empty until real runtimes report.' },
  { capability: 'Customer Deployments', epic: 'E1', level: 'business-data-pending', note: 'Empty until a real customer environment is deployed.' },
  // ── Infrastructure-pending — represented via descriptors; NEVER created or classified live ──
  { capability: 'Real Clusters', epic: 'E3', level: 'infrastructure-pending', note: 'Manifests represent intended state; a real cluster is not provisioned here.' },
  { capability: 'Real Cloud Resources', epic: 'E5', level: 'infrastructure-pending', note: 'Terraform represents resources; nothing is applied here.' },
  { capability: 'Real Databases', epic: 'E5', level: 'infrastructure-pending', note: 'Database resources represented; no real database is created.' },
  { capability: 'Real Monitoring', epic: 'E10', level: 'infrastructure-pending', note: 'Monitoring config represented; no Prometheus/Grafana/Loki is running.' },
  { capability: 'Real DNS', epic: 'E13', level: 'infrastructure-pending', note: 'Hostnames represented; no DNS record is created.' },
  { capability: 'Real TLS', epic: 'E14', level: 'infrastructure-pending', note: 'TLS config represented; no certificate is issued here.' },
  { capability: 'Real Load Balancers', epic: 'E13', level: 'infrastructure-pending', note: 'Ingress/LB represented; no real load balancer is provisioned.' },
];

export interface DeployReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function deployReadiness(matrix: CapabilityEvidence[] = DEPLOY_MATRIX): DeployReadiness {
  const by = (l: DeployEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = INFRA_ADAPTER_CATALOG.length;
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length;
