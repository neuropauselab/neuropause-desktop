/**
 * Devices HTTP API. Auth-agnostic like the organizations router: reads the caller
 * from req.userId (populated by requireAuth where mounted), maps DeviceError codes
 * to HTTP, and is fully testable with an injected service dep. Membership is
 * enforced in the service via the injected getMemberRole.
 *
 * Routes (mounted at /devices):
 *   POST   /                          register (upsert) the current device
 *   GET    /?orgId=...                list an org's devices
 *   POST   /:deviceId/heartbeat       update last-seen + version
 *   POST   /:deviceId/revoke          revoke a device (owner/admin)
 *   DELETE /:deviceId?orgId=...       remove a device (owner/admin)
 */
import { Router, type Request, type Response } from 'express';
import { validateBody } from '../middleware/validate';
import { AppError, unauthorized, badRequest } from '../middleware/error';
import { DeviceError, type DeviceErrorCode } from './types';
import {
  heartbeatDevice,
  listDevices,
  registerDevice,
  removeDevice,
  revokeDevice,
  type DeviceServiceDeps,
} from './service';
import { HeartbeatBody, OrgScopeBody, RegisterDeviceBody } from './schemas';

const STATUS: Record<DeviceErrorCode, number> = {
  forbidden: 403,
  not_found: 404,
  invalid: 400,
};

function toHttp(err: unknown): never {
  if (err instanceof DeviceError) {
    throw new AppError(STATUS[err.code], `device_${err.code}`, err.message);
  }
  throw err;
}

function actorId(req: Request): string {
  if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
  return req.userId;
}

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

export function createDevicesRouter(deps: DeviceServiceDeps): Router {
  const router = Router();

  router.post(
    '/',
    validateBody(RegisterDeviceBody),
    h(async (req, res) => {
      const device = await registerDevice(deps, {
        orgId: req.body.orgId,
        deviceId: req.body.deviceId,
        userId: actorId(req),
        name: req.body.name,
        platform: req.body.platform,
        os: req.body.os,
        arch: req.body.arch,
        appVersion: req.body.appVersion,
      });
      res.status(201).json({ device });
    }),
  );

  router.get(
    '/',
    h(async (req, res) => {
      const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
      if (!orgId) throw badRequest('invalid', 'orgId query parameter is required.');
      const devices = await listDevices(deps, orgId, actorId(req));
      res.json({ devices });
    }),
  );

  router.post(
    '/:deviceId/heartbeat',
    validateBody(HeartbeatBody),
    h(async (req, res) => {
      const device = await heartbeatDevice(deps, {
        orgId: req.body.orgId,
        deviceId: req.params.deviceId,
        userId: actorId(req),
        appVersion: req.body.appVersion,
      });
      res.json({ device });
    }),
  );

  router.post(
    '/:deviceId/revoke',
    validateBody(OrgScopeBody),
    h(async (req, res) => {
      const device = await revokeDevice(deps, {
        orgId: req.body.orgId,
        deviceId: req.params.deviceId,
        userId: actorId(req),
      });
      res.json({ device });
    }),
  );

  router.delete(
    '/:deviceId',
    h(async (req, res) => {
      const orgId = typeof req.query.orgId === 'string' ? req.query.orgId : '';
      if (!orgId) throw badRequest('invalid', 'orgId query parameter is required.');
      await removeDevice(deps, { orgId, deviceId: req.params.deviceId, userId: actorId(req) });
      res.status(204).end();
    }),
  );

  return router;
}
