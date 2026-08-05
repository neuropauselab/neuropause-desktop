/**
 * Phase 6 Stage 11 — partners + the organization exchange: composed from
 * records; the DECLARED exposure map resolves partner-facing services; the
 * artifact↔local-record join reports honest linkage states (name-match is a
 * stated heuristic; no-structural-link is the default truth; not-applicable
 * where no local registry exists).
 */
import { describe, expect, it } from 'vitest';
import { buildTrustReport } from './trustModel';
import { buildExchangeReport, buildPartnersReport, EXCHANGE_DISCLOSURE, type PartnerRecords } from './partnerExchange';

const NOW = '2026-07-31T12:00:00.000Z';

function records(): PartnerRecords {
  return {
    home: { id: 'org-home', name: 'NeuroPause', regionId: 'us-east' },
    peers: [
      { id: 'org-helios', name: 'Helios Commerce', role: 'peer', status: 'active', regionId: 'eu-west', trustLevel: 'verified', joinedAt: NOW, sharedOut: 2, sharedIn: 1 },
      { id: 'org-aperture', name: 'Aperture Capital', role: 'peer', status: 'invited', regionId: 'us-east', trustLevel: 'basic', joinedAt: NOW, sharedOut: 0, sharedIn: 2 },
    ],
    invitations: [
      { direction: 'inbound', status: 'pending' },
      { direction: 'outbound', status: 'accepted' },
    ],
    shares: [
      { kind: 'ai_worker', name: 'Compliance Reviewer', peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', direction: 'outbound', access: 'collaborate' },
      { kind: 'connector', name: 'NetSuite Pack', peerOrg: 'org-aperture', peerOrgName: 'Aperture Capital', direction: 'inbound', access: 'read' },
    ],
    summary: { orgs: 3, peers: 2, activePeers: 1, pendingInvites: 1, trustedPeers: 1, sharedOut: 2, sharedIn: 3 },
    artifacts: [{ publisherOrg: 'org-helios' }],
  };
}

function trustFor(r: PartnerRecords) {
  return buildTrustReport({
    nowIso: NOW,
    signals: {
      peers: r.peers,
      trusts: [],
      invitations: [],
      artifacts: [],
      audit: [],
      policies: [],
    },
    failures: {},
  });
}

describe('buildPartnersReport', () => {
  it('composes peers × shares × artifacts × declared exposure; pending invitations split by direction', () => {
    const r = records();
    const out = buildPartnersReport({ nowIso: NOW, records: r, trust: trustFor(r), failures: {} });
    expect(out.home?.name).toBe('NeuroPause');
    expect(out.partners).toHaveLength(2);
    const helios = out.partners.find((p) => p.peerOrg === 'org-helios')!;
    expect(helios.sharesOut).toBe(1);
    expect(helios.artifactsPublished).toBe(1);
    expect(helios.exposedServiceIds.sort()).toEqual(['execution-runtime', 'workforce-jobs']); // ai_worker exposure
    const aperture = out.partners.find((p) => p.peerOrg === 'org-aperture')!;
    expect(aperture.exposedServiceIds).toEqual(['connector-fleet']); // connector exposure
    expect(out.invitations).toEqual({ pendingInbound: 1, pendingOutbound: 0 });
  });

  it('unreadable stores surface as unavailable; partners degrade honestly', () => {
    const r: PartnerRecords = { home: null, peers: null, invitations: null, shares: null, summary: null, artifacts: null };
    const out = buildPartnersReport({
      nowIso: NOW,
      records: r,
      trust: { generatedAt: NOW, partners: [], totals: { consistent: 0, declaredAboveEvidence: 0, evidenceAboveDeclared: 0, unknown: 0 }, disclosure: '', unavailable: [] },
      failures: { 'fed-runtime': 'store unreadable' },
    });
    expect(out.partners).toEqual([]);
    expect(out.home).toBeNull();
    expect(out.unavailable).toContainEqual({ system: 'fed-runtime', reason: 'store unreadable' });
  });
});

describe('buildExchangeReport — honest linkage', () => {
  const locals = {
    playbooks: [
      { id: 'daily-ops-review', name: 'Daily Ops Review', version: 1 },
      { id: 'incident-first-response', name: 'Incident First Response', version: 1 },
    ],
    knowledgeAssets: [{ id: 'ka:doc:1', title: 'Data Handling SOP', topics: ['sop'] }],
    governancePolicies: [{ id: 'pol-1', name: 'Data Handling Baseline' }],
    connectors: [{ id: 'netsuite', name: 'NetSuite' }],
    workers: [{ id: 'w1', name: 'Compliance Reviewer' }],
  };

  it('joins artifacts to local candidates per kind; name equality reads as the stated heuristic', () => {
    const out = buildExchangeReport({
      nowIso: NOW,
      artifacts: [
        { id: 'a1', kind: 'ai_worker', name: 'Compliance Reviewer', publisherOrg: 'org-helios', publisherOrgName: 'Helios', scope: 'partner', verification: 'verified', installs: 3, signaturesEd25519: true },
        { id: 'a2', kind: 'workflow_template', name: 'Quarter Close Runbook', publisherOrg: 'org-aperture', publisherOrgName: 'Aperture', scope: 'private', verification: 'unverified', installs: 0, signaturesEd25519: true },
        { id: 'a3', kind: 'dashboard_template', name: 'Exec Wallboard', publisherOrg: 'org-helios', publisherOrgName: 'Helios', scope: 'public', verification: 'official', installs: 9, signaturesEd25519: false },
      ],
      locals,
      failures: {},
    });
    const worker = out.kinds.find((k) => k.kind === 'ai_worker')!.artifacts[0];
    expect(worker.link.state).toBe('name-match');
    expect(worker.link.detail).toContain('NOT a recorded link');
    expect(worker.link.nameMatches).toEqual(['w1']);
    const template = out.kinds.find((k) => k.kind === 'workflow_template')!.artifacts[0];
    expect(template.link.state).toBe('no-structural-link');
    const dash = out.kinds.find((k) => k.kind === 'dashboard_template')!;
    expect(dash.artifacts[0].link.state).toBe('not-applicable');
    expect(dash.gaps.some((g) => g.detail.includes('no local registry'))).toBe(true);
    expect(out.totals).toMatchObject({ artifacts: 3, nameMatched: 1, withoutStructuralLink: 1 });
    expect(out.totals.signed).toBe(2);
    expect(out.disclosure).toBe(EXCHANGE_DISCLOSURE);
  });

  it('lists REAL local candidates per kind even with an empty exchange — the shareable inventory', () => {
    const out = buildExchangeReport({ nowIso: NOW, artifacts: [], locals, failures: {} });
    expect(out.kinds.find((k) => k.kind === 'workflow_template')!.localCandidates).toHaveLength(2);
    expect(out.kinds.find((k) => k.kind === 'knowledge_package')!.localCandidates[0].label).toBe('Data Handling SOP');
    expect(out.totals.artifacts).toBe(0);
    expect(out.totals.localCandidates).toBeGreaterThan(0);
  });

  it('an unreadable local source is a gap on that kind, never a silent empty list', () => {
    const out = buildExchangeReport({
      nowIso: NOW,
      artifacts: [],
      locals: { ...locals, playbooks: null },
      failures: { 'automation-playbooks': 'registry unreadable' },
    });
    const wt = out.kinds.find((k) => k.kind === 'workflow_template')!;
    expect(wt.gaps.some((g) => g.detail.includes('unreadable'))).toBe(true);
    expect(out.unavailable).toContainEqual({ system: 'automation-playbooks', reason: 'registry unreadable' });
  });
});
