/**
 * The authentication brain of the desktop app. It lives in the main process,
 * owns all tokens, and exposes a small async surface that the IPC layer calls.
 *
 * Security model:
 *   - The refresh token is persisted encrypted (OS keychain via secureStore).
 *   - The access token is held in memory only and never sent to the renderer.
 *   - The renderer only ever observes an AuthStatus (user + expiry, no tokens).
 *
 * OAuth uses the RFC 8252 native-app pattern: PKCE + a loopback redirect, with
 * the provider's client secret confined to the backend.
 */
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { shell } from 'electron';
import type { AuthStatus, AuthProviderId, TokenPair, User } from '@neuropause/shared';
import { config } from '../config';
import { createLogger } from '../logger';
import { secureStore } from '../security/secureStore';
import { backendClient, BackendError } from './backendClient';
import { startLoopbackServer } from './loopbackServer';

const log = createLogger('auth');

type OAuthProviderId = Exclude<AuthProviderId, 'email'>;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Client-side PKCE pair, computed identically to the backend's verifier. */
function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function messageFor(err: unknown): string {
  if (err instanceof BackendError) {
    if (err.code === 'network_error') {
      return 'Could not reach the NeuroPause backend. Is it running?';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}

class AuthService extends EventEmitter {
  private status: AuthStatus = { state: 'unauthenticated' };
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  /** Current snapshot the renderer can render. */
  getStatus(): AuthStatus {
    return this.status;
  }

  private setStatus(next: AuthStatus): AuthStatus {
    this.status = next;
    this.emit('statusChanged', next);
    return next;
  }

  /** Persists tokens from a successful auth and flips status to authenticated. */
  private async applyAuthResult(result: { user: User; tokens: TokenPair }): Promise<AuthStatus> {
    await this.applyTokens(result.tokens);
    return this.setStatus({
      state: 'authenticated',
      session: { user: result.user, accessTokenExpiresAt: result.tokens.accessTokenExpiresAt },
    });
  }

  private async applyTokens(tokens: TokenPair): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
    // Refresh tokens rotate on every use, so always persist the latest one.
    await secureStore.setRefreshToken(tokens.refreshToken);
  }

  private async clearSession(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    await secureStore.clear();
  }

  /**
   * Attempts to restore a session on launch using the stored refresh token.
   * Rotation means a successful refresh yields (and persists) a new token.
   */
  async restoreSession(): Promise<void> {
    const refreshToken = await secureStore.getRefreshToken();
    if (!refreshToken) {
      this.setStatus({ state: 'unauthenticated' });
      return;
    }
    // The desktop app and backend start together (npm run dev), so at boot the
    // backend may not be reachable for a moment. A transient network failure must
    // NOT log the user out — only a genuine auth rejection (invalid/expired
    // credentials) should clear the session. Retry network failures with backoff.
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { tokens } = await backendClient.refresh(refreshToken);
        await this.applyTokens(tokens);
        const { user } = await backendClient.me(tokens.accessToken);
        this.setStatus({
          state: 'authenticated',
          session: { user, accessTokenExpiresAt: tokens.accessTokenExpiresAt },
        });
        log.info('Restored session from stored credentials', { attempt });
        return;
      } catch (err) {
        const isNetwork = err instanceof BackendError && err.status === 0;
        if (isNetwork && attempt < maxAttempts) {
          log.warn(
            `Backend unreachable during session restore (attempt ${attempt}/${maxAttempts}); retrying`,
            messageFor(err),
          );
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        if (isNetwork) {
          // Still unreachable after retries: keep credentials so a later launch (or
          // reconnect) can restore the session. Do not clear — the session is valid.
          log.warn(
            'Backend still unreachable after retries; keeping credentials for a later attempt',
            messageFor(err),
          );
          this.setStatus({ state: 'unauthenticated' });
          return;
        }
        // Genuine auth failure — the stored session is invalid, so clear it.
        log.warn('Stored session is invalid; clearing credentials', messageFor(err));
        await this.clearSession();
        this.setStatus({ state: 'unauthenticated' });
        return;
      }
    }
  }

  /** Full browser-based OAuth sign-in. Always resolves to a status. */
  async loginOAuth(provider: OAuthProviderId): Promise<AuthStatus> {
    this.setStatus({ state: 'authenticating', provider });
    let loopback: Awaited<ReturnType<typeof startLoopbackServer>> | null = null;

    try {
      const { verifier, challenge } = createPkcePair();
      const desktopState = base64url(randomBytes(24));
      loopback = await startLoopbackServer();

      const startUrl = new URL(`${config.backendUrl}/auth/${provider}/start`);
      startUrl.searchParams.set('redirect_uri', loopback.redirectUri);
      startUrl.searchParams.set('state', desktopState);
      startUrl.searchParams.set('code_challenge', challenge);
      startUrl.searchParams.set('code_challenge_method', 'S256');

      await shell.openExternal(startUrl.toString());

      const result = await loopback.waitForResult(config.oauthTimeoutMs);

      // CSRF defense: the state echoed back must match what we generated.
      if (result.state !== desktopState) {
        throw new Error('State mismatch; sign-in was rejected for your safety');
      }
      if (result.error) throw new Error(`Sign-in failed: ${result.error}`);
      if (!result.code) throw new Error('No authorization code was returned');

      const auth = await backendClient.exchangeOAuthCode(result.code, verifier);
      const status = await this.applyAuthResult(auth);
      log.info('OAuth sign-in succeeded', { provider });
      return status;
    } catch (err) {
      log.error('OAuth sign-in failed', messageFor(err));
      return this.setStatus({ state: 'error', message: messageFor(err) });
    } finally {
      loopback?.close();
    }
  }

  async loginEmail(email: string, password: string): Promise<AuthStatus> {
    this.setStatus({ state: 'authenticating', provider: 'email' });
    try {
      const auth = await backendClient.loginEmail(email, password);
      return await this.applyAuthResult(auth);
    } catch (err) {
      return this.setStatus({ state: 'error', message: messageFor(err) });
    }
  }

  async registerEmail(email: string, password: string): Promise<AuthStatus> {
    this.setStatus({ state: 'authenticating', provider: 'email' });
    try {
      const auth = await backendClient.registerEmail(email, password);
      return await this.applyAuthResult(auth);
    } catch (err) {
      return this.setStatus({ state: 'error', message: messageFor(err) });
    }
  }

  /** Revokes the refresh token server-side (best effort) and clears local state. */
  async logout(): Promise<AuthStatus> {
    const refreshToken = await secureStore.getRefreshToken();
    if (refreshToken) {
      try {
        await backendClient.logout(refreshToken);
      } catch (err) {
        // Logout is best-effort; we clear locally regardless.
        log.warn('Backend logout failed; clearing locally anyway', messageFor(err));
      }
    }
    await this.clearSession();
    return this.setStatus({ state: 'unauthenticated' });
  }

  /**
   * Returns a valid access token, refreshing first if it is missing or about to
   * expire. Reserved for the authenticated API calls that arrive in later
   * phases; exported now so the session plumbing is complete and tested.
   */
  async getValidAccessToken(): Promise<string | null> {
    const fresh =
      this.accessToken && Date.now() < this.accessTokenExpiresAt - config.accessTokenRefreshSkewMs;
    if (fresh) return this.accessToken;

    const refreshToken = await secureStore.getRefreshToken();
    if (!refreshToken) return null;
    try {
      const { tokens } = await backendClient.refresh(refreshToken);
      await this.applyTokens(tokens);
      return tokens.accessToken;
    } catch (err) {
      log.warn('Token refresh failed', messageFor(err));
      await this.clearSession();
      this.setStatus({ state: 'unauthenticated' });
      return null;
    }
  }
}

export const authService = new AuthService();
