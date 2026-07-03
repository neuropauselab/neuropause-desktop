import { loadEnv } from '../../config/env';
import { postForm, type OAuthProvider, type ProviderProfile, type ProviderTokens } from './types';

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';
const USER = 'https://api.github.com/user';
const EMAILS = 'https://api.github.com/user/emails';
const UA = 'NeuroPause-Desktop';

export const githubProvider: OAuthProvider = {
  id: 'github',
  usesFormPost: false,

  isEnabled() {
    const env = loadEnv();
    return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  },

  authorizeUrl({ state, redirectUri }) {
    const env = loadEnv();
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
      allow_signup: 'true',
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const env = loadEnv();
    const data = await postForm<{ access_token: string; token_type?: string }>(TOKEN, {
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    });
    return { accessToken: data.access_token, tokenType: data.token_type };
  },

  async fetchProfile(tokens: ProviderTokens): Promise<ProviderProfile> {
    const headers = {
      authorization: `Bearer ${tokens.accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
    };
    const userRes = await fetch(USER, { headers });
    if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
    const u = (await userRes.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string | null;
      email: string | null;
    };

    let email = u.email;
    if (!email) {
      const emailRes = await fetch(EMAILS, { headers });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        email = emails.find((e) => e.primary && e.verified)?.email ?? null;
      }
    }

    return {
      providerUserId: String(u.id),
      email,
      displayName: u.name ?? u.login,
      avatarUrl: u.avatar_url,
    };
  },
};
