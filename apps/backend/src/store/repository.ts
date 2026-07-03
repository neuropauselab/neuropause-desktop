import type {
  AppPermission,
  AppType,
  AppVersion,
  CategorySummary,
  DeveloperSummary,
  InstallationDto,
  InstallationStatus,
  PermissionKey,
  PluginPackage,
  PricingPlan,
  RatingSummary,
  ReleaseArtifact,
  ReviewDto,
  SandboxModel,
  Screenshot,
  StoreAppCard,
  StoreAppDetail,
  TagSummary,
} from '@neuropause/shared';
import { query } from '../db/pool';
import type { SearchQuery } from './schemas';

/* ───────────────────────── Card projection ──────────────────────────────── */

const CARD_COLUMNS = `
  a.id, a.slug, a.name, a.tagline, a.app_type, a.pricing_kind,
  a.icon_glyph, a.icon_tone, a.icon_url, a.install_count,
  a.is_open_source, a.is_staff_pick, a.updated_at,
  d.id AS dev_id, d.slug AS dev_slug, d.name AS dev_name, d.kind AS dev_kind,
  d.avatar_url AS dev_avatar, d.website AS dev_website,
  (dv.developer_id IS NOT NULL) AS dev_verified, dv.tier AS dev_tier,
  c.id AS cat_id, c.slug AS cat_slug, c.name AS cat_name, c.icon AS cat_icon,
  COALESCE(ar.rating_avg, 0) AS rating_avg, COALESCE(ar.rating_count, 0) AS rating_count,
  COALESCE(ar.count_1, 0) AS count_1, COALESCE(ar.count_2, 0) AS count_2,
  COALESCE(ar.count_3, 0) AS count_3, COALESCE(ar.count_4, 0) AS count_4,
  COALESCE(ar.count_5, 0) AS count_5`;

const CARD_JOINS = `
  FROM applications a
  JOIN developers d ON d.id = a.developer_id
  LEFT JOIN developer_verifications dv ON dv.developer_id = d.id
  JOIN categories c ON c.id = a.category_id
  LEFT JOIN app_ratings ar ON ar.application_id = a.id`;

const DETAIL_COLUMNS = `${CARD_COLUMNS},
  a.description, a.homepage_url, a.launch_url, a.repository_url, a.license`;

interface CardRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  app_type: AppType;
  pricing_kind: StoreAppCard['pricingKind'];
  icon_glyph: string | null;
  icon_tone: string | null;
  icon_url: string | null;
  install_count: string;
  is_open_source: boolean;
  is_staff_pick: boolean;
  updated_at: Date;
  dev_id: string;
  dev_slug: string;
  dev_name: string;
  dev_kind: 'individual' | 'organization';
  dev_avatar: string | null;
  dev_website: string | null;
  dev_verified: boolean;
  dev_tier: string | null;
  cat_id: string;
  cat_slug: string;
  cat_name: string;
  cat_icon: string | null;
  rating_avg: string;
  rating_count: number;
  count_1: number;
  count_2: number;
  count_3: number;
  count_4: number;
  count_5: number;
}

interface DetailRow extends CardRow {
  description: string;
  homepage_url: string | null;
  launch_url: string | null;
  repository_url: string | null;
  license: string | null;
}

function toRating(row: CardRow): RatingSummary {
  return {
    average: Number(row.rating_avg),
    count: row.rating_count,
    distribution: [row.count_1, row.count_2, row.count_3, row.count_4, row.count_5] as RatingSummary['distribution'],
  };
}

function toDeveloper(row: CardRow): DeveloperSummary {
  return {
    id: row.dev_id,
    slug: row.dev_slug,
    name: row.dev_name,
    kind: row.dev_kind,
    avatarUrl: row.dev_avatar,
    isVerified: row.dev_verified,
    verifiedTier: row.dev_tier,
    website: row.dev_website,
  };
}

function toCategory(row: CardRow): CategorySummary {
  return { id: row.cat_id, slug: row.cat_slug, name: row.cat_name, icon: row.cat_icon };
}

