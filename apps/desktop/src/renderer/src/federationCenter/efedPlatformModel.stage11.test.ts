/**
 * Phase 6 Stage 11 — the Enterprise tab's pure view-model (lives beside the
 * Federation Center tests so the existing federationCenter/** vitest glob runs
 * it; the model itself lives in ../enterpriseFederation). Total tone maps,
 * header stats, and rows that keep the declared-vs-computed trust language,
 * the heuristic linkage states, and the deduped unavailability strip.
 */
import { describe, expect, it } from 'vitest';
import type { EfedDashboard, EfedExchangeReport, EfedPartnersReport, EfedTrustReport } from '@neuropause/shared';
import {
  assessmentTone,
  efedHeaderStats,
  exchangeRows,
  linkTone,
  partnerRows,
  trustLevelTone,
  trustRows,
  unavailableLines,
} from '../enterpriseFederation/efedPlatformModel';

describe('tone maps (total)', () => {
  it('assessment, trust level, and linkage states all map to presentation tones', () => {
    expect(assessmentTone('consistent')).toBe('green');
    expect(assessmentTone('declared-above-evidence')).toBe('orange');
    expect(assessmentTone('evidence-above-declared')).toBe('blue');
    expect(assessmentTone('unknown')).toBe('gray');
    expect(trustLevelTone('full')).toBe('green');
    expect(trustLevelTone('none')).toBe('gray');
    expect(linkTone('name-match')).toBe('blue');
    expect(linkTone('no-structural-link')).toBe('orange');
    expect(linkTone('not-applicable')).toBe('gray');
  });
});

const DASH: EfedDashboard = {
  generatedAt: 'now',
  partners: { total: 2, active: 1, trusted: 1, pendingInvites: 1 },
  trust: { consistent: 1, declaredAboveEvidence: 1, evidenceAboveDeclared: 0, unknown: 0 },
  exchange: { artifacts: 3, verified: 2, signed: 2, installs: 9 },
  sharing: { sharedOut: 2, sharedIn: 1, jointInitiatives: 1, exposedServices: 3 },
  governance: { policies: 4, activePolicies: 3, pendingApprovals: 1, auditEntries: 12 },
  network: { shareableIntelligence: 6, publishedInsights: 2, healthBand: 'healthy' },
  kpis: [],
  recommendations: [],
  disclosures: ['records not networking'],
  unavailable: [],
};

describe('efedHeaderStats', () => {
  it('summarizes six dimensions with honest hints', () => {
    const stats = efedHeaderStats(DASH);
    expect(stats).toHaveLength(6);
    expect(stats[0]).toMatchObject({ label: 'Partners', value: '1/2', tone: 'orange' }); // pending invite
    expect(stats[0].hint).toContain('records, not live connectivity');
    expect(stats[1]).toMatchObject({ label: 'Trust', tone: 'orange' }); // declared-above-evidence present
    expect(stats[2]).toMatchObject({ label: 'Exchange', value: '2/3 signed', tone: 'orange' });
    expect(stats[4]).toMatchObject({ label: 'Governance', value: '3/4', tone: 'orange' }); // pending approval
    expect(stats[5]).toMatchObject({ label: 'Network', value: 'healthy', tone: 'green' });
  });

  it('unreadable governance/network slices read n/a + gray, never defaulted', () => {
    const stats = efedHeaderStats({ ...DASH, governance: null, network: null });
    expect(stats[4]).toMatchObject({ value: 'n/a', tone: 'gray' });
    expect(stats[5]).toMatchObject({ value: 'n/a', tone: 'gray' });
  });
});

describe('rows keep the composed honesty', () => {
  it('partner rows carry declared trust AND the computed assessment side by side', () => {
    const r: EfedPartnersReport = {
      generatedAt: 'now',
      home: null,
      partners: [
        {
          peerOrg: 'org-helios',
          peerOrgName: 'Helios Commerce',
          role: 'peer',
          status: 'active',
          regionId: 'eu-west',
          declaredTrust: 'verified',
          joinedAt: 'now',
          sharesOut: 2,
          sharesIn: 0,
          sharedResources: [],
          artifactsPublished: 1,
          trustAssessment: 'declared-above-evidence',
          exposedServiceIds: ['connector-fleet'],
        },
      ],
      summary: null,
      invitations: { pendingInbound: 0, pendingOutbound: 0 },
      gaps: [],
      unavailable: [],
    };
    const rows = partnerRows(r);
    expect(rows[0].declaredTrust).toBe('verified');
    expect(rows[0].assessment).toBe('declared-above-evidence');
    expect(rows[0].assessmentTone).toBe('orange');
    expect(rows[0].exposureText).toBe('connector-fleet');
  });

  it('trust rows name the expected-but-absent signals', () => {
    const r: EfedTrustReport = {
      generatedAt: 'now',
      partners: [
        {
          peerOrg: 'p1',
          peerOrgName: 'P1',
          declaredLevel: 'verified',
          declaredDetail: 'TrustRelationship: verified',
          signals: [
            { kind: 'accepted-invitation', live: true, detail: 'recorded' },
            { kind: 'attested-relationship', live: true, detail: 'recorded' },
            { kind: 'signed-artifacts', live: false, detail: 'nothing published' },
          ],
          expectedForDeclared: ['accepted-invitation', 'attested-relationship', 'signed-artifacts'],
          assessment: 'declared-above-evidence',
          divergenceDetail: 'declared remains authoritative',
        },
      ],
      totals: { consistent: 0, declaredAboveEvidence: 1, evidenceAboveDeclared: 0, unknown: 0 },
      disclosure: '',
      unavailable: [],
    };
    const rows = trustRows(r);
    expect(rows[0].liveSignalsText).toBe('accepted-invitation, attested-relationship');
    expect(rows[0].missingSignalsText).toContain('signed-artifacts');
  });

  it('exchange rows keep the heuristic linkage language and signature tones', () => {
    const r: EfedExchangeReport = {
      generatedAt: 'now',
      kinds: [
        {
          kind: 'ai_worker',
          localRecordKind: 'ai-worker',
          capabilityKeys: ['operations'],
          localCandidates: [{ id: 'w1', label: 'Reviewer', detail: 'AI worker' }],
          artifacts: [
            {
              artifactId: 'a1',
              name: 'Reviewer',
              kind: 'ai_worker',
              publisherOrg: 'p1',
              publisherOrgName: 'P1',
              scope: 'partner',
              verification: 'verified',
              installs: 2,
              signaturesValid: false,
              link: { state: 'name-match', detail: 'name equality — a stated heuristic, NOT a recorded link', nameMatches: ['w1'] },
            },
          ],
          gaps: [],
        },
      ],
      totals: { artifacts: 1, verified: 1, signed: 0, nameMatched: 1, withoutStructuralLink: 0, localCandidates: 1 },
      disclosure: 'd',
      unavailable: [],
    };
    const rows = exchangeRows(r);
    expect(rows[0].linkState).toBe('name-match');
    expect(rows[0].linkDetail).toContain('NOT a recorded link');
    expect(rows[0].signedTone).toBe('red');
  });
});

describe('the unavailability strip', () => {
  it('dedupes identical system+reason lines across views', () => {
    const lines = unavailableLines([
      { unavailable: [{ system: 'fed-peers', reason: 'unreadable' }] },
      { unavailable: [{ system: 'fed-peers', reason: 'unreadable' }, { system: 'intelligence-network', reason: 'offline' }] },
    ]);
    expect(lines).toEqual(['fed-peers: unreadable', 'intelligence-network: offline']);
  });
});
