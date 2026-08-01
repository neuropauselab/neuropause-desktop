/**
 * Phase 6 Stage 11 — the composition root: EXACTLY six read-only efed:*
 * channels (requireAuth + federation:read — the EXISTING P10 read scope; zero
 * mutation surface; the fed:* and federation:* clusters untouched), the 3 s TTL
 * cache, per-source failure isolation, the federation-watch source (governed
 * ITEMS from critical/high recommendations, deduped), the ten-question
 * assistant port, and dispose().
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel, type IntelligenceItem } from '@neuropause/shared';
import { initEnterpriseFederation, type EnterpriseFederationDeps } from './index';

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

interface Harness {
  deps: EnterpriseFederationDeps;
  sources: string[];
  produceWatch: () => Promise<IntelligenceItem[]>;
  setNow: (ms: number) => void;
  peerReads: () => number;
}

function mkDeps(over: Partial<EnterpriseFederationDeps> = {}): Harness {
  let nowMs = T0;
  let peerReads = 0;
  const sources: string[] = [];
  let produce: () => Promise<IntelligenceItem[]> = () => Promise.resolve([]);
  const deps: EnterpriseFederationDeps = {
    fedHome: () => ({ id: 'org-home', name: 'NeuroPause', regionId: 'us-east' }),
    fedPeers: () => {
      peerReads += 1;
      return [
        { id: 'org-helios', name: 'Helios Commerce', role: 'peer', status: 'active', regionId: 'eu-west', trustLevel: 'verified', joinedAt: new Date(T0).toISOString(), sharedOut: 2, sharedIn: 1 },
      ];
    },
    fedInvitations: () => [{ toOrg: 'org-helios', fromOrg: 'org-home', direction: 'outbound', status: 'accepted' }],
    fedTrusts: () => [
      { peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', trustLevel: 'verified', delegatedApproval: false, canShareWorkers: true, canShareData: false },
    ],
    fedShares: () => [
      { kind: 'ai_worker', name: 'Compliance Reviewer', peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', direction: 'outbound', access: 'collaborate' },
    ],
    fedSummary: () => ({ orgs: 2, peers: 1, activePeers: 1, pendingInvites: 0, trustedPeers: 1, sharedOut: 2, sharedIn: 1 }),
    artifacts: () => [
      { id: 'a1', kind: 'ai_worker', name: 'Compliance Reviewer', publisherOrg: 'org-helios', publisherOrgName: 'Helios Commerce', scope: 'partner', verification: 'verified', installs: 3, signaturesEd25519: true },
    ],
    govPolicies: () => [
      { id: 'p1', name: 'Partner data exchange', action: 'share_data', enabled: true },
      { id: 'p2', name: 'Federated worker execution', action: 'cross_org_run', enabled: true },
    ],
    govApprovals: () => [],
    govAudit: () => [{ peerOrg: 'org-helios' }],
    p18Summary: () => ({ shareableIntelligence: 6, publishedInsights: 2, healthBand: 'healthy' }),
    knowledgeAssets: () => [{ id: 'ka:1', title: 'Data Handling SOP', topics: ['sop'] }],
    playbooks: () => [
      { id: 'daily-ops-review', name: 'Daily Ops Review', version: 1 },
      { id: 'incident-first-response', name: 'Incident First Response', version: 1 },
    ],
    apFindings: () => [],
    connectors: () => [{ id: 'slack', name: 'Slack' }],
    workers: () => [{ id: 'w1', name: 'Compliance Reviewer' }],
    s9Services: () => [
      { serviceId: 'workforce-jobs', state: 'operational' },
      { serviceId: 'execution-runtime', state: 'operational' },
      { serviceId: 'connector-fleet', state: 'operational' },
    ],
    slaStatuses: () => [{ targetId: 'jobs-queue-depth', serviceId: 'workforce-jobs', status: 'met' }],
    readiness: () => [{ state: 'ready' }, { state: 'ready' }],
    capacityPressure: () => 'low',
    strategyInitiatives: () => [
      { id: 'init-operational-cadence', label: 'Operational review cadence', state: 'done', capabilityKeys: ['operations'] },
    ],
    strategyCapabilities: () => [{ key: 'operations', label: 'Operations', condition: 'on-track' }],
    executiveKpis: () => [{ key: 'org-health', label: 'Org health', display: '82', band: 'healthy' }],
    registerSource: (source) => {
      sources.push(source.key);
      produce = () => source.produce() as Promise<IntelligenceItem[]>;
    },
    now: () => nowMs,
    ...over,
  };
  return { deps, sources, produceWatch: () => produce(), setNow: (ms) => (nowMs = ms), peerReads: () => peerReads };
}

describe('the IPC surface (D-9) — six read-only channels under the EXISTING federation:read scope', () => {
  it('registers EXACTLY the six efed:* channels, all requireAuth + federation:read', () => {
    const p = initEnterpriseFederation(mkDeps().deps);
    expect(p.handlers.map((d) => d.channel).sort()).toEqual(
      [IpcChannel.EfedPartners, IpcChannel.EfedTrust, IpcChannel.EfedExchange, IpcChannel.EfedSharing, IpcChannel.EfedDashboard, IpcChannel.EfedReport].sort(),
    );
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('efed:'), String(d.channel)).toBe(true);
      expect(d.requireAuth, String(d.channel)).toBe(true);
      expect(d.permission, String(d.channel)).toBe('federation:read');
    }
  });

  it('never touches the fed:* / federation:* namespaces and no channel name implies mutation', () => {
    const p = initEnterpriseFederation(mkDeps().deps);
    for (const d of p.handlers) {
      expect(String(d.channel).startsWith('fed:')).toBe(false);
      expect(String(d.channel).startsWith('federation:')).toBe(false);
      expect(String(d.channel)).not.toMatch(/save|set|run\b|delete|execute|create|update|cancel|invite|share\b|publish|revoke|install/);
    }
  });
});

describe('the composed views (healthy fixture)', () => {
  it('partners, trust, exchange, and sharing compose from the injected records', () => {
    const p = initEnterpriseFederation(mkDeps().deps);
    expect(p.partners().partners).toHaveLength(1);
    expect(p.partners().partners[0].exposedServiceIds.sort()).toEqual(['execution-runtime', 'workforce-jobs']);
    const trust = p.trust().partners[0];
    expect(trust.declaredLevel).toBe('verified');
    expect(['consistent', 'evidence-above-declared']).toContain(trust.assessment);
    const ex = p.exchange();
    expect(ex.totals.artifacts).toBe(1);
    expect(ex.totals.nameMatched).toBe(1); // 'Compliance Reviewer' name-matches the worker (heuristic, disclosed)
    expect(p.sharing().strategy.jointInitiatives).toHaveLength(1);
    expect(p.dashboard().network?.healthBand).toBe('healthy');
    expect(p.boardReport().sections).toHaveLength(6);
  });
});

describe('the 3 s TTL cache', () => {
  it('reads within the TTL reuse one build; advancing the clock rebuilds; dispose clears', () => {
    const h = mkDeps();
    const p = initEnterpriseFederation(h.deps);
    p.partners();
    p.dashboard();
    p.trust();
    expect(h.peerReads()).toBe(1);
    h.setNow(T0 + 2_999);
    p.boardReport();
    expect(h.peerReads()).toBe(1);
    h.setNow(T0 + 3_001);
    p.partners();
    expect(h.peerReads()).toBe(2);
    p.dispose();
    p.partners();
    expect(h.peerReads()).toBe(3);
  });
});

describe('failure isolation — explicit unavailability, never fabricated values', () => {
  it('a throwing federation store becomes unavailable entries; local compositions stay computed', () => {
    const h = mkDeps({
      fedPeers: () => {
        throw new Error('fed store offline');
      },
    });
    const p = initEnterpriseFederation(h.deps);
    const partners = p.partners();
    expect(partners.partners).toEqual([]);
    expect(partners.unavailable.some((u) => u.system === 'fed-peers' && u.reason.includes('offline'))).toBe(true);
    // The exchange still lists LOCAL candidates (playbooks etc.) — local reads are isolated.
    expect(p.exchange().totals.localCandidates).toBeGreaterThan(0);
    expect(p.dashboard().unavailable.filter((u) => u.system === 'fed-peers')).toHaveLength(1);
  });

  it('a throwing P18 read degrades ONLY the network slice', () => {
    const h = mkDeps({
      p18Summary: () => {
        throw new Error('p18 offline');
      },
    });
    const p = initEnterpriseFederation(h.deps);
    expect(p.dashboard().network).toBeNull();
    expect(p.dashboard().unavailable.some((u) => u.system === 'intelligence-network')).toBe(true);
    expect(p.dashboard().partners.total).toBe(1); // siblings computed
  });
});

describe('the federation-watch source — governed items, never actions', () => {
  it('registers exactly one source and stays quiet when nothing needs focus', async () => {
    const h = mkDeps();
    initEnterpriseFederation(h.deps);
    expect(h.sources).toEqual(['federation-watch']);
    expect(await h.produceWatch()).toEqual([]);
  });

  it('trust divergence becomes a governed item once (deduped across produces)', async () => {
    const h = mkDeps({ artifacts: () => [] }); // peer published nothing → signed-artifacts absent → declared-above-evidence
    initEnterpriseFederation(h.deps);
    const items = await h.produceWatch();
    expect(items.length).toBeGreaterThan(0);
    for (const it_ of items) {
      expect(it_.id.startsWith('efed:efedrec:')).toBe(true);
      expect(it_.deepLink).toBe('federation');
      expect(it_.governance?.evidence.length ?? 0).toBeGreaterThan(0);
    }
    expect(await h.produceWatch()).toEqual([]);
  });
});

describe('the assistant port — ten questions, sync, same composed pass', () => {
  it('routes a matched question to a grounded intelligence report; unmatched → null', () => {
    const p = initEnterpriseFederation(mkDeps().deps);
    const r = p.answerQuestion('Which partners do we trust?', new Date(T0).toISOString());
    expect(r?.kind).toBe('intelligence');
    expect(r?.grounded).toBe(true);
    expect(p.answerQuestion('draft an email', new Date(T0).toISOString())).toBeNull();
  });

  it('the federation report answer reflects the live composition', () => {
    const p = initEnterpriseFederation(mkDeps().deps);
    const r = p.answerQuestion('Prepare the federation report', new Date(T0).toISOString())!;
    expect(r.title).toContain('board brief');
    expect(r.sections.length).toBe(6);
  });
});
