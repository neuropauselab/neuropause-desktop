import { loadEnv } from '../../config/env';
import { postForm, type OAuthProvider, type ProviderProfile, type ProviderTokens } from './types';

function base() {
  const env = loadEnv();
  return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0`;
}

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

export const microsoftProvider: OAuthProvider = {
  id: 'microsoft',
  usesFormPost: false,

  isEnabled() {
    const env = loadEnv();
    return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
  },

  authorizeUrl({ state, redirectUri }) {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: 'openid email profile offline_access User.Read',
      state,
    });
    return `${base()}/authorize?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const env = loadEnv();
    const data = await postForm<{ access_token: string; id_token?: string }>(`${base()}/token`, {
      client_id: env.MICROSOFT_CLIENT_ID!,
      client_secret: env.MICROSOFT_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: 'openid email profile offline_access User.Read',
    });
    return { accessToken: data.access_token, idToken: data.id_token };
  },

  async fetchProfile(tokens: ProviderTokens): Promise<ProviderProfile> {
    const res = await fetch(GRAPH_ME, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Microsoft Graph /me failed: ${res.status}`);
    const p = (await res.json()) as {
      id: string;
      displayName?: string;
      mail?: string | null;
      userPrincipalName?: string;
    };
    return {
      providerUserId: p.id,
      email: p.mail ?? p.userPrincipalName ?? null,
      displayName: p.displayName ?? null,
      avatarUrl: null,
    };
  },
};
