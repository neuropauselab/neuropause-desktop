/**
 * Developer Platform (P12) — the pure intelligence model.
 *
 * All non-trivial developer-platform logic lives here (the house pure-model pattern) so it is
 * unit-tested under Node with no I/O. It projects a composed snapshot of the EXISTING ecosystem
 * developer stack (developer account, API keys, OAuth, the gateway, billing, the public-API
 * registry, the SDK catalog, and marketplace publishing) into unified developer VIEW MODELS: a
 * developer console, an SDK registry, an API explorer, a template/sample registry, a publishing
 * console, and analytics. The registries are CATALOGS of the existing authoring surfaces — no
 * new SDK, runtime, API server, or marketplace.
 */
import type {
  ApiExplorer,
  DevApiEntry,
  DeveloperConsole,
  DeveloperConsoleHealth,
  DeveloperPlatformAnalytics,
  DeveloperPlatformOverview,
  DevSdkEntry,
  DevSdkLanguage,
  DevTemplate,
  DevTemplateKind,
  GatewayMetrics,
  ListingStatus,
  MarketplaceListing,
  PlanTier,
  PublicApi,
  PublishingConsole,
  PublishingEntry,
  SdkArtifact,
  SdkRegistry,
  TemplateRegistry,
} from '@neuropause/shared';

/** Bound on the publishing list payload so the IPC stays finite at scale. */
const MAX_PUBLISHING_ENTRIES = 250;

/** The composed snapshot the projections read (assembled by the service from the ecosystem stores). */
export interface DeveloperPlatformState {
  developerId: string;
  developerName: string;
  organization: string;
  planTier: PlanTier;
  apiKeys: number;
  oauthApps: number;
  listings: MarketplaceListing[];
  versionsByListing: Record<string, number>;
  currentVersionByListing: Record<string, string>;
  pendingReview: number;
  quotaLimit: number;
  quotaUsed: number;
  requests30d: number;
  errors30d: number;
  gateway: GatewayMetrics;
  usageSample: { at: string; path: string; status: number }[];
  publicApis: PublicApi[];
  apiVersions: string[];
  sdkArtifacts: SdkArtifact[];
}

/* ── SDK registry (catalog over the existing SDK artifacts + planned languages) ── */

const AVAILABLE_SDK_LANGS = new Set<DevSdkLanguage>(['typescript', 'cli', 'rest', 'webhooks']);

/** Planned language SDKs (catalog entries — honestly marked "planned", no implementation claimed). */
const PLANNED_SDKS: DevSdkEntry[] = [
  {
    language: 'go',
    name: 'NeuroPause SDK for Go',
    packageName: 'github.com/neuropause/neuropause-go',
    version: '0.1.0',
    install: 'go get github.com/neuropause/neuropause-go',
    status: 'planned',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'Idiomatic Go client mirroring the gateway contract (planned).',
    capabilities: ['AI Workers', 'Connectors', 'Enterprise Extensions'],
  },
  {
    language: 'java',
    name: 'NeuroPause SDK for Java',
    packageName: 'dev.neuropause:neuropause-sdk',
    version: '0.1.0',
    install: 'implementation "dev.neuropause:neuropause-sdk:0.1.0"',
    status: 'planned',
    docsPath: 'docs/ecosystem/sdk.md',
    description: 'JVM client mirroring the gateway contract (planned).',
    capabilities: ['AI Workers', 'Connectors', 'Enterprise Extensions'],
  },
  {
    language: 'dotnet',
    name: 'NeuroPause SDK for .NET',
    packageName: 'NeuroPause.Sdk',
    version: '0.1.0',
    install: 'dotnet add package NeuroPause.Sdk',
    status: 'planned',
    docsPath: 'docs/ecosystem/sdk.md',
    description: '.NET client mirroring the gateway contract (planned).',
    capabilities: ['AI Workers', 'Connectors', 'Enterprise Extensions'],
  },
];

export function buildSdkRegistry(sdkArtifacts: SdkArtifact[]): SdkRegistry {
  const mapped: DevSdkEntry[] = sdkArtifacts.map((a) => ({
    language: a.language,
    name: a.name,
    packageName: a.packageName,
    version: a.version,
    install: a.install,
    status: AVAILABLE_SDK_LANGS.has(a.language) ? 'available' : 'planned',
    docsPath: a.docsPath,
    description: a.description,
    capabilities: a.builds,
  }));
  const present = new Set(mapped.map((e) => e.language));
  const entries = [...mapped, ...PLANNED_SDKS.filter((e) => !present.has(e.language))];
  return {
    entries,
    available: entries.filter((e) => e.status === 'available').length,
    planned: entries.filter((e) => e.status === 'planned').length,
    languages: entries.length,
  };
}

