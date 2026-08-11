/**
 * P13C ROUND 9 — F1. A LISTING ID IS NOT OWNERSHIP.
 *
 * Round 8 scoped the marketplace READS and left every WRITE resolving the
 * renderer's id straight out of the Map. A listing id is not a secret: `list()`
 * hands every tenant the id of every published listing. So tenant B's Admin
 * could call `ecosystem:listing.rollback` with tenant A's listing id and
 * unpublish A's product, writing an event into A's trail attributed to B.
 *
 * WHAT THIS SUITE REFUSES TO DO
 *
 * It does not assert `A !== B`. Every listing here is REAL and PERSISTED through
 * the store's own lifecycle — created, versioned, submitted, reviewed,
 * published — and the assertions name the values:
 *
 *     A publishes 3 listings.   B publishes 7.   C publishes 11.
 *
 * A test whose fixture is empty proves nothing about isolation, because an empty
 * store denies everybody. Round 8's own `orgIntelligence` test mocked the store
 * as `all: () => []` and therefore agreed with the bug it was meant to catch.
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

/** A manifest that PASSES the real security scan, so submit→publish completes. */
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

/** Create → version → submit → review → publish, as the CURRENT tenant. */
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
  expect(version).not.toBeNull();
  store.submit(version!.id, 'tester');
  store.review(version!.id, 'approved', 'tester', 'ok');
  store.publish(version!.id, 'tester');
  return listing.id;
}

/** A listing left in DRAFT, as the current tenant. */
function draftAs(scope: TenantScope, name: string): { listingId: string; versionId: string } {
  who = scope;
  const listing = store.createListing({
    kind: 'app',
    slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    name,
    summary: `${name} summary`,
    category: 'writing',
    pricing: { model: 'free', amount: 0, currency: 'USD' },
  });
  const version = store.addVersion(listing.id, manifest('0.1.0'), 'draft');
  return { listingId: listing.id, versionId: version!.id };
}

