/**
 * Federation Platform (P10) — the pure intelligence model.
 *
 * All non-trivial federation-layer logic lives here (the house pure-model pattern) so it is
 * unit-tested under Node with no I/O. It projects the EXISTING federation runtime state
 * (peers, invitations, trust, shared resources, exchange artifacts, cross-org policies +
 * audit — Phase 9 · Stage 2) into unified VIEW MODELS: a federation graph, a unified
 * timeline, discovery/search, an org directory, analytics, and a policy-driven sharing
 * decision. No new runtime, store, package format, PKI, graph engine, search engine, or
 * governance engine — every function is a projection over data the federation stores already own.
 */
import type {
  DelegatedApproval,
  ExchangeArtifact,
  ExchangeKind,
  FederatedOrg,
  FederationAnalytics,
  FederationGraph,
  FederationGraphEdge,
  FederationGraphNode,
  FederationOverview,
  FederationSearchHit,
  FederationSearchKind,
  FederationShareEvaluation,
  FederationSummary,
  FederationTimelineEntry,
  FedAuditEntry,
  FedPolicy,
  FedPolicyEffect,
  GlobalGovSummary,
  MarketplaceScopeSummary,
  OrgDirectoryEntry,
  OrgHealth,
  OrgInvitation,
  SharedResource,
  SharedResourceKind,
  TrustDistribution,
  TrustLevel,
  TrustRelationship,
} from '@neuropause/shared';
import { EXCHANGE_KINDS } from '@neuropause/shared';

/* ── trust ranking (reuses the existing TrustLevel vocabulary) ────────────── */

const TRUST_RANK: Record<TrustLevel, number> = { none: 0, basic: 1, verified: 2, full: 3 };
const TRUST_LEVELS: readonly TrustLevel[] = ['none', 'basic', 'verified', 'full'];
export function trustRank(t: TrustLevel): number {
  return TRUST_RANK[t];
}

const EFFECT_RANK: Record<FedPolicyEffect, number> = { allow: 0, require_approval: 1, deny: 2 };
/** Combine two policy effects most-restrictive-wins (the existing federation governance rule). */
export function mostRestrictive(a: FedPolicyEffect, b: FedPolicyEffect): FedPolicyEffect {
  return EFFECT_RANK[a] >= EFFECT_RANK[b] ? a : b;
}

/** The composed federation state the projections read (assembled by the service from the stores). */
export interface FederationState {
  homeOrgId: string;
  homeOrgName: string;
  orgs: FederatedOrg[];
  invitations: OrgInvitation[];
  trust: TrustRelationship[];
  shared: SharedResource[];
  artifacts: ExchangeArtifact[];
  policies: FedPolicy[];
  approvals: DelegatedApproval[];
  audit: FedAuditEntry[];
  summary: FederationSummary;
  scopes: MarketplaceScopeSummary[];
  govSummary: GlobalGovSummary;
}

function homeIdOf(state: FederationState): string {
  return state.orgs.find((o) => o.role === 'home')?.id ?? state.homeOrgId;
}

/* ── Federation Graph (projection; NOT a second graph store) ──────────────── */

/**
 * Project organizations, trust relationships, and shared assets into a graph. Mirrors the
 * org-graph projection pattern — an on-demand view over live state, not a persisted graph.
 * Represents: organizations, trust edges, shared resources, and published exchange artifacts.
 */
