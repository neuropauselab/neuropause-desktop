import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

import { FederationRuntimeStore } from './runtime/fedStore';
import { ExchangeStore } from './exchange/exchangeStore';
import { signArtifact, verifyArtifact, type SignableManifest } from './exchange/signing';
import { GlobalGovStore } from './governance/globalGovStore';
import { evaluateFederatedAction, buildFedCompliance, complianceScore } from './governance/globalGov';
import { buildObservability, type ObsInput } from './observability/observability';
import { ObservabilityStore } from './observability/observabilityStore';
import { DrStore } from './dr/drStore';
import { buildFedAdmin } from './admin/fedAdmin';

// These suites exercise the DEMO-seeded federation fixtures (peer orgs, exchange artifacts, audit entries,
// backups). Demo seeds are off by default in production; enable them here so the fixtures exist. The honest
// production-empty behavior is asserted in *.prod.test.ts.
beforeAll(() => { process.env.NP_DEMO_SEEDS = '1'; });
afterAll(() => { delete process.env.NP_DEMO_SEEDS; });
import { buildScalabilityReport } from './scalability/scalability';
import type { FedPolicy } from '@neuropause/shared';

let dir = '';
const openStores: { flush: () => Promise<void> }[] = [];

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'np-fed-'));
  openStores.length = 0;
});
afterEach(async () => {
  await Promise.all(openStores.map((s) => s.flush().catch(() => undefined)));
  for (let i = 0; i < 6; i += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

async function makeFed(): Promise<FederationRuntimeStore> {
  const s = new FederationRuntimeStore(join(dir, 'fed.json'), 'org-default', 'NeuroPause');
  await s.load();
  openStores.push(s);
  return s;
}
async function makeExchange(): Promise<ExchangeStore> {
  const s = new ExchangeStore(join(dir, 'exchange.json'));
  await s.load();
  openStores.push(s);
  return s;
}
async function makeGov(): Promise<GlobalGovStore> {
  const s = new GlobalGovStore(join(dir, 'gov.json'), 'org-default', 'NeuroPause');
  await s.load();
  openStores.push(s);
  return s;
}
async function makeObs(): Promise<ObservabilityStore> {
  const s = new ObservabilityStore(join(dir, 'obs.json'));
  await s.load();
  openStores.push(s);
  return s;
}
async function makeDr(): Promise<DrStore> {
  const s = new DrStore(join(dir, 'dr.json'));
  await s.load();
  openStores.push(s);
  return s;
}

/* ════════════════════════════ Federation runtime ══════════════════════════ */

describe('FederationRuntimeStore', () => {
  it('seeds the home org plus federated peers, invitations, and shared resources', async () => {
    const s = await makeFed();
    const orgs = s.listOrgs();
    expect(orgs[0]?.role).toBe('home');
    expect(s.peers().length).toBe(3);
    expect(s.listInvitations().some((i) => i.status === 'pending')).toBe(true);
    expect(s.listShared().length).toBeGreaterThanOrEqual(4);
    const sum = s.summary();
    expect(sum.activePeers).toBe(2);
    expect(sum.sharedOut).toBeGreaterThanOrEqual(1);
    expect(sum.sharedIn).toBeGreaterThanOrEqual(1);
  });

  it('invites an org and accepts an inbound invitation into an active peer with trust', async () => {
    const s = await makeFed();
    const invite = s.inviteOrg({ name: 'Vertex Dynamics', trustLevel: 'verified' });
    expect(invite.direction).toBe('outbound');
    expect(invite.status).toBe('pending');

    const inbound = s.listInvitations().find((i) => i.direction === 'inbound' && i.status === 'pending');
    expect(inbound).toBeDefined();
    const accepted = s.respondInvitation(inbound!.id, true);
    expect(accepted?.status).toBe('accepted');
    const peer = s.org(inbound!.fromOrg);
    expect(peer?.status).toBe('active');
    expect(s.trustFor(inbound!.fromOrg)).not.toBeNull();
  });

  it('gates resource sharing on trust capabilities', async () => {
    const s = await makeFed();
    // Helios is verified (canShareWorkers, but not canShareData).
    const workerShare = s.shareResource({ kind: 'ai_worker', name: 'Ops Worker', peerOrg: 'org-helios', access: 'collaborate' });
    expect('id' in workerShare).toBe(true);

    const dataShare = s.shareResource({ kind: 'connector', name: 'Salesforce', peerOrg: 'org-helios', access: 'collaborate' });
    expect('error' in dataShare).toBe(true);

    // Aperture is full trust — collaborative data sharing is allowed.
    const ok = s.shareResource({ kind: 'connector', name: 'Salesforce', peerOrg: 'org-aperture', access: 'collaborate' });
    expect('id' in ok).toBe(true);
  });

  it('updates trust, revokes a share, and persists across reloads', async () => {
    const s = await makeFed();
    const updated = s.setTrust('org-helios', { trustLevel: 'full', canShareData: true });
    expect(updated?.trustLevel).toBe('full');
    const share = s.listShared().find((x) => x.direction === 'outbound');
    expect(s.revokeShare(share!.id)).toBe(true);
    await s.flush();

    const s2 = new FederationRuntimeStore(join(dir, 'fed.json'), 'org-default', 'NeuroPause');
    await s2.load();
    openStores.push(s2);
    expect(s2.trustFor('org-helios')?.trustLevel).toBe('full');
    expect(s2.listShared().some((x) => x.id === share!.id)).toBe(false);
  });
});

/* ════════════════════════════ Exchange signing ════════════════════════════ */

describe('exchange signing', () => {
  it('signs a manifest and verifies it; rejects a tampered manifest', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const manifest: SignableManifest = { kind: 'ai_worker', name: 'Reviewer', version: '1.0.0', scope: 'public', publisherOrg: 'org-default' };
    const sig = signArtifact(manifest, privateKey, 'npfed_test');
    expect(sig.algorithm).toBe('ed25519');
    expect(verifyArtifact(manifest, sig, publicKey)).toBe(true);
    expect(verifyArtifact({ ...manifest, version: '1.0.1' }, sig, publicKey)).toBe(false);
  });
});

/* ════════════════════════════ Organization exchange ═══════════════════════ */

describe('ExchangeStore', () => {
  it('seeds signed artifacts across kinds and verifies their signatures', async () => {
    const s = await makeExchange();
    const arts = s.listArtifacts();
    expect(arts.length).toBe(6);
    for (const a of arts) expect(s.verifyVersion(a.id, a.currentVersionId)).toBe(true);
    expect(s.signingKeyId().startsWith('npfed_')).toBe(true);
  });

  it('publishes an artifact, adds a version, and verifies the new signature', async () => {
    const s = await makeExchange();
    const art = s.publish({ kind: 'dashboard_template', name: 'Sales Board', summary: 'A board.', scope: 'private', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause' });
    expect(s.verifyVersion(art.id, art.currentVersionId)).toBe(true);
    const v2 = s.publishVersion(art.id, '1.1.0', 'More widgets.');
    expect(v2?.versions.length).toBe(2);
    expect(s.verifyVersion(v2!.id, v2!.currentVersionId)).toBe(true);
  });

  it('rolls back to the previous published version', async () => {
    const s = await makeExchange();
    const art = s.publish({ kind: 'workflow_template', name: 'Onboarding', summary: 'Flow.', scope: 'partner', publisherOrg: 'org-default', publisherOrgName: 'NeuroPause' });
    const firstVersionId = art.currentVersionId;
    const v2 = s.publishVersion(art.id, '2.0.0', 'v2');
    expect(v2?.currentVersionId).not.toBe(firstVersionId);
    const rolled = s.rollback(art.id);
    expect(rolled?.currentVersionId).toBe(firstVersionId);
    expect(rolled?.versions.find((v) => v.version === '2.0.0')?.status).toBe('rolled_back');
  });

  it('rates, verifies, rescopes, and summarizes by scope', async () => {
    const s = await makeExchange();
    const art = s.listArtifacts().find((a) => a.ratingCount === 0)!;
    const rated = s.rate(art.id, 4);
    expect(rated?.rating).toBe(4);
    expect(s.setVerification(art.id, 'verified')?.verification).toBe('verified');
    expect(s.setScope(art.id, 'public')?.scope).toBe('public');
    const scopes = s.scopeSummary();
    expect(scopes.reduce((n, x) => n + x.artifacts, 0)).toBe(6);
  });
});

/* ════════════════════════════ Global governance (pure) ════════════════════ */

describe('global governance engine', () => {
  const pol = (id: string, action: string, scope: FedPolicy['scope'], effect: FedPolicy['effect']): FedPolicy => ({
    id,
    name: id,
    description: '',
    scope,
    effect,
    action,
    enabled: true,
    createdAt: new Date().toISOString(),
  });

  it('chooses the most restrictive matching policy (deny > require_approval > allow)', () => {
    const policies = [pol('a', 'run', 'all', 'allow'), pol('b', 'run', 'all', 'require_approval'), pol('c', 'run', 'all', 'deny')];
    expect(evaluateFederatedAction({ action: 'run', peerTrustLevel: 'full', policies }).decision).toBe('deny');
    expect(evaluateFederatedAction({ action: 'run', peerTrustLevel: 'full', policies: policies.slice(0, 2) }).decision).toBe('require_approval');
  });

  it('applies trusted-scope policies only to verified+ peers and allows by default', () => {
    const policies = [pol('t', 'import', 'trusted', 'deny')];
    expect(evaluateFederatedAction({ action: 'import', peerTrustLevel: 'basic', policies }).decision).toBe('allow');
    expect(evaluateFederatedAction({ action: 'import', peerTrustLevel: 'verified', policies }).decision).toBe('deny');
    expect(evaluateFederatedAction({ action: 'other', peerTrustLevel: 'full', policies }).policyId).toBeNull();
  });

  it('builds a compliance report and scores it', () => {
    const rules = buildFedCompliance({ auditEntries: 3, signedArtifacts: true, activePeers: 2, attestedPeers: 2, pendingApprovals: 0, residencyHonored: true, now: Date.now() });
    expect(rules.length).toBe(5);
    expect(complianceScore(rules)).toBe(100);
    const degraded = buildFedCompliance({ auditEntries: 3, signedArtifacts: false, activePeers: 2, attestedPeers: 1, pendingApprovals: 2, residencyHonored: true, now: Date.now() });
    expect(complianceScore(degraded)).toBeLessThan(100);
  });
});

/* ════════════════════════════ Global governance store ═════════════════════ */

describe('GlobalGovStore', () => {
  it('seeds policies and opens an approval when an action requires it', async () => {
    const s = await makeGov();
    expect(s.listPolicies().length).toBeGreaterThanOrEqual(4);
    const before = s.listApprovals().length;
    // cross_org_run is seeded require_approval (scope all).
    const evalResult = s.recordAction({ action: 'cross_org_run', peerOrg: 'org-helios', peerOrgName: 'Helios Commerce', trustLevel: 'verified', detail: 'Run worker for Helios.' });
    expect(evalResult.decision).toBe('require_approval');
    expect(s.listApprovals().length).toBe(before + 1);
    expect(s.listAudit()[0]?.action).toBe('cross_org_run');
  });

  it('adds a policy, resolves an approval, and appends to the shared audit', async () => {
    const s = await makeGov();
    const added = s.addPolicy({ name: 'Block exports', description: 'x', scope: 'all', effect: 'deny', action: 'export_data' });
    expect(s.listPolicies().some((p) => p.id === added.id)).toBe(true);
    const pending = s.listApprovals().find((a) => a.status === 'pending')!;
    const auditBefore = s.listAudit().length;
    const resolved = s.resolveApproval(pending.id, true);
    expect(resolved?.status).toBe('approved');
    expect(s.listAudit().length).toBe(auditBefore + 1);
  });
});

/* ════════════════════════════ Observability (pure) ════════════════════════ */

describe('observability', () => {
  const base: ObsInput = {
    orgs: 4,
    activePeers: 2,
    workers: 9,
    workersDegraded: 0,
    connectorsTotal: 16,
    connectorsHealthy: 16,
    connectorsDegraded: 0,
    connectorsDown: 0,
    syncDomains: 8,
    syncPending: 0,
    syncOnline: true,
    apiReplicas: 3,
    apiHealthy: 3,
    apiUptimePct: 99.9,
    fedPeers: 3,
    fedTrusted: 2,
    security: [],
    usage: [],
  };

  it('reports all subsystems healthy on a clean input', async () => {
    const o = buildObservability(base);
    expect(o.subsystems.length).toBe(7);
    expect(o.degraded).toBe(0);
    expect(o.healthy).toBe(7);
  });

  it('degrades connectors, sync, and security on problem inputs', async () => {
    const obs = await makeObs();
    const o = buildObservability({
      ...base,
      connectorsDown: 1,
      syncOnline: false,
      security: obs.securityEvents().map((e) => ({ ...e, severity: 'critical' as const })),
    });
    const byId = Object.fromEntries(o.subsystems.map((s) => [s.id, s.status]));
    expect(byId.connectors).toBe('down');
    expect(byId.sync).toBe('down');
    expect(o.criticalEvents).toBeGreaterThan(0);
  });
});

/* ════════════════════════════ Disaster recovery ═══════════════════════════ */

describe('DrStore', () => {
  it('seeds backups, replicas, and a continuity score', async () => {
    const s = await makeDr();
    expect(s.listBackups().length).toBe(3);
    expect(s.listReplicas().length).toBe(3);
    expect(s.continuity().score).toBeGreaterThan(0);
    expect(s.summary().inSync).toBe(2);
  });

  it('creates a backup and validates recovery in a sandbox without touching production', async () => {
    const s = await makeDr();
    const backup = s.createBackup('incremental');
    expect(backup.scope).toBe('incremental');
    const validation = s.runValidation(backup.id);
    expect('error' in validation).toBe(false);
    if (!('error' in validation)) {
      expect(validation.sandbox).toBe(true);
      expect(validation.status).toBe('pass');
      expect(validation.rpoSeconds).toBeLessThanOrEqual(s.continuity().rpoTargetSeconds);
    }
    // The original backups are untouched.
    expect(s.listBackups().some((b) => b.id === backup.id)).toBe(true);
  });

  it('converges a lagging replica toward in-sync on a replication check', async () => {
    const s = await makeDr();
    const before = s.listReplicas().find((r) => r.status === 'lagging');
    expect(before).toBeDefined();
    for (let i = 0; i < 4; i += 1) s.checkReplication();
    expect(s.listReplicas().every((r) => r.status === 'in_sync')).toBe(true);
  });
});

/* ════════════════════════════ Admin + scalability (pure) ══════════════════ */

describe('federation administration + scalability', () => {
  it('rolls federation, governance, and DR summaries into an admin overview', () => {
    const overview = buildFedAdmin({
      orgs: [],
      fedSummary: { orgs: 4, peers: 3, activePeers: 2, pendingInvites: 2, trustedPeers: 2, sharedOut: 2, sharedIn: 2 },
      govSummary: { policies: 4, activePolicies: 4, pendingApprovals: 1, auditEntries: 3, complianceScore: 92 },
      drSummary: { backups: 3, lastBackupAt: null, replicas: 3, inSync: 2, lastValidationAt: null, continuityScore: 88 },
      openSecurityEvents: 2,
    });
    expect(overview.peers).toBe(3);
    expect(overview.complianceScore).toBe(92);
    expect(overview.replicasInSync).toBe(2);
  });

  it('builds a scalability report with headroom and extension points', () => {
    const report = buildScalabilityReport({ tenants: 4, orgs: 4, graphNodes: 16, concurrentWorkers: 9, regions: 6, benchmarks: [{ label: 'graph.project', valueMs: 8.67, budgetMs: 20 }], now: Date.now() });
    expect(report.dimensions.length).toBe(6);
    expect(report.extensionPoints.length).toBeGreaterThan(0);
    const orgs = report.dimensions.find((d) => d.id === 'orgs')!;
    expect(orgs.headroomPct).toBeGreaterThan(0);
    expect(report.benchmarks[0]?.valueMs).toBeLessThan(report.benchmarks[0]!.budgetMs);
  });
});
