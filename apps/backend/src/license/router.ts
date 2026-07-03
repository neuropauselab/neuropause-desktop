/**
 * License routes (authenticated, org-scoped): report the org's license — its
 * subscription entitlement evaluated into valid / grace / invalid, with the entitled
 * plan tier. Any active member may read it. There is no separate license storage:
 * the subscription IS the license, so this reads the existing subscriptions
 * repository and runs the shared evaluation. An org with no subscription row is a
 * valid free license. The repo and role lookup are injected (same pattern as the
 * billing router), so the router is unit-tested with the in-memory repository.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { CloudOrgRole, LicenseSnapshot, OrgLicense } from '@neuropause/shared';
import { evaluateLicense } from '@neuropause/shared';
import { forbidden, unauthorized } from '../middleware/error';
import type { Subscription, SubscriptionRepository } from '../subscriptions/types';

export interface LicenseRouterDeps {
  subscriptions: SubscriptionRepository;
  /** The actor's active role in the org, or null if not an active member. */
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

/** Map a subscription row (or its absence) onto the license snapshot. */
function toSnapshot(sub: Subscription | null): LicenseSnapshot {
  if (!sub) {
    return { planTier: 'free', status: 'active', currentPeriodEnd: null, trialEndsAt: null };
  }
  return {
    planTier: sub.planTier,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEndsAt: sub.trialEndsAt,
  };
}

export function createLicenseRouter(deps: LicenseRouterDeps): Router {
  const router = Router();

  const requireMember = async (orgId: string, userId: string): Promise<void> => {
    const role = await deps.getMemberRole(orgId, userId);
    if (!role) throw forbidden('not_member', 'You are not a member of this organization.');
  };

  router.get(
    '/:orgId',
    h(async (req, res) => {
      const orgId = req.params.orgId;
      await requireMember(orgId, actorId(req));
      const snapshot = toSnapshot(await deps.subscriptions.getByOrg(orgId));
      const body: OrgLicense = {
        orgId,
        snapshot,
        evaluation: evaluateLicense(snapshot),
        checkedAt: new Date().toISOString(),
      };
      res.json(body);
    }),
  );

  return router;
}
