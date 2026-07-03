import type { AuthProviderId, User } from './user';

/**
 * The pair of tokens the desktop client uses to talk to the backend.
 * The access token is short-lived and held in memory only.
 * The refresh token is long-lived and stored encrypted in the OS keychain.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token, epoch milliseconds. */
  accessTokenExpiresAt: number;
}

export interface Session {
  user: User;
  accessTokenExpiresAt: number;
}

export type AuthStatus =
  | { state: 'unauthenticated' }
  | { state: 'authenticating'; provider: AuthProviderId }
  | { state: 'authenticated'; session: Session }
  | { state: 'error'; message: string };

export interface EmailCredentials {
  email: string;
  password: string;
}