export function buildFederationGraph(state: FederationState): FederationGraph {
  const homeId = homeIdOf(state);
  const nodes: FederationGraphNode[] = [];
  const edges: FederationGraphEdge[] = [];
  const orgIds = new Set<string>();

  for (const org of state.orgs) {
    orgIds.add(org.id);
    nodes.push({
      id: org.id,
      kind: 'organization',
      label: org.name,
      sublabel: org.role === 'home' ? 'Home organization' : `${org.status} · ${org.regionId}`,
      trustLevel: org.role === 'home' ? null : org.trustLevel,
      home: org.role === 'home',
    });
  }

  // The home node must exist before drawing any home-sourced edge — guards against a corrupted
  // state with no role:'home' org, which would otherwise dangle those edges.
  const hasHome = orgIds.has(homeId);
  // Bound the projection so the IPC payload stays finite at large scale (orgs + trust are the
  // primary structure and stay whole; shared resources and artifacts are capped).
  const MAX_ARTIFACTS = 200;
  const MAX_SHARED = 200;

  // Trust edges: home → peer.
  for (const t of state.trust) {
    if (!hasHome || !orgIds.has(t.peerOrg)) continue;
    edges.push({ id: `trust:${t.id}`, from: homeId, to: t.peerOrg, kind: 'trust', label: t.trustLevel });
  }

  // Shared-resource nodes bridge home and the peer they are shared with (bounded).
  const sharedSlice = state.shared.slice(0, MAX_SHARED);
  for (const s of sharedSlice) {
    const rid = `res:${s.id}`;
    nodes.push({ id: rid, kind: 'shared_resource', label: s.name, sublabel: `${s.kind} · ${s.access}`, trustLevel: null, home: false });
    if (hasHome) edges.push({ id: `share-home:${s.id}`, from: homeId, to: rid, kind: 'shares', label: s.direction });
    if (orgIds.has(s.peerOrg)) edges.push({ id: `share-peer:${s.id}`, from: rid, to: s.peerOrg, kind: 'shares', label: s.access });
  }

  // Published exchange artifacts, attributed to their publishing org (fallback: home if known).
  const artifactSlice = state.artifacts.slice(0, MAX_ARTIFACTS);
  for (const a of artifactSlice) {
    const aid = `art:${a.id}`;
    nodes.push({ id: aid, kind: 'artifact', label: a.name, sublabel: `${a.kind} · ${a.scope}`, trustLevel: null, home: false });
    const publisher = orgIds.has(a.publisherOrg) ? a.publisherOrg : hasHome ? homeId : null;
    if (publisher) edges.push({ id: `pub:${a.id}`, from: publisher, to: aid, kind: 'publishes', label: a.kind });
  }

  return {
    homeOrgId: homeId,
    nodes,
    edges,
    counts: { organizations: orgIds.size, artifacts: artifactSlice.length, sharedResources: sharedSlice.length, edges: edges.length },
  };
}

/* ── Federation Timeline (unified read-model; reuses the Timeline concept) ── */

/**
 * Merge cross-org events — invitations, trust changes, resource shares, artifact publishes,
 * and governance decisions — into one immutable, newest-first timeline. Reuses the existing
 * FedAuditEntry data; adds no event store.
 */
export function buildFederationTimeline(state: FederationState): FederationTimelineEntry[] {
  const home = homeIdOf(state);
  const out: FederationTimelineEntry[] = [];

  for (const inv of state.invitations) {
    out.push({
      id: `inv:${inv.id}`,
      at: inv.respondedAt ?? inv.createdAt,
      kind: 'invitation',
      title: `Invitation ${inv.status} — ${inv.direction === 'outbound' ? inv.toOrgName : inv.fromOrgName}`,
      detail: inv.message || `${inv.direction} invitation at trust "${inv.trustLevel}"`,
      actorOrg: inv.fromOrg,
      actorOrgName: inv.fromOrgName,
      peerOrg: inv.toOrg,
      peerOrgName: inv.toOrgName,
      decision: null,
    });
  }
  for (const t of state.trust) {
    out.push({
      id: `trust:${t.id}`,
      at: t.establishedAt,
      kind: 'trust_change',
      title: `Trust established: ${t.trustLevel}`,
      detail: `workers=${t.canShareWorkers} data=${t.canShareData} delegatedApproval=${t.delegatedApproval}`,
      actorOrg: home,
      actorOrgName: state.homeOrgName,
      peerOrg: t.peerOrg,
      peerOrgName: t.peerOrgName,
      decision: null,
    });
  }
  for (const s of state.shared) {
    out.push({
      id: `share:${s.id}`,
      at: s.sharedAt,
      kind: 'resource_share',
      title: `Shared ${s.kind}: ${s.name}`,
      detail: `${s.direction} · ${s.access}`,
      actorOrg: home,
      actorOrgName: state.homeOrgName,
      peerOrg: s.peerOrg,
      peerOrgName: s.peerOrgName,
      decision: null,
    });
  }
  for (const a of state.artifacts) {
    const version = a.versions.find((v) => v.id === a.currentVersionId) ?? a.versions[a.versions.length - 1] ?? null;
    out.push({
      id: `pub:${a.id}`,
      at: version?.publishedAt ?? a.createdAt,
      kind: 'artifact_publish',
      title: `Published ${a.kind}: ${a.name}`,
      detail: `scope=${a.scope} · verification=${a.verification}`,
      actorOrg: a.publisherOrg,
      actorOrgName: a.publisherOrgName,
      peerOrg: null,
      peerOrgName: null,
      decision: null,
    });
  }
  for (const e of state.audit) {
    out.push({
      id: `gov:${e.id}`,
      at: e.at,
      kind: 'governance',
      title: e.action,
      detail: e.detail,
      actorOrg: e.actorOrg,
      actorOrgName: e.actorOrgName,
      peerOrg: e.peerOrg,
      peerOrgName: e.peerOrgName,
      decision: e.decision,
    });
  }

  return out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}

