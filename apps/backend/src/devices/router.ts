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
import { ChallengeRequestBody, HeartbeatBody, OrgScopeBody, RegisterDeviceBody } from './schemas';
import {
  consumeChallenge,
  enrollmentKeyDecision,
  issueChallenge,
  verifyDeviceSignature,
} from './challenge';

const STATUS: Record<DeviceErrorCode, number> = {
  forbidden: 403,
  revoked: 403,
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

  // Issue a challenge nonce for device proof-of-possession.
  router.post(
    '/challenge',
    validateBody(ChallengeRequestBody),
    h(async (req, res) => {
      actorId(req); // must be authenticated
      const nonce = await issueChallenge(req.body.deviceId);
      res.json({ challenge: nonce });
    }),
  );

  router.post(
    '/',
    validateBody(RegisterDeviceBody),
    h(async (req, res) => {
      // Verify proof-of-possession: the device must sign a server-issued
      // challenge with its Ed25519 private key.
      const nonceValid = await consumeChallenge(req.body.challengeNonce, req.body.deviceId);
      if (!nonceValid) {
        throw badRequest('invalid', 'Challenge nonce is invalid or expired. Request a new challenge.');
      }
      const sigValid = verifyDeviceSignature(
        req.body.publicKey,
        req.body.challengeSignature,
        req.body.challengeNonce,
      );
      if (!sigValid) {
        throw badRequest('invalid', 'Device signature verification failed.');
      }

      // NP-RELEASE-044 §4 — bind to the ENROLLED key, not merely a supplied
      // one: an already-enrolled device must present its enrolled key (the
      // signature above then proves possession of that credential). A legacy
      // row without a key takes the TOFU re-enrollment path. See
      // enrollmentKeyDecision() for the protocol statement.
      const existing = await deps.repo.get(req.body.orgId, req.body.deviceId);
      if (enrollmentKeyDecision(existing?.publicKey, req.body.publicKey) === 'mismatch') {
        throw new AppError(
          403,
          'device_key_mismatch',
          'This device is enrolled with a different key. Key rotation requires an owner/admin to remove the device, then re-enroll.',
        );
      }

      const device = await registerDevice(deps, {
        orgId: req.body.orgId,
        deviceId: req.body.deviceId,
        userId: actorId(req),
        name: req.body.name,
        platform: req.body.platform,
        os: req.body.os,
        arch: req.body.arch,
        appVersion: req.body.appVersion,
        publicKey: req.body.publicKey,
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
