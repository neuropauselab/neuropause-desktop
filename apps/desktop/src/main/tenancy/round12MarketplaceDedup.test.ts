/**
 * P13C ROUND 12 — M-12. A VOTE WITH NO VOTER.
 *
 * `install()` was `installs + 1` and `rate()` was a running average, both with
 * NO RECORD OF WHO. Every call was a fresh adoption and a fresh opinion.
 *
 * `ecosystem:listing.rate` is gated at `developer:manage` — a permission every
 * Owner of every self-created organization holds — and a published listing is
 * visible to all tenants by design (that is the marketplace). So tenant B could
 * loop one channel and drive tenant A's published listing to `ratingAvg: 1.0,
 * ratingCount: 100000`, or inflate its own to the top of `rankCatalog`, which
 * sorts on `installs`. Neither handler carried `audit: true`, so the write was
 * not even recorded.
 *
 * THE DIMENSION IS THE ORGANIZATION, and it is a decision. This store's only
 * identity seam is `tenancy.scopeOrDeny()`, which resolves a tenant — there is
 * no user seam here, and inventing one would be guessing at semantics the rest
 * of the subsystem does not share. Per-org also matches how adoption is already
 * counted next door: `exchange/analytics.downloads30d` counts per-organization
 * `Installation` rows through `requireCallerOrgId`.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. A published listing stays installable and
 * rateable by every tenant. `marketplaceOwnership.test.ts` has a case named
 * *"B CAN install and rate A's PUBLISHED listing — that is the marketplace"*,
 * and it still passes. The finding was never that consumption crosses tenants;
 * it was that consumption was unbounded and anonymous.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TenantScope, ListingManifest } from '@neuropause/shared';
import { MarketplaceStore } from '../ecosystem/marketplace/marketplaceStore';

const A: TenantScope = { tenantId: 'org-a', workspaceId: 'ws-a' };
const B: TenantScope = { tenantId: 'org-b', workspaceId: 'ws-b' };
const C: TenantScope = { tenantId: 'org-c', workspaceId: 'ws-c' };

const dirs: string[] = [];
let store: MarketplaceStore;
let who: TenantScope | null = null;
let file: string;

function manifest(version: string): ListingManifest {
  return {
    kind: 'app',
    name: 'Fixture',
    version,
    entry: 'index.js',
    permissions: [],
    capabilities: [],
    dependencies: [],
    network: [],
    metadata: {},
  };
}

/** Create → version → submit → review → publish, as `scope`. */
function publishAs(scope: TenantScope, name: string): string {
  who = scope;
  const listing = store.createListing({
    kind: 'app',
    slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    name,
    summary: `${name} summary`,
    category: 'writing',
    pricing: { model: 'free', amount: 0, currency: 'USD' },
  });
  const version = store.addVersion(listing.id, manifest('1.0.0'), 'first');
  store.submit(version!.id, 'tester');
  store.review(version!.id, 'approved', 'tester', 'ok');
  store.publish(version!.id, 'tester');
  return listing.id;
}

