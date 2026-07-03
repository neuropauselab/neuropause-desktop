/**
 * Organizations HTTP API. The router is auth-agnostic: it reads the caller from
 * `req.userId`/`req.userEmail` (populated by `requireAuth`, applied where the
 * router is mounted). This keeps it fully testable with an injected actor and an
 * injected repository. `OrgError` codes are mapped to HTTP status codes here.
 *
 * Routes (mounted at /organizations):
 *   POST   /                                 create an organization
 *   POST   /accept-invite                    accept an invitation (by token)
 *   GET    /:orgId/members                   list members
 *   POST   /:orgId/invitations               invite a member
 *   PATCH  /:orgId/members/:membershipId     change a member's role
 *   DELETE /:orgId/members/:membershipId     remove a member
 *   GET    /:orgId/workspaces                list workspaces
 *   POST   /:orgId/workspaces                create a workspace
 */
import { Router, type Request, type Response } from 'express';
import { validateBody } from '../middleware/validate';
import { AppError, unauthorized } from '../middleware/error';
import type { OrgRepository } from './types';
import {
  OrgError,
  type OrgErrorCode,
  acceptInvite,
  changeRole,
  createOrganization,
  createWorkspace,
  deleteWorkspace,
  getOrganization,
  inviteMember,
  listMembers,
  listUserOrganizations,
  listWorkspaces,
  removeMember,
  updateOrganization,
  updateWorkspace,
} from './service';
import {
  AcceptInviteBody,
  ChangeRoleBody,
  CreateOrgBody,
  CreateWorkspaceBody,
  InviteBody,
  UpdateOrgBody,
  UpdateWorkspaceBody,
} from './schemas';

const STATUS: Record<OrgErrorCode, number> = {
  conflict: 409,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  expired: 410,
};

/** Translate a thrown OrgError into the app's HTTP error; re-throw anything else. */
function toHttp(err: unknown): never {
  if (err instanceof OrgError) throw new AppError(STATUS[err.code], `org_${err.code}`, err.message);
  throw err;
}

function actorId(req: Request): string {
  if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
  return req.userId;
}
function actorEmail(req: Request): string {
  if (!req.userEmail) throw unauthorized('unauthorized', 'Authentication required.');
  return req.userEmail;
}

/** Wrap an async handler so OrgErrors become HTTP errors (surfaced via errorHandler). */
type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const h =
  (fn: AsyncHandler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      toHttp(err);
    }
  };

export function createOrganizationsRouter(repo: OrgRepository): Router {
  const router = Router();

  router.post(
    '/',
    validateBody(CreateOrgBody),
    h(async (req, res) => {
      const result = await createOrganization(repo, {
        name: req.body.name,
        slug: req.body.slug,
        ownerUserId: actorId(req),
      });
      res.status(201).json(result);
    }),
  );

  router.get(
    '/',
    h(async (req, res) => {
      const organizations = await listUserOrganizations(repo, actorId(req));
      res.json({ organizations });
    }),
  );

  router.post(
    '/accept-invite',
    validateBody(AcceptInviteBody),
    h(async (req, res) => {
      const membership = await acceptInvite(repo, {
        token: req.body.token,
        userId: actorId(req),
        userEmail: actorEmail(req),
      });
      res.json({ membership });
    }),
  );

  router.get(
    '/:orgId',
    h(async (req, res) => {
      const organization = await getOrganization(repo, req.params.orgId, actorId(req));
      res.json({ organization });
    }),
  );

  router.patch(
    '/:orgId',
    validateBody(UpdateOrgBody),
    h(async (req, res) => {
      const organization = await updateOrganization(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        name: req.body.name,
      });
      res.json({ organization });
    }),
  );

  router.get(
    '/:orgId/members',
    h(async (req, res) => {
      const members = await listMembers(repo, req.params.orgId, actorId(req));
      res.json({ members });
    }),
  );

  router.post(
    '/:orgId/invitations',
    validateBody(InviteBody),
    h(async (req, res) => {
      const result = await inviteMember(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        email: req.body.email,
        role: req.body.role,
      });
      res.status(201).json(result);
    }),
  );

  router.patch(
    '/:orgId/members/:membershipId',
    validateBody(ChangeRoleBody),
    h(async (req, res) => {
      const membership = await changeRole(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        membershipId: req.params.membershipId,
        role: req.body.role,
      });
      res.json({ membership });
    }),
  );

  router.delete(
    '/:orgId/members/:membershipId',
    h(async (req, res) => {
      await removeMember(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        membershipId: req.params.membershipId,
      });
      res.status(204).end();
    }),
  );

  router.get(
    '/:orgId/workspaces',
    h(async (req, res) => {
      const workspaces = await listWorkspaces(repo, req.params.orgId, actorId(req));
      res.json({ workspaces });
    }),
  );

  router.post(
    '/:orgId/workspaces',
    validateBody(CreateWorkspaceBody),
    h(async (req, res) => {
      const workspace = await createWorkspace(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        name: req.body.name,
      });
      res.status(201).json({ workspace });
    }),
  );

  router.patch(
    '/:orgId/workspaces/:workspaceId',
    validateBody(UpdateWorkspaceBody),
    h(async (req, res) => {
      const workspace = await updateWorkspace(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        workspaceId: req.params.workspaceId,
        name: req.body.name,
      });
      res.json({ workspace });
    }),
  );

  router.delete(
    '/:orgId/workspaces/:workspaceId',
    h(async (req, res) => {
      await deleteWorkspace(repo, {
        orgId: req.params.orgId,
        actorUserId: actorId(req),
        workspaceId: req.params.workspaceId,
      });
      res.status(204).end();
    }),
  );

  return router;
}
