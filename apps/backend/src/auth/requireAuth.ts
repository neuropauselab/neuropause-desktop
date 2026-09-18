import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, checkAccessTokenRevocation } from './jwt';
import { AppError, unauthorized } from '../middleware/error';
import { loadEnv } from '../config/env';
import { logger } from '../config/logger';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    userEmail?: string;
  }
}

/**
 * Verifies the Bearer access token, checks revocation, and attaches the user
 * id to the request.
 *
 * NP-RELEASE-044 §5 / DECISION-4 — FAIL CLOSED: when the cross-process
 * revocation authority (Redis) is unavailable, the protected path answers a
 * deterministic 503 rather than silently accepting a token that another
 * process may have revoked. Same-process revocations remain enforced from the
 * in-process cache. No request waits on a reconnecting Redis (status guard).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('missing_token', 'Missing bearer token'));
    return;
  }
  let claims: { sub: string; email: string };
  let rawToken: string;
  try {
    rawToken = header.slice('Bearer '.length);
    claims = verifyAccessToken(rawToken);
  } catch {
    next(unauthorized('invalid_token', 'Invalid or expired token'));
    return;
  }

  const revocation = await checkAccessTokenRevocation(rawToken, claims.sub);
  if (revocation === 'revoked') {
    next(unauthorized('token_revoked', 'Token has been revoked'));
    return;
  }
  if (revocation === 'authority_unavailable') {
    if (loadEnv().REVOCATION_FAIL_MODE === 'open') {
      // Explicit availability-first opt-in (see env.ts). Logged every time so
      // an accidental production 'open' is visible, never silent.
      logger.warn(
        { userId: claims.sub },
        'REVOCATION_FAIL_MODE=open — proceeding without cross-process revocation check',
      );
    } else {
      next(
        new AppError(
          503,
          'revocation_unavailable',
          'Token revocation status cannot be verified right now. Please retry.',
        ),
      );
      return;
    }
  }

  req.userId = claims.sub;
  req.userEmail = claims.email;
  next();
}