/* ── Organization directory + health ──────────────────────────────────────── */

function orgHealth(org: FederatedOrg, trust: TrustRelationship | null): OrgHealth {
  if (org.role === 'home') return 'healthy';
  if (org.status !== 'active') return 'inactive';
  if (!trust || trustRank(org.trustLevel) <= TRUST_RANK.basic) return 'attention';
  return 'healthy';
}

export function buildOrgDirectory(state: FederationState): OrgDirectoryEntry[] {
  const trustByOrg = new Map<string, TrustRelationship>();
  for (const t of state.trust) trustByOrg.set(t.peerOrg, t);

  return state.orgs
    .map((org): OrgDirectoryEntry => {
      const trust = trustByOrg.get(org.id) ?? null;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: org.role,
        status: org.status,
        trustLevel: org.trustLevel,
        regionId: org.regionId,
        sharedOut: org.sharedOut,
        sharedIn: org.sharedIn,
        canShareWorkers: trust?.canShareWorkers ?? false,
        canShareData: trust?.canShareData ?? false,
        delegatedApproval: trust?.delegatedApproval ?? false,
        health: orgHealth(org, trust),
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'home' ? -1 : 1;
      const d = trustRank(b.trustLevel) - trustRank(a.trustLevel);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
}

/* ── Analytics (Operations-Center rollup) ─────────────────────────────────── */

export function buildFederationAnalytics(state: FederationState): FederationAnalytics {
  const peers = state.orgs.filter((o) => o.role === 'peer');
  const trustDistribution: TrustDistribution[] = TRUST_LEVELS.map((level) => ({
    level,
    count: peers.filter((p) => p.trustLevel === level).length,
  }));

  const byKind = EXCHANGE_KINDS.map((kind: ExchangeKind) => ({
    kind,
    count: state.artifacts.filter((a) => a.kind === kind).length,
  })).filter((k) => k.count > 0);

  const sharedByKind = new Map<SharedResourceKind, number>();
  for (const s of state.shared) sharedByKind.set(s.kind, (sharedByKind.get(s.kind) ?? 0) + 1);
  const topShared = [...sharedByKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  const gov: GlobalGovSummary = state.govSummary;

  return {
    orgs: state.summary.orgs,
    activePeers: state.summary.activePeers,
    trustedPeers: state.summary.trustedPeers,
    pendingInvites: state.summary.pendingInvites,
    sharedOut: state.summary.sharedOut,
    sharedIn: state.summary.sharedIn,
    trustDistribution,
    exchange: {
      artifacts: state.artifacts.length,
      verified: state.artifacts.filter((a) => a.verification !== 'unverified').length,
      installs: state.artifacts.reduce((n, a) => n + a.installs, 0),
      byKind,
    },
    scopes: state.scopes,
    governance: {
      policies: gov.policies,
      activePolicies: gov.activePolicies,
      pendingApprovals: gov.pendingApprovals,
      complianceScore: gov.complianceScore,
      auditEntries: gov.auditEntries,
    },
    topShared,
  };
}

/* ── Federation discovery / search (policy-aware) ─────────────────────────── */

function matchScore(haystacks: string[], q: string): number {
  if (!q) return 0.4;
  let best = 0;
  for (const h of haystacks) {
    const l = h.toLowerCase();
    if (l === q) best = Math.max(best, 1);
    else if (l.startsWith(q)) best = Math.max(best, 0.8);
    else if (l.includes(q)) best = Math.max(best, 0.6);
  }
  return best;
}

/**
 * Search organizations, exchange artifacts, cross-org policies, and shared resources. Honors a
 * simple visibility policy: private-scope artifacts are excluded unless `includePrivate` (the
 * home org sees its own private artifacts; a federated searcher would not).
 */
export function searchFederation(
  state: FederationState,
  text: string,
  opts: { kinds?: FederationSearchKind[]; limit?: number; includePrivate?: boolean } = {},
): FederationSearchHit[] {
  const q = text.trim().toLowerCase();
  const kinds = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
  const includePrivate = opts.includePrivate ?? true;
  const wants = (k: FederationSearchKind): boolean => !kinds || kinds.has(k);
  const hits: FederationSearchHit[] = [];

  if (wants('organization')) {
    for (const o of state.orgs) {
      const score = matchScore([o.name, o.slug], q);
      if (score > 0) hits.push({ kind: 'organization', id: o.id, title: o.name, subtitle: `${o.role} · trust ${o.trustLevel}`, score, badge: o.trustLevel });
    }
  }
  if (wants('artifact')) {
    for (const a of state.artifacts) {
      // A peer's private artifact is never visible; the home org's own private artifacts are
      // visible only when includePrivate (the gated Federation surface), never via the adapter.
      if (a.scope === 'private' && (!includePrivate || a.publisherOrg !== state.homeOrgId)) continue;
      const score = matchScore([a.name, a.summary, a.kind], q);
      if (score > 0) hits.push({ kind: 'artifact', id: a.id, title: a.name, subtitle: `${a.kind} · ${a.verification}`, score, badge: a.scope });
    }
  }
  if (wants('policy')) {
    for (const p of state.policies) {
      const score = matchScore([p.name, p.action, p.description], q);
      if (score > 0) hits.push({ kind: 'policy', id: p.id, title: p.name, subtitle: `${p.scope} · ${p.effect}`, score, badge: p.enabled ? 'enabled' : 'disabled' });
    }
  }
  if (wants('shared_resource')) {
    for (const s of state.shared) {
      const score = matchScore([s.name, s.kind], q);
      if (score > 0) hits.push({ kind: 'shared_resource', id: s.id, title: s.name, subtitle: `${s.kind} · ${s.peerOrgName}`, score, badge: s.access });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, opts.limit ?? 20);
}

/* ── Policy-driven cross-org sharing decision ─────────────────────────────── */

/**
 * Decide whether a resource of `kind` may be shared with / installed from a peer, given the
 * trust relationship and an optional governance-policy verdict. This is the DECISION layer the
 * "federated workforce" requires (share only when trust + approval + policy allow) — it reuses
 * the existing trust flags and the allow/deny/require_approval effect vocabulary; it executes
 * nothing (a real worker install still routes through the P8.5 installer).
 */
export function evaluateFederatedShare(
  trust: TrustRelationship | null,
  kind: SharedResourceKind,
  policyDecision: FedPolicyEffect = 'allow',
): FederationShareEvaluation {
  const reasons: string[] = [];
  const trustLevel = trust?.trustLevel ?? 'none';

  if (!trust) {
    return { decision: 'deny', kind, trustLevel, reasons: ['No trust relationship is established with the peer organization'] };
  }

  let decision: FedPolicyEffect = 'allow';
  const raise = (d: FedPolicyEffect): void => {
    decision = mostRestrictive(decision, d);
  };

  // A below-"basic" trust relationship gates every kind behind approval.
  if (trustRank(trust.trustLevel) < TRUST_RANK.basic) {
    raise('require_approval');
    reasons.push('Peer trust is below "basic"; sharing requires approval');
  }

  if (kind === 'ai_worker') {
    if (!trust.canShareWorkers) {
      raise('deny');
      reasons.push('Worker sharing is not permitted by the trust relationship');
    } else if (trustRank(trust.trustLevel) < TRUST_RANK.verified) {
      raise('require_approval');
      reasons.push('Worker sharing below "verified" trust requires approval');
    }
  } else if (kind === 'governance_policy') {
    if (trustRank(trust.trustLevel) < TRUST_RANK.full) {
      raise('require_approval');
      reasons.push('Sharing a governance policy requires "full" trust or explicit approval');
    }
  } else {
    // project | workspace | connector — data-bearing shares.
    if (!trust.canShareData) {
      raise('deny');
      reasons.push('Data sharing is not permitted by the trust relationship');
    } else if (!trust.delegatedApproval) {
      raise('require_approval');
      reasons.push('Data sharing without delegated approval requires explicit approval');
    }
  }

  raise(policyDecision);
  if (policyDecision !== 'allow') reasons.push(`Governance policy requires "${policyDecision}"`);
  if (reasons.length === 0) reasons.push('Trust and policy permit this share');
  return { decision, kind, trustLevel, reasons };
}

/* ── Overview bundle ──────────────────────────────────────────────────────── */

export function buildFederationOverview(state: FederationState): FederationOverview {
  return {
    summary: state.summary,
    analytics: buildFederationAnalytics(state),
    directory: buildOrgDirectory(state),
    recentTimeline: buildFederationTimeline(state).slice(0, 20),
  };
}
