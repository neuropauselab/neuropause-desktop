/**
 * Launch Workstream 1 capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave 14
 * model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process CONTROL PLANE that really executes: environment/cluster
 *                            inventory, k8s/database/API/networking/storage/monitoring descriptor
 *                            registries, identity activation, AI-ops routing, CI/CD, the operations
 *                            center, backup/recovery orchestration, production security, deployment
 *                            automation, validation, documentation, the executive dashboard, and
 *                            governance.
 *   adapter-verified       — external providers/engines: AWS/Azure/GCP, PostgreSQL/Redis/Qdrant, the AI
 *                            providers, the monitoring stack, Vault, and CDN/WAF; represented until
 *                            configured.
 *   business-data-pending  — real production traffic, customer sessions, AI usage, database query load,
 *                            and production metrics; never fabricated.
 *   infrastructure-pending — the LIVE domain (app.neuropause033.com), running Kubernetes clusters,
 *                            provisioned production databases, issued TLS certificates, production load
 *                            balancers, and production object storage; represented until provisioned.
 * A test asserts that no adapter, business-data, or infrastructure capability is ever classified live,
 * and that the live domain, running clusters, and provisioned databases are infrastructure-pending.
 */
import type { PlatformOpsEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: PlatformOpsEvidenceLevel;
  note: string;
}