beforeEach(async () => {
  const dir = join(tmpdir(), `np-market-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  dirs.push(dir);
  // NO SEEDS: the fixture is built explicitly below so the counts are exact.
  store = new MarketplaceStore(join(dir, 'market.json'), 'dev-owner', []);
  store.bindScope(() => who);
  await store.load();
  who = null;
});

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

describe('A/B/C publish real listings and each sees its own', () => {
  it('A owns 3, B owns 7, C owns 11 — the numbers, not an inequality', () => {
    const aIds = Array.from({ length: 3 }, (_, i) => publishAs(A, `A-APP-${i}`));
    const bIds = Array.from({ length: 7 }, (_, i) => publishAs(B, `B-APP-${i}`));
    const cIds = Array.from({ length: 11 }, (_, i) => publishAs(C, `C-APP-${i}`));

    expect(aIds).toHaveLength(3);
    expect(bIds).toHaveLength(7);
    expect(cIds).toHaveLength(11);

    // Published listings are public — that is what publishing means. All 21.
    who = A;
    expect(store.list()).toHaveLength(21);

    // But the EVENT TRAIL is the publisher's own, and it is not empty.
    who = A;
    const aEvents = store.recentEvents(500);
    who = B;
    const bEvents = store.recentEvents(500);
    who = C;
    const cEvents = store.recentEvents(500);

    expect(aEvents.length).toBeGreaterThan(0);
    expect(bEvents.length).toBeGreaterThan(0);
    expect(cEvents.length).toBeGreaterThan(0);

    const aListingIds = new Set(aIds);
    expect(aEvents.every((e) => aListingIds.has(e.listingId ?? ''))).toBe(true);
    expect(bEvents.some((e) => aListingIds.has(e.listingId ?? ''))).toBe(false);
    expect(cEvents.some((e) => aListingIds.has(e.listingId ?? ''))).toBe(false);
  });
});

describe('every mutation path refuses a foreign listing id', () => {
  it('B cannot roll back A’s published listing — THE EXPLOIT', () => {
    const aListing = publishAs(A, 'A-PRODUCT');

    who = A;
    expect(store.detail(aListing)!.listing.status).toBe('published');

    // B holds the id: it is in the public list.
    who = B;
    expect(store.list().some((l) => l.id === aListing)).toBe(true);

    expect(store.rollback(aListing, 'attacker')).toBeNull();

    // Still published, and no rollback event was written into A's trail.
    who = A;
    expect(store.detail(aListing)!.listing.status).toBe('published');
    expect(store.eventsFor(aListing, 500).some((e) => e.action === 'rolled_back')).toBe(false);
  });

  it('A CAN roll back its own — the guard is not simply "always no"', () => {
    const aListing = publishAs(A, 'A-PRODUCT');
    who = A;
    store.addVersion(aListing, manifest('2.0.0'), 'second');
    const v2 = store.detail(aListing)!.versions.find((v) => v.version === '2.0.0')!;
    store.submit(v2.id, 'a');
    store.review(v2.id, 'approved', 'a', 'ok');
    store.publish(v2.id, 'a');
    expect(store.detail(aListing)!.listing.currentVersionId).toBe(v2.id);

    expect(store.rollback(aListing, 'a')).not.toBeNull();
    who = A;
    expect(store.eventsFor(aListing, 500).some((e) => e.action === 'rolled_back')).toBe(true);
  });

  it('B cannot addVersion onto A’s listing', () => {
    const aListing = publishAs(A, 'A-PRODUCT');
    who = A;
    const before = store.detail(aListing)!.versions.length;

    who = B;
    expect(store.addVersion(aListing, manifest('9.9.9'), 'hostile')).toBeNull();

    who = A;
    expect(store.detail(aListing)!.versions).toHaveLength(before);
  });

  it('B cannot submit, review or publish A’s version', () => {
    const { versionId } = draftAs(A, 'A-DRAFT');

    who = B;
    expect(store.submit(versionId, 'attacker')).toBeNull();
    expect(store.review(versionId, 'approved', 'attacker', 'self-approved')).toBeNull();
    expect(store.publish(versionId, 'attacker')).toBeNull();

    who = A;
    const still = store.detail(store.list().find((l) => l.name === 'A-DRAFT')!.id);
    expect(still!.versions[0]!.status).toBe('draft');
  });

  it('A cannot mutate B’s listing either — the rule is symmetric', () => {
    const bListing = publishAs(B, 'B-PRODUCT');
    who = A;
    expect(store.rollback(bListing, 'attacker')).toBeNull();
    expect(store.addVersion(bListing, manifest('9.9.9'), 'hostile')).toBeNull();

    who = B;
    expect(store.detail(bListing)!.listing.status).toBe('published');
  });

  it('an unresolved caller (no tenant) mutates nothing', () => {
    const aListing = publishAs(A, 'A-PRODUCT');
    who = null;
    expect(store.rollback(aListing, 'nobody')).toBeNull();
    expect(store.addVersion(aListing, manifest('9.9.9'), 'nobody')).toBeNull();
    who = A;
    expect(store.detail(aListing)!.listing.status).toBe('published');
  });
});

describe('install and rate are the CONSUMER relation, not the publisher one', () => {
  it('B CAN install and rate A’s PUBLISHED listing — that is the marketplace', () => {
    const aListing = publishAs(A, 'A-PRODUCT');

    who = B;
    expect(store.install(aListing)!.installs).toBe(1);
    expect(store.rate(aListing, 5)!.ratingCount).toBe(1);
  });

  it('B CANNOT install or rate A’s DRAFT — that would confirm it exists', () => {
    const { listingId } = draftAs(A, 'A-SECRET-DRAFT');

    who = B;
    expect(store.install(listingId)).toBeNull();
    expect(store.rate(listingId, 5)).toBeNull();

    who = A;
    const mine = store.list().find((l) => l.id === listingId)!;
    expect(mine.installs).toBe(0);
    expect(mine.ratingCount).toBe(0);
  });
});

describe('F8 — stats counts what the caller can see', () => {
  it('A’s draft is invisible in B’s stats, and B’s totals stay honest', () => {
    publishAs(A, 'A-PUBLISHED');
    draftAs(A, 'A-DRAFT-1');
    draftAs(A, 'A-DRAFT-2');
    publishAs(B, 'B-PUBLISHED');

    who = B;
    const bStats = store.stats();
    // B sees two published listings and none of A's two drafts.
    expect(bStats.published).toBe(2);
    expect(bStats.draft).toBe(0);
    expect(bStats.totalListings).toBe(2);

    who = A;
    const aStats = store.stats();
    // A sees both published plus its OWN two drafts. A zero would not be a count.
    expect(aStats.published).toBe(2);
    expect(aStats.draft).toBe(2);
    expect(aStats.totalListings).toBe(4);
  });
});

describe('ownership survives a restart', () => {
  it('a reloaded store still refuses B on A’s listing, and still allows A', async () => {
    const aListing = publishAs(A, 'A-PRODUCT');
    await store.flush();

    const path = (store as unknown as { filePath: string }).filePath;
    const reopened = new MarketplaceStore(path, 'dev-owner', []);
    reopened.bindScope(() => who);
    await reopened.load();

    who = B;
    expect(reopened.rollback(aListing, 'attacker')).toBeNull();

    who = A;
    expect(reopened.detail(aListing)!.listing.status).toBe('published');
    expect(reopened.addVersion(aListing, manifest('2.0.0'), 'mine')).not.toBeNull();
  });
});
