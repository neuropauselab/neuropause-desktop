/**
 * Authenticated semantic search router (V8.2 Part 1). Thin Express wrapper over
 * `semanticSearchQuery` — mirrors the license router: mount behind `requireAuth`,
 * take `orgId` from the path, `userId` from `req.userId` (the session), validate
 * the body with zod, and map `SemanticError` onto the app's HTTP error helpers.
 *
 * Wiring (in app.ts), behind requireAuth so the session is present:
 *
 *   const embeddingProvider = createEmbeddingProvider(loadEmbeddingConfig(env), {
 *     fetchFn: (url, init) => fetch(url, init) as unknown as HttpResponse,
 *   });
 *   const vectorStore = new QdrantVectorStore(loadQdrantConfig(env), (u, i) => fetch(u, i) as never);
 *   const orgRepo = createPgOrgRepository(pool);
 *   app.use(
 *     '/memory/semantic',
 *     requireAuth,
 *     createSemanticRouter({ embeddingProvider, vectorStore, getMemberRole: orgRepo.getMemberRole }),
 *   );
 *
 * → POST /memory/semantic/:orgId/search  { text, limit? }
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, unauthorized } from '../../middleware/error';
import { semanticSearchQuery, SemanticError, type SemanticSearchDeps } from './semanticSearchService';

const SearchBody = z.object({
  text: z.string().trim().min(1).max(400),
  limit: z.number().int().min(1).max(100).optional(),
});

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const h =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

function actorId(req: Request): string {
  if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
  return req.userId;
}

/** Translate the service's structured error into the app's HTTP error helpers. */
function toHttpError(err: unknown): never {
  if (err instanceof SemanticError) {
    if (err.code === 'not_member') throw forbidden('not_member', err.message);
    if (err.code === 'invalid_request') throw badRequest('invalid_request', err.message);
    // embedding_failed / search_failed → surface as-is (500 via the error handler).
  }
  throw err;
}

export function createSemanticRouter(deps: SemanticSearchDeps): Router {
  const router = Router();

  router.post(
    '/:orgId/search',
    h(async (req, res) => {
      const parsed = SearchBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_request', 'Invalid search body.');
      try {
        const result = await semanticSearchQuery(deps, {
          orgId: req.params.orgId,
          userId: actorId(req),
          text: parsed.data.text,
          limit: parsed.data.limit,
        });
        res.json(result);
      } catch (err) {
        toHttpError(err);
      }
    }),
  );

  return router;
}
