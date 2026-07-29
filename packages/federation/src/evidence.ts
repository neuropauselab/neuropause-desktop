/**
 * Wave 6 capability evidence matrix — the HONESTY BOUNDARY encoded as data, verbatim from
 * the program:
 *   live-verified    — federation runtime/registry/APIs/marketplace/search/governance/
 *                      analytics/dashboards, executed in-process over real runtime data
 *   adapter-verified — Kubernetes/AWS/Azure/GCP/Docker deployment DESCRIPTORS (shapes only)
 *   infra-pending    — real clusters, real cloud deployments, cross-region replication,
 *                      multi-cloud sync, failover, DR, live marketplace distribution
 * A test asserts no infra-pending capability is ever marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const FEDERATION_MATRIX: CapabilityEvidence[] = [
  { capability: 'Federation Runtime', module: 'M1', level: 'live-verified', note: 'Federation engine, org registry, lifecycle, trust, metadata — in-process, governed.' },
  { capability: 'Organization Manager', module: 'M2', level: 'live-verified', note: 'Create/update/archive/membership/metadata — in-process, governed.' },
  { capability: 'Multi-Tenant Federation', module: 'M3', level: 'live-verified', note: 'Tenant isolation, federation, shared policies, discovery.' },
  { capability: 'Federation Trust Engine', module: 'M7', level: 'live-verified', note: 'Trust relationships, validation, policies, permissions.' },
  { capability: 'Cross-Organization Exchange', module: 'M8', level: 'live-verified', note: 'Share workflows/policies/dashboards/playbooks/connectors/agents as references — no cross-org execution.' },
  { capability: 'Marketplace Runtime', module: 'M9', level: 'live-verified', note: 'Publish/search/install (copy) — publishing only; live distribution is infra-pending.' },
  { capability: 'Global Search', module: 'M10', level: 'live-verified', note: 'Unified search across orgs/federations/exchange/marketplace via the source-registry pattern.' },
  { capability: 'Federation Observability', module: 'M11', level: 'live-verified', note: 'Federation/org/trust/exchange/region/cluster/deployment health from real in-process state — no cloud metrics.' },
  { capability: 'Global Governance', module: 'M12', level: 'live-verified', note: 'Every federation operation audited on the one chain with federation id, replay id, evidence.' },
  { capability: 'Federation Analytics', module: 'M13', level: 'live-verified', note: 'Org/connector counts, topology, deployment inventory, exchange metrics — real runtime data only.' },
  { capability: 'Executive Federation Dashboards', module: 'M14', level: 'live-verified', note: 'Six role dashboards from live analytics + observability.' },
  { capability: 'Federation APIs', module: 'M15', level: 'live-verified', note: 'createFederation/join/leave/registerOrganization/... executed in-process.' },
  // Descriptors — adapter-verified (shapes validated), never applied
  { capability: 'Docker deployment descriptors', module: 'M6', level: 'adapter-verified', note: 'compose-shaped descriptor validated; not applied.' },
  { capability: 'Kubernetes deployment descriptors', module: 'M6', level: 'adapter-verified', note: 'Deployment+Service-shaped manifest validated; no real cluster.' },
  { capability: 'AWS deployment descriptors', module: 'M6', level: 'adapter-verified', note: 'ECS/task-shaped descriptor validated; no real AWS deploy.' },
  { capability: 'Azure deployment descriptors', module: 'M6', level: 'adapter-verified', note: 'Container-app-shaped descriptor validated; no real Azure deploy.' },
  { capability: 'GCP deployment descriptors', module: 'M6', level: 'adapter-verified', note: 'Cloud-Run-shaped descriptor validated; no real GCP deploy.' },
  { capability: 'Region / Cluster registries', module: 'M4/M5', level: 'adapter-verified', note: 'Region/AZ/edge/cluster/node/service records — simulation metadata, no real provisioning.' },
  // Infra-pending — never executed
  { capability: 'Real Kubernetes / AWS / Azure / GCP deployment', module: 'M6', level: 'infra-pending', note: 'Requires real clusters/cloud accounts + credentials + network. Never executed.' },
  { capability: 'Cross-region replication / multi-cloud sync / failover / DR', module: 'M4/M5', level: 'infra-pending', note: 'Requires real infrastructure. Never executed or claimed.' },
  { capability: 'Live marketplace distribution', module: 'M9', level: 'infra-pending', note: 'Real cross-org package distribution needs a hosted registry + network. Never executed.' },
];

export interface FederationReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  infraPending: number;
}

export function federationReadiness(matrix: CapabilityEvidence[] = FEDERATION_MATRIX): FederationReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return { total: matrix.length, liveVerified: by('live-verified'), adapterVerified: by('adapter-verified'), infraPending: by('infra-pending') };
}
