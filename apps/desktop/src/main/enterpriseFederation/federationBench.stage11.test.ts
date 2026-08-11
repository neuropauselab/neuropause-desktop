/**
 * Phase 6 Stage 11 — composition budgets (D-10), measured over a realistic
 * seeded fixture AFTER a warmup pass (the Stage 8–10 bench pattern):
 * partners / trust / exchange / sharing builds ≤ 100 ms each; the full
 * dashboard and the federation report ≤ 500 ms. The bench advances the
 * injected clock to defeat the TTL per measurement.
 */
import { describe, expect, it } from 'vitest';
import { initEnterpriseFederation, type EnterpriseFederationDeps } from './index';

/**
 * P13C ROUND 3 — the composed cache is now tenant-keyed, so this fixture names a
 * tenant. A fixed scope preserves every existing TTL and memoization assertion:
 * repeated reads under ONE tenant must still be one build, which is what these
 * tests were written to protect.
 */
const TEST_SCOPE = { tenantId: 'org-test', workspaceId: 'ws-test' };
const scope = (): typeof TEST_SCOPE => TEST_SCOPE;

const T0 = Date.parse('2026-07-31T12:00:00.000Z');

function mkDeps(): { deps: EnterpriseFederationDeps; tick: () => void } {
  let nowMs = T0;
  // Realistic volume: 12 peers, 80 shares, 60 artifacts, 300 knowledge assets.
  const peers = Array.from({ length: 12 }, (_, i) => ({
    id: `org-${i}`,
    name: `Partner ${i}`,
    role: 'peer',
    status: i % 4 === 0 ? 'invited' : 'active',
    regionId: 'us-east',
    trustLevel: (['none', 'basic', 'verified', 'full'] as const)[i % 4],
    joinedAt: new Date(T0 - i * 86_400_000).toISOString(),
    sharedOut: i % 3,
    sharedIn: i % 2,
  }));
  const shares = Array.from({ length: 80 }, (_, i) => ({
    kind: (['project', 'workspace', 'ai_worker', 'governance_policy', 'connector'] as const)[i % 5],
    name: `Share ${i}`,
    peerOrg: `org-${i % 12}`,
    peerOrgName: `Partner ${i % 12}`,
    direction: i % 2 === 0 ? 'outbound' : 'inbound',
    access: 'read',
  }));
  const artifacts = Array.from({ length: 60 }, (_, i) => ({
    id: `art-${i}`,
    kind: (['ai_worker', 'connector_pack', 'governance_policy', 'workflow_template', 'knowledge_package', 'dashboard_template'] as const)[i % 6],
    name: `Artifact ${i}`,
    publisherOrg: `org-${i % 12}`,
    publisherOrgName: `Partner ${i % 12}`,
    scope: 'partner',
    verification: i % 3 === 0 ? 'verified' : 'unverified',
    installs: i % 7,
    signaturesEd25519: i % 5 !== 0,
  }));
  const knowledgeAssets = Array.from({ length: 300 }, (_, i) => ({
    id: `ka:${i}`,
    title: `Asset ${i}`,
    topics: i % 4 === 0 ? ['sop'] : i % 4 === 1 ? ['policy'] : ['misc'],
  }));
  const deps: EnterpriseFederationDeps = {
    scope,
    fedHome: () => ({ id: 'org-home', name: 'NeuroPause', regionId: 'us-east' }),
    fedPeers: () => peers,
    fedInvitations: () => peers.map((p) => ({ toOrg: p.id, fromOrg: 'org-home', direction: 'outbound', status: 'accepted' })),
    fedTrusts: () =>
      peers.map((p) => ({ peerOrg: p.id, peerOrgName: p.name, trustLevel: p.trustLevel, delegatedApproval: false, canShareWorkers: true, canShareData: false })),
    fedShares: () => shares,
    fedSummary: () => ({ orgs: 13, peers: 12, activePeers: 9, pendingInvites: 2, trustedPeers: 8, sharedOut: 40, sharedIn: 40 }),
    artifacts: () => artifacts,
    govPolicies: () => [
      { id: 'p1', name: 'Partner data exchange', action: 'share_data', enabled: true },
      { id: 'p2', name: 'Federated worker execution', action: 'cross_org_run', enabled: true },
      { id: 'p3', name: 'Public artifact publishing', action: 'publish_public', enabled: false },
    ],
    govApprovals: () => [{ status: 'pending' }, { status: 'approved' }],
    govAudit: () => Array.from({ length: 200 }, (_, i) => ({ peerOrg: i % 3 === 0 ? `org-${i % 12}` : null })),
    p18Summary: () => ({ shareableIntelligence: 12, publishedInsights: 4, healthBand: 'watch' }),
    knowledgeAssets: () => knowledgeAssets,
    playbooks: () => [
      { id: 'daily-ops-review', name: 'Daily Ops Review', version: 2 },
      { id: 'incident-first-response', name: 'Incident First Response', version: 1 },
      { id: 'weekly-maintenance-review', name: 'Weekly Maintenance Review', version: 1 },
      { id: 'quarterly-ops-report', name: 'Quarterly Ops Report', version: 1 },
    ],
    apFindings: () => [{ severity: 'critical' }, { severity: 'medium' }],
    connectors: () => Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `Connector ${i}` })),
    workers: () => Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, name: `Worker ${i}` })),
    s9Services: () =>
      ['execution-runtime', 'workforce-jobs', 'automation-rules', 'connector-fleet', 'ai-runtime', 'assistant-experience', 'notification-delivery'].map(
        (serviceId, i) => ({ serviceId, state: i % 4 === 0 ? 'degraded' : 'operational' }),
      ),
    slaStatuses: () => [
      { targetId: 'jobs-queue-depth', serviceId: 'workforce-jobs', status: 'met' },
      { targetId: 'connector-healthy-ratio', serviceId: 'connector-fleet', status: 'breached' },
    ],
    readiness: () => Array.from({ length: 7 }, (_, i) => ({ state: i % 3 === 0 ? 'degraded' : 'ready' })),
    capacityPressure: () => 'elevated',
    strategyInitiatives: () => [
      { id: 'init-operational-cadence', label: 'Operational review cadence', state: 'done', capabilityKeys: ['operations'] },
      { id: 'init-ai-enablement', label: 'Governed AI enablement', state: 'advancing', capabilityKeys: ['engineering', 'security'] },
      { id: 'init-integration-reliability', label: 'Integration reliability', state: 'blocked', capabilityKeys: ['support', 'security'] },
    ],
    strategyCapabilities: () =>
      ['sales', 'marketing', 'customer-success', 'finance', 'procurement', 'engineering', 'manufacturing', 'compliance', 'risk', 'security', 'operations', 'support'].map(
        (key) => ({ key, label: key, condition: 'on-track' }),
      ),
    executiveKpis: () => [{ key: 'org-health', label: 'Org health', display: '82', band: 'healthy' }],
    registerSource: () => {},
    now: () => nowMs,
  };
  return { deps, tick: () => (nowMs += 10_000) };
}

