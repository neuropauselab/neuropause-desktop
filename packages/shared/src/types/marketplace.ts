/**
 * P9 — Enterprise Marketplace types.
 *
 * The Marketplace is a governed, trusted LAYER over the existing ecosystem marketplace
 * (`ListingManifest`/`MarketplaceListing`/`Installation`), the P8.5 worker install
 * service, and the Ed25519 signing pipeline. These types are the marketplace-layer
 * projections — publisher trust, release channels, a unified cross-type catalog entry,
 * a trust report, org governance policy + verdict, dependency install plans, and
 * analytics. No new package format: an entry maps from the existing `MarketplaceListing`.
 *
 * Types-only.
 */
import type { ListingKind } from './ecosystem';

/** The 10 marketplace package types (a superset view mapped from `ListingKind` + metadata). */
export type MarketplacePackageType =
  | 'worker'
  | 'connector'
  | 'template'
  | 'workflow_pack'
  | 'knowledge_pack'
  | 'automation_pack'
  | 'dashboard_pack'
  | 'policy_pack'
  | 'blueprint'
  | 'prompt_pack';

export const MARKETPLACE_PACKAGE_TYPES: readonly MarketplacePackageType[] = [
  'worker', 'connector', 'template', 'workflow_pack', 'knowledge_pack',
  'automation_pack', 'dashboard_pack', 'policy_pack', 'blueprint', 'prompt_pack',
] as const;

/**
 * How a package type is adopted today (recon-verified): `installable` routes to a real
 * installer (workers → WorkerInstallService), `connect` deep-links the OAuth connect
 * flow (connectors), `import` has a persisted governed-import seam (automation/policy),
 * `catalog` is browse + govern only until an importer exists.
 */
export type InstallCapability = 'installable' | 'connect' | 'import' | 'catalog';

/** Release channels for versioned packages. */
export type ReleaseChannel = 'stable' | 'beta' | 'canary' | 'lts';
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['stable', 'beta', 'canary', 'lts'] as const;

/** Publisher verification/trust tier. */
export type PublisherTier = 'unverified' | 'verified' | 'trusted' | 'official';
export const PUBLISHER_TIERS: readonly PublisherTier[] = ['unverified', 'verified', 'trusted', 'official'] as const;

export interface PublisherProfile {
  id: string;
  name: string;
  tier: PublisherTier;
  /** 0..1 aggregate publisher trust. */
  trustScore: number;
  /** The publisher's signing key id (public), or null if unsigned. */
  keyId: string | null;
  verifiedAt: string | null;
  listings: number;
  installs: number;
}

export type InstallState = 'not_installed' | 'installed' | 'update_available' | 'disabled';

/** A unified catalog entry — one row spanning every package type. */
export interface MarketplaceEntry {
  id: string;
  slug: string;
  name: string;
  summary: string;
  packageType: MarketplacePackageType;
  listingKind: ListingKind;
  capability: InstallCapability;
  category: string;
  publisher: { id: string; name: string; tier: PublisherTier; trustScore: number };
  version: string;
  channel: ReleaseChannel;
  signed: boolean;
  certified: boolean;
  /** 0..1 aggregate package trust score. */
  trustScore: number;
  rating: number;
  ratingCount: number;
  installs: number;
  installState: InstallState;
  dependencies: string[];
  updatedAt: string;
}

export type MarketplaceDecision = 'allow' | 'require_approval' | 'deny';

export interface MarketplaceVerdict {
  decision: MarketplaceDecision;
  reasons: string[];
}

/** The Trust Center report for one package. */
export interface TrustReport {
  listingId: string;
  signatureValid: boolean;
  signatureKeyId: string | null;
  certificate: 'valid' | 'unsigned' | 'untrusted';
  publisherTier: PublisherTier;
  publisherTrust: number;
  trustScore: number;
  scan: 'pass' | 'warn' | 'fail' | 'none';
  compatible: boolean;
  compatibilityNote: string | null;
  policy: MarketplaceVerdict;
}

/** Persisted org marketplace governance policy (enterprise config data, not an engine). */
export interface OrgMarketplacePolicy {
  /** When true, every install requires an approval before it may proceed. */
  requireApproval: boolean;
  /** If non-empty, ONLY these publisher ids are allowed (an allowlist). */
  allowedPublishers: string[];
  blockedPublishers: string[];
  blockedTypes: MarketplacePackageType[];
  /** Minimum publisher tier an installable package must meet. */
  minPublisherTier: PublisherTier;
  /** When true, an unsigned package cannot be installed. */
  requireSignature: boolean;
  updatedAt: string;
}

/** A dependency install plan (topological waves + conflicts), from planGoal reuse. */
export interface InstallPlan {
  ok: boolean;
  /** Topological install order — each wave installs in parallel. */
  waves: string[][];
  /** Declared dependencies not present in the catalog. */
  missing: string[];
  /** Version/compatibility conflicts. */
  conflicts: { id: string; reason: string }[];
  error: string | null;
}

export interface MarketplaceAnalytics {
  totalPackages: number;
  totalPublishers: number;
  totalInstalls: number;
  updatesAvailable: number;
  /** Fraction of installs that were later rolled back, 0..1. */
  rollbackRate: number;
  byType: { type: MarketplacePackageType; count: number; installs: number }[];
  byChannel: { channel: ReleaseChannel; count: number }[];
  topPublishers: { id: string; name: string; installs: number; tier: PublisherTier }[];
  /** installed / total, 0..1. */
  adoption: number;
}

export type MarketplaceSort = 'relevance' | 'trending' | 'installs' | 'rating' | 'recent' | 'trust';

export interface MarketplaceCatalogQuery {
  q?: string;
  type?: MarketplacePackageType;
  category?: string;
  channel?: ReleaseChannel;
  verifiedOnly?: boolean;
  installedOnly?: boolean;
  updatesOnly?: boolean;
  collection?: string;
  sort?: MarketplaceSort;
}

/** The result of a governed marketplace install attempt. */
export interface MarketplaceInstallResult {
  ok: boolean;
  decision: MarketplaceDecision;
  /** True when the package was actually routed to a real installer (e.g. a worker). */
  routed: boolean;
  message: string;
  errors: string[];
}
