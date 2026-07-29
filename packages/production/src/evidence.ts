/**
 * Wave 14 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data. Wave 14's
 * fourth level is INFRASTRUCTURE-PENDING (not regulated-external): capabilities that require real
 * infrastructure and are represented via validated descriptors until real environments exist.
 *   live-verified          — production runtime, deployment descriptors, release management,
 *                            zero-downtime upgrade planning, backup registry, DR plans/drills,
 *                            observability runtime, security hardening, compliance verification,
 *                            health monitoring, diagnostics, upgrade assistant, installer,
 *                            documentation, support, SDK, and governance — executed in-process.
 *   adapter-verified       — Kubernetes / Docker / AWS / Azure / GCP / VMware / Hyper-V and external
 *                            monitoring providers; represented until configured, never provisioned.
 *   business-data-pending  — production metrics, customer deployments, upgrade/incident/performance
 *                            history; empty until real deployed environments emit them.
 *   infrastructure-pending — real HA clusters, real multi-region failover, production DR, and global
 *                            replication; represented via descriptors until real infrastructure exists.
 * A test asserts nothing infrastructure-pending or business-data-pending is marked live-verified,
 * and that no certification is claimed anywhere.
 */
import type { ProductionEvidenceLevel } from './types';
import { INFRASTRUCTURE_PENDING_CAPS, DEPLOY_ADAPTER_CATALOG } from './constants';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: ProductionEvidenceLevel;
  note: string;
}

export const PRODUCTION_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — executed in-process, through the one runtime and governance ──
  { capability: 'Production Runtime + Registries', module: 'M1', level: 'live-verified', note: 'Environment/deployment/release registries + runtime health; governed; starts empty.' },
  { capability: 'Release Management', module: 'M3', level: 'live-verified', note: 'Pipeline/semver/promotion/approval/rollback; production promotion requires approval.' },
  { capability: 'Zero-Downtime Upgrade Planning', module: 'M4', level: 'live-verified', note: 'Rolling/blue-green/canary/progressive step + rollback plans; no live traffic shifted here.' },
  { capability: 'Backup Registry', module: 'M5', level: 'live-verified', note: 'Snapshots + restore validation; never marked restorable until a real integrity check runs.' },
  { capability: 'Disaster Recovery Plans & Drills', module: 'M6', level: 'live-verified', note: 'DR plans + drills recorded; REUSES cloud-ops failover. Real failover is infrastructure-pending.' },
  { capability: 'Observability Runtime', module: 'M8', level: 'live-verified', note: 'Metrics/logs/traces/alerts; REUSES the operations dashboard + health registry.' },
  { capability: 'Security Hardening', module: 'M9', level: 'live-verified', note: 'Policies/cert expiry/key rotation/session validation; REUSES the security key & session managers.' },
  { capability: 'Compliance Verification', module: 'M10', level: 'live-verified', note: 'Security/config/dependency/license/infra audits → evidence reports. NEVER a certification.' },
  { capability: 'Health Monitoring', module: 'M13', level: 'live-verified', note: 'Platform/tenant/workforce/workspace/business/infra health; REUSES Wave 12 mission control.' },
  { capability: 'Enterprise Diagnostics', module: 'M14', level: 'live-verified', note: 'Diagnostic bundles from real runtime state — nothing invented.' },
  { capability: 'Upgrade Assistant', module: 'M15', level: 'live-verified', note: 'Compatibility (real semver), dependency validation, migration plan, checklist, rollback.' },
  { capability: 'Installer Platform', module: 'M16', level: 'live-verified', note: 'Installer descriptors for Windows/macOS/Linux/Docker/K8s; artifacts represented, not built here.' },
  { capability: 'Enterprise Documentation', module: 'M17', level: 'live-verified', note: 'Admin/user/API/SDK/deployment/DR/security/ops guide outlines generated.' },
  { capability: 'Support Platform', module: 'M18', level: 'live-verified', note: 'Support bundles from real runtime state; REUSES the operations incident registry.' },
  { capability: 'Production SDK', module: 'M19', level: 'live-verified', note: 'Register deployment/monitoring/health/diagnostics/installer/upgrade extensions; each reuses ≥1.' },
  { capability: 'Production Governance', module: 'M21', level: 'live-verified', note: 'Every action records org/environment/operator/version/deployment/evidence/approval/replay id.' },
  // ── Adapter-verified — external deployment / monitoring providers, until configured ──
  { capability: 'Kubernetes', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no cluster created here.' },
  { capability: 'Docker', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no container run here.' },
  { capability: 'AWS', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no infrastructure provisioned here.' },
  { capability: 'Azure', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no infrastructure provisioned here.' },
  { capability: 'Google Cloud', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no infrastructure provisioned here.' },
  { capability: 'VMware', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no VM provisioned here.' },
  { capability: 'Hyper-V', module: 'M2', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no VM provisioned here.' },
  { capability: 'Monitoring Providers', module: 'M8', level: 'adapter-verified', note: 'Represented; adapter-verified until configured; no external monitoring queried here.' },
  // ── Business-data-pending — real telemetry/history; empty until deployed environments emit it ──
  { capability: 'Production Metrics', module: 'M8', level: 'business-data-pending', note: 'Counters read 0 until a deployed environment emits telemetry — never fabricated.' },
  { capability: 'Customer Deployments', module: 'M2', level: 'business-data-pending', note: 'Empty until real customer environments are deployed.' },
  { capability: 'Upgrade History', module: 'M15', level: 'business-data-pending', note: 'Empty until real upgrades run.' },
  { capability: 'Incident History', module: 'M18', level: 'business-data-pending', note: 'Empty until real incidents occur (reused from operations).' },
  { capability: 'Performance History', module: 'M11', level: 'business-data-pending', note: 'Only measured results (reused operations monitor); none until measured.' },
  // ── Infrastructure-pending — represented via descriptors until real infrastructure exists ──
  { capability: 'Real HA Clusters', module: 'M7', level: 'infrastructure-pending', note: 'Cluster descriptors + quorum computed; a real cluster with real node health is not provisioned here.' },
  { capability: 'Real Multi-Region Failover', module: 'M6', level: 'infrastructure-pending', note: 'Failover plans represented; real cross-region failover requires configured DR infrastructure.' },
  { capability: 'Production DR', module: 'M6', level: 'infrastructure-pending', note: 'DR drills validate plan structure only; real disaster recovery requires real infrastructure.' },
  { capability: 'Global Replication', module: 'M7', level: 'infrastructure-pending', note: 'Replica registry represented; real global replication requires real infrastructure.' },
];

export interface ProductionReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function productionReadiness(matrix: CapabilityEvidence[] = PRODUCTION_MATRIX): ProductionReadiness {
  const by = (l: ProductionEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    infrastructurePending: by('infrastructure-pending'),
  };
}

/** Sanity constants for the honesty invariant test. */
export const EXPECTED_ADAPTERS = DEPLOY_ADAPTER_CATALOG.length;
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length;