function toCard(row: CardRow): StoreAppCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    appType: row.app_type,
    pricingKind: row.pricing_kind,
    iconGlyph: row.icon_glyph,
    iconTone: row.icon_tone,
    iconUrl: row.icon_url,
    developer: toDeveloper(row),
    category: toCategory(row),
    rating: toRating(row),
    installCount: Number(row.install_count),
    isOpenSource: row.is_open_source,
    isStaffPick: row.is_staff_pick,
    updatedAt: row.updated_at.toISOString(),
  };
}

/* ───────────────────────── Search & sections ─────────────────────────────── */

const SORT_SQL: Record<NonNullable<SearchQuery['sort']>, string> = {
  relevance: 'a.trending_score DESC',
  trending: 'a.trending_score DESC',
  installs: 'a.install_count DESC',
  rating: 'ar.rating_avg DESC NULLS LAST, ar.rating_count DESC',
  newest: 'a.first_published_at DESC NULLS LAST',
  updated: 'a.latest_release_at DESC NULLS LAST',
  name: 'a.name ASC',
};

export async function searchApps(
  params: SearchQuery,
): Promise<{ items: StoreAppCard[]; total: number }> {
  const where: string[] = [`a.status = 'published'`];
  const args: unknown[] = [];
  let rankExpr = 'a.trending_score';

  if (params.q) {
    args.push(params.q);
    const p = `$${args.length}`;
    where.push(`(a.search_tsv @@ websearch_to_tsquery('english', ${p}) OR a.name ILIKE '%' || ${p} || '%')`);
    rankExpr = `ts_rank(a.search_tsv, websearch_to_tsquery('english', ${p}))`;
  }
  if (params.category) {
    args.push(params.category);
    where.push(`c.slug = $${args.length}`);
  }
  if (params.tags && params.tags.length > 0) {
    args.push(params.tags);
    where.push(
      `EXISTS (SELECT 1 FROM app_tags at JOIN tags t ON t.id = at.tag_id
               WHERE at.application_id = a.id AND t.slug = ANY($${args.length}))`,
    );
  }
  if (params.pricing) {
    args.push(params.pricing);
    where.push(`a.pricing_kind = $${args.length}`);
  }
  if (params.type) {
    args.push(params.type);
    where.push(`a.app_type = $${args.length}`);
  }
  if (params.openSource) where.push(`a.is_open_source = TRUE`);
  if (params.verified) where.push(`dv.developer_id IS NOT NULL`);

  const whereSql = `WHERE ${where.join(' AND ')}`;

  // Relevance falls back to trending when there is no text query.
  const orderSql =
    params.sort && params.sort !== 'relevance'
      ? SORT_SQL[params.sort]
      : params.q
        ? `${rankExpr} DESC, a.trending_score DESC`
        : 'a.trending_score DESC';

  const countRes = await query<{ total: string }>(
    `SELECT count(*)::int AS total ${CARD_JOINS} ${whereSql}`,
    args,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const offset = (params.page - 1) * params.pageSize;
  args.push(params.pageSize, offset);
  const rows = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} ${whereSql}
     ORDER BY ${orderSql} LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return { items: rows.rows.map(toCard), total };
}

const SECTION_SQL: Record<string, { where: string; order: string }> = {
  trending: { where: `a.status = 'published'`, order: 'a.trending_score DESC' },
  new: { where: `a.status = 'published'`, order: 'a.first_published_at DESC NULLS LAST' },
  verified: {
    where: `a.status = 'published' AND dv.developer_id IS NOT NULL`,
    order: 'a.install_count DESC',
  },
  enterprise: {
    where: `a.status = 'published' AND a.pricing_kind = 'enterprise'`,
    order: 'a.install_count DESC',
  },
  open_source: {
    where: `a.status = 'published' AND a.is_open_source = TRUE`,
    order: 'a.install_count DESC',
  },
  staff_picks: {
    where: `a.status = 'published' AND a.is_staff_pick = TRUE`,
    order: 'a.trending_score DESC',
  },
  recently_updated: {
    where: `a.status = 'published'`,
    order: 'a.latest_release_at DESC NULLS LAST',
  },
};

