/**
 * P13C Round 8 — `MarketplaceStore` now has a publisher boundary: PUBLISHED
 * listings stay visible to all (a marketplace), while DRAFTS and the submission
 * trail belong to the publisher. These suites act AS one publisher.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createPublicKey } from 'node:crypto';
import { DeveloperStore, developerOwnerIdentity } from './developer/developerStore';
import { MarketplaceStore } from './marketplace/marketplaceStore';
import { GatewayStore } from './gateway/gatewayStore';
import { BillingStore } from './billing/billingStore';
import { verifyManifest } from './marketplace/pipeline';
import type { ListingManifest } from '@neuropause/shared';

const paths: string[] = [];
function tempPath(tag: string): string {
  const p = join(tmpdir(), `nps-eco-${tag}-${randomUUID()}.json`);
  paths.push(p);
  return p;
}
afterEach(async () => {
  for (const p of paths.splice(0)) await fs.rm(p, { force: true }).catch(() => undefined);
});

const SEED = { id: 'dev-test', name: 'Tester', email: 't@x.io', organization: 'X', orgId: 'org-default' };

/**
 * P13C ROUND 3 — H-3. The developer, billing and gateway stores now carry a
 * tenant boundary, and an UNBOUND store denies. These tests name the same
 * organization the seeds use, so every existing assertion keeps its meaning:
 * they are single-tenant tests of single-tenant behaviour, which is exactly what
 * they were before. Cross-tenant behaviour is asserted separately, in
 * `tenancy/e2e/developerSurfaceTenancy.test.ts`.
 */
const TENANT = { tenantId: 'org-default', workspaceId: 'ws-default' };
const scope = (): typeof TENANT => TENANT;

function cleanManifest(version = '1.0.0'): ListingManifest {
  return {
    kind: 'connector',
    name: 'C',
    version,
    entry: 'connector/c.js',
    permissions: ['connectors:read'],
    capabilities: [],
    dependencies: [],
    network: [],
    metadata: { publisher: 'X' },
  };
}

describe('DeveloperStore', () => {
  it('creates, verifies, and revokes API keys', async () => {
    const s = new DeveloperStore(tempPath('dev'), SEED).bindScope(scope);
    await s.load();
    const { key, secret } = s.createKey('dev-test', 'CI', ['marketplace:read']);
    expect(secret.startsWith(key.prefix)).toBe(true);
    expect(s.verifyKey(secret)?.id).toBe(key.id);
    expect(s.verifyKey('npk_live_garbage.nope')).toBeNull();
    s.revokeKey(key.id);
    expect(s.verifyKey(secret)).toBeNull();
    await s.flush();
  });

  it('records usage and counts within a window', async () => {
    const s = new DeveloperStore(tempPath('dev'), SEED).bindScope(scope);
    await s.load();
    const now = new Date().toISOString();
    s.recordUsage({ developerId: 'dev-test', apiKeyId: null, at: now, method: 'GET', path: '/v1/x', version: 'v1', status: 200, latencyMs: 5, computeUnits: 1 });
    expect(s.countSince('dev-test', Date.now() - 86_400_000)).toBe(1);
    await s.flush();
  });
});

describe('developerOwnerIdentity (mirrors the enterprise claimed owner)', () => {
  it('returns the owner identity once the workspace owner is claimed', () => {
    expect(developerOwnerIdentity({ name: 'Ada', email: 'ada@np.dev' })).toEqual({
      name: 'Ada',
      email: 'ada@np.dev',
    });
  });

  it('keeps the seeded placeholder while the owner is unclaimed (null email)', () => {
    expect(developerOwnerIdentity({ name: 'Workspace Owner', email: null })).toBeNull();
  });

  it('keeps the placeholder when there is no owner record', () => {
    expect(developerOwnerIdentity(null)).toBeNull();
  });
});

