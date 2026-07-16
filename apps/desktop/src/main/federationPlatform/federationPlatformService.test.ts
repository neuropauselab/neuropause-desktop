/**
 * P10 — Federation Platform service tests. Snapshot memoization + invalidation, the
 * projection methods, the governed-share decision, and the Enterprise Search adapter.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExchangeArtifact,
  FederatedOrg,
  FederationSummary,
  GlobalGovSummary,
  SharedResource,
  TrustRelationship,
} from '@neuropause/shared';
import { FederationPlatformService, type FederationReaders } from './federationPlatformService';

const NOW = '2026-07-15T00:00:00.000Z';

const HOME: FederatedOrg = { id: 'org-default', name: 'NeuroPause', slug: 'neuropause', role: 'home', status: 'active', regionId: 'us-east', trustLevel: 'full', joinedAt: NOW, sharedOut: 1, sharedIn: 0 };
const PEER: FederatedOrg = { id: 'org-helios', name: 'Helios', slug: 'helios', role: 'peer', status: 'active', regionId: 'eu-west', trustLevel: 'verified', joinedAt: NOW, sharedOut: 0, sharedIn: 1 };
const TRUST: TrustRelationship = { id: 'tr-1', peerOrg: 'org-helios', peerOrgName: 'Helios', trustLevel: 'verified', delegatedApproval: true, canShareWorkers: true, canShareData: true, establishedAt: NOW };
const SHARED: SharedResource = { id: 'sr-1', kind: 'ai_worker', name: 'Ops Copilot', peerOrg: 'org-helios', peerOrgName: 'Helios', direction: 'outbound', access: 'read', sharedAt: NOW };
const ART: ExchangeArtifact = {
  id: 'art-1', kind: 'ai_worker', name: 'Finance Analyst', summary: 'signed worker', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause',
  scope: 'partner', verification: 'verified', regionId: 'us-east', rating: 4, ratingCount: 3, installs: 12, currentVersionId: 'v1',
  versions: [{ id: 'v1', version: '1.0.0', changelog: '', digest: 'd', signature: { algorithm: 'ed25519', keyId: 'npfed_x', digest: 'd', signature: 's', signedAt: NOW }, status: 'published', publishedAt: NOW }],
  createdAt: NOW,
};
const SUMMARY: FederationSummary = { orgs: 2, peers: 1, activePeers: 1, pendingInvites: 0, trustedPeers: 1, sharedOut: 1, sharedIn: 1 };
const GOV: GlobalGovSummary = { policies: 0, activePolicies: 0, pendingApprovals: 0, auditEntries: 0, complianceScore: 100 };

function readers(orgsBox: { value: FederatedOrg[] }): FederationReaders {
  return {
    homeOrgId: 'org-default',
    homeOrgName: 'NeuroPause',
    orgs: () => orgsBox.value,
    invitations: () => [],
    trust: () => [TRUST],
    shared: () => [SHARED],
    artifacts: () => [ART],
    policies: () => [],
    approvals: () => [],
    audit: () => [],
    summary: () => SUMMARY,
    scopes: () => [{ scope: 'partner', artifacts: 1, installs: 12 }],
    govSummary: () => GOV,
  };
}

describe('FederationPlatformService', () => {
  it('composes the projections from the injected readers', () => {
    const svc = new FederationPlatformService(readers({ value: [HOME, PEER] }));
    expect(svc.graph().counts.organizations).toBe(2);
    expect(svc.directory()[0].role).toBe('home');
    expect(svc.analytics().trustedPeers).toBe(1);
    expect(svc.timeline().length).toBeGreaterThan(0);
    expect(svc.overview().summary.orgs).toBe(2);
    expect(svc.search('helios').some((h) => h.kind === 'organization')).toBe(true);
  });

  it('memoizes a snapshot and recomposes only after invalidate()', () => {
    const box = { value: [HOME, PEER] };
    const svc = new FederationPlatformService(readers(box));
    expect(svc.directory()).toHaveLength(2);
    box.value = [HOME]; // backing store "changed" but not yet invalidated
    expect(svc.directory()).toHaveLength(2); // still the cached snapshot
    svc.invalidate();
    expect(svc.directory()).toHaveLength(1); // recomposed
  });

  it('memoizes projections within a snapshot and recomputes after invalidate()', () => {
    const svc = new FederationPlatformService(readers({ value: [HOME, PEER] }));
    const g1 = svc.graph();
    expect(svc.graph()).toBe(g1); // same reference → true O(1) cache hit
    svc.invalidate();
    expect(svc.graph()).not.toBe(g1); // recomposed after invalidation
  });

  it('adapts federation hits into the Enterprise Search hit shape', () => {
    const svc = new FederationPlatformService(readers({ value: [HOME, PEER] }));
    const hits = svc.searchHits('finance', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'federation')).toBe(true);
    expect(hits[0].id).toMatch(/^artifact:/);
  });
});
