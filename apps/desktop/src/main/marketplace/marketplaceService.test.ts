/**
 * P9 — marketplace service tests. Catalog composition, trust report, install plan,
 * analytics, and the governed install routing: allowed worker → routes to the injected
 * installer; policy deny/require_approval blocks; non-worker types catalog-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkerInstallResult, WorkerPackage } from '@neuropause/shared';
import { OrgPolicyStore } from './orgPolicyStore';
import { MarketplaceService, type CatalogSource } from './marketplaceService';
import type { EntryInput } from './marketplaceModel';

const NOW = '2026-07-15T00:00:00.000Z';
const stores: OrgPolicyStore[] = [];
const paths: string[] = [];
function tempPath(): string {
  const p = join(tmpdir(), `nps-mkt-${randomUUID()}.json`);
  paths.push(p);
  return p;
}

function ei(over: Partial<EntryInput> = {}): EntryInput {
  return {
    id: 'lst-worker',
    slug: 'acme-ops',
    name: 'Acme Ops',
    summary: 'Ops helper',
    kind: 'ai_worker',
    metadata: {},
    category: 'Operations',
    certified: true,
    version: '1.0.0',
    signed: true,
    scan: 'pass',
    rating: 4.5,
    ratingCount: 20,
    installs: 500,
    dependencies: [],
    updatedAt: NOW,
    publisher: { id: 'pub-1', name: 'Acme', verified: true, official: false, listings: 2, installs: 800, keyId: 'npsign_x', verifiedAt: NOW },
    installStatus: 'not_installed',
    ...over,
  };
}

function source(entries: EntryInput[]): CatalogSource {
  return {
    entries,
    publishers: [{ id: 'pub-1', name: 'Acme', tier: 'verified', trustScore: 0.6, keyId: 'npsign_x', verifiedAt: NOW, listings: 2, installs: 800 }],
    meta: Object.fromEntries(entries.map((e) => [e.id, { signatureValid: true, signatureKeyId: 'npsign_x', engineRange: '^1.0.0' }])),
    rollbacks: 10,
  };
}

async function setup(entries: EntryInput[], installWorker?: (pkg: WorkerPackage) => WorkerInstallResult): Promise<MarketplaceService> {
  const policy = new OrgPolicyStore(tempPath());
  stores.push(policy);
  await policy.load();
  return new MarketplaceService({
    source: () => source(entries),
    policy,
    installWorker: installWorker ?? (() => ({ ok: true, errors: [], summary: null })),
    appVersion: '1.4.0',
  });
}

afterEach(async () => {
  await Promise.all(stores.map((s) => s.flush()));
  stores.length = 0;
  for (const p of paths) await fs.rm(p, { force: true });
  paths.length = 0;
});

describe('MarketplaceService catalog', () => {
  it('composes + filters the catalog and buckets collections', async () => {
    const svc = await setup([ei(), ei({ id: 'c2', name: 'Connector', kind: 'connector', publisher: { id: 'pub-1', name: 'Acme', verified: true, official: false, listings: 2, installs: 800, keyId: 'npsign_x', verifiedAt: NOW } })]);
    expect(svc.catalog()).toHaveLength(2);
    expect(svc.catalog({ type: 'worker' })).toHaveLength(1);
    expect(svc.collections().featured.length).toBeGreaterThan(0);
    expect(svc.categories()[0].category).toBe('Operations');
    expect(svc.publishers()).toHaveLength(1);
  });

  it('builds a trust report + install plan + analytics', async () => {
    const svc = await setup([ei()]);
    const r = svc.trustReport('lst-worker')!;
    expect(r.certificate).toBe('valid');
    expect(r.compatible).toBe(true);
    expect(svc.installPlan('lst-worker').ok).toBe(true);
    const a = svc.analytics();
    expect(a.totalPackages).toBe(1);
    expect(a.rollbackRate).toBeGreaterThan(0);
  });
});

describe('MarketplaceService governed install routing', () => {
  it('routes an allowed worker install to the injected installer', async () => {
    let received: WorkerPackage | null = null;
    const svc = await setup([ei()], (pkg) => {
      received = pkg;
      return { ok: true, errors: [], summary: null };
    });
    const pkg = { manifest: { id: 'worker:pkg-x' } } as unknown as WorkerPackage;
    const r = svc.install('lst-worker', pkg);
    expect(r.ok).toBe(true);
    expect(r.routed).toBe(true);
    expect(r.decision).toBe('allow');
    expect(received).toBe(pkg); // actually routed to the real installer
  });

  it('approves a worker install with no package payload (routing hand-off to the Workforce Center)', async () => {
    const svc = await setup([ei()]);
    const r = svc.install('lst-worker');
    expect(r.ok).toBe(true);
    expect(r.decision).toBe('allow');
    expect(r.routed).toBe(false);
    expect(r.message).toContain('Workforce Center');
  });

  it('denies a present-but-invalid signature when the org requires a valid signature', async () => {
    const policy = new OrgPolicyStore(tempPath());
    stores.push(policy);
    await policy.load();
    // Entry claims to be signed, but the trust layer reports the signature does NOT verify.
    const entries = [ei()];
    const svc = new MarketplaceService({
      source: () => ({
        entries,
        publishers: [{ id: 'pub-1', name: 'Acme', tier: 'verified', trustScore: 0.6, keyId: 'npsign_x', verifiedAt: NOW, listings: 2, installs: 800 }],
        meta: { 'lst-worker': { signatureValid: false, signatureKeyId: 'npsign_x', engineRange: '^1.0.0' } },
        rollbacks: 0,
      }),
      policy,
      installWorker: () => ({ ok: true, errors: [], summary: null }),
      appVersion: '1.4.0',
    });
    svc.policySet({ requireApproval: false, allowedPublishers: [], blockedPublishers: [], blockedTypes: [], minPublisherTier: 'unverified', requireSignature: true });
    const r = svc.install('lst-worker', {} as WorkerPackage);
    expect(r.decision).toBe('deny');
    expect(r.ok).toBe(false);
  });

  it('blocks an install denied by org policy (blocked publisher) — never routes', async () => {
    let routed = false;
    const svc = await setup([ei()], () => {
      routed = true;
      return { ok: true, errors: [], summary: null };
    });
    svc.policySet({ requireApproval: false, allowedPublishers: [], blockedPublishers: ['pub-1'], blockedTypes: [], minPublisherTier: 'unverified', requireSignature: false });
    const r = svc.install('lst-worker', {} as WorkerPackage);
    expect(r.decision).toBe('deny');
    expect(r.ok).toBe(false);
    expect(routed).toBe(false); // denied before routing
  });

  it('returns require_approval when org policy demands it', async () => {
    const svc = await setup([ei()]);
    svc.policySet({ requireApproval: true, allowedPublishers: [], blockedPublishers: [], blockedTypes: [], minPublisherTier: 'unverified', requireSignature: false });
    const r = svc.install('lst-worker', {} as WorkerPackage);
    expect(r.decision).toBe('require_approval');
    expect(r.ok).toBe(false);
    expect(r.routed).toBe(false);
  });

  it('catalogs a non-worker (non-installable) type without routing', async () => {
    const svc = await setup([ei({ id: 'dash', name: 'Dash', kind: 'plugin', metadata: { packageType: 'dashboard_pack' } })]);
    const r = svc.install('dash');
    expect(r.ok).toBe(true);
    expect(r.routed).toBe(false);
    expect(r.message).toContain('no in-app installer');
  });

  it('propagates an installer failure', async () => {
    const svc = await setup([ei()], () => ({ ok: false, errors: ['bad signature'], summary: null }));
    const r = svc.install('lst-worker', {} as WorkerPackage);
    expect(r.ok).toBe(false);
    expect(r.routed).toBe(true);
    expect(r.errors).toContain('bad signature');
  });
});