export async function listSection(
  key: string,
  page: number,
  pageSize: number,
): Promise<{ items: StoreAppCard[]; total: number }> {
  const def = SECTION_SQL[key];
  if (!def) return { items: [], total: 0 };
  const countRes = await query<{ total: string }>(
    `SELECT count(*)::int AS total ${CARD_JOINS} WHERE ${def.where}`,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const rows = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE ${def.where}
     ORDER BY ${def.order} LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  return { items: rows.rows.map(toCard), total };
}

/* ───────────────────────── App detail parts ──────────────────────────────── */

export async function getAppCardBySlug(slug: string): Promise<StoreAppCard | null> {
  const { rows } = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE a.slug = $1`,
    [slug],
  );
  return rows[0] ? toCard(rows[0]) : null;
}

async function getDetailRowBySlug(slug: string): Promise<DetailRow | null> {
  const { rows } = await query<DetailRow>(
    `SELECT ${DETAIL_COLUMNS} ${CARD_JOINS} WHERE a.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

interface ScreenshotRow {
  id: string;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
}
async function getScreenshots(appId: string): Promise<Screenshot[]> {
  const { rows } = await query<ScreenshotRow>(
    `SELECT id, url, thumbnail_url, caption, width, height
       FROM screenshots WHERE application_id = $1 ORDER BY sort_order`,
    [appId],
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    thumbnailUrl: r.thumbnail_url,
    caption: r.caption,
    width: r.width,
    height: r.height,
  }));
}

interface PricingRow {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  interval: PricingPlan['interval'];
  features: string[];
  is_default: boolean;
}
async function getPricingPlans(appId: string): Promise<PricingPlan[]> {
  const { rows } = await query<PricingRow>(
    `SELECT id, name, price_cents, currency, interval, features, is_default
       FROM pricing_plans WHERE application_id = $1 ORDER BY sort_order`,
    [appId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    currency: r.currency.trim(),
    interval: r.interval,
    features: r.features ?? [],
    isDefault: r.is_default,
  }));
}

interface PermissionRow {
  permission: PermissionKey;
  required: boolean;
  reason: string | null;
  scope: string | null;
}
async function getPermissions(appId: string): Promise<AppPermission[]> {
  const { rows } = await query<PermissionRow>(
    `SELECT permission, required, reason, scope
       FROM app_permissions WHERE application_id = $1 ORDER BY permission`,
    [appId],
  );
  return rows.map((r) => ({
    permission: r.permission,
    required: r.required,
    reason: r.reason,
    scope: r.scope,
  }));
}

interface PluginRow {
  id: string;
  runtime: AppType;
  entry: string;
  sandbox: SandboxModel;
  sha256: string | null;
  signature: string | null;
}
async function getPluginPackages(appId: string): Promise<PluginPackage[]> {
  const { rows } = await query<PluginRow>(
    `SELECT id, runtime, entry, sandbox, sha256, signature
       FROM plugin_packages WHERE application_id = $1 ORDER BY runtime`,
    [appId],
  );
  return rows.map((r) => ({
    id: r.id,
    runtime: r.runtime,
    entry: r.entry,
    sandbox: r.sandbox,
    hasSignature: r.signature != null,
    sha256: r.sha256,
  }));
}

async function getTags(appId: string): Promise<TagSummary[]> {
  const { rows } = await query<{ id: string; slug: string; label: string }>(
    `SELECT t.id, t.slug, t.label FROM tags t
       JOIN app_tags at ON at.tag_id = t.id
      WHERE at.application_id = $1 ORDER BY t.label`,
    [appId],
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, label: r.label }));
}

