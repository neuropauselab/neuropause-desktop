/**
 * P12 — Developer Platform service tests: composition, snapshot + projection memoization,
 * and invalidation.
 */
import { describe, expect, it } from 'vitest';
import type { GatewayMetrics, MarketplaceListing, PublicApi, SdkArtifact } from '@neuropause/shared';
import { DeveloperPlatformService } from './developerPlatformService';
import type { DeveloperPlatformState } from './developerPlatformModel';

const NOW = '2026-07-16T00:00:00.000Z';
const GATEWAY: GatewayMetrics = { windowDays: 30, requests: 500, allowed: 490, denied: 10, rateLimited: 4, unauthorized: 6, byStatus: {}, byVersion: {}, p95LatencyMs: 60 };
const SDKS: SdkArtifact[] = [{ language: 'typescript', name: 'SDK', packageName: '@neuropause/sdk', version: '0.1.0', install: 'npm i', docsPath: 'd', description: 'x', builds: ['AI Workers'] }];
const APIS: PublicApi[] = [{ id: 'a', name: 'Marketplace API', basePath: '/v1/marketplace', version: 'v1', visibility: 'public', scopes: [], rps: 240 }];
const LISTING: MarketplaceListing = { id: 'l1', kind: 'ai_worker', slug: 's', name: 'W', summary: '', developerId: 'dev-owner', category: 'Ops', pricing: { model: 'free', amount: 0, currency: 'USD' }, status: 'published', currentVersionId: 'v1', latestVersionId: 'v1', installs: 5, ratingAvg: 4, ratingCount: 2, certified: true, createdAt: NOW, updatedAt: NOW };

function baseState(over: Partial<DeveloperPlatformState> = {}): DeveloperPlatformState {
  return {
    developerId: 'dev-owner',
    developerName: 'Owner',
    organization: 'NeuroPause',
    planTier: 'free',
    apiKeys: 2,
    oauthApps: 0,
    listings: [LISTING],
    versionsByListing: { l1: 1 },
    currentVersionByListing: { l1: '1.0.0' },
    pendingReview: 0,
    quotaLimit: 1000,
    quotaUsed: 100,
    requests30d: 500,
    errors30d: 10,
    gateway: GATEWAY,
    usageSample: [{ at: NOW, path: '/v1/marketplace', status: 200 }],
    publicApis: APIS,
    apiVersions: ['v1'],
    sdkArtifacts: SDKS,
    ...over,
  };
}

describe('DeveloperPlatformService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new DeveloperPlatformService({ readState: () => baseState() });
    expect(svc.overview().console.apiKeys).toBe(2);
    expect(svc.console().health).toBe('healthy');
    expect(svc.sdks().languages).toBeGreaterThan(0);
    expect(svc.apis().total).toBe(1);
    expect(svc.templates().total).toBeGreaterThan(0);
    expect(svc.publishing().published).toBe(1);
    // Analytics is developer-scoped: `requests` comes from the developer's usage sample (1 event),
    // not the gateway-wide 500, and the header reconciles with the byDay breakdown.
    const analytics = svc.analytics();
    expect(analytics.requests).toBe(1);
    expect(analytics.byDay.reduce((n, d) => n + d.requests, 0)).toBe(analytics.requests);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new DeveloperPlatformService({
      readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const c1 = svc.console();
    expect(svc.console()).toBe(c1); // same reference → O(1) cache hit
    expect(svc.apis()).toBe(svc.apis());
    expect(reads).toBe(1); // one composition across all reads

    box.value = baseState({ apiKeys: 9 });
    expect(svc.console()).toBe(c1); // still cached
    svc.invalidate();
    expect(svc.console()).not.toBe(c1); // recomposed
    expect(svc.console().apiKeys).toBe(9);
    expect(reads).toBe(2);
  });
});
