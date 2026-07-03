/**
 * NeuroPause AI Store — shared DTO contracts.
 *
 * These are the wire shapes returned by the Store API and consumed by the
 * desktop renderer (through the catalog IPC bridge). Keeping them here means
 * the backend and the client are type-checked against one identical contract.
 * All timestamps are ISO-8601 strings; all money is integer minor units.
 */

/** The runtime/distribution kind of an application. Extensible by design. */
export type AppType =
  | 'web'
  | 'desktop_plugin'
  | 'electron'
  | 'native'
  | 'ai_agent'
  | 'mcp_server'
  | 'automation';

export type PricingKind = 'free' | 'freemium' | 'paid' | 'subscription' | 'enterprise';

/** Dynamic, curated home-page rails. */
export type StoreSectionKey =
  | 'trending'
  | 'new'
  | 'verified'
  | 'enterprise'
  | 'open_source'
  | 'staff_picks'
  | 'recently_updated';

export const STORE_SECTION_KEYS: readonly StoreSectionKey[] = [
  'trending',
  'new',
  'verified',
  'enterprise',
  'open_source',
  'staff_picks',
  'recently_updated',
];

export type StoreSort =
  | 'relevance'
  | 'trending'
  | 'installs'
  | 'rating'
  | 'newest'
  | 'updated'
  | 'name';

/** A capability an application may request. Drives the permission dialog. */
export type PermissionKey =
  | 'network'
  | 'filesystem_read'
  | 'filesystem_write'
  | 'clipboard'
  | 'notifications'
  | 'camera'
  | 'microphone'
  | 'local_models'
  | 'automation'
  | 'background';

export const PERMISSION_KEYS: readonly PermissionKey[] = [
  'network',
  'filesystem_read',
  'filesystem_write',
  'clipboard',
  'notifications',
  'camera',
  'microphone',
  'local_models',
  'automation',
  'background',
];

/** Isolation level the host applies when running a package. */
export type SandboxModel = 'none' | 'iframe' | 'process' | 'container';

export type InstallationStatus = 'installed' | 'updating' | 'paused' | 'uninstalled' | 'failed';

export interface DeveloperSummary {
  id: string;
  slug: string;
  name: string;
  kind: 'individual' | 'organization';
  avatarUrl: string | null;
  isVerified: boolean;
  verifiedTier: string | null;
  website: string | null;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  appCount?: number;
}

export interface TagSummary {
  id: string;
  slug: string;
  label: string;
}

/** Aggregate rating plus a 1→5 star distribution histogram. */
export interface RatingSummary {
  average: number;
  count: number;
  /** Five buckets: index 0 = 1★ … index 4 = 5★. */
  distribution: [number, number, number, number, number];
}

export interface Screenshot {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
}

export interface PricingPlan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: 'once' | 'month' | 'year' | 'custom';
  features: string[];
  isDefault: boolean;
}

export interface AppPermission {
  permission: PermissionKey;
  required: boolean;
  reason: string | null;
  scope: string | null;
}

export interface ChangelogEntry {
  body: string | null;
  highlights: string[];
}

export interface AppVersion {
  id: string;
  version: string;
  isPrerelease: boolean;
  channel: string | null;
  releasedAt: string | null;
  changelog: ChangelogEntry | null;
}

export interface PluginPackage {
  id: string;
  runtime: AppType;
  entry: string;
  sandbox: SandboxModel;
  hasSignature: boolean;
  sha256: string | null;
}

export interface ReviewDto {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  author: { name: string; avatarUrl: string | null };
  version: string | null;
  helpfulCount: number;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The compact card shape used in grids, rails, and search results. */
export interface StoreAppCard {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  appType: AppType;
  pricingKind: PricingKind;
  iconGlyph: string | null;
  iconTone: string | null;
  iconUrl: string | null;
  developer: DeveloperSummary;
  category: CategorySummary;
  rating: RatingSummary;
  installCount: number;
  isOpenSource: boolean;
  isStaffPick: boolean;
  updatedAt: string;
}

/** The full app page payload. */
export interface StoreAppDetail extends StoreAppCard {
  description: string;
  homepageUrl: string | null;
  launchUrl: string | null;
  repositoryUrl: string | null;
  license: string | null;
  tags: TagSummary[];
  screenshots: Screenshot[];
  pricingPlans: PricingPlan[];
  permissions: AppPermission[];
  pluginPackages: PluginPackage[];
  versions: AppVersion[];
  latestVersion: AppVersion | null;
  reviews: ReviewDto[];
  reviewsTotal: number;
}

export interface CollectionDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  accent: string | null;
  heroImageUrl: string | null;
  apps: StoreAppCard[];
}

export interface FeaturedEntry {
  id: string;
  headline: string;
  subheadline: string | null;
  bannerImageUrl: string | null;
  accent: string | null;
  ctaLabel: string | null;
  app: StoreAppCard;
}

export interface InstallationDto {
  id: string;
  status: InstallationStatus;
  app: StoreAppCard;
  version: string | null;
  channel: string | null;
  grantedPermissions: PermissionKey[];
  installLocation: string | null;
  lastLaunchedAt: string | null;
  launchCount: number;
  installedAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StoreSearchParams {
  q?: string;
  category?: string;
  tags?: string[];
  pricing?: PricingKind;
  type?: AppType;
  openSource?: boolean;
  verified?: boolean;
  sort?: StoreSort;
  page?: number;
  pageSize?: number;
}

/** Result of comparing a user's installed version with the latest release. */
export interface UpdateCheck {
  appSlug: string;
  updateAvailable: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  channel: string | null;
  releaseId: string | null;
}

/** What NPMX needs to fetch + verify a release (Stage 2 consumes this). */
export interface ReleaseArtifact {
  releaseId: string;
  version: string;
  channel: string;
  url: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  signature: string | null;
  signatureKeyId: string | null;
  isDelta: boolean;
}
