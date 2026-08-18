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
import type { AuthErrorCause, AuthStatus, AuthProviderId, TokenPair, User } from '@neuropause/shared';
import { config } from '../config';
import { createLogger } from '../logger';
import { secureStore } from '../security/secureStore';
import { backendClient, BackendError } from './backendClient';
import { startLoopbackServer } from './loopbackServer';
import { localPrincipalStore } from './localPrincipalStore';

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

/**
 * P13C — O-4. The failure CLASS, so the renderer never has to match on message
 * text to decide whether the F-7 notice has already explained the situation.
 *
 * A string comparison here would be exactly the kind of fragility this program
 * keeps finding: today's `not.toContain('http')` matched `http_error`.
 */
function causeFor(err: unknown): AuthErrorCause {
  if (err instanceof BackendError) {
    return err.code === 'network_error' ? 'unreachable' : 'rejected';
  }
  return 'unknown';
}

/** Every error status carries both, so no caller can set one without the other. */
function errorStatus(err: unknown): AuthStatus {
  return { state: 'error', message: messageFor(err), cause: causeFor(err) };
}

class AuthService extends EventEmitter {
  private status: AuthStatus = { state: 'unauthenticated' };
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  /**
   * P13C ROUND 33 — SINGLE-FLIGHT REFRESH.
   *
   * Refresh tokens rotate on every use and the backend treats a re-sent
   * (already-consumed) token as theft: it revokes EVERY session for the user
   * (`refresh_reused`). Six independent consumers call
   * `getValidAccessToken()` per request, and one screen fires several
   * concurrently — two calls that both observe an expired access token would
   * both POST the same stored refresh token, and the second one burned the
   * whole chain, deterministically, once per token lifetime. All concurrent
   * callers now share one in-flight refresh.
   */
  private refreshInFlight: Promise<string | null> | null = null;

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
   * Enter device-local mode (S17 local-first). Loads-or-creates the stable
   * LocalPrincipal from the local profile (id persisted → stable across
   * restarts, FG-6 condition 2 / pin 3) and flips status to `local`. Holds no
   * token, so cloud clients keep failing closed; enterprise RBAC + tenancy
   * resolve locally. Idempotent.
   */
  async enterLocalMode(): Promise<AuthStatus> {
    const principal = await localPrincipalStore.loadOrCreate();
    log.info('Entering device-local mode (no cloud account)');
    return this.setStatus({ state: 'local', principal });
  }

  /**
   * Attempts to restore a session on launch using the stored refresh token.
   * Rotation means a successful refresh yields (and persists) a new token.
   */
  async restoreSession(): Promise<void> {
    const stored = await secureStore.getRefreshToken();
    if (!stored) {
      // S17 local-first (FG-6): no stored account → the device-local principal,
      // NOT the sign-in wall. Signing in later (the affordance) transitions
      // local → authenticating → authenticated (DECISIONS D-11).
      await this.enterLocalMode();
      return;
    }
    // The desktop app and backend start together (npm run dev), so at boot the
    // backend may not be reachable for a moment. A transient network failure must
    // NOT log the user out — only a genuine auth rejection (invalid/expired
    // credentials) should clear the session. Retry network failures with backoff.
    //
    // P13C ROUND 33 — NEVER RE-SEND A CONSUMED REFRESH TOKEN. Refresh tokens
    // rotate on use, and the backend treats a re-sent one as theft: it revokes
    // every session for the user (`refresh_reused`). The old loop captured the
    // stored token once and re-sent it on every retry — so when the REFRESH
    // succeeded but the `me()` call that followed hit a network blip (the exact
    // boot race this retry exists for), the second attempt burned the whole
    // chain and a flaky boot signed the user out on every device. The refresh
    // now happens at most once; retries after a successful rotation re-attempt
    // only the `me()` read with the already-valid access token.
    const maxAttempts = 5;
    let tokens: TokenPair | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (tokens === null) {
          tokens = (await backendClient.refresh(stored)).tokens;
          await this.applyTokens(tokens);
        }
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
      return this.setStatus(errorStatus(err));
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
      return this.setStatus(errorStatus(err));
    }
  }

  async registerEmail(email: string, password: string): Promise<AuthStatus> {
    this.setStatus({ state: 'authenticating', provider: 'email' });
    try {
      const auth = await backendClient.registerEmail(email, password);
      return await this.applyAuthResult(auth);
    } catch (err) {
      return this.setStatus(errorStatus(err));
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

    // Single-flight: concurrent callers share one refresh instead of racing
    // the same rotating token into the backend's reuse detector.
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshAccessToken();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await secureStore.getRefreshToken();
    if (!refreshToken) return null;
    try {
      const { tokens } = await backendClient.refresh(refreshToken);
      await this.applyTokens(tokens);
      return tokens.accessToken;
    } catch (err) {
      /**
       * P13C ROUND 33 — A TRANSIENT NETWORK ERROR MUST NOT DESTROY THE VAULT.
       *
       * This catch used to `clearSession()` for EVERY failure class, so ~14
       * minutes after sign-in (access-token TTL), the first authenticated
       * call made while offline — sleep, VPN drop, backend restart; often
       * from an unattended background loop — deleted a still-valid refresh
       * token and signed the user out. `restoreSession` was written to make
       * exactly this network-vs-rejection distinction; apply the same rule
       * here: keep the credentials on a network failure and let a later call
       * (or the next launch) retry. Only a genuine rejection clears.
       */
      const isNetwork = err instanceof BackendError && err.status === 0;
      if (isNetwork) {
        log.warn('Token refresh failed on a network error; keeping credentials', messageFor(err));
        return null;
      }
      log.warn('Token refresh rejected; clearing credentials', messageFor(err));
      await this.clearSession();
      this.setStatus({ state: 'unauthenticated' });
      return null;
    }
  }
}

export const authService = new AuthService();