beforeEach(async () => {
  const dir = join(tmpdir(), `np-r12-market-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  file = join(dir, 'marketplace.json');
  store = new MarketplaceStore(file, 'dev-owner', []).bindScope(() => who);
  await store.load();
  who = null;
});
afterEach(async () => {
  await store.flush?.();
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

describe('one adoption per organization', () => {
  it('A installing five times counts ONCE', () => {
    const x = publishAs(A, 'Widget');
    who = B;
    for (let i = 0; i < 5; i += 1) store.install(x);
    who = A;
    expect(store.detail(x)!.listing.installs).toBe(1);
  });

  it('A, B and C each count once — three distinct adopters', () => {
    const x = publishAs(A, 'Widget');
    for (const scope of [A, B, C]) {
      who = scope;
      store.install(x);
      store.install(x); // repeat, must not count
    }
    who = A;
    expect(store.detail(x)!.listing.installs).toBe(3);
  });

  it('an unresolved caller cannot adopt at all', () => {
    const x = publishAs(A, 'Widget');
    who = null;
    expect(store.install(x)).toBeNull();
    who = A;
    expect(store.detail(x)!.listing.installs).toBe(0);
  });
});

describe('one opinion per organization, changeable', () => {
  it('THE REVIEW-BOMB: B rating 100 times moves the count by one', () => {
    const x = publishAs(A, 'Widget');
    who = B;
    for (let i = 0; i < 100; i += 1) store.rate(x, 1);
    who = A;
    const l = store.detail(x)!.listing;
    expect(l.ratingCount).toBe(1);
    expect(l.ratingAvg).toBe(1);
  });

  it('three organizations, three votes, correct arithmetic', () => {
    const x = publishAs(A, 'Widget');
    who = A;
    store.rate(x, 5);
    who = B;
    store.rate(x, 4);
    who = C;
    store.rate(x, 3);

    who = A;
    const l = store.detail(x)!.listing;
    expect(l.ratingCount).toBe(3);
    expect(l.ratingAvg).toBe(4); // (5+4+3)/3
  });

  it('an organization may CHANGE its rating — count steady, average moves', () => {
    const x = publishAs(A, 'Widget');
    who = A;
    store.rate(x, 5);
    who = B;
    store.rate(x, 1);
    who = A;
    expect(store.detail(x)!.listing.ratingAvg).toBe(3); // (5+1)/2

    who = B;
    store.rate(x, 5); // B changes its mind
    who = A;
    const l = store.detail(x)!.listing;
    expect(l.ratingCount).toBe(2); // NOT 3
    expect(l.ratingAvg).toBe(5); // (5+5)/2
  });

  it('an unresolved caller cannot vote', () => {
    const x = publishAs(A, 'Widget');
    who = null;
    expect(store.rate(x, 1)).toBeNull();
    who = A;
    expect(store.detail(x)!.listing.ratingCount).toBe(0);
  });

  it('stars stay clamped to 1-5 per organization', () => {
    const x = publishAs(A, 'Widget');
    who = B;
    store.rate(x, 99);
    who = A;
    expect(store.detail(x)!.listing.ratingAvg).toBe(5);
    who = B;
    store.rate(x, -7);
    who = A;
    expect(store.detail(x)!.listing.ratingAvg).toBe(1);
    expect(store.detail(x)!.listing.ratingCount).toBe(1);
  });
});

describe('a legacy row keeps its history — no silent migration loss', () => {
  it('pre-M-12 totals survive, and new votes extend rather than replace them', () => {
    const x = publishAs(A, 'Widget');
    // Simulate a row written before `ratings` existed: real historical totals,
    // no identity map. Recomputing from the map would erase all 40 votes.
    const l = store.detail(x)!.listing;
    (store as unknown as { listings: Map<string, unknown> }).listings.set(x, {
      ...l,
      ratingCount: 40,
      ratingAvg: 4,
      installs: 40,
    });

    who = B;
    store.rate(x, 5);
    who = A;
    const after = store.detail(x)!.listing;
    expect(after.ratingCount).toBe(41); // 40 legacy + B
    expect(after.ratingAvg).toBe(4.02); // (4*40 + 5) / 41
    expect(after.installs).toBe(40); // untouched by a rating

    // And B still cannot vote twice on top of the legacy baseline.
    who = B;
    store.rate(x, 1);
    who = A;
    expect(store.detail(x)!.listing.ratingCount).toBe(41);
  });
});

describe('the dedup survives a reload from disk', () => {
  it('B cannot re-vote after the store is reopened', async () => {
    const x = publishAs(A, 'Widget');
    who = B;
    store.rate(x, 5);
    store.install(x);
    await store.flush?.();

    const reopened = new MarketplaceStore(file, 'dev-owner', []).bindScope(() => who);
    await reopened.load();

    who = B;
    reopened.rate(x, 1); // a revision, not a new vote
    reopened.install(x); // already adopted
    who = A;
    const l = reopened.detail(x)!.listing;
    expect(l.ratingCount).toBe(1);
    expect(l.installs).toBe(1);
  });
});
