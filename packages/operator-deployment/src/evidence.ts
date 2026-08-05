/**
 * Version 1.1 Program 1C (Operator Deployment) capability evidence matrix — the four-level HONESTY
 * BOUNDARY (reusing the Wave 14 model):
 *   live-verified          — the operator workflow: wizard, environment validator, deployment executor,
 *                            live validation, rollback engine, evidence package, operator dashboard,
 *                            documentation, and governance.
 *   adapter-verified       — the external systems the operator supplies (cloud credentials, the
 *                            Kubernetes API, the container registry, the DNS provider, the TLS issuer).
 *   business-data-pending  — deployment runs, rollout metrics, and live-validation results; nothing deployed.
 *   infrastructure-pending — a reachable cluster/databases/registry/DNS and a production rollout.
 * A test asserts no external system, deployment-run metric, or real-infrastructure row is ever classified
 * live — the validator STOPS at PENDING, the executor never fabricates success, and nothing is Verified
 * without real evidence.
 */
import type { OdEvidenceLevel } from './types';
import { MATRIX_ADAPTERS, INFRASTRUCTURE_PENDING_CAPS } from './constants';

export interface CapabilityEvidence {
  capability: string;
  step: string;
  level: OdEvidenceLevel;
  note: string;
}

export const OD_MATRIX: CapabilityEvidence[] = [
  // ── Live-verified — the in-process operator workflow ──
  { capability: 'Deployment Wizard', step: '1', level: 'live-verified', note: 'Collects config + reports missing fields; references only.' },
  { capability: 'Environment Validator', step: '2', level: 'live-verified', note: 'Stops at PENDING - OPERATOR ACTION REQUIRED; never fabricates reachability.' },
  { capability: 'Deployment Executor', step: '3', level: 'live-verified', note: 'Approval + validation gated; prepares commands, executed:false.' },
  { capability: 'Live Validation', step: '4', level: 'live-verified', note: 'Machine-readable checks; every check pending, no output fabricated.' },
  { capability: 'Rollback Engine', step: '5', level: 'live-verified', note: 'Auto-generates a rollback plan on triggers; executes nothing.' },
  { capability: 'Evidence Package', step: '6', level: 'live-verified', note: 'Items pending; never auto-promoted.' },
  { capability: 'Operator Dashboard', step: '7', level: 'live-verified', note: 'Pending/Running/Succeeded/Failed/Verified; succeeded + verified always 0.' },
  { capability: 'Documentation', step: '8', level: 'live-verified', note: 'Six operator guides; no deployment result fabricated.' },
  { capability: 'Governance', step: '-', level: 'live-verified', note: 'Every activity audited on the one ledger with a replay id.' },
  // ── Adapter-verified — the external systems the operator supplies ──
  { capability: 'Cloud Credentials', step: '2', level: 'adapter-verified', note: 'Verified by an operator probe (aws sts get-caller-identity); not held here.' },
  { capability: 'Kubernetes API', step: '2', level: 'adapter-verified', note: 'Reachability probed by the operator (kubectl cluster-info).' },
  { capability: 'Container Registry', step: '2', level: 'adapter-verified', note: 'Reachability probed by the operator (docker login/pull).' },
  { capability: 'DNS Provider', step: '2', level: 'adapter-verified', note: 'Availability probed by the operator (dig).' },
  { capability: 'TLS Issuer', step: '2', level: 'adapter-verified', note: 'Availability probed by the operator (kubectl get clusterissuer).' },
  // ── Business-data-pending — real deployment activity; never fabricated ──
  { capability: 'Deployment Runs', step: '3', level: 'business-data-pending', note: 'No deployment has been executed against real infrastructure.' },
  { capability: 'Rollout Metrics', step: '4', level: 'business-data-pending', note: 'No rollout metric exists; no rollout has occurred.' },
  { capability: 'Live Validation Results', step: '4', level: 'business-data-pending', note: 'No live-validation check has run against a real deployment.' },
  // ── Infrastructure-pending — real, reachable infrastructure ──
  { capability: 'Reachable Cluster', step: '2', level: 'infrastructure-pending', note: 'No Kubernetes cluster is reachable.' },
  { capability: 'Reachable Databases', step: '2', level: 'infrastructure-pending', note: 'No database is reachable.' },
  { capability: 'Reachable Registry', step: '2', level: 'infrastructure-pending', note: 'No container registry is reachable.' },
  { capability: 'Reachable DNS', step: '2', level: 'infrastructure-pending', note: 'No DNS zone is available.' },
  { capability: 'Production Rollout', step: '3', level: 'infrastructure-pending', note: 'No production rollout is applied to a real cluster.' },
];

export interface OdReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  infrastructurePending: number;
}

export function odReadiness(matrix: CapabilityEvidence[] = OD_MATRIX): OdReadiness {
  const by = (l: OdEvidenceLevel): number => matrix.filter((m) => m.level === l).length;
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
