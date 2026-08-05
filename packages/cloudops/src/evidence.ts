/**
 * Wave 7 capability evidence matrix — the HONESTY BOUNDARY encoded as data:
 *   live-verified    — cloud-ops runtime / cloud / environment / deployment registries,
 *                      GitOps desired-state + drift computation, configuration over the
 *                      reused encrypted vault, secret-operations registry, release workflow
 *                      validation, infrastructure policy evaluation, observability registry,
 *                      backup/DR plan registry, fleet inventory, dashboards, governance, APIs
 *                      — all executed in-process over real runtime data
 *   adapter-verified — Kubernetes manifests + GitOps/secret/observability/cloud-provider
 *                      adapter DESCRIPTORS (shapes only, never applied)
 *   infra-pending    — real Kubernetes apply, real GitOps reconciliation, live Prometheus/
 *                      Grafana telemetry, live secret synchronization, production failover,
 *                      disaster-recovery execution, multi-region deployment
 * A test asserts no infra-pending capability is ever marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const CLOUDOPS_MATRIX: CapabilityEvidence[] = [
  // Live-verified — executed in-process over real runtime data
  { capability: 'Cloud Operations Runtime', module: 'M1', level: 'live-verified', note: 'Cloud / deployment / environment registries + infrastructure inventory — in-process, governed.' },
  { capability: 'Cloud Registry', module: 'M1', level: 'live-verified', note: 'Cloud provider descriptors registered and inventoried — no account is connected.' },
  { capability: 'Environment Registry', module: 'M2', level: 'live-verified', note: 'Dev / test / QA / staging / production tiers with metadata, targets, policies, secret refs.' },
  { capability: 'Deployment Registry', module: 'M3', level: 'live-verified', note: 'Applications / services / jobs / cronjobs / workers / APIs with version, status, health.' },
  { capability: 'GitOps Runtime (desired state + drift detection)', module: 'M5', level: 'live-verified', note: 'Desired state, commit history, promotion, and a real in-process drift diff over desired vs observed state.' },
  { capability: 'Configuration Runtime', module: 'M6', level: 'live-verified', note: 'Env vars + config templates; secret-backed values encrypted at rest via the reused vault (real AES-256-GCM).' },
  { capability: 'Secret Operations Registry', module: 'M7', level: 'live-verified', note: 'Secret references, rotation metadata, expiration, validation, audit — in-process; no backend sync.' },
  { capability: 'Release Workflow Validation', module: 'M8', level: 'live-verified', note: 'Rolling / blue-green / canary / progressive workflow shapes validated; rollout never executed.' },
  { capability: 'Infrastructure Policy Engine', module: 'M9', level: 'live-verified', note: 'Resource-limits / security-context / labels / image / isolation / approval / compliance evaluated in-process.' },
  { capability: 'Observability Registry', module: 'M10', level: 'live-verified', note: 'Metrics / logs / tracing / alerts / dashboards resource records — descriptors, not live telemetry.' },
  { capability: 'Backup / DR Plan Registry', module: 'M11', level: 'live-verified', note: 'Backup / restore / snapshot / recovery / failover plans with RPO/RTO targets — simulation records.' },
  { capability: 'Fleet Inventory', module: 'M12', level: 'live-verified', note: 'One unified inventory across orgs / regions / clusters / clouds / environments / deployments.' },
  { capability: 'Cloud Operations Dashboards', module: 'M13', level: 'live-verified', note: 'Six role dashboards from live registries + policy compliance + fleet inventory.' },
  { capability: 'Cloud Operations Governance', module: 'M1-M14', level: 'live-verified', note: 'Every cloud operation audited on the one runtime chain with a replay id and evidence.' },
  { capability: 'Runtime APIs', module: 'M14', level: 'live-verified', note: 'runtime.cloud/environments/deployments/gitops/config/secrets/release/infrastructure/fleet/observability/backups.' },
  // Adapter-verified — shapes validated, never applied
  { capability: 'Kubernetes manifest descriptors (11 kinds)', module: 'M4', level: 'adapter-verified', note: 'Namespace / Deployment / StatefulSet / DaemonSet / Service / ConfigMap / Secret / Ingress / HPA / NetworkPolicy / PVC shapes validated; never applied.' },
  { capability: 'GitOps engine adapters (ArgoCD / Flux)', module: 'M5', level: 'adapter-verified', note: 'Application/Kustomization-shaped adapter descriptors; no controller connected.' },
  { capability: 'Secret backend adapters (Vault / AWS / Azure / GCP)', module: 'M7', level: 'adapter-verified', note: 'HashiCorp Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager reference shapes; no sync.' },
  { capability: 'Observability backend adapters (Prometheus / Grafana / Loki / Tempo / OTel)', module: 'M10', level: 'adapter-verified', note: 'Scrape-config / dashboard / datasource shapes validated; no live scrape or render.' },
  { capability: 'Cloud provider adapters (AWS / Azure / GCP)', module: 'M1', level: 'adapter-verified', note: 'Provider descriptor shapes; no account, credentials, or API connection.' },
  // Infra-pending — never executed
  { capability: 'Real Kubernetes apply', module: 'M4', level: 'infra-pending', note: 'Requires a real cluster + kubeconfig + API server. Manifests are validated, never applied.' },
  { capability: 'Real GitOps reconciliation', module: 'M5', level: 'infra-pending', note: 'Requires a running ArgoCD/Flux controller against a real cluster. Never executed.' },
  { capability: 'Live Prometheus metrics / live Grafana dashboards', module: 'M10', level: 'infra-pending', note: 'Requires live exporters + a running Prometheus/Grafana. No telemetry is collected or rendered.' },
  { capability: 'Live secret synchronization', module: 'M7', level: 'infra-pending', note: 'Requires real backend credentials + network. References only; nothing is fetched or written.' },
  { capability: 'Production failover / disaster recovery execution', module: 'M11', level: 'infra-pending', note: 'Requires real multi-region infrastructure + data replication. Plans are simulated, never run.' },
  { capability: 'Multi-region deployment', module: 'M1/M12', level: 'infra-pending', note: 'Requires real regions, clusters, and credentials. Never executed.' },
];

export interface CloudOpsReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  infraPending: number;
}

export function cloudOpsReadiness(matrix: CapabilityEvidence[] = CLOUDOPS_MATRIX): CloudOpsReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return { total: matrix.length, liveVerified: by('live-verified'), adapterVerified: by('adapter-verified'), infraPending: by('infra-pending') };
}
