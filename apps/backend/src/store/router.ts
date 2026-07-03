import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Paginated, StoreAppCard } from '@neuropause/shared';
import { validateBody } from '../middleware/validate';
import { notFound, unauthorized } from '../middleware/error';
import { requireAuth } from '../auth/requireAuth';
import { verifyAccessToken } from '../auth/jwt';
import * as repo from './repository';
import * as service from './service';
import {
  DownloadBodySchema,
  InstallBodySchema,
  PageQuerySchema,
  ReviewBodySchema,
  SearchQuerySchema,
} from './schemas';

/**
 * Best-effort auth: attaches req.userId when a valid Bearer token is present,
 * but never rejects. Lets public endpoints personalize (e.g. mark a viewer's
 * own review) without forcing sign-in.
 */
function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    try {
      const claims = verifyAccessToken(header.slice('Bearer '.length));
      req.userId = claims.sub;
      req.userEmail = claims.email;
    } catch {
      /* ignore — treat as anonymous */
    }
  }
  next();
}

/** Resolves a slug to an application id or throws a 404. */
async function requireAppId(slug: string): Promise<string> {
  const id = await repo.getAppIdBySlug(slug);
  if (!id) throw notFound('app_not_found', 'Application not found');
  return id;
}

function userIdOrThrow(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}

export function createStoreRouter(): Router {
  const router = Router();

  /* ─────────────── Discovery / merchandising (public) ─────────────── */

  router.get('/featured', async (_req, res) => {
    res.json({ items: await service.getFeatured() });
  });

  router.get('/collections', async (_req, res) => {
    res.json({ items: await service.getFeaturedCollections() });
  });

  router.get('/collections/:slug', async (req, res) => {
    const collection = await service.getCollection(req.params.slug);
    if (!collection) throw notFound('collection_not_found', 'Collection not found');
    res.json(collection);
  });

  // Trending / new / verified / enterprise / open_source / staff_picks / recently_updated.
  router.get('/sections/:key', async (req, res) => {
    const key = service.normalizeSectionKey(req.params.key);
    if (!key) throw notFound('section_not_found', 'Unknown store section');
    const { page, pageSize } = PageQuerySchema.parse(req.query);
    const { items, total } = await repo.listSection(key, page, pageSize);
    const body: Paginated<StoreAppCard> = { items, page, pageSize, total };
    res.json(body);
  });

  /* ─────────────── Search / catalog (public) ─────────────── */

  router.get('/apps', async (req, res) => {
    const params = SearchQuerySchema.parse(req.query);
    const { items, total } = await repo.searchApps(params);
    const body: Paginated<StoreAppCard> = {
      items,
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
    res.json(body);
  });

  router.get('/apps/:slug', optionalAuth, async (req, res) => {
    const detail = await repo.getAppDetail(req.params.slug, req.userId);
    if (!detail) throw notFound('app_not_found', 'Application not found');
    res.json(detail);
  });

  router.get('/apps/:slug/reviews', optionalAuth, async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    const { page, pageSize } = PageQuerySchema.parse(req.query);
    const { items, total } = await repo.listReviews(appId, page, pageSize, req.userId);
    res.json({ items, page, pageSize, total });
  });

  router.get('/apps/:slug/versions', async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    res.json({ items: await repo.getVersions(appId) });
  });

  router.get('/developers/:slug', async (req, res) => {
    const dev = await repo.getDeveloperBySlug(req.params.slug);
    if (!dev) throw notFound('developer_not_found', 'Developer not found');
    res.json(dev);
  });

  router.get('/categories', async (_req, res) => {
    res.json({ items: await repo.listCategories() });
  });

  router.get('/tags', async (_req, res) => {
    res.json({ items: await repo.listTags() });
  });

  /* ─────────────── Personal library (auth required) ─────────────── */

  router.get('/me/bookmarks', requireAuth, async (req, res) => {
    res.json({ items: await repo.listBookmarks(userIdOrThrow(req)) });
  });

  router.put('/apps/:slug/bookmark', requireAuth, async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    await repo.addBookmark(userIdOrThrow(req), appId);
    res.json({ bookmarked: true });
  });

  router.delete('/apps/:slug/bookmark', requireAuth, async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    await repo.removeBookmark(userIdOrThrow(req), appId);
    res.json({ bookmarked: false });
  });

  router.get('/me/installations', requireAuth, async (req, res) => {
    res.json({ items: await repo.listInstallations(userIdOrThrow(req)) });
  });

  router.get('/me/recently-used', requireAuth, async (req, res) => {
    res.json({ items: await repo.listInstallations(userIdOrThrow(req), { recentOnly: true }) });
  });

  router.get('/me/recommendations', requireAuth, async (req, res) => {
    res.json({ items: await service.recommend(userIdOrThrow(req)) });
  });

  /* ─────────────── Install / launch / update (auth required) ─────────────── */

  router.post('/apps/:slug/install', requireAuth, validateBody(InstallBodySchema), async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    const result = await service.installApp(userIdOrThrow(req), appId, req.body);
    if (!result) throw notFound('install_failed', 'Could not install application');
    res.status(201).json(result);
  });

  router.post('/apps/:slug/uninstall', requireAuth, async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    const ok = await repo.uninstall(userIdOrThrow(req), appId);
    res.json({ uninstalled: ok });
  });

  router.post('/installations/:id/launch', requireAuth, async (req, res) => {
    const installation = await service.launch(userIdOrThrow(req), req.params.id);
    if (!installation) throw notFound('installation_not_found', 'Installation not found');
    res.json(installation);
  });

  router.get('/apps/:slug/updates', requireAuth, async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    res.json(await service.checkUpdate(userIdOrThrow(req), appId, req.params.slug));
  });

  router.post('/apps/:slug/download', requireAuth, validateBody(DownloadBodySchema), async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    const artifact = await service.download(userIdOrThrow(req), appId, req.body.channel);
    if (!artifact) throw notFound('release_not_found', 'No published release for this channel');
    res.json(artifact);
  });

  /* ─────────────── Reviews (auth required) ─────────────── */

  router.post('/apps/:slug/reviews', requireAuth, validateBody(ReviewBodySchema), async (req, res) => {
    const appId = await requireAppId(req.params.slug);
    const review = await repo.upsertReview({
      appId,
      userId: userIdOrThrow(req),
      rating: req.body.rating,
      title: req.body.title ?? null,
      body: req.body.body ?? null,
    });
    if (!review) throw notFound('review_failed', 'Could not save review');
    res.status(201).json(review);
  });

  return router;
}