interface VersionRow {
  id: string;
  version: string;
  is_prerelease: boolean;
  released_at: Date | null;
  channel: string | null;
  changelog_body: string | null;
  highlights: string[] | null;
}
function toVersion(r: VersionRow): AppVersion {
  return {
    id: r.id,
    version: r.version,
    isPrerelease: r.is_prerelease,
    channel: r.channel,
    releasedAt: r.released_at ? r.released_at.toISOString() : null,
    changelog:
      r.changelog_body != null || (r.highlights && r.highlights.length > 0)
        ? { body: r.changelog_body, highlights: r.highlights ?? [] }
        : null,
  };
}
export async function getVersions(appId: string): Promise<AppVersion[]> {
  const { rows } = await query<VersionRow>(
    `SELECT v.id, v.version, v.is_prerelease,
            rel.released_at, ch.slug AS channel,
            cl.body AS changelog_body, cl.highlights
       FROM versions v
       LEFT JOIN releases rel ON rel.version_id = v.id
       LEFT JOIN update_channels ch ON ch.id = rel.channel_id
       LEFT JOIN changelogs cl ON cl.version_id = v.id
      WHERE v.application_id = $1
      ORDER BY rel.released_at DESC NULLS LAST, v.created_at DESC`,
    [appId],
  );
  return rows.map(toVersion);
}

interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  helpful_count: number;
  created_at: Date;
  updated_at: Date;
  author_name: string | null;
  author_avatar: string | null;
  version: string | null;
  user_id: string;
}
function toReview(r: ReviewRow, viewerId?: string): ReviewDto {
  return {
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    author: { name: r.author_name ?? 'NeuroPause user', avatarUrl: r.author_avatar },
    version: r.version,
    helpfulCount: r.helpful_count,
    isMine: viewerId != null && viewerId === r.user_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listReviews(
  appId: string,
  page: number,
  pageSize: number,
  viewerId?: string,
): Promise<{ items: ReviewDto[]; total: number }> {
  const countRes = await query<{ total: string }>(
    `SELECT count(*)::int AS total FROM reviews WHERE application_id = $1`,
    [appId],
  );
  const total = Number(countRes.rows[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const { rows } = await query<ReviewRow>(
    `SELECT r.id, r.rating, r.title, r.body, r.helpful_count, r.created_at, r.updated_at,
            r.user_id, u.display_name AS author_name, u.avatar_url AS author_avatar,
            v.version AS version
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN versions v ON v.id = r.version_id
      WHERE r.application_id = $1
      ORDER BY r.helpful_count DESC, r.created_at DESC
      LIMIT $2 OFFSET $3`,
    [appId, pageSize, offset],
  );
  return { items: rows.map((r) => toReview(r, viewerId)), total };
}

/** Assembles the full detail payload for an app slug. */
export async function getAppDetail(
  slug: string,
  viewerId?: string,
): Promise<StoreAppDetail | null> {
  const row = await getDetailRowBySlug(slug);
  if (!row) return null;
  const card = toCard(row);
  const [screenshots, pricingPlans, permissions, pluginPackages, tags, versions, reviews] =
    await Promise.all([
      getScreenshots(row.id),
      getPricingPlans(row.id),
      getPermissions(row.id),
      getPluginPackages(row.id),
      getTags(row.id),
      getVersions(row.id),
      listReviews(row.id, 1, 5, viewerId),
    ]);
  const latestVersion = versions.find((v) => v.releasedAt) ?? versions[0] ?? null;
  return {
    ...card,
    description: row.description,
    homepageUrl: row.homepage_url,
    launchUrl: row.launch_url,
    repositoryUrl: row.repository_url,
    license: row.license,
    tags,
    screenshots,
    pricingPlans,
    permissions,
    pluginPackages,
    versions,
    latestVersion,
    reviews: reviews.items,
    reviewsTotal: reviews.total,
  };
}

/* ───────────────────────── Developers / taxonomy ─────────────────────────── */

export interface DeveloperProfile {
  id: string;
  slug: string;
  name: string;
  kind: 'individual' | 'organization';
  avatarUrl: string | null;
  website: string | null;
  supportUrl: string | null;
  bio: string | null;
  isVerified: boolean;
  verifiedTier: string | null;
  organization: { slug: string; name: string; isEnterprise: boolean } | null;
  apps: StoreAppCard[];
}

export async function getDeveloperBySlug(slug: string): Promise<DeveloperProfile | null> {
  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    kind: 'individual' | 'organization';
    avatar_url: string | null;
    website: string | null;
    support_url: string | null;
    bio: string | null;
    verified: boolean;
    tier: string | null;
    org_slug: string | null;
    org_name: string | null;
    org_enterprise: boolean | null;
  }>(
    `SELECT d.id, d.slug, d.name, d.kind, d.avatar_url, d.website, d.support_url, d.bio,
            (dv.developer_id IS NOT NULL) AS verified, dv.tier,
            o.slug AS org_slug, o.name AS org_name, o.is_enterprise AS org_enterprise
       FROM developers d
       LEFT JOIN developer_verifications dv ON dv.developer_id = d.id
       LEFT JOIN organizations o ON o.id = d.organization_id
      WHERE d.slug = $1`,
    [slug],
  );
  const d = rows[0];
  if (!d) return null;
  const apps = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
      WHERE a.developer_id = $1 AND a.status = 'published'
      ORDER BY a.install_count DESC`,
    [d.id],
  );
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    kind: d.kind,
    avatarUrl: d.avatar_url,
    website: d.website,
    supportUrl: d.support_url,
    bio: d.bio,
    isVerified: d.verified,
    verifiedTier: d.tier,
    organization: d.org_slug
      ? { slug: d.org_slug, name: d.org_name ?? '', isEnterprise: !!d.org_enterprise }
      : null,
    apps: apps.rows.map(toCard),
  };
}

export async function listCategories(): Promise<CategorySummary[]> {
  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    icon: string | null;
    app_count: string;
  }>(
    `SELECT c.id, c.slug, c.name, c.icon,
            count(a.id) FILTER (WHERE a.status = 'published') AS app_count
       FROM categories c
       LEFT JOIN applications a ON a.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order, c.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    icon: r.icon,
    appCount: Number(r.app_count),
  }));
}

