import { loadEnv } from '../../config/env';
import { postForm, type OAuthProvider, type ProviderProfile, type ProviderTokens } from './types';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';

export const googleProvider: OAuthProvider = {
  id: 'google',
  usesFormPost: false,

  isEnabled() {
    const env = loadEnv();
    return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  },

  authorizeUrl({ state, redirectUri }) {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const env = loadEnv();
    const data = await postForm<{ access_token: string; id_token?: string; token_type?: string }>(
      TOKEN,
      {
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      },
    );
    return { accessToken: data.access_token, idToken: data.id_token, tokenType: data.token_type };
  },

  async fetchProfile(tokens: ProviderTokens): Promise<ProviderProfile> {
    const res = await fetch(USERINFO, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
    const p = (await res.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    return {
      providerUserId: p.sub,
      email: p.email_verified ? (p.email ?? null) : null,
      displayName: p.name ?? null,
      avatarUrl: p.picture ?? null,
    };
  },
};
