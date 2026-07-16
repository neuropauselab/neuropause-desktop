/**
 * P10 — Federation Platform model tests. Pure projections over the existing federation state:
 * graph, unified timeline, directory + health, analytics, discovery/search, and the
 * policy-driven cross-org sharing decision.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExchangeArtifact,
  FederatedOrg,
  FederationSummary,
  FedAuditEntry,
  FedPolicy,
  GlobalGovSummary,
  SharedResource,
  TrustRelationship,
} from '@neuropause/shared';
import {
  buildFederationAnalytics,
  buildFederationGraph,
  buildFederationTimeline,
  buildOrgDirectory,
  evaluateFederatedShare,
  mostRestrictive,
  searchFederation,
  trustRank,
  type FederationState,
} from './federationModel';

const NOW = '2026-07-15T00:00:00.000Z';

function org(over: Partial<FederatedOrg> = {}): FederatedOrg {
  return {
    id: 'org-helios',
    name: 'Helios Robotics',
    slug: 'helios',
    role: 'peer',
    status: 'active',
    regionId: 'us-east',
    trustLevel: 'verified',
    joinedAt: NOW,
    sharedOut: 2,
    sharedIn: 1,
    ...over,
  };
}

function trust(over: Partial<TrustRelationship> = {}): TrustRelationship {
  return {
    id: 'tr-1',
    peerOrg: 'org-helios',
    peerOrgName: 'Helios Robotics',
    trustLevel: 'verified',
    delegatedApproval: false,
    canShareWorkers: true,
    canShareData: true,
    establishedAt: NOW,
    ...over,
  };
}

function shared(over: Partial<SharedResource> = {}): SharedResource {
  return {
    id: 'sr-1',
    kind: 'ai_worker',
    name: 'Ops Copilot',
    peerOrg: 'org-helios',
    peerOrgName: 'Helios Robotics',
    direction: 'outbound',
    access: 'read',
    sharedAt: NOW,
    ...over,
  };
}

function artifact(over: Partial<ExchangeArtifact> = {}): ExchangeArtifact {
  return {
    id: 'art-1',
    kind: 'ai_worker',
    name: 'Finance Analyst',
    summary: 'Signed cross-org worker',
    publisherOrg: 'org-default',
    publisherOrgName: 'NeuroPause',
    scope: 'partner',
    verification: 'verified',
    regionId: 'us-east',
    rating: 4.6,
    ratingCount: 12,
    installs: 30,
    currentVersionId: 'v1',
    versions: [
      {
        id: 'v1',
        version: '1.0.0',
        changelog: 'init',
        digest: 'd',
        signature: { algorithm: 'ed25519', keyId: 'npfed_x', digest: 'd', signature: 's', signedAt: NOW },
        status: 'published',
        publishedAt: NOW,
      },
    ],
    createdAt: NOW,
    ...over,
  };
}

function policy(over: Partial<FedPolicy> = {}): FedPolicy {
  return { id: 'pol-1', name: 'Require approval for data', description: 'Data shares need approval', scope: 'all', effect: 'require_approval', action: 'share_data', enabled: true, createdAt: NOW, ...over };
}

function audit(over: Partial<FedAuditEntry> = {}): FedAuditEntry {
  return { id: 'fa-1', at: NOW, actorOrg: 'org-default', actorOrgName: 'NeuroPause', peerOrg: 'org-helios', peerOrgName: 'Helios Robotics', action: 'share_worker', decision: 'allow', policyId: null, detail: 'shared a worker', ...over };
}

const SUMMARY: FederationSummary = { orgs: 2, peers: 1, activePeers: 1, pendingInvites: 1, trustedPeers: 1, sharedOut: 2, sharedIn: 1 };
const GOV: GlobalGovSummary = { policies: 1, activePolicies: 1, pendingApprovals: 1, auditEntries: 1, complianceScore: 92 };

function state(over: Partial<FederationState> = {}): FederationState {
  return {
    homeOrgId: 'org-default',
    homeOrgName: 'NeuroPause',
    orgs: [org({ id: 'org-default', name: 'NeuroPause', slug: 'neuropause', role: 'home', trustLevel: 'full' }), org()],
    invitations: [
      { id: 'inv-1', fromOrg: 'org-default', fromOrgName: 'NeuroPause', toOrg: 'org-northwind', toOrgName: 'Northwind', direction: 'outbound', status: 'pending', trustLevel: 'basic', message: 'join us', createdAt: NOW, respondedAt: null },
    ],
    trust: [trust()],
    shared: [shared()],
    artifacts: [artifact()],
    policies: [policy()],
    approvals: [],
    audit: [audit()],
    summary: SUMMARY,
    scopes: [{ scope: 'partner', artifacts: 1, installs: 30 }],
    govSummary: GOV,
    ...over,
  };
}

describe('trust ranking', () => {
  it('ranks trust levels and combines effects most-restrictively', () => {
    expect(trustRank('none')).toBeLessThan(trustRank('full'));
    expect(mostRestrictive('allow', 'deny')).toBe('deny');
    expect(mostRestrictive('allow', 'require_approval')).toBe('require_approval');
    expect(mostRestrictive('allow', 'allow')).toBe('allow');
  });
});

describe('buildFederationGraph', () => {
  it('projects orgs, trust edges, shared resources, and published artifacts', () => {
    const g = buildFederationGraph(state());
    expect(g.homeOrgId).toBe('org-default');
    expect(g.counts.organizations).toBe(2);
    expect(g.counts.artifacts).toBe(1);
    expect(g.counts.sharedResources).toBe(1);
    // A trust edge from home to the peer exists.
    expect(g.edges.some((e) => e.kind === 'trust' && e.from === 'org-default' && e.to === 'org-helios')).toBe(true);
    // The publish edge attributes the artifact to its publisher org.
    expect(g.edges.some((e) => e.kind === 'publishes' && e.from === 'org-default' && e.to === 'art:art-1')).toBe(true);
    // Every edge references a node that exists (no dangling edges).
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('attributes a peer-published artifact to the peer, never a dangling node', () => {
    const g = buildFederationGraph(state({ artifacts: [artifact({ publisherOrg: 'org-helios', publisherOrgName: 'Helios' })] }));
    expect(g.edges.some((e) => e.kind === 'publishes' && e.from === 'org-helios')).toBe(true);
  });

  it('emits no dangling edges even when no home org is present (corrupted state)', () => {
    const g = buildFederationGraph(
      state({
        orgs: [org({ id: 'org-helios', role: 'peer' })],
        trust: [trust()],
        shared: [shared()],
        artifacts: [artifact({ publisherOrg: 'org-default' })], // publisher is not a node
      }),
    );
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });
});

describe('buildFederationTimeline', () => {
  it('merges all event kinds and sorts strictly newest-first with distinct timestamps', () => {
    // DISTINCT timestamps so the descending-sort assertion is meaningful (a reversed or removed
    // sort would fail). Artifact publishedAt defaults to NOW (2026-07-15) → the newest event.
    const s = state({
      invitations: [
        { id: 'inv-1', fromOrg: 'org-default', fromOrgName: 'NeuroPause', toOrg: 'org-northwind', toOrgName: 'Northwind', direction: 'outbound', status: 'pending', trustLevel: 'basic', message: '', createdAt: '2026-01-01T00:00:00.000Z', respondedAt: null },
      ],
      trust: [trust({ establishedAt: '2026-03-01T00:00:00.000Z' })],
      shared: [shared({ sharedAt: '2026-05-01T00:00:00.000Z' })],
      audit: [audit({ at: '2026-06-01T00:00:00.000Z' })],
    });
    const t = buildFederationTimeline(s);
    const kinds = new Set(t.map((e) => e.kind));
    expect(kinds).toContain('invitation');
    expect(kinds).toContain('trust_change');
    expect(kinds).toContain('resource_share');
    expect(kinds).toContain('artifact_publish');
    expect(kinds).toContain('governance');
    for (let i = 1; i < t.length; i++) expect(t[i - 1].at > t[i].at).toBe(true);
    expect(t[0].kind).toBe('artifact_publish'); // newest
    expect(t[t.length - 1].kind).toBe('invitation'); // oldest
    expect(t.find((e) => e.kind === 'governance')?.decision).toBe('allow');
  });
});

describe('buildOrgDirectory', () => {
  it('lists orgs home-first with derived health + trust flags', () => {
    const dir = buildOrgDirectory(state());
    expect(dir[0].role).toBe('home');
    expect(dir[0].health).toBe('healthy');
    const peer = dir.find((d) => d.id === 'org-helios')!;
    expect(peer.canShareWorkers).toBe(true);
    expect(peer.health).toBe('healthy'); // active + verified
  });

  it('flags an active low-trust peer as attention and an inactive peer as inactive', () => {
    const dir = buildOrgDirectory(
      state({
        orgs: [org({ id: 'org-default', role: 'home', trustLevel: 'full' }), org({ id: 'org-basic', trustLevel: 'basic' }), org({ id: 'org-inv', status: 'invited' })],
        trust: [],
      }),
    );
    expect(dir.find((d) => d.id === 'org-basic')!.health).toBe('attention');
    expect(dir.find((d) => d.id === 'org-inv')!.health).toBe('inactive');
  });
});

describe('buildFederationAnalytics', () => {
  it('rolls up trust distribution, exchange, governance, and shared kinds', () => {
    const a = buildFederationAnalytics(state());
    expect(a.orgs).toBe(2);
    expect(a.trustedPeers).toBe(1);
    expect(a.trustDistribution.find((d) => d.level === 'verified')!.count).toBe(1);
    expect(a.exchange.artifacts).toBe(1);
    expect(a.exchange.verified).toBe(1);
    expect(a.exchange.installs).toBe(30);
    expect(a.governance.complianceScore).toBe(92);
    expect(a.topShared[0]).toEqual({ kind: 'ai_worker', count: 1 });
  });
});

describe('searchFederation', () => {
  it('matches across orgs, artifacts, policies, and shared resources', () => {
    expect(searchFederation(state(), 'helios').some((h) => h.kind === 'organization')).toBe(true);
    expect(searchFederation(state(), 'finance').some((h) => h.kind === 'artifact')).toBe(true);
    expect(searchFederation(state(), 'approval').some((h) => h.kind === 'policy')).toBe(true);
    // Kind filter narrows.
    const onlyOrgs = searchFederation(state(), 'a', { kinds: ['organization'] });
    expect(onlyOrgs.every((h) => h.kind === 'organization')).toBe(true);
  });

  it('hides the home org private artifacts unless includePrivate', () => {
    // Default artifact publisherOrg is the home org (org-default).
    const s = state({ artifacts: [artifact({ scope: 'private', name: 'Secret Worker' })] });
    expect(searchFederation(s, 'secret', { includePrivate: false })).toHaveLength(0);
    expect(searchFederation(s, 'secret', { includePrivate: true }).length).toBeGreaterThan(0);
  });

  it('never returns a PEER-owned private artifact, even with includePrivate', () => {
    const s = state({ artifacts: [artifact({ scope: 'private', name: 'Peer Secret', publisherOrg: 'org-helios' })] });
    expect(searchFederation(s, 'peer secret', { includePrivate: true })).toHaveLength(0);
  });
});

describe('evaluateFederatedShare', () => {
  it('denies when there is no trust relationship', () => {
    expect(evaluateFederatedShare(null, 'ai_worker').decision).toBe('deny');
  });

  it('denies a worker share when worker sharing is not permitted', () => {
    expect(evaluateFederatedShare(trust({ canShareWorkers: false }), 'ai_worker').decision).toBe('deny');
  });

  it('requires approval for a worker share below verified trust', () => {
    expect(evaluateFederatedShare(trust({ trustLevel: 'basic' }), 'ai_worker').decision).toBe('require_approval');
  });

  it('allows a worker share at verified trust', () => {
    expect(evaluateFederatedShare(trust({ trustLevel: 'verified' }), 'ai_worker').decision).toBe('allow');
  });

  it('combines a governance policy verdict most-restrictively', () => {
    const r = evaluateFederatedShare(trust({ trustLevel: 'full' }), 'ai_worker', 'deny');
    expect(r.decision).toBe('deny');
  });

  it('requires approval for data shares without delegated approval', () => {
    expect(evaluateFederatedShare(trust({ delegatedApproval: false }), 'project').decision).toBe('require_approval');
  });
});
