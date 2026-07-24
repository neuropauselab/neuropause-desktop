import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { loadEnv } from '../../config/env';
import { postForm, type OAuthProvider, type ProviderProfile, type ProviderTokens } from './types';

/**
 * Apple Sign In notes (see docs/AUTHENTICATION.md):
 *  - Requires an Apple Developer account: a Services ID (used as client_id), a
 *    Team ID, a Key ID, and a downloaded .p8 private key.
 *  - The "client secret" is NOT a static value — it is a short-lived ES256 JWT
 *    we sign on demand with the .p8 key. We generate it below.
 *  - Apple posts its callback as form_post (handled by the auth router) and
 *    returns the user's name only on first authorization. Identity claims come
 *    from the returned id_token.
 *  - The id_token signature IS verified against Apple's JWKS
 *    (https://appleid.apple.com/auth/keys), and its issuer/audience/expiry are
 *    checked, before any claim is trusted. See `verifyAppleIdToken` below.
 */

const AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const TOKEN = 'https://appleid.apple.com/auth/token';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

/**
 * Apple's public signing keys, fetched and cached from Apple's JWKS endpoint.
 * `createRemoteJWKSet` handles caching, cooldown, and key rotation (it re-fetches
 * when a token references an unseen `kid`). Created lazily so importing this
 * module never performs network I/O.
 */
let appleJwks: JWTVerifyGetKey | null = null;
function getAppleJwks(): JWTVerifyGetKey {
  if (!appleJwks) appleJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return appleJwks;
}

export interface VerifiedAppleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Verifies an Apple `id_token`: RS256 signature against Apple's JWKS, issuer
 * `https://appleid.apple.com`, audience equal to our Services ID (client_id),
 * and expiry. Throws if any check fails. `keySet` is injectable so the
 * verification logic can be exercised against a local JWKS in tests; production
 * always uses Apple's real remote key set.
 */
export async function verifyAppleIdToken(
  idToken: string,
  opts: { clientId: string; keySet?: JWTVerifyGetKey },
): Promise<VerifiedAppleIdentity> {
  const keySet = opts.keySet ?? getAppleJwks();
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keySet, {
      // Pin the accepted algorithm: Apple signs id_tokens with RS256. Pinning
      // rejects `alg: none` and any algorithm-confusion attempt outright, rather
      // than relying only on the JWKS key type to exclude them (defense in depth,
      // and consistent with the HS256 pin on the access-token path in jwt.ts).
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: opts.clientId,
    }));
  } catch (err) {
    throw new Error(`Apple id_token verification failed: ${(err as Error).message}`);
  }
  if (!payload.sub) throw new Error('Apple id_token missing subject');
  const email = typeof payload.email === 'string' ? payload.email : null;
  // Apple sends email_verified as the string "true"/"false" or a boolean.
  const ev = (payload as Record<string, unknown>).email_verified;
  const emailVerified = ev === true || ev === 'true';
  return { sub: payload.sub, email, emailVerified };
}

function generateClientSecret(): string {
  const env = loadEnv();
  const privateKey = (env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 60 * 10,
      aud: 'https://appleid.apple.com',
      sub: env.APPLE_CLIENT_ID,
    },
    privateKey,
    { algorithm: 'ES256', keyid: env.APPLE_KEY_ID },
  );
}

export const appleProvider: OAuthProvider = {
  id: 'apple',
  usesFormPost: true,

  isEnabled() {
    const env = loadEnv();
    return Boolean(
      env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY,
    );
  },

  authorizeUrl({ state, redirectUri }) {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.APPLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const env = loadEnv();
    const data = await postForm<{ access_token: string; id_token: string }>(TOKEN, {
      client_id: env.APPLE_CLIENT_ID!,
      client_secret: generateClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    return { accessToken: data.access_token, idToken: data.id_token };
  },

  async fetchProfile(tokens: ProviderTokens): Promise<ProviderProfile> {
    if (!tokens.idToken) throw new Error('Apple did not return an id_token');
    const env = loadEnv();
    if (!env.APPLE_CLIENT_ID) throw new Error('APPLE_CLIENT_ID is not configured');
    // Verify signature (Apple JWKS) + issuer + audience + expiry before trusting claims.
    const identity = await verifyAppleIdToken(tokens.idToken, { clientId: env.APPLE_CLIENT_ID });
    return {
      providerUserId: identity.sub,
      email: identity.email,
      displayName: null,
      avatarUrl: null,
    };
  },
};
