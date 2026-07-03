import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env';

const env = loadEnv();

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
}

const ISSUER = 'neuropause';
const AUDIENCE = 'neuropause-desktop';

export function signAccessToken(claims: AccessTokenClaims): { token: string; expiresAt: number } {
  const expiresInSeconds = env.JWT_ACCESS_TTL;
  const token = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { token, expiresAt: Date.now() + expiresInSeconds * 1_000 };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload === 'string') throw new Error('Malformed token');
  return { sub: String(payload.sub), email: String(payload.email) };
}
