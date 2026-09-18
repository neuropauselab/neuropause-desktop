/**
 * Account HTTP endpoints (mounted at /auth), wiring the verification,
 * password-reset, data export, and account deletion flows.
 *
 * Routes:
 *   POST /auth/request-verification    (authenticated) email the current user a link
 *   POST /auth/verify-email            confirm a verification token
 *   POST /auth/request-password-reset  email a reset link (never reveals if email exists)
 *   POST /auth/reset-password          set a new password with a reset token
 *   GET  /auth/export                  (authenticated) export the user's data
 *   POST /auth/delete-account          (authenticated) request account deletion
 *   POST /auth/confirm-delete-account  (authenticated) confirm + execute deletion
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';
import { AppError, unauthorized } from '../middleware/error';
import {
  AuthAccountError,
  type AuthAccountDeps,
  confirmEmailVerification,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
} from './accountService';
import { exportUserData, requestAccountDeletion, confirmAccountDeletion } from './accountManagement';

const VerifyEmailBody = z.object({ token: z.string().min(1) });
const RequestResetBody = z.object({ email: z.string().trim().email() });
const ResetPasswordBody = z.object({ token: z.string().min(1), password: z.string().min(1) });
const DeleteAccountBody = z.object({ reason: z.string().max(500).optional() });
const ConfirmDeleteBody = z.object({ requestId: z.string().uuid() });

/** Map a thrown AuthAccountError to the app's HTTP error; re-throw anything else. */
function toHttp(err: unknown): never {
  if (err instanceof AuthAccountError) throw new AppError(400, `auth_${err.code}`, err.message);
  throw err;
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

export function createAccountRouter(deps: AuthAccountDeps): Router {
  const router = Router();

  router.post(
    '/request-verification',
    h(async (req, res) => {
      if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
      await requestEmailVerification(deps, req.userId);
      res.status(202).json({ status: 'sent' });
    }),
  );

  router.post(
    '/verify-email',
    validateBody(VerifyEmailBody),
    h(async (req, res) => {
      await confirmEmailVerification(deps, req.body.token);
      res.json({ verified: true });
    }),
  );

  router.post(
    '/request-password-reset',
    validateBody(RequestResetBody),
    h(async (req, res) => {
      await requestPasswordReset(deps, req.body.email);
      // Always 202, regardless of whether the email is registered.
      res.status(202).json({ status: 'sent' });
    }),
  );

  router.post(
    '/reset-password',
    validateBody(ResetPasswordBody),
    h(async (req, res) => {
      await resetPassword(deps, req.body.token, req.body.password);
      res.json({ reset: true });
    }),
  );

  // ── Data Export (authenticated) ─────────────────────────────────────────
  router.get(
    '/export',
    h(async (req, res) => {
      if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
      const data = await exportUserData(req.userId);
      res.json({ export: data, exportedAt: new Date().toISOString() });
    }),
  );

  // ── Account Deletion (authenticated, two-step) ────────────────────────
  router.post(
    '/delete-account',
    validateBody(DeleteAccountBody),
    h(async (req, res) => {
      if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
      const result = await requestAccountDeletion(req.userId, req.body.reason);
      res.json({ deletion: result });
    }),
  );

  router.post(
    '/confirm-delete-account',
    validateBody(ConfirmDeleteBody),
    h(async (req, res) => {
      if (!req.userId) throw unauthorized('unauthorized', 'Authentication required.');
      const result = await confirmAccountDeletion(req.userId, req.body.requestId);
      if (!result.executed) {
        throw new AppError(400, 'auth_invalid', 'Deletion request not found or already processed.');
      }
      res.json({ deleted: true });
    }),
  );

  return router;
}
