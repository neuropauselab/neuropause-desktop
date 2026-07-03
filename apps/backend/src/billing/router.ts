/**
 * Billing management routes (authenticated, org-scoped): view the subscription,
 * start checkout for a plan, and cancel. Owners/admins only for mutations. The
 * gateway and the org role lookup are injected, so the router is unit-tested with a
 * stub gateway and no live payment calls. The webhook route is mounted separately
 * (it is public + signature-verified and needs the raw body).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BillingPlanId, CloudOrgRole } from '@neuropause/shared';
import { BILLING_PLANS, billingPlan } from '@neuropause/shared';
import { validateBody } from '../middleware/validate';
import { badRequest, forbidden, notFound, unauthorized } from '../middleware/error';
import type { SubscriptionRepository } from '../subscriptions/types';
import type { BillingGateway } from './gateway';
import { CheckoutBody } from './schemas';

export interface BillingRouterDeps {
  subscriptions: SubscriptionRepository;
  gateway: BillingGateway;
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

export function createBillingRouter(deps: BillingRouterDeps): Router {
  const router = Router();

  const roleOf = async (orgId: string, userId: string): Promise<CloudOrgRole> => {
    const role = await deps.getMemberRole(orgId, userId);
    if (!role) throw forbidden('not_member', 'You are not a member of this organization.');
    return role;
  };
  const requireManager = async (orgId: string, userId: string): Promise<void> => {
    const role = await roleOf(orgId, userId);
    if (role !== 'owner' && role !== 'admin') {
      throw forbidden('forbidden', 'Only owners and admins can manage billing.');
    }
  };

  router.get(
    '/:orgId/subscription',
    h(async (req, res) => {
      await roleOf(req.params.orgId, actorId(req));
      const subscription = await deps.subscriptions.getByOrg(req.params.orgId);
      res.json({ subscription, plans: Object.values(BILLING_PLANS) });
    }),
  );

  router.post(
    '/:orgId/checkout',
    validateBody(CheckoutBody),
    h(async (req, res) => {
      await requireManager(req.params.orgId, actorId(req));
      const plan = req.body.plan as BillingPlanId;
      const meta = billingPlan(plan);
      if (!meta.selfServe) {
        throw badRequest('not_self_serve', 'This plan is sales-assisted — please contact us.');
      }
      const seats = (req.body.seats as number | undefined) ?? meta.includedSeats;
      const created = await deps.gateway.createSubscription({
        orgId: req.params.orgId,
        plan,
        seats,
        trialDays: meta.trialDays,
      });
      // Record the provider ids now; the webhook finalizes status/period later.
      await deps.subscriptions.update(req.params.orgId, {
        providerSubscriptionId: created.subscriptionId,
        providerCustomerId: created.customerId,
        plan,
      });
      res
        .status(201)
        .json({ subscriptionId: created.subscriptionId, checkoutUrl: created.shortUrl });
    }),
  );

  router.post(
    '/:orgId/cancel',
    h(async (req, res) => {
      await requireManager(req.params.orgId, actorId(req));
      const sub = await deps.subscriptions.getByOrg(req.params.orgId);
      if (!sub?.providerSubscriptionId) {
        throw notFound('no_subscription', 'No active subscription to cancel.');
      }
      await deps.gateway.cancelSubscription(sub.providerSubscriptionId, true);
      res.json({ canceled: true });
    }),
  );

  return router;
}
