/**
 * Federation Platform (P10) — the intelligence / governance / integration LAYER
 * over the existing federation runtime (peers, trust, signed exchange, cross-org
 * governance from Phase 9 · Stage 2). These are VIEW-MODEL projections: they are
 * derived from the existing `FederatedOrg` / `TrustRelationship` / `SharedResource`
 * / `ExchangeArtifact` / `FedPolicy` / `FedAuditEntry` state — no new runtime,
 * store, package format, PKI, graph, search, or governance engine.
 *
 *  • Federation Graph   — organizations, trust relationships, and shared assets as
 *                         a graph projection (mirrors the org-graph pattern; NOT a
 *                         second graph store).
 *  • Federation Timeline— a unified, immutable, sorted read-model of cross-org
 *                         events (invitations, trust changes, shares, publishes,
 *                         governance decisions) — reuses the existing Timeline
 *                         concept, adds no event store.
 *  • Federation Search  — policy-aware hits over orgs / artifacts / policies /
 *                         shared resources, also injected into Enterprise Search.
 *  • Federation Analytics + Directory — the Operations-Center rollup.
 */
import type { CloudRegionId } from './cloud';
import type {
  ExchangeKind,
  FederationRole,
  FederationStatus,
  FederationSummary,
  FedPolicyEffect,
  MarketplaceScopeSummary,
  SharedResourceKind,
  TrustLevel,
} from './federation';

/* ════════════════════════════ Federation Graph ════════════════════════════ */

export type FederationGraphNodeKind = 'organization' | 'artifact' | 'shared_resource';

export interface FederationGraphNode {
  id: string;
  kind: FederationGraphNodeKind;
  label: string;
  sublabel: string;
  /** For organization nodes: the trust level; null otherwise. */
  trustLevel: TrustLevel | null;
  /** Whether this is the home organization (the local tenant). */
  home: boolean;
}

export type FederationGraphEdgeKind = 'trust' | 'shares' | 'publishes';

export interface FederationGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: FederationGraphEdgeKind;
  label: string;
}

export interface FederationGraph {
  homeOrgId: string;
  nodes: FederationGraphNode[];
  edges: FederationGraphEdge[];
  counts: { organizations: number; artifacts: number; sharedResources: number; edges: number };
}

/* ════════════════════════════ Federation Timeline ═════════════════════════ */

export type FederationTimelineKind =
  | 'invitation'
  | 'trust_change'
  | 'resource_share'
  | 'artifact_publish'
  | 'governance';

export interface FederationTimelineEntry {
  id: string;
  at: string;
  kind: FederationTimelineKind;
  title: string;
  detail: string;
  actorOrg: string;
  actorOrgName: string;
  peerOrg: string | null;
  peerOrgName: string | null;
  /** For governance entries: the policy decision; null otherwise. */
  decision: FedPolicyEffect | null;
}

/* ════════════════════════════ Federation Search ═══════════════════════════ */

export type FederationSearchKind = 'organization' | 'artifact' | 'policy' | 'shared_resource';

export interface FederationSearchHit {
  kind: FederationSearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Relevance 0..1 within the federation source. */
  score: number;
  badge: string | null;
}

/* ════════════════════════════ Directory + Analytics ═══════════════════════ */

export type OrgHealth = 'healthy' | 'attention' | 'inactive';

export interface OrgDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  role: FederationRole;
  status: FederationStatus;
  trustLevel: TrustLevel;
  regionId: CloudRegionId;
  sharedOut: number;
  sharedIn: number;
  canShareWorkers: boolean;
  canShareData: boolean;
  delegatedApproval: boolean;
  health: OrgHealth;
}

export interface TrustDistribution {
  level: TrustLevel;
  count: number;
}

export interface FederationExchangeStats {
  artifacts: number;
  verified: number;
  installs: number;
  byKind: { kind: ExchangeKind; count: number }[];
}

export interface FederationGovernanceStats {
  policies: number;
  activePolicies: number;
  pendingApprovals: number;
  complianceScore: number;
  auditEntries: number;
}

export interface FederationAnalytics {
  orgs: number;
  activePeers: number;
  trustedPeers: number;
  pendingInvites: number;
  sharedOut: number;
  sharedIn: number;
  trustDistribution: TrustDistribution[];
  exchange: FederationExchangeStats;
  scopes: MarketplaceScopeSummary[];
  governance: FederationGovernanceStats;
  topShared: { kind: SharedResourceKind; count: number }[];
}

/* ════════════════════════════ Governed sharing decision ═══════════════════ */

/** The decision for a policy-driven cross-org share/install (reuses the fed effect vocabulary). */
export interface FederationShareEvaluation {
  decision: FedPolicyEffect;
  kind: SharedResourceKind;
  trustLevel: TrustLevel;
  reasons: string[];
}

/* ════════════════════════════ Overview bundle ═════════════════════════════ */

export interface FederationOverview {
  summary: FederationSummary;
  analytics: FederationAnalytics;
  directory: OrgDirectoryEntry[];
  recentTimeline: FederationTimelineEntry[];
}
