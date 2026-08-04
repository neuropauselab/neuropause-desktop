/**
 * Store router HTTP tests (closes audit finding A3-2 — "23 endpoints, 0 tests").
 *
 * Strategy mirrors accountRouter.test.ts: a real Express app on an ephemeral
 * port, exercised over fetch, with the central error handlers installed. The
 * Postgres repository is replaced with vi.mock; the service layer, the Zod
 * schemas, and the real JWT verification (requireAuth / optionalAuth) all run
 * for real, so routing, validation, auth, personalization, and service logic
 * are covered end-to-end without infrastructure.
 */
import 'express-async-errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  InstallationDto,
  ReleaseArtifact,
  ReviewDto,
  StoreAppCard,
  StoreAppDetail,
} from '@neuropause/shared';
import { signAccessToken } from '../auth/jwt';
import { errorHandler, notFoundHandler } from '../middleware/error';
import { createStoreRouter } from './router';
import * as repo from './repository';

vi.mock('./repository', () => ({
  searchApps: vi.fn(),
  listSection: vi.fn(),
  getAppCardBySlug: vi.fn(),
  getVersions: vi.fn(),
  listReviews: vi.fn(),
  getAppDetail: vi.fn(),
  getDeveloperBySlug: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  listFeaturedRows: vi.fn(),
  listFeaturedCollectionMeta: vi.fn(),
  getCollectionMeta: vi.fn(),
  getManualCollectionApps: vi.fn(),
  listBookmarks: vi.fn(),
  addBookmark: vi.fn(),
  removeBookmark: vi.fn(),
  listInstallations: vi.fn(),
  upsertInstallation: vi.fn(),
  uninstall: vi.fn(),
  recordLaunch: vi.fn(),
  upsertReview: vi.fn(),
  recommendApps: vi.fn(),
  getLatestRelease: vi.fn(),
  getInstalledVersion: vi.fn(),
  recordDownload: vi.fn(),
  getAppIdBySlug: vi.fn(),
  getChannelIdBySlug: vi.fn(),
  getReleaseVersionId: vi.fn(),
}));

const mocked = vi.mocked(repo);

/* ───────────────────────── Fixtures ─────────────────────────────────────── */