describe('MarketplaceStore lifecycle', () => {
  it('drives submit → review → publish, and signs the version', async () => {
    const s = new MarketplaceStore(tempPath('mkt'), 'dev-test', []).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    await s.load();
    const listing = s.createListing({ kind: 'connector', slug: 'c', name: 'C', summary: '', category: 'x', pricing: { model: 'free', amount: 0, currency: 'USD' } });
    const v1 = s.addVersion(listing.id, cleanManifest('1.0.0'), 'init');
    expect(v1).not.toBeNull();

    const submitted = s.submit(v1!.id, 'tester');
    expect(submitted?.status).toBe('in_review');
    expect(submitted?.signature).not.toBeNull();
    expect(submitted?.scan?.status).toBe('pass');

    // signature verifies against the store's public key
    const pub = createPublicKey(s.publicKeyPem());
    expect(verifyManifest(submitted!.manifest, submitted!.signature!, pub)).toBe(true);

    s.review(v1!.id, 'approved', 'reviewer', 'ok');
    const published = s.publish(v1!.id, 'tester');
    expect(published?.status).toBe('published');
    expect(s.detail(listing.id)?.listing.currentVersionId).toBe(v1!.id);
    await s.flush();
  });

  it('rejects a version that fails the security scan', async () => {
    const s = new MarketplaceStore(tempPath('mkt'), 'dev-test', []).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    await s.load();
    const listing = s.createListing({ kind: 'plugin', slug: 'p', name: 'P', summary: '', category: 'x', pricing: { model: 'free', amount: 0, currency: 'USD' } });
    const bad = s.addVersion(listing.id, { ...cleanManifest(), permissions: ['system:exec'] }, 'bad');
    const r = s.submit(bad!.id, 'tester');
    expect(r?.status).toBe('rejected');
    expect(r?.review?.reviewer).toBe('scanner');
    await s.flush();
  });

  it('rolls back to the previous published version', async () => {
    const s = new MarketplaceStore(tempPath('mkt'), 'dev-test', []).bindScope(() => ({ tenantId: 'org-alpha', workspaceId: 'ws-alpha' }));
    await s.load();
    const listing = s.createListing({ kind: 'connector', slug: 'c', name: 'C', summary: '', category: 'x', pricing: { model: 'free', amount: 0, currency: 'USD' } });
    const v1 = s.addVersion(listing.id, cleanManifest('1.0.0'), 'v1')!;
    s.submit(v1.id, 't');
    s.review(v1.id, 'approved', 'r', '');
    s.publish(v1.id, 't');
    const v2 = s.addVersion(listing.id, cleanManifest('2.0.0'), 'v2')!;
    s.submit(v2.id, 't');
    s.review(v2.id, 'approved', 'r', '');
    s.publish(v2.id, 't');
    expect(s.detail(listing.id)?.listing.currentVersionId).toBe(v2.id);

    s.rollback(listing.id, 't');
    expect(s.detail(listing.id)?.listing.currentVersionId).toBe(v1.id);
    const versions = s.detail(listing.id)!.versions;
    expect(versions.find((v) => v.id === v2.id)?.status).toBe('rolled_back');
    await s.flush();
  });
});

describe('GatewayStore', () => {
  it('peeks without consuming and commits one request', async () => {
    const s = new GatewayStore(tempPath('gw')).bindScope(scope);
    await s.load();
    const rate = { windowMs: 60_000, max: 5 };
    const quota = { period: 'month' as const, limit: 100 };
    const now = Date.now();
    expect(s.peek('key_1', 'dev_1', rate, quota, now)).toEqual({ rateRemaining: 5, quotaUsed: 0 });
    s.commit('key_1', 'dev_1', rate, quota, now);
    expect(s.peek('key_1', 'dev_1', rate, quota, now)).toEqual({ rateRemaining: 4, quotaUsed: 1 });
    await s.flush();
  });

  it('aggregates metrics from the audit trail', async () => {
    const s = new GatewayStore(tempPath('gw')).bindScope(scope);
    await s.load();
    const at = new Date().toISOString();
    const owner = TENANT.tenantId;
    s.record({ at, tenantId: owner, keyId: 'k', developerId: 'd', method: 'GET', path: '/v1', version: 'v1', status: 200, reason: 'OK', latencyMs: 4 });
    s.record({ at, tenantId: owner, keyId: 'k', developerId: 'd', method: 'GET', path: '/v1', version: 'v1', status: 429, reason: 'rate', latencyMs: 2 });
    const m = s.metrics(7, Date.now());
    expect(m.requests).toBe(2);
    expect(m.allowed).toBe(1);
    expect(m.rateLimited).toBe(1);
    await s.flush();
  });
});

describe('BillingStore', () => {
  it('seeds a free subscription with the owner seated', async () => {
    const s = new BillingStore(tempPath('bill'), { orgId: 'org-default', ownerUserId: 'user-owner', ownerName: 'Owner' }).bindScope(scope);
    await s.load();
    const sub = s.getSubscription();
    expect(sub.planTier).toBe('free');
    expect(sub.seatsUsed).toBe(1);
    await s.flush();
  });

  it('enforces seat limits and reflects plan changes', async () => {
    const s = new BillingStore(tempPath('bill'), { orgId: 'org-default', ownerUserId: 'user-owner', ownerName: 'Owner' }).bindScope(scope);
    await s.load();
    // free plan = 1 seat, already used by owner
    expect(s.assignSeat('u2', 'Two')).toHaveProperty('error');
    s.setPlan('pro');
    expect(s.getSubscription().seats).toBe(5);
    expect(s.assignSeat('u2', 'Two')).toHaveProperty('id');
    await s.flush();
  });

  it('records a purchase and issues an org license', async () => {
    const s = new BillingStore(tempPath('bill'), { orgId: 'org-default', ownerUserId: 'user-owner', ownerName: 'Owner' }).bindScope(scope);
    await s.load();
    const { purchase, license } = s.purchase({ listingId: 'lst_1', listingName: 'Pack', versionId: 'ver_1', model: 'one_time', amount: 100, currency: 'USD', feePct: 0.2 });
    expect(purchase.feeAmount).toBe(20);
    expect(license.kind).toBe('organization');
    expect(s.listLicenses()).toHaveLength(1);
    await s.flush();
  });
});