export async function listTags(): Promise<(TagSummary & { appCount: number })[]> {
  const { rows } = await query<{ id: string; slug: string; label: string; app_count: string }>(
    `SELECT t.id, t.slug, t.label, count(at.application_id) AS app_count
       FROM tags t LEFT JOIN app_tags at ON at.tag_id = t.id
      GROUP BY t.id ORDER BY app_count DESC, t.label`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    appCount: Number(r.app_count),
  }));
}

/* ───────────────────────── Featured / collections ────────────────────────── */

export interface FeaturedRow {
  id: string;
  headline: string;
  subheadline: string | null;
  banner_image_url: string | null;
  accent: string | null;
  cta_label: string | null;
  app_slug: string;
}
export async function listFeaturedRows(): Promise<FeaturedRow[]> {
  const { rows } = await query<FeaturedRow>(
    `SELECT f.id, f.headline, f.subheadline, f.banner_image_url, f.accent, f.cta_label,
            a.slug AS app_slug
       FROM featured_apps f
       JOIN applications a ON a.id = f.application_id
      WHERE f.is_active = TRUE
        AND (f.starts_at IS NULL OR f.starts_at <= now())
        AND (f.ends_at IS NULL OR f.ends_at >= now())
      ORDER BY f.sort_order`,
  );
  return rows;
}

export interface CollectionMeta {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  accent: string | null;
  hero_image_url: string | null;
  kind: 'manual' | 'auto';
  auto_rule: string | null;
}
export async function listFeaturedCollectionMeta(): Promise<CollectionMeta[]> {
  const { rows } = await query<CollectionMeta>(
    `SELECT id, slug, title, subtitle, accent, hero_image_url, kind, auto_rule
       FROM collections WHERE is_featured = TRUE ORDER BY sort_order`,
  );
  return rows;
}
export async function getCollectionMeta(slug: string): Promise<CollectionMeta | null> {
  const { rows } = await query<CollectionMeta>(
    `SELECT id, slug, title, subtitle, accent, hero_image_url, kind, auto_rule
       FROM collections WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}
export async function getManualCollectionApps(collectionId: string): Promise<StoreAppCard[]> {
  const { rows } = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       JOIN collection_apps ca ON ca.application_id = a.id
      WHERE ca.collection_id = $1 AND a.status = 'published'
      ORDER BY ca.sort_order`,
    [collectionId],
  );
  return rows.map(toCard);
}