function measure(fn: () => unknown): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

describe('composition budgets (D-10) — measured, after warmup', () => {
  it('partners / trust / exchange / sharing cold builds ≤ 100 ms; dashboard / report ≤ 500 ms', () => {
    const { deps, tick } = mkDeps();
    const p = initEnterpriseFederation(deps);
    p.dashboard(); // warmup pass

    tick();
    const partners = measure(() => p.partners());
    tick();
    const trust = measure(() => p.trust());
    tick();
    const exchange = measure(() => p.exchange());
    tick();
    const sharing = measure(() => p.sharing());
    tick();
    const dashboard = measure(() => p.dashboard());
    tick();
    const board = measure(() => p.boardReport());

    expect(partners, `partners build ${partners.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(trust, `trust build ${trust.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(exchange, `exchange build ${exchange.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(sharing, `sharing build ${sharing.toFixed(1)}ms`).toBeLessThanOrEqual(100);
    expect(dashboard, `dashboard build ${dashboard.toFixed(1)}ms`).toBeLessThanOrEqual(500);
    expect(board, `federation report build ${board.toFixed(1)}ms`).toBeLessThanOrEqual(500);
  });

  it('a warm read (inside the TTL) is near-instant (≤ 20 ms)', () => {
    const { deps, tick } = mkDeps();
    const p = initEnterpriseFederation(deps);
    tick();
    p.dashboard();
    const warm = measure(() => p.dashboard());
    expect(warm, `warm read ${warm.toFixed(1)}ms`).toBeLessThanOrEqual(20);
  });
});
