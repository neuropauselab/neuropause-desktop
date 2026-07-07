/**
 * Semantic health router (V8.2 Part 2 inc3). GET /memory/semantic/:orgId/health,
 * membership-gated like search/backfill. Optional ?total=N lets the desktop supply
 * its memory count for a coverage percent (backend only knows the embedded count).
 * Mount alongside the search + backfill routers:
 *
 *   app.use('/memory/semantic', requireAuth, createSemanticHealthRouter({
 *     embeddingProvider, vectorStore,
 *     countEmbedded: (orgId) => embeddingStateRepo.countByOrg(orgId),
 *     getMemberRole,
 *   }));
 *
 * → GET /memory/semantic/:orgId/health[?total=N]
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { forbidden, unauthorized } from '../../middleware/error';
import { semanticHealth, type SemanticHealthDeps } from './semanticHealthService';

export interface SemanticHealthRouterDeps {
  embeddingProvider: SemanticHealthDeps['embeddingProvider'];
  vectorStore: SemanticHealthDeps['vectorStore'];
  countEmbedded: (orgId: string) => Promise<number>;
  getMemberRole: (orgId: string, userId: string) => Promise<string | null>;
}

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

export function createSemanticHealthRouter(deps: SemanticHealthRouterDeps): Router {
  const router = Router();

  router.get(
    '/:orgId/health',
    h(async (req, res) => {
      const orgId = req.params.orgId;
      const role = await deps.getMemberRole(orgId, actorId(req));
      if (!role) throw forbidden('not_member', 'You are not a member of this organization.');

      const totalRaw = Number(req.query.total);
      const result = await semanticHealth(
        {
          embeddingProvider: deps.embeddingProvider,
          vectorStore: deps.vectorStore,
          getCoverage: async (o) => {
            const embedded = await deps.countEmbedded(o);
            const total = Number.isFinite(totalRaw) && totalRaw >= 0 ? totalRaw : embedded;
            return { embedded, total };
          },
        },
        orgId,
      );
      res.json(result);
    }),
  );

  return router;
}