/* ───────────────────────── Bookmarks ─────────────────────────────────────── */

export async function listBookmarks(userId: string): Promise<StoreAppCard[]> {
  const { rows } = await query<CardRow>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
       JOIN bookmarks b ON b.application_id = a.id
      WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [userId],
  );
  return rows.map(toCard);
}

export async function addBookmark(userId: string, appId: string): Promise<void> {
  await query(
    `INSERT INTO bookmarks (user_id, application_id) VALUES ($1, $2)
       ON CONFLICT (user_id, application_id) DO NOTHING`,
    [userId, appId],
  );
}

export async function removeBookmark(userId: string, appId: string): Promise<void> {
  await query(`DELETE FROM bookmarks WHERE user_id = $1 AND application_id = $2`, [userId, appId]);
}

/* ───────────────────────── Installations ─────────────────────────────────── */

interface InstallRow {
  i_id: string;
  i_status: InstallationStatus;
  i_install_location: string | null;
  i_granted_permissions: PermissionKey[];
  i_last_launched_at: Date | null;
  i_launch_count: number;
  i_installed_at: Date;
  i_updated_at: Date;
  i_version: string | null;
  i_channel: string | null;
}

function buildInstallation(row: InstallRow, app: StoreAppCard): InstallationDto {
  return {
    id: row.i_id,
    status: row.i_status,
    app,
    version: row.i_version,
    channel: row.i_channel,
    grantedPermissions: row.i_granted_permissions ?? [],
    installLocation: row.i_install_location,
    lastLaunchedAt: row.i_last_launched_at ? row.i_last_launched_at.toISOString() : null,
    launchCount: row.i_launch_count,
    installedAt: row.i_installed_at.toISOString(),
    updatedAt: row.i_updated_at.toISOString(),
  };
}

interface InstallJoinRow extends InstallRow, CardRow {}

// Aliased with an i_ prefix so they never collide with the card projection's
// own a.id / a.updated_at when both column sets are selected together.
const INSTALL_COLUMNS = `
  i.id AS i_id, i.status AS i_status, i.install_location AS i_install_location,
  i.granted_permissions AS i_granted_permissions,
  i.last_launched_at AS i_last_launched_at, i.launch_count AS i_launch_count,
  i.installed_at AS i_installed_at, i.updated_at AS i_updated_at,
  iv.version AS i_version, ich.slug AS i_channel`;
const INSTALL_JOINS = `
  JOIN applications a ON a.id = i.application_id
  JOIN developers d ON d.id = a.developer_id
  LEFT JOIN developer_verifications dv ON dv.developer_id = d.id
  JOIN categories c ON c.id = a.category_id
  LEFT JOIN app_ratings ar ON ar.application_id = a.id
  LEFT JOIN versions iv ON iv.id = i.version_id
  LEFT JOIN update_channels ich ON ich.id = i.channel_id`;

export async function listInstallations(
  userId: string,
  opts: { recentOnly?: boolean } = {},
): Promise<InstallationDto[]> {
  const filter = opts.recentOnly
    ? `AND i.status = 'installed' AND i.last_launched_at IS NOT NULL`
    : `AND i.status <> 'uninstalled'`;
  const order = opts.recentOnly ? 'i.last_launched_at DESC' : 'i.installed_at DESC';
  const { rows } = await query<InstallJoinRow>(
    `SELECT ${INSTALL_COLUMNS}, ${CARD_COLUMNS}
       FROM installations i ${INSTALL_JOINS}
      WHERE i.user_id = $1 ${filter}
      ORDER BY ${order}`,
    [userId],
  );
  return rows.map((r) => buildInstallation(r, toCard(r)));
}

