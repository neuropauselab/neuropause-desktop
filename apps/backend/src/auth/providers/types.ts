import type { OAuthProviderIdSchema } from '@neuropause/shared';
import type { z } from 'zod';

export type OAuthProviderId = z.infer<typeof OAuthProviderIdSchema>;

/** Normalized profile every provider must resolve a successful login to. */
export interface ProviderProfile {
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ProviderTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  tokenType?: string;
}

/**
 * Each provider knows how to build its authorize URL, exchange a code for
 * tokens, and resolve a normalized profile. The backend owns the client
 * secret; the desktop client never sees provider credentials.
 */
export interface OAuthProvider {
  readonly id: OAuthProviderId;
  /** True only when the provider's credentials are configured. */
  isEnabled(): boolean;
  /** Whether the provider posts its callback (Apple) vs. GET redirect. */
  readonly usesFormPost: boolean;
  authorizeUrl(params: { state: string; redirectUri: string }): string;
  exchangeCode(params: { code: string; redirectUri: string }): Promise<ProviderTokens>;
  fetchProfile(tokens: ProviderTokens): Promise<ProviderProfile>;
}

/** Small helper for POSTing form-encoded bodies to token endpoints. */
export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token endpoint ${url} responded ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}