/* ── API explorer (over the existing public-API registry) ── */

export function buildApiExplorer(publicApis: PublicApi[], apiVersions: string[]): ApiExplorer {
  const apis: DevApiEntry[] = publicApis.map((a) => ({
    id: a.id,
    name: a.name,
    basePath: a.basePath,
    version: a.version,
    visibility: a.visibility,
    scopes: a.scopes,
    rps: a.rps,
  }));
  return {
    apis,
    versions: apiVersions,
    total: apis.length,
    publicApis: apis.filter((a) => a.visibility === 'public').length,
    partnerApis: apis.filter((a) => a.visibility === 'partner').length,
    privateApis: apis.filter((a) => a.visibility === 'private').length,
  };
}

/* ── Template / sample registry (catalog of the existing authoring surfaces) ── */

// Each scaffold cites ONLY real surfaces: the SDK builders (`defineWorker/Connector/Plugin/Extension`
// in packages/sdk/src/builders.ts) that yield a `ListingManifest`, then the one real publish command
// the `neuropause` CLI exposes (`neuropause publish <listingId> <manifest.json>` →
// `marketplace.publishVersion` + `submit`). Package scanning and signing happen server-side during the
// marketplace review pipeline (the `scanning`/`signing` states) — there is no client-side pack/sign step.
const TEMPLATES: DevTemplate[] = [
  { id: 'tpl-worker', kind: 'worker', name: 'AI Worker starter', summary: 'A declarative AI worker package.', language: 'typescript', scaffold: "defineWorker({ … }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (ai_worker); signed server-side at review, installable via the Workforce Center', docsPath: 'docs/ecosystem/sdk.md' },
  { id: 'tpl-connector', kind: 'connector', name: 'Connector starter', summary: 'A connector manifest with OAuth/API-key auth.', language: 'typescript', scaffold: "defineConnector({ … }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (connector) publishable to the marketplace', docsPath: 'docs/ecosystem/sdk.md' },
  { id: 'tpl-plugin', kind: 'plugin', name: 'Plugin starter', summary: 'A Plugin SDK extension bundle.', language: 'typescript', scaffold: "definePlugin({ … }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (plugin) installable via the plugin host', docsPath: 'docs/ecosystem/sdk.md' },
  { id: 'tpl-extension', kind: 'extension', name: 'Enterprise Extension starter', summary: 'An enterprise template / blueprint.', language: 'typescript', scaffold: "defineExtension({ … }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (enterprise_template) for the marketplace', docsPath: 'docs/ecosystem/sdk.md' },
  { id: 'tpl-automation', kind: 'automation', name: 'Automation pack starter', summary: 'A packaged automation rule set.', language: 'typescript', scaffold: "defineExtension({ metadata: { packageType: 'automation_pack' } }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (enterprise_template) tagged as an automation pack', docsPath: 'docs/ecosystem/sdk.md' },
  { id: 'tpl-dashboard', kind: 'dashboard', name: 'Dashboard pack starter', summary: 'A packaged dashboard definition.', language: 'typescript', scaffold: "defineExtension({ metadata: { packageType: 'dashboard_pack' } }).toManifest() → neuropause publish <listingId> manifest.json", produces: 'A ListingManifest (enterprise_template) tagged as a dashboard pack', docsPath: 'docs/ecosystem/sdk.md' },
];

export function buildTemplateRegistry(): TemplateRegistry {
  const byKindMap = new Map<DevTemplateKind, number>();
  for (const t of TEMPLATES) byKindMap.set(t.kind, (byKindMap.get(t.kind) ?? 0) + 1);
  return {
    templates: TEMPLATES,
    byKind: [...byKindMap.entries()].map(([kind, count]) => ({ kind, count })),
    total: TEMPLATES.length,
  };
}

/* ── Developer console ── */

export function buildDeveloperConsole(s: DeveloperPlatformState): DeveloperConsole {
  const published = s.listings.filter((l) => l.status === 'published').length;
  const errorRate30d = s.requests30d > 0 ? s.errors30d / s.requests30d : 0;
  const quotaUtilizationPct = s.quotaLimit > 0 ? Math.min(100, Math.round((s.quotaUsed / s.quotaLimit) * 100)) : 0;
  const health: DeveloperConsoleHealth = errorRate30d > 0.1 || quotaUtilizationPct >= 90 ? 'attention' : 'healthy';
  return {
    developerId: s.developerId,
    developerName: s.developerName,
    organization: s.organization,
    planTier: s.planTier,
    apiKeys: s.apiKeys,
    oauthApps: s.oauthApps,
    listings: s.listings.length,
    published,
    pendingReview: s.pendingReview,
    requests30d: s.requests30d,
    errorRate30d,
    quotaLimit: s.quotaLimit,
    quotaUsed: s.quotaUsed,
    quotaUtilizationPct,
    health,
  };
}

/* ── Publishing console ── */

const REVIEW_STATES = new Set<ListingStatus>(['submitted', 'scanning', 'signing', 'in_review', 'approved']);

export function buildPublishingConsole(s: DeveloperPlatformState): PublishingConsole {
  const entries: PublishingEntry[] = s.listings
    .map((l): PublishingEntry => ({
      listingId: l.id,
      name: l.name,
      slug: l.slug,
      kind: l.kind,
      status: l.status,
      currentVersion: s.currentVersionByListing[l.id] ?? null,
      versions: s.versionsByListing[l.id] ?? 0,
      installs: l.installs,
      certified: l.certified,
      updatedAt: l.updatedAt,
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, MAX_PUBLISHING_ENTRIES);
  return {
    entries,
    draft: s.listings.filter((l) => l.status === 'draft').length,
    inReview: s.listings.filter((l) => REVIEW_STATES.has(l.status)).length,
    published: s.listings.filter((l) => l.status === 'published').length,
    pendingReview: s.pendingReview,
  };
}

/* ── Analytics ── */

export function buildDeveloperAnalytics(s: DeveloperPlatformState): DeveloperPlatformAnalytics {
  // Counts are DEVELOPER-SCOPED: every headline total is derived from THIS developer's own usage
  // sample, in the same pass that builds the daily and per-route breakdowns, so the header reconciles
  // exactly with byDay/topRoutes (sum of byDay.requests === requests, sum of byDay.errors === denied).
  // The gateway-wide `GatewayMetrics` aggregate spans every developer, so folding its totals in here
  // is what previously made the header disagree with the breakdown. Latency is the sole exception: the
  // usage records carry no per-event timing, so p95 reflects the shared gateway the developer rides.
  const byDayMap = new Map<string, { requests: number; errors: number }>();
  const byRouteMap = new Map<string, number>();
  let allowed = 0;
  let denied = 0;
  let rateLimited = 0;
  let unauthorized = 0;
  for (const u of s.usageSample) {
    const day = u.at.slice(0, 10);
    const d = byDayMap.get(day) ?? { requests: 0, errors: 0 };
    d.requests += 1;
    if (u.status >= 400) {
      d.errors += 1;
      denied += 1;
    } else {
      allowed += 1;
    }
    if (u.status === 429) rateLimited += 1;
    if (u.status === 401 || u.status === 403) unauthorized += 1;
    byDayMap.set(day, d);
    byRouteMap.set(u.path, (byRouteMap.get(u.path) ?? 0) + 1);
  }
  const byDay = [...byDayMap.entries()]
    .map(([day, v]) => ({ day, requests: v.requests, errors: v.errors }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const topRoutes = [...byRouteMap.entries()]
    .map(([route, requests]) => ({ route, requests }))
    .sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route))
    .slice(0, 8);
  return {
    windowDays: s.gateway.windowDays,
    requests: s.usageSample.length,
    allowed,
    denied,
    rateLimited,
    unauthorized,
    p95LatencyMs: s.gateway.p95LatencyMs,
    byDay,
    topRoutes,
  };
}

/* ── Overview bundle ── */

export function buildDeveloperPlatformOverview(s: DeveloperPlatformState): DeveloperPlatformOverview {
  return {
    console: buildDeveloperConsole(s),
    sdks: buildSdkRegistry(s.sdkArtifacts),
    apis: buildApiExplorer(s.publicApis, s.apiVersions),
    templates: buildTemplateRegistry(),
    publishing: buildPublishingConsole(s),
    analytics: buildDeveloperAnalytics(s),
  };
}
