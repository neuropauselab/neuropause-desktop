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
  /**
   * P13C — O-4. `cause` exists so the UI can tell "the service is unreachable"
   * apart from "those credentials are wrong" WITHOUT matching on message text.
   * The login screen suppresses its own banner for `unreachable`, because the
   * F-7 reachability notice above it already states that cause — and states it
   * better, since the auth message asks the reader "Is it running?", which is a
   * question a founder who installed an installer cannot act on.
   *
   * Optional and additive: an omitted `cause` behaves exactly as before.
   */
  | { state: 'error'; message: string; cause?: AuthErrorCause };

/**
 * Why authentication failed, at the coarseness a UI may act on.
 *
 *   - `unreachable`  — the service could not be contacted at all
 *   - `rejected`     — the service answered and refused
 *   - `unknown`      — anything else; render the message as-is
 */
export type AuthErrorCause = 'unreachable' | 'rejected' | 'unknown';

export interface EmailCredentials {
  email: string;
  password: string;
}