function makeCard(id: string, slug: string): StoreAppCard {
  return {
    id,
    slug,
    name: `App ${id}`,
    tagline: 'Does one thing well',
    appType: 'web',
    pricingKind: 'free',
    iconGlyph: null,
    iconTone: null,
    iconUrl: null,
    developer: {
      id: 'dev-1',
      slug: 'acme',
      name: 'Acme',
      kind: 'organization',
      avatarUrl: null,
      isVerified: true,
      verifiedTier: null,
      website: null,
    },
    category: { id: 'cat-1', slug: 'writing', name: 'Writing', icon: null },
    rating: { average: 4.5, count: 10, distribution: [0, 0, 1, 3, 6] },
    installCount: 42,
    isOpenSource: false,
    isStaffPick: false,
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeDetail(card: StoreAppCard): StoreAppDetail {
  return {
    ...card,
    description: 'Long description',
    homepageUrl: null,
    launchUrl: 'https://app.example.com',
    repositoryUrl: null,
    license: null,
    tags: [],
    screenshots: [],
    pricingPlans: [],
    permissions: [],
    pluginPackages: [],
    versions: [],
    latestVersion: null,
    reviews: [],
    reviewsTotal: 0,
  };
}

function makeInstallation(id: string, card: StoreAppCard): InstallationDto {
  return {
    id,
    status: 'installed',
    app: card,
    version: '1.2.0',
    channel: 'stable',
    grantedPermissions: [],
    installLocation: null,
    lastLaunchedAt: null,
    launchCount: 0,
    installedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function makeArtifact(releaseId: string, version: string): ReleaseArtifact {
  return {
    releaseId,
    version,
    channel: 'stable',
    url: 'https://cdn.example.com/pkg.npkg',
    sizeBytes: 1024,
    sha256: 'abc123',
    signature: null,
    signatureKeyId: null,
    isDelta: false,
  };
}

function makeReview(id: string, rating: number): ReviewDto {
  return {
    id,
    rating,
    title: null,
    body: null,
    author: { name: 'Reviewer', avatarUrl: null },
    version: null,
    helpfulCount: 0,
    isMine: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const cardA = makeCard('app-1', 'focus-writer');
const cardB = makeCard('app-2', 'code-pilot');

/** Seed the happy-path defaults every test starts from. */
function seedDefaults(): void {
  mocked.getAppIdBySlug.mockImplementation(async (slug) =>
    slug === cardA.slug ? cardA.id : slug === cardB.slug ? cardB.id : null,
  );
  mocked.searchApps.mockResolvedValue({ items: [cardA, cardB], total: 2 });
  mocked.listSection.mockResolvedValue({ items: [cardA], total: 1 });
  mocked.getAppCardBySlug.mockImplementation(async (slug) =>
    slug === cardA.slug ? cardA : slug === cardB.slug ? cardB : null,
  );
  mocked.getAppDetail.mockImplementation(async (slug) =>
    slug === cardA.slug ? makeDetail(cardA) : null,
  );
  mocked.getVersions.mockResolvedValue([]);
  mocked.listReviews.mockResolvedValue({ items: [makeReview('rev-1', 5)], total: 1 });
  mocked.getDeveloperBySlug.mockResolvedValue(null);
  mocked.listCategories.mockResolvedValue([]);
  mocked.listTags.mockResolvedValue([]);
  mocked.listFeaturedRows.mockResolvedValue([]);
  mocked.listFeaturedCollectionMeta.mockResolvedValue([]);
  mocked.getCollectionMeta.mockResolvedValue(null);
  mocked.getManualCollectionApps.mockResolvedValue([]);
  mocked.listBookmarks.mockResolvedValue([]);
  mocked.addBookmark.mockResolvedValue(undefined);
  mocked.removeBookmark.mockResolvedValue(undefined);
  mocked.listInstallations.mockResolvedValue([]);
  mocked.upsertInstallation.mockResolvedValue(null);
  mocked.uninstall.mockResolvedValue(true);
  mocked.recordLaunch.mockResolvedValue(null);
  mocked.upsertReview.mockResolvedValue(null);
  mocked.recommendApps.mockResolvedValue([]);
  mocked.getLatestRelease.mockResolvedValue(null);
  mocked.getInstalledVersion.mockResolvedValue(null);
  mocked.recordDownload.mockResolvedValue(undefined);
  mocked.getChannelIdBySlug.mockResolvedValue('chan-stable');
  mocked.getReleaseVersionId.mockResolvedValue(null);
}

/* ───────────────────────── Harness ──────────────────────────────────────── */

function build(): Express {
  const app = express();
  app.use(express.json());
  app.use('/store', createStoreRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

let server: Server | undefined;
async function start(): Promise<string> {
  const app = build();
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.resetAllMocks();
  seedDefaults();
});
afterEach(() => {
  server?.close();
  server = undefined;
});

const tokenFor = (userId: string): string =>
  signAccessToken({ sub: userId, email: `${userId}@test.dev` }).token;

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic JSON response body under test
  body: any;
}
async function call(
  base: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* ───────────────────────── Discovery (public) ───────────────────────────── */

describe('GET /store/featured', () => {
  it('joins featured rows to app cards and drops rows whose app is missing', async () => {
    mocked.listFeaturedRows.mockResolvedValue([
      {
        id: 'f1',
        headline: 'Write faster',
        subheadline: null,
        banner_image_url: null,
        accent: null,
        cta_label: null,
        app_slug: cardA.slug,
      },
      {
        id: 'f2',
        headline: 'Ghost entry',
        subheadline: null,
        banner_image_url: null,
        accent: null,
        cta_label: null,
        app_slug: 'unpublished-app',
      },
    ]);
    const base = await start();
    const res = await call(base, 'GET', '/store/featured');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].app.slug).toBe(cardA.slug);
  });
});

describe('GET /store/collections', () => {
  it('returns manual collections with their apps', async () => {
    mocked.listFeaturedCollectionMeta.mockResolvedValue([
      {
        id: 'c1',
        slug: 'essentials',
        title: 'Essentials',
        subtitle: null,
        accent: null,
        hero_image_url: null,
        kind: 'manual',
        auto_rule: null,
      },
    ]);
    mocked.getManualCollectionApps.mockResolvedValue([cardB]);
    const base = await start();
    const res = await call(base, 'GET', '/store/collections');
    expect(res.status).toBe(200);
    expect(res.body.items[0].slug).toBe('essentials');
    expect(res.body.items[0].apps[0].slug).toBe(cardB.slug);
    expect(mocked.getManualCollectionApps).toHaveBeenCalledWith('c1');
  });

  it('resolves auto collections through their section rule', async () => {
    mocked.listFeaturedCollectionMeta.mockResolvedValue([
      {
        id: 'c2',
        slug: 'hot-now',
        title: 'Hot now',
        subtitle: null,
        accent: null,
        hero_image_url: null,
        kind: 'auto',
        auto_rule: 'trending',
      },
    ]);
    const base = await start();
    const res = await call(base, 'GET', '/store/collections');
    expect(res.status).toBe(200);
    expect(mocked.listSection).toHaveBeenCalledWith('trending', 1, 12);
    expect(res.body.items[0].apps[0].slug).toBe(cardA.slug);
  });
});

describe('GET /store/collections/:slug', () => {
  it('returns a single collection', async () => {
    mocked.getCollectionMeta.mockResolvedValue({
      id: 'c1',
      slug: 'essentials',
      title: 'Essentials',
      subtitle: null,
      accent: null,
      hero_image_url: null,
      kind: 'manual',
      auto_rule: null,
    });
    const base = await start();
    const res = await call(base, 'GET', '/store/collections/essentials');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('essentials');
  });

  it('404s for an unknown collection', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/collections/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('collection_not_found');
  });
});

describe('GET /store/sections/:key', () => {
  it('serves a known section with pagination defaults', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/sections/trending');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(mocked.listSection).toHaveBeenCalledWith('trending', 1, 20);
  });

  it('normalizes hyphenated keys to the canonical underscore form', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/sections/staff-picks?page=2&pageSize=5');
    expect(res.status).toBe(200);
    expect(mocked.listSection).toHaveBeenCalledWith('staff_picks', 2, 5);
  });

  it('404s for an unknown section key', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/sections/definitely-not-a-section');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('section_not_found');
  });

  it('rejects an out-of-range pageSize with a validation error', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/sections/trending?pageSize=999');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

/* ───────────────────────── Search / catalog (public) ────────────────────── */

describe('GET /store/apps', () => {
  it('parses filters, splits tags, and coerces booleans + pagination', async () => {
    const base = await start();
    const res = await call(
      base,
      'GET',
      '/store/apps?q=writing&tags=ai,productivity&openSource=1&sort=rating&page=3&pageSize=10',
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 3, pageSize: 10, total: 2 });
    expect(mocked.searchApps).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'writing',
        tags: ['ai', 'productivity'],
        openSource: true,
        sort: 'rating',
        page: 3,
        pageSize: 10,
      }),
    );
  });

  it('rejects an unknown sort value', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/apps?sort=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('GET /store/apps/:slug', () => {
  it('returns the app detail anonymously', async () => {
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(cardA.slug);
    expect(mocked.getAppDetail).toHaveBeenCalledWith(cardA.slug, undefined);
  });

  it('personalizes with the viewer id when a valid bearer token is present', async () => {
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}`, { token: tokenFor('u7') });
    expect(res.status).toBe(200);
    expect(mocked.getAppDetail).toHaveBeenCalledWith(cardA.slug, 'u7');
  });

  it('treats a garbage bearer token as anonymous instead of failing', async () => {
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}`, { token: 'garbage' });
    expect(res.status).toBe(200);
    expect(mocked.getAppDetail).toHaveBeenCalledWith(cardA.slug, undefined);
  });

  it('404s for an unknown app', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/apps/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('app_not_found');
  });
});

