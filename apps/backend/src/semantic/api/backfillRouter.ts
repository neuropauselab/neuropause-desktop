/**
 * Memory backfill router (V8.2 Part 2 inc3). Thin Express wrapper over
 * `backfillOrgMemories`, mirroring the semantic search router: mount behind
 * `requireAuth`, org from the path, userId from the session, zod-validated body,
 * BackfillError → HTTP error helpers. Mount alongside the search router:
 *
 *   app.use('/memory/semantic', requireAuth, createBackfillRouter({
 *     embeddingProvider, vectorStore,
 *     stateRepo: createPgEmbeddingStateRepository(),
 *     getMemberRole: orgRepo.getMembershipByOrgUser
 *       ? (o, u) => orgRepo.getMemberRole(o, u)   // use the same accessor search uses
 *       : orgRepo.getMemberRole,
 *   }));
 *
 * → POST /memory/semantic/:orgId/backfill  { memories: [{ memoryId, content }] }
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, unauthorized } from '../../middleware/error';
import { backfillOrgMemories, BackfillError, type BackfillDeps } from './backfillService';

const BackfillBody = z.object({
  memories: z
    .array(z.object({ memoryId: z.string().min(1), content: z.string() }))
    .min(1)
    .max(500),
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

export function createBackfillRouter(deps: BackfillDeps): Router {
  const router = Router();

  router.post(
    '/:orgId/backfill',
    h(async (req, res) => {
      const parsed = BackfillBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_request', 'Invalid backfill body.');
      try {
        const result = await backfillOrgMemories(deps, {
          orgId: req.params.orgId,
          userId: actorId(req),
          memories: parsed.data.memories,
        });
        res.json(result);
      } catch (err) {
        if (err instanceof BackfillError) {
          if (err.code === 'not_member') throw forbidden('not_member', err.message);
          if (err.code === 'invalid_request') throw badRequest('invalid_request', err.message);
        }
        throw err;
      }
    }),
  );

  return router;
}
