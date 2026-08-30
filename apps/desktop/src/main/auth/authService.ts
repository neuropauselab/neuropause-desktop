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
  /**
   * P13C GATE 2 — SINGLE-FLIGHT RESTORE.
   *
   * `restoreSession` refreshes the rotating token, and a re-restore can now be
   * TRIGGERED at runtime (when the backend becomes reachable again), not only
   * once at boot. Two overlapping restores would both read the same stored
   * token and both POST it — the second is a consumed-token reuse, which the
   * backend punishes by revoking every session on every device (`refresh_reused`,
   * the same catastrophe the round-33 single-flight refresh exists to prevent).
   * All restore entry points (boot + reachability retry) share one in-flight run.
   */
  private restoreInFlight: Promise<void> | null = null;

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
   * Single-flighted so it can never overlap itself (or a reachability retry) and
   * re-send the rotating token. Rotation means a successful refresh yields (and
   * persists) a new token.
   */
  async restoreSession(): Promise<void> {
    if (this.restoreInFlight) return this.restoreInFlight;
    this.restoreInFlight = this.doRestoreSession();
    try {
      await this.restoreInFlight;
    } finally {
      this.restoreInFlight = null;
    }
  }

  /**
   * Re-attempt a cloud restore after the backend becomes reachable again.
   *
   * P13C GATE 2 — RE-RESTORE ON REACHABILITY RECOVERY. A user who launched
   * offline degraded to device-local mode (the network branch of
   * `doRestoreSession` below) with a valid refresh token still in the vault.
   * Nothing used to re-attempt the cloud restore when connectivity returned, so
   * they stayed local for the whole session. This is wired to the
   * backend-reachable edge (`runtimeTelemetry` → `backendReachabilityHub`) and
   * acts ONLY from the degraded state:
   *
   *   - a NO-OP unless status is `local` AND a refresh token is stored, so it
   *     can never disturb an authenticated session, a deliberately logged-out
   *     user, or a genuine local-first user — and never contacts the backend in
   *     those cases;
   *   - single-flighted with `restoreSession`, so it can never re-send the
   *     rotating token;
   *   - CRUCIALLY, unlike boot restore, a genuine rejection here does NOT wall:
   *     the user is comfortably working locally, so an invalid token is cleared
   *     but the app STAYS local (a background probe must never bump a working
   *     user to an escape-less sign-in screen). Success promotes local →
   *     authenticated.
   */
  async retryCloudRestore(): Promise<void> {
    if (this.status.state !== 'local') return;
    if (this.restoreInFlight) return this.restoreInFlight;
    this.restoreInFlight = this.doRetryCloudRestore();
    try {
      await this.restoreInFlight;
    } finally {
      this.restoreInFlight = null;
    }
  }

  private async doRetryCloudRestore(): Promise<void> {
    const stored = await secureStore.getRefreshToken();
    if (!stored) return; // genuine local-first: nothing to restore, no backend contact
    try {
      const { tokens } = await backendClient.refresh(stored);
      await this.applyTokens(tokens);
      const { user } = await backendClient.me(tokens.accessToken);
      this.setStatus({
        state: 'authenticated',
        session: { user, accessTokenExpiresAt: tokens.accessTokenExpiresAt },
      });
      log.info('Re-restored cloud session after the backend became reachable');
    } catch (err) {
      const isNetwork = err instanceof BackendError && err.status === 0;
      if (isNetwork) {
        // The backend went away again mid-restore: stay local, keep the token,
        // and wait for the next reachable edge. No status change.
        log.warn('Cloud re-restore hit a network error; staying in local mode', messageFor(err));
        return;
      }
      // Genuine rejection: the stored token is invalid/revoked. Clear it so a
      // dead token is not re-tried on every future edge — but STAY local. A
      // background reachability probe must never convert a working local session
      // into an escape-less sign-in wall; the user reconnects via the affordance.
      log.warn(
        'Cloud re-restore rejected; clearing the invalid token and staying local',
        messageFor(err),
      );
      await this.clearSession();
      await this.enterLocalMode();
    }
  }

  private async doRestoreSession(): Promise<void> {
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
          //
          // GATE 1 (Program 13C) — DEGRADE TO LOCAL, NOT TO A WALL. Setting
          // `unauthenticated` here dropped a returning user onto `LoginScreen`,
          // and App.tsx renders that fallback with NO `onDismiss`, so there was
          // no "Keep working locally" escape — an offline launch became a
          // backend-dependent dead end. S17's whole premise is that the absence
          // of a reachable cloud account yields the device-local principal, not
          // the sign-in wall. A valid-but-unreachable session is exactly that
          // case: cloud is absent right now. So enter local mode, which grants
          // NO cloud access (a distinct `@device.invalid` principal) and asserts
          // no authenticated session — fail-closed is preserved — while leaving
          // the stored refresh token untouched so a later online launch, or the
          // in-shell "connect an account" affordance, restores the cloud session.
          log.warn(
            'Backend still unreachable after retries; entering device-local mode and keeping credentials for a later attempt',
            messageFor(err),
          );
          await this.enterLocalMode();
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
