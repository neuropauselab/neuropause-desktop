/**
 * Sync routes (authenticated, org-scoped): push a batch of local changes and pull
 * changes since a cursor. Both require active org membership; the org role lookup is
 * injected so the router is unit-tested without a database. Cross-tenant safety and
 * conflict resolution live in the service.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { CloudOrgRole, SyncChange, SyncEntityType } from '@neuropause/shared';
import { SYNC_ENTITY_TYPES } from '@neuropause/shared';
import { validateBody } from '../middleware/validate';
import { badRequest, forbidden, unauthorized } from '../middleware/error';
import type { SyncRepository } from './types';
import { pullChanges, pushChanges } from './service';
import { SyncPullQuery, SyncPushBody } from './schemas';

export interface SyncRouterDeps {
  repo: SyncRepository;
  getMemberRole: (orgId: string, userId: string) => Promise<CloudOrgRole | null>;
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

function parseEntityTypes(raw: string | undefined): SyncEntityType[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<string>(SYNC_ENTITY_TYPES);
  const types = raw.split(',').filter((t) => valid.has(t)) as SyncEntityType[];
  return types.length > 0 ? types : undefined;
}

export function createSyncRouter(deps: SyncRouterDeps): Router {
  const router = Router();

  const requireMember = async (orgId: string, userId: string): Promise<void> => {
    const role = await deps.getMemberRole(orgId, userId);
    if (!role) throw forbidden('not_member', 'You are not a member of this organization.');
  };

  router.post(
    '/:orgId/push',
    validateBody(SyncPushBody),
    h(async (req, res) => {
      const orgId = req.params.orgId;
      await requireMember(orgId, actorId(req));
      const { deviceId, changes } = req.body as { deviceId: string; changes: SyncChange[] };
      const result = await pushChanges(deps.repo, orgId, deviceId, changes);
      res.json(result);
    }),
  );

  router.get(
    '/:orgId/pull',
    h(async (req, res) => {
      const orgId = req.params.orgId;
      await requireMember(orgId, actorId(req));
      const parsed = SyncPullQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('invalid_query', 'Invalid pull parameters.');
      const { cursor, deviceId, limit, entityTypes } = parsed.data;
      const result = await pullChanges(deps.repo, orgId, cursor, {
        deviceId,
        limit,
        entityTypes: parseEntityTypes(entityTypes),
      });
      res.json(result);
    }),
  );

  return router;
}