/** Upserts an installation into the 'installed' state and returns it (with app card). */
export async function upsertInstallation(args: {
  userId: string;
  appId: string;
  versionId: string | null;
  channelId: string | null;
  grantedPermissions: PermissionKey[];
  installLocation: string | null;
}): Promise<InstallationDto | null> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO installations
       (user_id, application_id, version_id, channel_id, status,
        granted_permissions, install_location, installed_at, uninstalled_at)
     VALUES ($1, $2, $3, $4, 'installed', $5::jsonb, $6, now(), NULL)
     ON CONFLICT (user_id, application_id) DO UPDATE SET
       version_id = EXCLUDED.version_id,
       channel_id = EXCLUDED.channel_id,
       status = 'installed',
       granted_permissions = EXCLUDED.granted_permissions,
       install_location = EXCLUDED.install_location,
       uninstalled_at = NULL,
       installed_at = CASE WHEN installations.status = 'uninstalled' THEN now()
                           ELSE installations.installed_at END
     RETURNING id`,
    [
      args.userId,
      args.appId,
      args.versionId,
      args.channelId,
      JSON.stringify(args.grantedPermissions),
      args.installLocation,
    ],
  );
  const id = rows[0]?.id;
  return id ? getInstallationById(id, args.userId) : null;
}

export async function getInstallationById(
  id: string,
  userId: string,
): Promise<InstallationDto | null> {
  const { rows } = await query<InstallJoinRow>(
    `SELECT ${INSTALL_COLUMNS}, ${CARD_COLUMNS}
       FROM installations i ${INSTALL_JOINS}
      WHERE i.id = $1 AND i.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? buildInstallation(rows[0], toCard(rows[0])) : null;
}

export async function uninstall(userId: string, appId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE installations
        SET status = 'uninstalled', uninstalled_at = now()
      WHERE user_id = $1 AND application_id = $2 AND status <> 'uninstalled'`,
    [userId, appId],
  );
  return (rowCount ?? 0) > 0;
}

export async function recordLaunch(
  installationId: string,
  userId: string,
): Promise<InstallationDto | null> {
  const { rows } = await query<{ id: string }>(
    `UPDATE installations
        SET launch_count = launch_count + 1, last_launched_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'installed'
      RETURNING id`,
    [installationId, userId],
  );
  return rows[0] ? getInstallationById(rows[0].id, userId) : null;
}

/* ───────────────────────── Reviews (write) ───────────────────────────────── */

export async function upsertReview(args: {
  appId: string;
  userId: string;
  rating: number;
  title: string | null;
  body: string | null;
}): Promise<ReviewDto | null> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO reviews (application_id, user_id, rating, title, body, is_edited)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     ON CONFLICT (application_id, user_id) DO UPDATE SET
       rating = EXCLUDED.rating, title = EXCLUDED.title, body = EXCLUDED.body,
       is_edited = TRUE
     RETURNING id`,
    [args.appId, args.userId, args.rating, args.title, args.body],
  );
  const id = rows[0]?.id;
  if (!id) return null;
  const { rows: out } = await query<ReviewRow>(
    `SELECT r.id, r.rating, r.title, r.body, r.helpful_count, r.created_at, r.updated_at,
            r.user_id, u.display_name AS author_name, u.avatar_url AS author_avatar,
            v.version AS version
       FROM reviews r JOIN users u ON u.id = r.user_id
       LEFT JOIN versions v ON v.id = r.version_id
      WHERE r.id = $1`,
    [id],
  );
  return out[0] ? toReview(out[0], args.userId) : null;
}

/* ───────────────────────── Recommendations ───────────────────────────────── */

