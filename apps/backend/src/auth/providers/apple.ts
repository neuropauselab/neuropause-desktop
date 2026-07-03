import jwt from 'jsonwebtoken';
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
 *  - HARDENING TODO: verify the id_token signature against Apple's JWKS
 *    (https://appleid.apple.com/auth/keys) before trusting its claims. We decode
 *    it here; signature verification is wired in a later hardening pass.
 */

const AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const TOKEN = 'https://appleid.apple.com/auth/token';

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
    const decoded = jwt.decode(tokens.idToken) as { sub?: string; email?: string } | null;
    if (!decoded?.sub) throw new Error('Apple id_token missing subject');
    return {
      providerUserId: decoded.sub,
      email: decoded.email ?? null,
      displayName: null,
      avatarUrl: null,
    };
  },
};
