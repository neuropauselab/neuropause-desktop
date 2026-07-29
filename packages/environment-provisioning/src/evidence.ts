/**
 * Version 1.1 Program 1C capability evidence matrix — the four-level HONESTY BOUNDARY (reusing the Wave
 * 14 model). Evidence is NEVER promoted without a real basis:
 *   live-verified          — the in-process provisioning-orchestration control plane: the cloud runtime,
 *                            prerequisite gate, every phase provisioning planner, the acceptance
 *                            validator, the evidence-promotion engine, the operations dashboard, and
 *                            governance.
 *   adapter-verified       — the external systems the orchestration drives (AWS, Azure, Google Cloud,
 *                            Terraform, Helm, cert-manager); represented until an operator wires a real one.
 *   business-data-pending  — provisioning runs, cluster health, acceptance results, and monitoring data;
 *                            no real provisioning has occurred.
 *   infrastructure-pending — cloud accounts, a provisioned VPC/cluster/databases, a DNS zone, a TLS
 *                            certificate, and a production deployment; none exist until operators provision.
 * A test asserts no external system, provisioning-run metric, or real-infrastructure row is ever
 * classified live — provisioning is gated on operator input and prepares only; nothing is provisioned.
 */
import type { EpEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  epic: string;
  level: EpEvidenceLevel;
  note: string;
}

export const EP_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process provisioning-orchestration control plane ──
  { capability: 'Cloud Provisioning Runtime', epic: 'E1', level: 'live-verified', note: 'Preview provisions nothing; provision prepares only.' },
  { capability: 'Prerequisite Gate', epic: 'E1', level: 'live-verified', note: 'Stops at PENDING - OPERATOR INPUT REQUIRED with the missing inputs.' },
  { capability: 'Infrastructure Provisioning Planner', epic: 'E2', level: 'live-verified', note: 'Reuses the 1B Terraform generator; plans only.' },
  { capability: 'Kubernetes Provisioning Planner', epic: 'E3', level: 'live-verified', note: 'Reuses the 1B Kubernetes generator; never applies.' },
  { capability: 'Database Provisioning Planner', epic: 'E4', level: 'live-verified', note: 'Reuses the 1B database descriptors; never provisions.' },
  { capability: 'DNS and TLS Provisioning Planner', epic: 'E5', level: 'live-verified', note: 'Reuses the 1B DNS/TLS generator; nothing published or issued.' },
  { capability: 'Secrets Provisioning Planner', epic: 'E6', level: 'live-verified', note: 'Reuses the 1B secrets generator; references only, no values.' },
  { capability: 'Deployment Orchestrator', epic: 'E7', level: 'live-verified', note: 'Prepares Helm apply commands; waits on operator approval.' },
  { capability: 'Monitoring Provisioning Planner', epic: 'E8', level: 'live-verified', note: 'Reuses the 1B monitoring generator; no metric fabricated.' },
  { capability: 'Acceptance Validator', epic: 'E9', level: 'live-verified', note: 'Machine-readable report; every check pending, no pass fabricated.' },
  { capability: 'Evidence Promotion Engine', epic: 'E10', level: 'live-verified', note: 'Records per area; never auto-promotes.' },
  { capability: 'Operations Dashboard', epic: 'E11', level: 'live-verified', note: 'Pending/Provisioning/Failed/Verified; verified always 0.' },
  { capability: 'Governance', epic: 'E1', level: 'live-verified', note: 'Every provisioning activity audited on the one ledger with a replay id.' },
  // ── Adapter-verified — external systems the orchestration drives, until an operator wires a real one ──
  { capability: 'AWS', epic: 'E1', level: 'adapter-verified', note: 'Target provider; not authenticated (no credentials).' },
  { capability: 'Azure', epic: 'E1', level: 'adapter-verified', note: 'Target provider; not authenticated.' },
  { capability: 'Google Cloud', epic: 'E1', level: 'adapter-verified', note: 'Target provider; not authenticated.' },
  { capability: 'Terraform', epic: 'E2', level: 'adapter-verified', note: 'Plans generated; apply is the operator step.' },
  { capability: 'Helm', epic: 'E7', level: 'adapter-verified', note: 'Upgrade commands prepared; run by the operator.' },
  { capability: 'cert-manager', epic: 'E5', level: 'adapter-verified', note: 'Issuer/Certificate target a real cert-manager install.' },
  // ── Business-data-pending — real provisioning activity; never fabricated ──
  { capability: 'Provisioning Runs', epic: 'E1', level: 'business-data-pending', note: 'No provisioning has been applied to real infrastructure.' },
  { capability: 'Cluster Health', epic: 'E3', level: 'business-data-pending', note: 'No cluster exists to report health for.' },
  { capability: 'Acceptance Results', epic: 'E9', level: 'business-data-pending', note: 'No acceptance check has run against real infrastructure.' },
  { capability: 'Monitoring Data', epic: 'E8', level: 'business-data-pending', note: 'No production monitoring datum exists.' },
  // ── Infrastructure-pending — real infrastructure the orchestration provisions ──
  { capability: 'Cloud Accounts', epic: 'E1', level: 'infrastructure-pending', note: 'No cloud account is created or authenticated.' },
  { capability: 'Provisioned VPC', epic: 'E2', level: 'infrastructure-pending', note: 'No VPC/VNet is created.' },
  { capability: 'Provisioned Cluster', epic: 'E3', level: 'infrastructure-pending', note: 'No Kubernetes cluster is provisioned.' },
  { capability: 'Provisioned Databases', epic: 'E4', level: 'infrastructure-pending', note: 'No database is provisioned.' },
  { capability: 'DNS Zone', epic: 'E5', level: 'infrastructure-pending', note: 'No DNS zone is owned or published.' },
  { capability: 'TLS Certificate', epic: 'E5', level: 'infrastructure-pending', note: 'No certificate is issued.' },
  { capability: 'Production Deployment', epic: 'E7', level: 'infrastructure-pending', note: 'No deployment is applied to a real cluster.' },
];

export interface EpReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function epReadiness(matrix: CapabilityEvidence[] = EP_MATRIX): EpReadiness {
  const by = (l: EpEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
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
export const EXPECTED_INFRA_PENDING = INFRASTRUCTURE_PENDING_CAPS.length; // 7
