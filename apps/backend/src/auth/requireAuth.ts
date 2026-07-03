import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './jwt';
import { unauthorized } from '../middleware/error';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    userEmail?: string;
  }
}

/** Verifies the Bearer access token and attaches the user id to the request. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('missing_token', 'Missing bearer token'));
    return;
  }
  try {
    const claims = verifyAccessToken(header.slice('Bearer '.length));
    req.userId = claims.sub;
    req.userEmail = claims.email;
    next();
  } catch {
    next(unauthorized('invalid_token', 'Invalid or expired token'));
  }
}
