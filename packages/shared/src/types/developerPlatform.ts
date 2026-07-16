/**
 * Developer Platform (P12) — the developer-experience LAYER over the existing ecosystem
 * developer stack (developer accounts, API keys, OAuth, the gateway, billing, the public-API
 * registry, and the marketplace publishing lifecycle). These are VIEW-MODEL projections /
 * registries: they are derived from data the ecosystem stores already own — no new SDK, runtime,
 * API server, or marketplace. The registries (SDKs, templates, APIs) are CATALOGS of the
 * existing authoring surfaces, not new implementations.
 */
import type { ApiVisibility } from './cloud';
import type { PlanTier } from './ecosystem';

/* ════════════════════════════ SDK registry ═══════════════════════════════ */

export type DevSdkLanguage = 'typescript' | 'cli' | 'python' | 'go' | 'java' | 'dotnet' | 'rest' | 'webhooks';
export type DevSdkStatus = 'available' | 'beta' | 'planned';

export interface DevSdkEntry {
  language: DevSdkLanguage;
  name: string;
  packageName: string;
  version: string;
  install: string;
  status: DevSdkStatus;
  docsPath: string;
  description: string;
  /** What a developer can build with it (AI Workers, Connectors, Plugins, Enterprise Extensions). */
  capabilities: string[];
}

export interface SdkRegistry {
  entries: DevSdkEntry[];
  available: number;
  planned: number;
  languages: number;
}

/* ════════════════════════════ API explorer ═══════════════════════════════ */

export interface DevApiEntry {
  id: string;
  name: string;
  basePath: string;
  version: string;
  visibility: ApiVisibility;
  scopes: string[];
  rps: number;
}

export interface ApiExplorer {
  apis: DevApiEntry[];
  /** Supported gateway API versions (e.g. v1). */
  versions: string[];
  total: number;
  publicApis: number;
  partnerApis: number;
  privateApis: number;
}

/* ════════════════════════════ Template / sample registry ═════════════════ */

export type DevTemplateKind = 'worker' | 'connector' | 'plugin' | 'extension' | 'automation' | 'dashboard';

export interface DevTemplate {
  id: string;
  kind: DevTemplateKind;
  name: string;
  summary: string;
  language: DevSdkLanguage;
  /** The command / builder that scaffolds it (e.g. `nps init`, `defineWorker(...)`). */
  scaffold: string;
  /** What it produces (a signed WorkerPackage, a ListingManifest, a plugin bundle, …). */
  produces: string;
  docsPath: string;
}

export interface TemplateRegistry {
  templates: DevTemplate[];
  byKind: { kind: DevTemplateKind; count: number }[];
  total: number;
}

/* ════════════════════════════ Developer console ══════════════════════════ */

export type DeveloperConsoleHealth = 'healthy' | 'attention';

export interface DeveloperConsole {
  developerId: string;
  developerName: string;
  organization: string;
  planTier: PlanTier;
  apiKeys: number;
  oauthApps: number;
  listings: number;
  published: number;
  pendingReview: number;
  requests30d: number;
  errorRate30d: number;
  quotaLimit: number;
  quotaUsed: number;
  quotaUtilizationPct: number;
  health: DeveloperConsoleHealth;
}

/* ════════════════════════════ Publishing console ═════════════════════════ */

export interface PublishingEntry {
  listingId: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  currentVersion: string | null;
  versions: number;
  installs: number;
  certified: boolean;
  updatedAt: string;
}

export interface PublishingConsole {
  entries: PublishingEntry[];
  draft: number;
  inReview: number;
  published: number;
  pendingReview: number;
}

/* ════════════════════════════ Analytics ══════════════════════════════════ */

export interface DevAnalyticsDay {
  day: string;
  requests: number;
  errors: number;
}

export interface DevAnalyticsRoute {
  route: string;
  requests: number;
}

export interface DeveloperPlatformAnalytics {
  windowDays: number;
  requests: number;
  allowed: number;
  denied: number;
  rateLimited: number;
  unauthorized: number;
  p95LatencyMs: number;
  byDay: DevAnalyticsDay[];
  topRoutes: DevAnalyticsRoute[];
}

/* ════════════════════════════ Overview bundle ════════════════════════════ */

export interface DeveloperPlatformOverview {
  console: DeveloperConsole;
  sdks: SdkRegistry;
  apis: ApiExplorer;
  templates: TemplateRegistry;
  publishing: PublishingConsole;
  analytics: DeveloperPlatformAnalytics;
}