export const PLATFORM_OPS_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process control plane ──
  { capability: 'Environment Inventory Runtime', epic: 'E1', level: 'live-verified', note: 'Environment/region registry + lifecycle; governed.' },
  { capability: 'Cluster / Resource Inventory', epic: 'E1', level: 'live-verified', note: 'Reuses infrastructure; clusters register with 0 running nodes until real.' },
  { capability: 'Kubernetes Descriptor Registry', epic: 'E2', level: 'live-verified', note: 'All 11 resource kinds as descriptors; reuses deploy manifest assets.' },
  { capability: 'Database Descriptor Registry', epic: 'E3', level: 'live-verified', note: 'Pools + descriptors; reuses infra (health unknown) + production backups.' },
  { capability: 'Connection Pool Registry', epic: 'E3', level: 'live-verified', note: 'Pool descriptors; live connection health requires a real probe.' },
  { capability: 'API Platform Registry', epic: 'E4', level: 'live-verified', note: 'Gateway + 7 services over REST/GraphQL/WebSocket as endpoint descriptors.' },
  { capability: 'Networking Descriptor Registry', epic: 'E5', level: 'live-verified', note: 'DNS/TLS/LB/WAF descriptors; the domain is reported NOT live.' },
  { capability: 'Identity Activation Runtime', epic: 'E6', level: 'live-verified', note: 'Real identity/MFA/session via reused security; external IdPs represented.' },
  { capability: 'AI Runtime Operations', epic: 'E7', level: 'live-verified', note: 'Real in-process routing + failover; providers represented, no model invoked.' },
  { capability: 'Storage Descriptor Registry', epic: 'E8', level: 'live-verified', note: 'Object/file/backup/log/artifact descriptors + lifecycle policies.' },
  { capability: 'CI/CD Pipeline Runtime', epic: 'E9', level: 'live-verified', note: 'Build/release reuse the Sprint-6 release automation (real checksums).' },
  { capability: 'Monitoring Descriptor Registry', epic: 'E10', level: 'live-verified', note: 'Dashboards declared; platform health reuses the operations overview.' },
  { capability: 'Operations Center Runtime', epic: 'E11', level: 'live-verified', note: 'Health snapshot + incident center reusing operations incidents.' },
  { capability: 'Backup & Recovery Orchestration', epic: 'E12', level: 'live-verified', note: 'Reuses production backups + the Sprint-4 recovery validation.' },
  { capability: 'Production Security Runtime', epic: 'E13', level: 'live-verified', note: 'Real key rotation; Vault + certs reused; secrets are references only.' },
  { capability: 'Deployment Automation', epic: 'E14', level: 'live-verified', note: 'Artifacts + rollback verified; rolling real traffic is infrastructure-pending.' },
  { capability: 'Production Validation Runtime', epic: 'E15', level: 'live-verified', note: 'Reuses the Sprint-4 end-to-end validation; only measured results.' },
  { capability: 'Operations Documentation', epic: 'E16', level: 'live-verified', note: 'Seven manuals; reuses reliability documentation generators.' },
  { capability: 'Executive Operations Dashboard', epic: 'E17', level: 'live-verified', note: 'Live tiles only where real; domain reported not live.' },
  { capability: 'Governance', epic: 'E18', level: 'live-verified', note: 'Every production operation audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external providers/engines, until configured ──
  { capability: 'AWS', epic: 'E1', level: 'adapter-verified', note: 'Cloud provider represented; requires real credentials + account.' },
  { capability: 'Azure', epic: 'E1', level: 'adapter-verified', note: 'Cloud provider represented; requires real credentials + account.' },
  { capability: 'Google Cloud', epic: 'E1', level: 'adapter-verified', note: 'Cloud provider represented; requires real credentials + account.' },
  { capability: 'PostgreSQL', epic: 'E3', level: 'adapter-verified', note: 'Engine represented; a provisioned instance is infrastructure-pending.' },
  { capability: 'Redis', epic: 'E3', level: 'adapter-verified', note: 'Engine represented; a provisioned instance is infrastructure-pending.' },
  { capability: 'Qdrant', epic: 'E3', level: 'adapter-verified', note: 'Engine represented; a provisioned instance is infrastructure-pending.' },
  { capability: 'AI providers', epic: 'E7', level: 'adapter-verified', note: 'Ollama/OpenAI/Anthropic/Gemini/Azure OpenAI represented until configured.' },
  { capability: 'Monitoring stack', epic: 'E10', level: 'adapter-verified', note: 'Prometheus/Grafana/Loki/OTel represented until real endpoints exist.' },
  { capability: 'Vault', epic: 'E13', level: 'adapter-verified', note: 'HashiCorp Vault represented; integrated via infra secrets, not populated.' },
  { capability: 'CDN / WAF providers', epic: 'E5', level: 'adapter-verified', note: 'CDN + WAF represented; require real provider configuration.' },
  // ── Business-data-pending — real production data; never fabricated ──
  { capability: 'Real production traffic', epic: 'E4', level: 'business-data-pending', note: 'No real request traffic is served or measured here.' },
  { capability: 'Real customer sessions', epic: 'E6', level: 'business-data-pending', note: 'Session activation is real in-process; real end-user sessions await go-live.' },
  { capability: 'Real AI usage', epic: 'E7', level: 'business-data-pending', note: 'No external model is invoked; real usage requires configured providers + traffic.' },
  { capability: 'Real database query load', epic: 'E3', level: 'business-data-pending', note: 'No real queries run; query load requires a provisioned database.' },
  { capability: 'Real production metrics', epic: 'E10', level: 'business-data-pending', note: 'Live metrics require a configured monitoring stack + real traffic.' },
  // ── Infrastructure-pending — real provisioned infrastructure ──
  { capability: 'Live domain (app.neuropause033.com)', epic: 'E5', level: 'infrastructure-pending', note: 'The domain is NOT live; it is served only when real DNS/TLS/ingress exist.' },
  { capability: 'Running Kubernetes clusters', epic: 'E2', level: 'infrastructure-pending', note: 'Clusters register with 0 running nodes; a running cluster is provisioned by ops.' },
  { capability: 'Provisioned production databases', epic: 'E3', level: 'infrastructure-pending', note: 'Databases are descriptors with unknown health until a real instance is provisioned.' },
  { capability: 'Issued TLS certificates', epic: 'E5', level: 'infrastructure-pending', note: 'Certificates are not issued until a real issuance occurs.' },
  { capability: 'Production load balancers', epic: 'E5', level: 'infrastructure-pending', note: 'Load balancers are descriptors; a real LB requires provisioned infrastructure.' },
  { capability: 'Production object storage', epic: 'E8', level: 'infrastructure-pending', note: 'Buckets are descriptors; a real bucket serving bytes is infrastructure-pending.' },
];

export interface PlatformOpsReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function platformOpsReadiness(matrix: CapabilityEvidence[] = PLATFORM_OPS_MATRIX): PlatformOpsReadiness {
  const by = (l: PlatformOpsEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = MATRIX_ADAPTERS.length; // 10
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 6
