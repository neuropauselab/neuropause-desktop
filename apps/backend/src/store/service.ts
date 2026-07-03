import type {
  CollectionDto,
  FeaturedEntry,
  InstallationDto,
  PermissionKey,
  ReleaseArtifact,
  StoreAppCard,
  StoreSectionKey,
  UpdateCheck,
} from '@neuropause/shared';
import { STORE_SECTION_KEYS } from '@neuropause/shared';
import * as repo from './repository';
import type { InstallBody } from './schemas';

/** URL-friendly section keys (hyphens) normalize to the canonical underscore form. */
export function normalizeSectionKey(raw: string): StoreSectionKey | null {
  const key = raw.replace(/-/g, '_');
  return (STORE_SECTION_KEYS as readonly string[]).includes(key)
    ? (key as StoreSectionKey)
    : null;
}

/** The hero banner: each featured row joined to its app card. */
export async function getFeatured(): Promise<FeaturedEntry[]> {
  const rows = await repo.listFeaturedRows();
  const entries = await Promise.all(
    rows.map(async (r) => {
      const app = await repo.getAppCardBySlug(r.app_slug);
      if (!app) return null;
      return {
        id: r.id,
        headline: r.headline,
        subheadline: r.subheadline,
        bannerImageUrl: r.banner_image_url,
        accent: r.accent,
        ctaLabel: r.cta_label,
        app,
      } satisfies FeaturedEntry;
    }),
  );
  return entries.filter((e): e is FeaturedEntry => e !== null);
}

const PREVIEW_SIZE = 12;

async function collectionApps(meta: repo.CollectionMeta): Promise<StoreAppCard[]> {
  if (meta.kind === 'auto' && meta.auto_rule) {
    const key = normalizeSectionKey(meta.auto_rule);
    if (key) return (await repo.listSection(key, 1, PREVIEW_SIZE)).items;
    return [];
  }
  return repo.getManualCollectionApps(meta.id);
}

function toCollectionDto(meta: repo.CollectionMeta, apps: StoreAppCard[]): CollectionDto {
  return {
    id: meta.id,
    slug: meta.slug,
    title: meta.title,
    subtitle: meta.subtitle,
    accent: meta.accent,
    heroImageUrl: meta.hero_image_url,
    apps,
  };
}

/** Landing-page rails: every featured collection with a preview of its apps. */
export async function getFeaturedCollections(): Promise<CollectionDto[]> {
  const metas = await repo.listFeaturedCollectionMeta();
  const out = await Promise.all(
    metas.map(async (m) => toCollectionDto(m, await collectionApps(m))),
  );
  return out;
}

export async function getCollection(slug: string): Promise<CollectionDto | null> {
  const meta = await repo.getCollectionMeta(slug);
  if (!meta) return null;
  return toCollectionDto(meta, await collectionApps(meta));
}

/* ───────────────────────── Install / launch ──────────────────────────────── */

export interface InstallResult {
  installation: InstallationDto;
  /** What NPMX needs to fetch + verify the package, if there is an artifact. */
  artifact: ReleaseArtifact | null;
}

export async function installApp(
  userId: string,
  appId: string,
  body: InstallBody,
): Promise<InstallResult | null> {
  const channelId = await repo.getChannelIdBySlug(body.channel);
  const versionId = await repo.getReleaseVersionId(appId, body.channel);
  const installation = await repo.upsertInstallation({
    userId,
    appId,
    versionId,
    channelId,
    grantedPermissions: body.grantedPermissions as PermissionKey[],
    installLocation: body.installLocation ?? null,
  });
  if (!installation) return null;

  // Record an install-time download and hand back the artifact descriptor so the
  // desktop package manager can fetch + verify it (web apps have no artifact).
  const artifact = await repo.getLatestRelease(appId, body.channel);
  if (artifact) {
    await repo.recordDownload({
      appId,
      releaseId: artifact.releaseId,
      userId,
      channel: body.channel,
    });
  }
  return { installation, artifact };
}

export async function launch(
  userId: string,
  installationId: string,
): Promise<InstallationDto | null> {
  return repo.recordLaunch(installationId, userId);
}

/* ───────────────────────── Updates ───────────────────────────────────────── */

/** Compares dotted numeric versions; prerelease suffixes are ignored. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

export async function checkUpdate(
  userId: string,
  appId: string,
  appSlug: string,
): Promise<UpdateCheck> {
  const installed = await repo.getInstalledVersion(userId, appId);
  const channel = installed?.channel ?? 'stable';
  const latest = await repo.getLatestRelease(appId, channel);
  const installedVersion = installed?.version ?? null;
  const latestVersion = latest?.version ?? null;

  const updateAvailable =
    !!installedVersion &&
    !!latestVersion &&
    compareVersions(latestVersion, installedVersion) > 0;

  return {
    appSlug,
    updateAvailable,
    installedVersion,
    latestVersion,
    channel,
    releaseId: latest?.releaseId ?? null,
  };
}

/* ───────────────────────── Downloads ─────────────────────────────────────── */

export async function download(
  userId: string,
  appId: string,
  channel: string,
): Promise<ReleaseArtifact | null> {
  const artifact = await repo.getLatestRelease(appId, channel);
  if (!artifact) return null;
  await repo.recordDownload({ appId, releaseId: artifact.releaseId, userId, channel });
  return artifact;
}

/* ───────────────────────── Recommendations ───────────────────────────────── */

export async function recommend(userId: string, limit = 12): Promise<StoreAppCard[]> {
  return repo.recommendApps(userId, limit);
}
