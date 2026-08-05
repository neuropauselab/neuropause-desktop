/**
 * Phase 6 Stage 11 — the dashboard + board report: pure compositions; every
 * recommendation is a structurally complete Principle-C item pointing at an
 * EXISTING governed fed:* surface; disclosures always ride; unavailability
 * dedupes; the board introduces no new facts.
 */
import { describe, expect, it } from 'vitest';
import { recommendationIssues } from '@neuropause/shared';
import { buildTrustReport, type TrustSignals } from './trustModel';
import { buildExchangeReport, buildPartnersReport } from './partnerExchange';
import { buildSharedAutomation } from './sharedAutomation';
import { buildSharedKnowledge } from './sharedKnowledge';
import { buildSharedOperations } from './sharedOperations';
import { buildSharedStrategy } from './sharedStrategy';
import {
  composeFederationBoardReport,
  composeFederationDashboard,
  composeFederationRecommendations,
  EFED_DISCLOSURES,
  RECORDS_DISCLOSURE,
  type EfedDashboardInputs,
} from './federationDashboard';
import type { EfedSharingReport } from '@neuropause/shared';

const NOW = '2026-07-31T12:00:00.000Z';

function signals(divergent: boolean): TrustSignals {
  return {
    peers: [{ id: 'org-helios', name: 'Helios Commerce', trustLevel: 'verified', status: 'active', sharedOut: 1, sharedIn: 1 }],
    trusts: [{ peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', trustLevel: 'verified', delegatedApproval: false, canShareWorkers: true, canShareData: true }],
    invitations: [{ toOrg: 'org-helios', fromOrg: 'org-home', status: 'accepted' }],
    artifacts: divergent ? [] : [{ publisherOrg: 'org-helios', signaturesEd25519: true }],
    audit: [{ peerOrg: 'org-helios' }],
    policies: [{ action: 'share_data', enabled: true }],
  };
}

function mkInputs(opts: { divergent?: boolean; unsigned?: boolean; pendingApprovals?: number } = {}): EfedDashboardInputs {
  const trust = buildTrustReport({ nowIso: NOW, signals: signals(opts.divergent ?? false), failures: {} });
  const shares = [{ kind: 'connector', name: 'NetSuite Pack', peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', direction: 'outbound', access: 'read' }];
  const partners = buildPartnersReport({
    nowIso: NOW,
    records: {
      home: { id: 'org-home', name: 'NeuroPause', regionId: 'us-east' },
      peers: signals(false).peers,
      invitations: [],
      shares,
      summary: { orgs: 2, peers: 1, activePeers: 1, pendingInvites: 0, trustedPeers: 1, sharedOut: 1, sharedIn: 0 },
      artifacts: [{ publisherOrg: 'org-helios' }],
    },
    trust,
    failures: { 'fed-summary': 'dup-check' },
  });
  const exchange = buildExchangeReport({
    nowIso: NOW,
    artifacts: [
      { id: 'a1', kind: 'ai_worker', name: 'W', publisherOrg: 'org-helios', publisherOrgName: 'Helios', scope: 'partner', verification: 'verified', installs: 2, signaturesEd25519: !(opts.unsigned ?? false) },
    ],
    locals: { playbooks: [], knowledgeAssets: [], governancePolicies: [], connectors: [], workers: [] },
    failures: { 'fed-summary': 'dup-check' },
  });
  const sharing: EfedSharingReport = {
    generatedAt: NOW,
    knowledge: buildSharedKnowledge({ artifacts: [], shares: [], knowledgeAssets: [], failures: {} }),
    automation: buildSharedAutomation({ artifacts: [], playbooks: [], apFindings: [], failures: {} }),
    operations: buildSharedOperations({
      shares,
      s9Services: [{ serviceId: 'connector-fleet', state: opts.unsigned ? 'operational' : 'degraded' }],
      slaStatuses: [],
      readiness: [],
      capacityPressure: 'low',
      failures: {},
    }),
    strategy: buildSharedStrategy({ initiatives: [], capabilities: [], shares: [], artifacts: [], failures: {} }),
    unavailable: [],
  };
  return {
    nowIso: NOW,
    partners,
    trust,
    exchange,
    sharing,
    governance: { policies: 4, activePolicies: 4, pendingApprovals: opts.pendingApprovals ?? 0, auditEntries: 5 },
    network: { shareableIntelligence: 6, publishedInsights: 2, healthBand: 'healthy' },
    kpis: [],
  };
}

describe('composeFederationRecommendations — Principle-C, pointing only at existing fed:* surfaces', () => {
  it('trust divergence, pending approvals, and unhealthy exposure each produce a complete recommendation', () => {
    const recs = composeFederationRecommendations(mkInputs({ divergent: true, pendingApprovals: 2 }));
    const ids = recs.map((r) => r.id);
    expect(ids).toContain('efedrec:trust:org-helios');
    expect(ids).toContain('efedrec:governance:pending-approvals');
    expect(ids).toContain('efedrec:exposure:org-helios'); // connector-fleet degraded
    for (const r of recs) {
      expect(recommendationIssues(r), r.id).toEqual([]);
      expect(r.suggestedAction).toMatch(/fed:|existing/i);
    }
  });

  it('unsigned artifact versions produce the exchange recommendation', () => {
    const recs = composeFederationRecommendations(mkInputs({ unsigned: true }));
    expect(recs.some((r) => r.id === 'efedrec:exchange:unsigned')).toBe(true);
  });

  it('a healthy composition produces no invented focus', () => {
    const inputs = mkInputs();
    inputs.sharing.operations.partners = []; // no exposure rows
    const recs = composeFederationRecommendations(inputs);
    expect(recs).toEqual([]);
  });
});

describe('composeFederationDashboard', () => {
  it('mirrors composed totals; dedupes unavailability by system; always carries the four disclosures', () => {
    const d = composeFederationDashboard(mkInputs());
    expect(d.partners).toMatchObject({ total: 1, active: 1 });
    expect(d.exchange).toMatchObject({ artifacts: 1, signed: 1, installs: 2 });
    expect(d.network?.healthBand).toBe('healthy');
    expect(d.unavailable.filter((u) => u.system === 'fed-summary')).toHaveLength(1); // deduped across views
    expect(d.disclosures).toEqual([...EFED_DISCLOSURES]);
    expect(d.disclosures[0]).toBe(RECORDS_DISCLOSURE);
  });
});

describe('composeFederationBoardReport', () => {
  it('sections the same computed views (six sections) and states honest zero-focus', () => {
    const inputs = mkInputs();
    inputs.sharing.operations.partners = [];
    const b = composeFederationBoardReport(inputs);
    expect(b.sections.map((s) => s.title)).toEqual([
      'Partners',
      'Trust (declared beside computed — declared is authoritative)',
      'Organization exchange',
      'Shared enterprise layers',
      'Federation governance',
      'Executive focus (recommendations only — nothing executes from here)',
    ]);
    expect(b.sections.at(-1)!.lines[0]).toContain('No focus items');
  });

  it('an unreadable governance slice is stated, not defaulted', () => {
    const inputs = mkInputs();
    inputs.governance = null;
    const b = composeFederationBoardReport(inputs);
    expect(b.sections.find((s) => s.title === 'Federation governance')!.lines[0]).toContain('unreadable');
  });
});
