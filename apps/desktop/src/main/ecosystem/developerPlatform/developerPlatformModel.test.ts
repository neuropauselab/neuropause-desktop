/**
 * P12 — Developer Platform model tests. Pure projections over the composed developer-stack
 * snapshot: developer console, SDK registry, API explorer, template registry, publishing
 * console, and analytics.
 */
import { describe, expect, it } from 'vitest';
import type { GatewayMetrics, MarketplaceListing, PublicApi, SdkArtifact } from '@neuropause/shared';
import {
  buildApiExplorer,
  buildDeveloperAnalytics,
  buildDeveloperConsole,
  buildDeveloperPlatformOverview,
  buildPublishingConsole,
  buildSdkRegistry,
  buildTemplateRegistry,
  type DeveloperPlatformState,
} from './developerPlatformModel';

const NOW = '2026-07-16T00:00:00.000Z';

function listing(over: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: 'lst-1',
    kind: 'ai_worker',
    slug: 'ops-copilot',
    name: 'Ops Copilot',
    summary: 'An ops worker',
    developerId: 'dev-owner',
    category: 'Operations',
    pricing: { model: 'free', amount: 0, currency: 'USD' },
    status: 'published',
    currentVersionId: 'v1',
    latestVersionId: 'v1',
    installs: 42,
    ratingAvg: 4.6,
    ratingCount: 12,
    certified: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const SDK_ARTIFACTS: SdkArtifact[] = [
  { language: 'typescript', name: 'NeuroPause SDK', packageName: '@neuropause/sdk', version: '0.1.0', install: 'npm i @neuropause/sdk', docsPath: 'd', description: 'ts', builds: ['AI Workers', 'Connectors'] },
  { language: 'cli', name: 'NeuroPause CLI', packageName: '@neuropause/cli', version: '0.3.0', install: 'npm i -g @neuropause/cli', docsPath: 'd', description: 'cli', builds: ['AI Workers'] },
  { language: 'python', name: 'NeuroPause Python', packageName: 'neuropause', version: '0.1.0', install: 'pip install neuropause', docsPath: 'd', description: 'py', builds: ['Connectors'] },
  { language: 'rest', name: 'REST', packageName: 'https://api', version: 'v1', install: 'curl', docsPath: 'd', description: 'rest', builds: ['Enterprise Extensions'] },
  { language: 'webhooks', name: 'Webhooks', packageName: '@neuropause/sdk/webhooks', version: '0.1.0', install: 'npm i @neuropause/sdk', docsPath: 'd', description: 'wh', builds: ['Enterprise Extensions'] },
];

const PUBLIC_APIS: PublicApi[] = [
  { id: 'api-mkt', name: 'Marketplace API', basePath: '/v1/marketplace', version: 'v1', visibility: 'public', scopes: ['marketplace:read', 'marketplace:publish'], rps: 240 },
  { id: 'api-wf', name: 'Workforce API', basePath: '/v1/workers', version: 'v1', visibility: 'partner', scopes: ['workers:read', 'workers:manage'], rps: 90 },
  { id: 'api-admin', name: 'Admin API', basePath: '/v1/admin', version: 'v1', visibility: 'private', scopes: ['billing:read', 'usage:read'], rps: 30 },
];

const GATEWAY: GatewayMetrics = { windowDays: 30, requests: 1200, allowed: 1150, denied: 50, rateLimited: 20, unauthorized: 30, byStatus: {}, byVersion: {}, p95LatencyMs: 84 };

function state(over: Partial<DeveloperPlatformState> = {}): DeveloperPlatformState {
  return {
    developerId: 'dev-owner',
    developerName: 'Org Owner',
    organization: 'NeuroPause',
    planTier: 'pro',
    apiKeys: 3,
    oauthApps: 1,
    listings: [listing(), listing({ id: 'lst-2', name: 'Draft Worker', slug: 'draft', status: 'draft', installs: 0, certified: false }), listing({ id: 'lst-3', name: 'In Review', slug: 'rev', status: 'in_review' })],
    versionsByListing: { 'lst-1': 3, 'lst-2': 1, 'lst-3': 2 },
    currentVersionByListing: { 'lst-1': '1.2.0' },
    pendingReview: 1,
    quotaLimit: 100_000,
    quotaUsed: 12_000,
    requests30d: 1200,
    errors30d: 60,
    gateway: GATEWAY,
    usageSample: [
      { at: '2026-07-15T10:00:00Z', path: '/v1/marketplace', status: 200 },
      { at: '2026-07-15T11:00:00Z', path: '/v1/marketplace', status: 200 },
      { at: '2026-07-15T12:00:00Z', path: '/v1/workers', status: 429 },
      { at: '2026-07-16T09:00:00Z', path: '/v1/workers', status: 401 },
    ],
    publicApis: PUBLIC_APIS,
    apiVersions: ['v1'],
    sdkArtifacts: SDK_ARTIFACTS,
    ...over,
  };
}

describe('buildSdkRegistry', () => {
  it('marks real SDKs available, python planned, and appends go/java/dotnet as planned', () => {
    const r = buildSdkRegistry(SDK_ARTIFACTS);
    const byLang = new Map(r.entries.map((e) => [e.language, e]));
    expect(byLang.get('typescript')!.status).toBe('available');
    expect(byLang.get('cli')!.status).toBe('available');
    expect(byLang.get('python')!.status).toBe('planned');
    expect(byLang.get('go')!.status).toBe('planned');
    expect(byLang.get('java')).toBeDefined();
    expect(byLang.get('dotnet')).toBeDefined();
    expect(r.available).toBe(4); // ts, cli, rest, webhooks
    expect(r.planned).toBe(4); // python, go, java, dotnet
    expect(r.languages).toBe(8);
  });
});

describe('buildApiExplorer', () => {
  it('projects the public-API registry and counts by visibility', () => {
    const e = buildApiExplorer(PUBLIC_APIS, ['v1']);
    expect(e.total).toBe(3);
    expect(e.publicApis).toBe(1);
    expect(e.partnerApis).toBe(1);
    expect(e.privateApis).toBe(1);
    expect(e.versions).toEqual(['v1']);
  });
});

describe('buildTemplateRegistry', () => {
  it('catalogs the authoring-surface starters with per-kind counts', () => {
    const t = buildTemplateRegistry();
    expect(t.total).toBeGreaterThanOrEqual(6);
    expect(t.templates.some((x) => x.kind === 'worker')).toBe(true);
    expect(t.templates.some((x) => x.kind === 'connector')).toBe(true);
    expect(t.templates.some((x) => x.kind === 'plugin')).toBe(true);
    expect(t.byKind.reduce((n, k) => n + k.count, 0)).toBe(t.total);
  });
});

describe('buildDeveloperConsole', () => {
  it('rolls up the developer account, keys, listings, and quota', () => {
    const c = buildDeveloperConsole(state());
    expect(c.apiKeys).toBe(3);
    expect(c.listings).toBe(3);
    expect(c.published).toBe(1);
    expect(c.quotaUtilizationPct).toBe(12); // 12k/100k
    expect(c.health).toBe('healthy'); // 5% errors, 12% quota → healthy
  });

  it('flags attention on high error rate or quota pressure; healthy otherwise', () => {
    expect(buildDeveloperConsole(state({ errors30d: 0, quotaUsed: 1000 })).health).toBe('healthy');
    expect(buildDeveloperConsole(state({ errors30d: 200, requests30d: 1000 })).health).toBe('attention'); // 20% errors
    expect(buildDeveloperConsole(state({ quotaUsed: 95_000, quotaLimit: 100_000, errors30d: 0 })).health).toBe('attention'); // 95% quota
  });
});

describe('buildPublishingConsole', () => {
  it('lists the developer listings with status buckets', () => {
    const p = buildPublishingConsole(state());
    expect(p.entries).toHaveLength(3);
    expect(p.published).toBe(1);
    expect(p.draft).toBe(1);
    expect(p.inReview).toBe(1);
    expect(p.pendingReview).toBe(1);
    expect(p.entries.find((e) => e.listingId === 'lst-1')!.versions).toBe(3);
  });
});

describe('buildDeveloperAnalytics', () => {
  it('is developer-scoped and internally consistent: the header reconciles with byDay/topRoutes', () => {
    const a = buildDeveloperAnalytics(state());
    // Counts derive from the developer's own 4-event usage sample — NOT the gateway-wide 1200 total —
    // so the headline numbers reconcile exactly with the daily/route breakdowns below.
    expect(a.requests).toBe(4);
    expect(a.allowed).toBe(2); // the two 200s
    expect(a.denied).toBe(2); // the 429 + the 401
    expect(a.rateLimited).toBe(1); // the 429
    expect(a.unauthorized).toBe(1); // the 401
    expect(a.p95LatencyMs).toBe(84); // no per-event latency in the sample → reflects the shared gateway
    // Reconciliation invariants: the header total is exactly the sum of the breakdowns.
    expect(a.byDay.reduce((n, d) => n + d.requests, 0)).toBe(a.requests);
    expect(a.byDay.reduce((n, d) => n + d.errors, 0)).toBe(a.denied);
    expect(a.topRoutes.reduce((n, r) => n + r.requests, 0)).toBe(a.requests);
    expect(a.byDay).toHaveLength(2); // 07-15 and 07-16
    expect(a.byDay.find((d) => d.day === '2026-07-15')!.requests).toBe(3);
    expect(a.byDay.find((d) => d.day === '2026-07-16')!.errors).toBe(1); // the 401
    expect(a.topRoutes[0].route).toBe('/v1/marketplace'); // 2 requests, most
  });
});

describe('buildDeveloperPlatformOverview', () => {
  it('bundles console, sdks, apis, templates, publishing, and analytics', () => {
    const o = buildDeveloperPlatformOverview(state());
    expect(o.console.listings).toBe(3);
    expect(o.sdks.languages).toBe(8);
    expect(o.apis.total).toBe(3);
    expect(o.templates.total).toBeGreaterThanOrEqual(6);
    expect(o.publishing.entries).toHaveLength(3);
    expect(o.analytics.byDay.length).toBeGreaterThan(0);
  });
});

// F1 — template scaffolds must cite ONLY real surfaces (SDK builders + the real `neuropause` CLI),
// never the fabricated `nps init/pack/sign` commands that don't exist.
describe('buildTemplateRegistry — real authoring surfaces only', () => {
  it('references the real SDK builders and the real `neuropause publish` command (no `nps`)', () => {
    const t = buildTemplateRegistry();
    for (const tpl of t.templates) {
      expect(tpl.scaffold).not.toMatch(/\bnps\b/); // no fabricated `nps` CLI
      expect(tpl.scaffold).toMatch(/define(Worker|Connector|Plugin|Extension)/); // a real SDK builder
      expect(tpl.scaffold).toContain('neuropause publish'); // the one real authoring/publish command
    }
  });
});

// F4 — a planned language that already ships as an artifact must not be double-listed.
describe('buildSdkRegistry — dedupe against planned catalog', () => {
  it('does not append a PLANNED entry for a language already present in the artifacts', () => {
    const withGo: SdkArtifact[] = [
      ...SDK_ARTIFACTS,
      { language: 'go', name: 'NeuroPause Go (shipped)', packageName: 'github.com/neuropause/neuropause-go', version: '1.0.0', install: 'go get github.com/neuropause/neuropause-go', docsPath: 'd', description: 'go', builds: ['AI Workers'] },
    ];
    const r = buildSdkRegistry(withGo);
    const go = r.entries.filter((e) => e.language === 'go');
    expect(go).toHaveLength(1); // NOT duplicated by PLANNED_SDKS
    expect(go[0].name).toBe('NeuroPause Go (shipped)'); // the real artifact wins over the planned stub
    const langs = r.entries.map((e) => e.language);
    expect(new Set(langs).size).toBe(langs.length); // every language appears exactly once
    expect(r.languages).toBe(8); // 6 artifacts (ts,cli,python,rest,webhooks,go) + java + dotnet
  });
});

// F5 — every member of REVIEW_STATES (not just `in_review`) counts toward the in-review bucket.
describe('buildPublishingConsole — full review-state coverage', () => {
  it('counts submitted, scanning, signing, in_review, and approved as in-review', () => {
    const s = state({
      listings: [
        listing({ id: 'a', slug: 'a', status: 'submitted' }),
        listing({ id: 'b', slug: 'b', status: 'scanning' }),
        listing({ id: 'c', slug: 'c', status: 'signing' }),
        listing({ id: 'd', slug: 'd', status: 'in_review' }),
        listing({ id: 'e', slug: 'e', status: 'approved' }),
        listing({ id: 'f', slug: 'f', status: 'published' }),
        listing({ id: 'g', slug: 'g', status: 'draft' }),
        listing({ id: 'h', slug: 'h', status: 'rejected' }),
      ],
    });
    const p = buildPublishingConsole(s);
    expect(p.inReview).toBe(5); // submitted + scanning + signing + in_review + approved
    expect(p.published).toBe(1);
    expect(p.draft).toBe(1); // `rejected` counts toward none of the three buckets
  });
});

// F3 — the empty developer (no listings, no requests, zero quota) must not divide by zero.
describe('developer platform — empty / zero state', () => {
  it('yields zeroed, guarded projections and never throws', () => {
    const s = state({
      listings: [],
      versionsByListing: {},
      currentVersionByListing: {},
      pendingReview: 0,
      quotaLimit: 0,
      quotaUsed: 0,
      requests30d: 0,
      errors30d: 0,
      usageSample: [],
      sdkArtifacts: [],
    });
    const c = buildDeveloperConsole(s);
    expect(c.errorRate30d).toBe(0); // guarded: requests30d === 0
    expect(c.quotaUtilizationPct).toBe(0); // guarded: quotaLimit === 0
    expect(c.health).toBe('healthy');
    expect(c.listings).toBe(0);
    const p = buildPublishingConsole(s);
    expect(p.entries).toHaveLength(0);
    expect(p.inReview).toBe(0);
    expect(p.published).toBe(0);
    const a = buildDeveloperAnalytics(s);
    expect(a.requests).toBe(0);
    expect(a.denied).toBe(0);
    expect(a.byDay).toHaveLength(0);
    expect(a.topRoutes).toHaveLength(0);
    const sdks = buildSdkRegistry(s.sdkArtifacts);
    expect(sdks.available).toBe(0); // no artifacts → only the 3 planned stubs remain
    expect(sdks.planned).toBe(3);
    expect(() => buildDeveloperPlatformOverview(s)).not.toThrow();
  });
});