export async function recommendApps(userId: string, limit: number): Promise<StoreAppCard[]> {
  const { rows } = await query<CardRow>(
    `WITH interest AS (
        SELECT DISTINCT a2.category_id
          FROM applications a2
          JOIN (
            SELECT application_id FROM installations WHERE user_id = $1 AND status <> 'uninstalled'
            UNION
            SELECT application_id FROM bookmarks WHERE user_id = $1
          ) eng ON eng.application_id = a2.id
     ),
     owned AS (
        SELECT application_id FROM installations WHERE user_id = $1 AND status <> 'uninstalled'
        UNION SELECT application_id FROM bookmarks WHERE user_id = $1
     )
     SELECT ${CARD_COLUMNS} ${CARD_JOINS}
      WHERE a.status = 'published'
        AND a.id NOT IN (SELECT application_id FROM owned)
        AND (
          (EXISTS (SELECT 1 FROM interest) AND a.category_id IN (SELECT category_id FROM interest))
          OR NOT EXISTS (SELECT 1 FROM interest)
        )
      ORDER BY a.trending_score DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toCard);
}

/* ───────────────────────── Releases / updates / downloads ─────────────────── */

interface ReleaseRow {
  release_id: string;
  version: string;
  channel: string;
  artifact_url: string | null;
  artifact_size_bytes: string | null;
  sha256: string | null;
  signature: string | null;
  signature_key_id: string | null;
  is_delta: boolean;
}

export async function getLatestRelease(
  appId: string,
  channelSlug: string,
): Promise<ReleaseArtifact | null> {
  const { rows } = await query<ReleaseRow>(
    `SELECT rel.id AS release_id, v.version, ch.slug AS channel,
            rel.artifact_url, rel.artifact_size_bytes, rel.sha256, rel.signature,
            rel.signature_key_id, rel.is_delta
       FROM releases rel
       JOIN versions v ON v.id = rel.version_id
       JOIN update_channels ch ON ch.id = rel.channel_id
      WHERE rel.application_id = $1 AND ch.slug = $2 AND rel.status = 'published'
      ORDER BY rel.released_at DESC
      LIMIT 1`,
    [appId, channelSlug],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    releaseId: r.release_id,
    version: r.version,
    channel: r.channel,
    url: r.artifact_url,
    sizeBytes: r.artifact_size_bytes != null ? Number(r.artifact_size_bytes) : null,
    sha256: r.sha256,
    signature: r.signature,
    signatureKeyId: r.signature_key_id,
    isDelta: r.is_delta,
  };
}

export async function getInstalledVersion(
  userId: string,
  appId: string,
): Promise<{ version: string | null; channel: string | null } | null> {
  const { rows } = await query<{ version: string | null; channel: string | null }>(
    `SELECT v.version AS version, ch.slug AS channel
       FROM installations i
       LEFT JOIN versions v ON v.id = i.version_id
       LEFT JOIN update_channels ch ON ch.id = i.channel_id
      WHERE i.user_id = $1 AND i.application_id = $2 AND i.status <> 'uninstalled'`,
    [userId, appId],
  );
  return rows[0] ?? null;
}

export async function recordDownload(args: {
  appId: string;
  releaseId: string | null;
  userId: string | null;
  channel: string;
}): Promise<void> {
  await query(
    `INSERT INTO downloads (application_id, release_id, user_id, channel)
     VALUES ($1, $2, $3, $4)`,
    [args.appId, args.releaseId, args.userId, args.channel],
  );
}

/* ───────────────────────── Small lookups ─────────────────────────────────── */

export async function getAppIdBySlug(slug: string): Promise<string | null> {
  const { rows } = await query<{ id: string }>(`SELECT id FROM applications WHERE slug = $1`, [
    slug,
  ]);
  return rows[0]?.id ?? null;
}

export async function getChannelIdBySlug(slug: string): Promise<string | null> {
  const { rows } = await query<{ id: string }>(`SELECT id FROM update_channels WHERE slug = $1`, [
    slug,
  ]);
  return rows[0]?.id ?? null;
}

/** The version id for an app's current release on a channel (for install pinning). */
export async function getReleaseVersionId(
  appId: string,
  channelSlug: string,
): Promise<string | null> {
  const { rows } = await query<{ version_id: string }>(
    `SELECT rel.version_id
       FROM releases rel JOIN update_channels ch ON ch.id = rel.channel_id
      WHERE rel.application_id = $1 AND ch.slug = $2 AND rel.status = 'published'
      ORDER BY rel.released_at DESC LIMIT 1`,
    [appId, channelSlug],
  );
  return rows[0]?.version_id ?? null;
}