describe('GET /store/apps/:slug/reviews', () => {
  it('returns a paginated review list', async () => {
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}/reviews?page=2&pageSize=5`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 2, pageSize: 5, total: 1 });
    expect(mocked.listReviews).toHaveBeenCalledWith(cardA.id, 2, 5, undefined);
  });

  it('404s when the app slug is unknown', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/apps/nope/reviews');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('app_not_found');
  });
});

describe('GET /store/apps/:slug/versions', () => {
  it('returns the version history', async () => {
    mocked.getVersions.mockResolvedValue([
      { id: 'v1', version: '1.0.0', isPrerelease: false, channel: 'stable', releasedAt: null, changelog: null },
    ]);
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(mocked.getVersions).toHaveBeenCalledWith(cardA.id);
  });
});

describe('GET /store/developers/:slug', () => {
  it('returns a developer profile', async () => {
    mocked.getDeveloperBySlug.mockResolvedValue({
      id: 'dev-1',
      slug: 'acme',
      name: 'Acme',
      kind: 'organization',
      avatarUrl: null,
      website: null,
      supportUrl: null,
      bio: null,
      isVerified: true,
      verifiedTier: null,
      organization: null,
      apps: [cardA, cardB],
    });
    const base = await start();
    const res = await call(base, 'GET', '/store/developers/acme');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('acme');
  });

  it('404s for an unknown developer', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/developers/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('developer_not_found');
  });
});

describe('GET /store/categories and /store/tags', () => {
  it('lists categories', async () => {
    mocked.listCategories.mockResolvedValue([
      { id: 'cat-1', slug: 'writing', name: 'Writing', icon: null, appCount: 3 },
    ]);
    const base = await start();
    const res = await call(base, 'GET', '/store/categories');
    expect(res.status).toBe(200);
    expect(res.body.items[0].slug).toBe('writing');
  });

  it('lists tags', async () => {
    mocked.listTags.mockResolvedValue([{ id: 't1', slug: 'ai', label: 'AI', appCount: 5 }]);
    const base = await start();
    const res = await call(base, 'GET', '/store/tags');
    expect(res.status).toBe(200);
    expect(res.body.items[0].slug).toBe('ai');
  });
});

/* ───────────────────────── Personal library (auth) ──────────────────────── */

describe('auth gating on personal endpoints', () => {
  it.each([
    ['GET', '/store/me/bookmarks'],
    ['GET', '/store/me/installations'],
    ['GET', '/store/me/recently-used'],
    ['GET', '/store/me/recommendations'],
    ['PUT', '/store/apps/focus-writer/bookmark'],
    ['DELETE', '/store/apps/focus-writer/bookmark'],
    ['POST', '/store/apps/focus-writer/install'],
    ['POST', '/store/apps/focus-writer/uninstall'],
    ['POST', '/store/installations/i1/launch'],
    ['GET', '/store/apps/focus-writer/updates'],
    ['POST', '/store/apps/focus-writer/download'],
    ['POST', '/store/apps/focus-writer/reviews'],
  ] as const)('%s %s → 401 without a token', async (method, path) => {
    const base = await start();
    const res = await call(base, method, path, method === 'GET' ? {} : { body: {} });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('missing_token');
  });

  it('rejects an invalid token with 401 invalid_token', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/me/bookmarks', { token: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });
});

describe('bookmarks', () => {
  it('lists the caller bookmarks', async () => {
    mocked.listBookmarks.mockResolvedValue([cardA]);
    const base = await start();
    const res = await call(base, 'GET', '/store/me/bookmarks', { token: tokenFor('u1') });
    expect(res.status).toBe(200);
    expect(res.body.items[0].slug).toBe(cardA.slug);
    expect(mocked.listBookmarks).toHaveBeenCalledWith('u1');
  });

  it('adds a bookmark by slug', async () => {
    const base = await start();
    const res = await call(base, 'PUT', `/store/apps/${cardA.slug}/bookmark`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.bookmarked).toBe(true);
    expect(mocked.addBookmark).toHaveBeenCalledWith('u1', cardA.id);
  });

  it('removes a bookmark by slug', async () => {
    const base = await start();
    const res = await call(base, 'DELETE', `/store/apps/${cardA.slug}/bookmark`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.bookmarked).toBe(false);
    expect(mocked.removeBookmark).toHaveBeenCalledWith('u1', cardA.id);
  });
});

describe('installations listing', () => {
  it('lists installations', async () => {
    mocked.listInstallations.mockResolvedValue([makeInstallation('i1', cardA)]);
    const base = await start();
    const res = await call(base, 'GET', '/store/me/installations', { token: tokenFor('u1') });
    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe('i1');
    expect(mocked.listInstallations).toHaveBeenCalledWith('u1');
  });

  it('lists recently-used with the recentOnly filter', async () => {
    const base = await start();
    const res = await call(base, 'GET', '/store/me/recently-used', { token: tokenFor('u1') });
    expect(res.status).toBe(200);
    expect(mocked.listInstallations).toHaveBeenCalledWith('u1', { recentOnly: true });
  });

  it('returns recommendations', async () => {
    mocked.recommendApps.mockResolvedValue([cardB]);
    const base = await start();
    const res = await call(base, 'GET', '/store/me/recommendations', { token: tokenFor('u1') });
    expect(res.status).toBe(200);
    expect(res.body.items[0].slug).toBe(cardB.slug);
    expect(mocked.recommendApps).toHaveBeenCalledWith('u1', 12);
  });
});

/* ───────────────────────── Install / launch / update ────────────────────── */

describe('POST /store/apps/:slug/install', () => {
  it('installs, records the download, and returns 201 with the artifact', async () => {
    const installation = makeInstallation('i1', cardA);
    const artifact = makeArtifact('rel-1', '1.2.0');
    mocked.upsertInstallation.mockResolvedValue(installation);
    mocked.getLatestRelease.mockResolvedValue(artifact);
    mocked.getReleaseVersionId.mockResolvedValue('v-12');

    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/install`, {
      token: tokenFor('u1'),
      body: { channel: 'stable', grantedPermissions: ['network'] },
    });
    expect(res.status).toBe(201);
    expect(res.body.installation.id).toBe('i1');
    expect(res.body.artifact.releaseId).toBe('rel-1');
    expect(mocked.upsertInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        appId: cardA.id,
        versionId: 'v-12',
        channelId: 'chan-stable',
        grantedPermissions: ['network'],
      }),
    );
    expect(mocked.recordDownload).toHaveBeenCalledWith(
      expect.objectContaining({ appId: cardA.id, releaseId: 'rel-1', userId: 'u1' }),
    );
  });

  it('defaults the channel to stable and permissions to empty', async () => {
    mocked.upsertInstallation.mockResolvedValue(makeInstallation('i1', cardA));
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/install`, {
      token: tokenFor('u1'),
      body: {},
    });
    expect(res.status).toBe(201);
    expect(res.body.artifact).toBeNull();
    expect(mocked.recordDownload).not.toHaveBeenCalled();
    expect(mocked.upsertInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ grantedPermissions: [] }),
    );
  });

  it('rejects an unknown permission key', async () => {
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/install`, {
      token: tokenFor('u1'),
      body: { grantedPermissions: ['root_access'] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('404s when the app is unknown', async () => {
    const base = await start();
    const res = await call(base, 'POST', '/store/apps/nope/install', {
      token: tokenFor('u1'),
      body: {},
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('app_not_found');
  });

  it('404s with install_failed when the repository cannot install', async () => {
    mocked.upsertInstallation.mockResolvedValue(null);
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/install`, {
      token: tokenFor('u1'),
      body: {},
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('install_failed');
  });
});

describe('POST /store/apps/:slug/uninstall', () => {
  it('reports the uninstall outcome', async () => {
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/uninstall`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.uninstalled).toBe(true);
    expect(mocked.uninstall).toHaveBeenCalledWith('u1', cardA.id);
  });
});

describe('POST /store/installations/:id/launch', () => {
  it('records a launch and returns the installation', async () => {
    mocked.recordLaunch.mockResolvedValue(makeInstallation('i1', cardA));
    const base = await start();
    const res = await call(base, 'POST', '/store/installations/i1/launch', {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('i1');
    expect(mocked.recordLaunch).toHaveBeenCalledWith('i1', 'u1');
  });

  it('404s for an unknown installation', async () => {
    const base = await start();
    const res = await call(base, 'POST', '/store/installations/missing/launch', {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('installation_not_found');
  });
});

describe('GET /store/apps/:slug/updates', () => {
  it('reports an available update when the latest release is newer', async () => {
    mocked.getInstalledVersion.mockResolvedValue({ version: '1.2.0', channel: 'beta' });
    mocked.getLatestRelease.mockResolvedValue(makeArtifact('rel-2', '1.3.0'));
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}/updates`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appSlug: cardA.slug,
      updateAvailable: true,
      installedVersion: '1.2.0',
      latestVersion: '1.3.0',
      channel: 'beta',
      releaseId: 'rel-2',
    });
    expect(mocked.getLatestRelease).toHaveBeenCalledWith(cardA.id, 'beta');
  });

  it('reports no update when versions match ignoring prerelease suffixes', async () => {
    mocked.getInstalledVersion.mockResolvedValue({ version: '1.3.0', channel: 'stable' });
    mocked.getLatestRelease.mockResolvedValue(makeArtifact('rel-2', '1.3.0-beta.1'));
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}/updates`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body.updateAvailable).toBe(false);
  });

  it('falls back to the stable channel when nothing is installed', async () => {
    const base = await start();
    const res = await call(base, 'GET', `/store/apps/${cardA.slug}/updates`, {
      token: tokenFor('u1'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updateAvailable: false, installedVersion: null });
    expect(mocked.getLatestRelease).toHaveBeenCalledWith(cardA.id, 'stable');
  });
});

describe('POST /store/apps/:slug/download', () => {
  it('returns the artifact and records the download', async () => {
    mocked.getLatestRelease.mockResolvedValue(makeArtifact('rel-9', '2.0.0'));
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/download`, {
      token: tokenFor('u1'),
      body: { channel: 'stable' },
    });
    expect(res.status).toBe(200);
    expect(res.body.releaseId).toBe('rel-9');
    expect(mocked.recordDownload).toHaveBeenCalledWith(
      expect.objectContaining({ appId: cardA.id, releaseId: 'rel-9', channel: 'stable' }),
    );
  });

  it('404s when the channel has no published release', async () => {
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/download`, {
      token: tokenFor('u1'),
      body: {},
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('release_not_found');
  });
});

/* ───────────────────────── Reviews (auth) ───────────────────────────────── */

describe('POST /store/apps/:slug/reviews', () => {
  it('creates a review and returns 201', async () => {
    mocked.upsertReview.mockResolvedValue(makeReview('rev-9', 4));
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/reviews`, {
      token: tokenFor('u1'),
      body: { rating: 4, title: 'Solid', body: 'Works great' },
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('rev-9');
    expect(mocked.upsertReview).toHaveBeenCalledWith({
      appId: cardA.id,
      userId: 'u1',
      rating: 4,
      title: 'Solid',
      body: 'Works great',
    });
  });

  it('normalizes missing title/body to null', async () => {
    mocked.upsertReview.mockResolvedValue(makeReview('rev-9', 5));
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/reviews`, {
      token: tokenFor('u1'),
      body: { rating: 5 },
    });
    expect(res.status).toBe(201);
    expect(mocked.upsertReview).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, body: null }),
    );
  });

  it('rejects an out-of-range rating', async () => {
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/reviews`, {
      token: tokenFor('u1'),
      body: { rating: 6 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('404s with review_failed when the repository rejects the write', async () => {
    mocked.upsertReview.mockResolvedValue(null);
    const base = await start();
    const res = await call(base, 'POST', `/store/apps/${cardA.slug}/reviews`, {
      token: tokenFor('u1'),
      body: { rating: 3 },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('review_failed');
  });
});
