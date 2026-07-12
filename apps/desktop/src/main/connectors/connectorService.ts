/**
 * The Connector Service — the runtime brain of NCF.
 *
 * Owns the full account lifecycle (connect → authenticate → refresh → reconnect
 * → sync → disconnect → health check → error recovery), persists account
 * metadata and (encrypted) tokens, derives health, keeps a log feed, and emits
 * `event`s the IPC layer broadcasts to the renderer.
 *
 * Tokens are obtained and refreshed here and vaulted encrypted; no token is ever
 * returned from a public method. `getValidAccessToken` is the single internal
 * accessor the Stage-2 sync adapters will use to talk to providers.
 */
import { EventEmitter } from 'node:events';
import type {
  ConnectedAccount,
  ConnectorActionResult,
  ConnectorConnectResult,
  ConnectorDto,
  ConnectorEvent,
  ConnectorHealth,
  ConnectorLifecyclePhase,
  ConnectorLogEntry,
  ConnectorManifest,
  ConnectorStats,
  ConnectorStatus,
  IntegrationCredentialMeta,
  SyncState,
} from '@neuropause/shared';
import { credentialAuthState } from '@neuropause/shared';
import { createLogger } from '../logger';
import { CONNECTOR_MANIFESTS, MANIFEST_BY_ID } from './manifests';
import { isConfigured, resolveCredentials, setupHintFor } from './credentials';
import { connectorStore } from './connectorStore';
import { connectorVault, type AccountTokens } from './connectorVault';
import { oauthEngine, type OAuthTokens } from './oauthEngine';
import { accountHealth, aggregateHealth, aggregateStatus, latestSync } from './health';
import { shortId } from './pkce';

const log = createLogger('connectors');
const REFRESH_SKEW_MS = 60 * 1000;
/** P4.1 — proactively refresh a token when it will expire within this window (well before the lazy path). */
const PROACTIVE_SKEW_MS = 5 * 60 * 1000;
const LOG_CAP = 500;

const now = (): string => new Date().toISOString();
const isoFromMs = (ms: number | null): string | null => (ms !== null ? new Date(ms).toISOString() : null);

/**
 * The Stage-2 sync engine registers itself here so the connector lifecycle's
 * `sync()` runs real data adapters instead of the verify-only stub. Injected at
 * init to avoid a sync↔connectors import cycle.
 */
export type SyncRunner = (
  connectorId: string,
  accountId: string,
) => Promise<{ ok: boolean; total: number; hadAdapter: boolean; error: string | null }>;

class ConnectorService extends EventEmitter {
  private syncRunner: SyncRunner | null = null;
  private controlGate: ((connectorId: string, accountId: string) => boolean) | null = null;

  /** Wire in the data-sync runner (called once by the sync subsystem at init). */
  setSyncRunner(runner: SyncRunner): void {
    this.syncRunner = runner;
  }

  /**
   * Wire the Runtime Supervisor's suppression check (P4.1): a paused account, or an account whose
   * connector is disabled, skips a manual sync. Injected at init to avoid a supervisor↔service cycle.
   */
  setControlGate(gate: (connectorId: string, accountId: string) => boolean): void {
    this.controlGate = gate;
  }

  private logs: ConnectorLogEntry[] = [];
  /** P4.1 — per-account in-flight token refresh, so concurrent refreshers coalesce onto one call. */
  private readonly refreshInFlight = new Map<string, Promise<string | null>>();

  /** Loads persisted accounts. Call once at startup. */
  async init(): Promise<void> {
    await connectorStore.load();
    log.info('Connector service ready', {
      connectors: CONNECTOR_MANIFESTS.length,
      accounts: connectorStore.all().length,
    });
  }

  /* ───────────────────────── reads ───────────────────────── */

  list(): ConnectorDto[] {
    return CONNECTOR_MANIFESTS.map((m) => this.toDto(m));
  }

  get(connectorId: string): ConnectorDto | null {
    const m = MANIFEST_BY_ID[connectorId];
    return m ? this.toDto(m) : null;
  }

  stats(): ConnectorStats {
    const dtos = this.list();
    const byCategory: Record<string, number> = {};
    let connected = 0;
    let configured = 0;
    let accounts = 0;
    let healthy = 0;
    let degraded = 0;
    let down = 0;
    for (const d of dtos) {
      byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
      if (d.configured) configured += 1;
      if (d.accounts.length > 0) connected += 1;
      accounts += d.accounts.length;
      for (const a of d.accounts) {
        if (a.health === 'healthy') healthy += 1;
        else if (a.health === 'degraded') degraded += 1;
        else if (a.health === 'down') down += 1;
      }
    }
    return { total: dtos.length, configured, connected, accounts, healthy, degraded, down, byCategory };
  }

  logFeed(connectorId?: string): ConnectorLogEntry[] {
    const all = connectorId ? this.logs.filter((l) => l.connectorId === connectorId) : this.logs;
    return [...all].reverse(); // newest first
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  /** Interactive connect: runs the OAuth flow and stores the new account. */
  async connect(connectorId: string): Promise<ConnectorConnectResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    if (!manifest) return this.connectFail(connectorId, 'Unknown connector');

    if (manifest.authType === 'api_key') {
      this.log(connectorId, null, 'warn', 'connect', 'This connector authenticates with an API key rather than a browser sign-in.');
      return this.connectFail(connectorId, `${manifest.name} uses an API key. Supply it in configuration to connect.`);
    }

    const creds = resolveCredentials(manifest);
    if (!creds) return this.connectFail(connectorId, setupHintFor(manifest) ?? `${manifest.name} is not configured.`);

    if (!manifest.multiAccount && connectorStore.byConnector(connectorId).length > 0) {
      return this.connectFail(connectorId, `${manifest.name} supports a single account. Disconnect the existing one first.`);
    }

    const accountId = shortId('acct');
    this.fireStatus(connectorId, accountId, 'connecting', null, null);
    this.log(connectorId, accountId, 'info', 'authenticate', 'Opening your browser to sign in…');

    try {
      const tokens = await oauthEngine.authorize(manifest, creds);
      await this.vaultTokens(connectorId, accountId, tokens);
      const account = await this.persistConnected(manifest, accountId, tokens);
      this.fire({ connectorId, accountId, type: 'account_added', status: 'connected', health: account.health, syncState: null, message: account.label, at: now() });
      this.fireStatus(connectorId, accountId, 'connected', account.health, null);
      this.log(connectorId, accountId, 'info', 'connect', `Connected ${account.label}.`);
      return { ok: true, connectorId, account, message: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authorization failed';
      this.fireStatus(connectorId, accountId, 'error', 'down', message);
      this.log(connectorId, accountId, 'error', 'authenticate', message);
      return { ok: false, connectorId, account: null, message };
    }
  }

  /** Re-authorize an existing account (recover from reauth_required/error). */
  async reconnect(connectorId: string, accountId: string): Promise<ConnectorConnectResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    const existing = manifest ? connectorStore.get(connectorId, accountId) : null;
    if (!manifest || !existing) return this.connectFail(connectorId, 'No such account to reconnect');
    const creds = resolveCredentials(manifest);
    if (!creds) return this.connectFail(connectorId, setupHintFor(manifest) ?? `${manifest.name} is not configured.`);

    this.fireStatus(connectorId, accountId, 'connecting', null, null);
    this.log(connectorId, accountId, 'info', 'reconnect', 'Re-authorizing…');
    try {
      const tokens = await oauthEngine.authorize(manifest, creds);
      await this.vaultTokens(connectorId, accountId, tokens);
      const account = await connectorStore.patch(connectorId, accountId, {
        status: 'connected',
        error: null,
        grantedScopes: tokens.scopes.length ? tokens.scopes : existing.grantedScopes,
        accessTokenExpiresAt: isoFromMs(tokens.expiresAt),
        health: 'healthy',
      });
      this.fireStatus(connectorId, accountId, 'connected', 'healthy', null);
      this.log(connectorId, accountId, 'info', 'reconnect', 'Reconnected.');
      return { ok: true, connectorId, account, message: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Re-authorization failed';
      await connectorStore.patch(connectorId, accountId, { status: 'error', error: message, health: 'down' });
      this.fireStatus(connectorId, accountId, 'error', 'down', message);
      this.log(connectorId, accountId, 'error', 'reconnect', message);
      return { ok: false, connectorId, account: null, message };
    }
  }

  /** Disconnect an account: revoke (best-effort), drop tokens and metadata. */
  async disconnect(connectorId: string, accountId: string): Promise<ConnectorActionResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    const account = connectorStore.get(connectorId, accountId);
    if (!manifest || !account) return { ok: false, message: 'No such account' };

    const creds = resolveCredentials(manifest);
    const tokens = await connectorVault.get(connectorId, accountId);
    if (creds && tokens) await oauthEngine.revoke(manifest, creds, tokens.accessToken);

    await connectorVault.delete(connectorId, accountId);
    await connectorStore.remove(connectorId, accountId);
    this.fire({ connectorId, accountId, type: 'account_removed', status: 'disconnected', health: null, syncState: null, message: account.label, at: now() });
    this.log(connectorId, accountId, 'info', 'disconnect', `Disconnected ${account.label}.`);
    return { ok: true, message: null };
  }

  /** Force a token refresh for one account (coalesced — see `refreshTokens`). */
  async refresh(connectorId: string, accountId: string): Promise<ConnectorActionResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    const account = connectorStore.get(connectorId, accountId);
    if (!manifest || !account) return { ok: false, message: 'No such account' };
    const token = await this.refreshTokens(connectorId, accountId);
    if (token) {
      this.fireStatus(connectorId, accountId, 'connected', 'healthy', null);
      this.log(connectorId, accountId, 'info', 'refresh', 'Access token refreshed.');
      return { ok: true, message: null };
    }
    this.log(connectorId, accountId, 'error', 'refresh', 'Refresh failed; reconnect may be required.');
    return { ok: false, message: 'Refresh failed; reconnect may be required' };
  }

  /**
   * Run the sync lifecycle for a connector (or one account). Stage 1 verifies
   * each account's token (refreshing if needed) and records the sync; the actual
   * data adapters that populate the Unified Data Model arrive in Stage 2.
   */
  async sync(connectorId: string, accountId?: string | null): Promise<ConnectorActionResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    if (!manifest) return { ok: false, message: 'Unknown connector' };
    const targets = (accountId ? [connectorStore.get(connectorId, accountId)] : connectorStore.byConnector(connectorId))
      .filter((a): a is ConnectedAccount => Boolean(a) && a?.status === 'connected');
    if (targets.length === 0) return { ok: false, message: 'No connected account to sync' };

    let okCount = 0;
    for (const acc of targets) {
      if (this.controlGate?.(connectorId, acc.id)) {
        this.log(connectorId, acc.id, 'info', 'sync', 'Synchronization is paused for this account.');
        continue;
      }
      this.setSync(connectorId, acc.id, 'syncing');
      this.log(connectorId, acc.id, 'info', 'sync', 'Verifying connection…');
      const token = await this.getValidAccessToken(connectorId, acc.id);
      if (!token) {
        await connectorStore.setSync(connectorId, acc.id, 'error', acc.lastSyncAt);
        this.fire({ connectorId, accountId: acc.id, type: 'sync', status: null, health: null, syncState: 'error', message: 'Could not obtain a valid token', at: now() });
        this.log(connectorId, acc.id, 'error', 'sync', 'Could not obtain a valid access token; reconnect may be required.');
        continue;
      }
      if (this.syncRunner) {
        const res = await this.syncRunner(connectorId, acc.id);
        const at = now();
        if (res.ok) {
          await connectorStore.setSync(connectorId, acc.id, 'success', at);
          this.fire({ connectorId, accountId: acc.id, type: 'sync', status: null, health: null, syncState: 'success', message: at, at });
          this.log(connectorId, acc.id, 'info', 'sync', res.hadAdapter ? `Synced ${res.total} record${res.total === 1 ? '' : 's'}.` : 'Connection verified. No data adapter for this provider yet.');
          okCount += 1;
        } else {
          await connectorStore.setSync(connectorId, acc.id, 'error', acc.lastSyncAt);
          this.fire({ connectorId, accountId: acc.id, type: 'sync', status: null, health: null, syncState: 'error', message: res.error, at });
          this.log(connectorId, acc.id, 'error', 'sync', res.error ?? 'Sync failed.');
        }
      } else {
        const at = now();
        await connectorStore.setSync(connectorId, acc.id, 'success', at);
        this.fire({ connectorId, accountId: acc.id, type: 'sync', status: null, health: null, syncState: 'success', message: at, at });
        this.log(connectorId, acc.id, 'info', 'sync', 'Connection verified.');
        okCount += 1;
      }
    }
    return { ok: okCount > 0, message: okCount > 0 ? null : 'Sync could not verify any account' };
  }

  /** Recompute health for accounts, persist transitions, and emit events. */
  async checkHealth(connectorId?: string, accountId?: string | null): Promise<ConnectorDto[]> {
    const manifests = connectorId ? [MANIFEST_BY_ID[connectorId]].filter(Boolean) : CONNECTOR_MANIFESTS;
    for (const manifest of manifests as ConnectorManifest[]) {
      const accounts = accountId
        ? connectorStore.byConnector(manifest.id).filter((a) => a.id === accountId)
        : connectorStore.byConnector(manifest.id);
      for (const account of accounts) {
        // P4.1 — proactive credential rotation: refresh tokens nearing expiry before they lapse.
        await this.maybeRotate(manifest.id, account);
        const current = connectorStore.get(manifest.id, account.id) ?? account;
        const h = accountHealth(current);
        if (h !== current.health) {
          await connectorStore.patch(manifest.id, current.id, { health: h });
          this.fire({ connectorId: manifest.id, accountId: current.id, type: 'health', status: null, health: h, syncState: null, message: null, at: now() });
          this.log(manifest.id, current.id, h === 'down' ? 'warn' : 'info', 'health_check', `Health is now ${h}.`);
        }
      }
    }
    return (manifests as ConnectorManifest[]).map((m) => this.toDto(m));
  }

  /**
   * Returns a valid access token for an account, refreshing first if it is
   * missing or about to expire. Internal — never exposed over IPC. This is the
   * accessor Stage-2 provider adapters use.
   */
  async getValidAccessToken(connectorId: string, accountId: string): Promise<string | null> {
    const tokens = await connectorVault.get(connectorId, accountId);
    if (!tokens) return null;
    const fresh = !tokens.expiresAt || Date.now() < tokens.expiresAt - REFRESH_SKEW_MS;
    if (fresh) return tokens.accessToken;
    return this.refreshTokens(connectorId, accountId);
  }

  /**
   * P4.1 — force-refresh an account's tokens, COALESCING concurrent callers (getValidAccessToken, the
   * proactive rotation pass, and the explicit refresh IPC) so a single-use refresh token is never sent to
   * the provider twice at once — which, against providers that rotate refresh tokens on use, would
   * spuriously invalidate a healthy account. Returns the new access token, or null (→ markReauth).
   */
  private refreshTokens(connectorId: string, accountId: string): Promise<string | null> {
    const k = `${connectorId}::${accountId}`;
    const inflight = this.refreshInFlight.get(k);
    if (inflight) return inflight;
    const p = this.doRefreshTokens(connectorId, accountId).finally(() => this.refreshInFlight.delete(k));
    this.refreshInFlight.set(k, p);
    return p;
  }

  private async doRefreshTokens(connectorId: string, accountId: string): Promise<string | null> {
    const manifest = MANIFEST_BY_ID[connectorId];
    const creds = manifest ? resolveCredentials(manifest) : null;
    const tokens = await connectorVault.get(connectorId, accountId);
    if (!manifest || !creds || !tokens || !tokens.refreshToken) {
      await this.markReauth(connectorId, accountId, 'Access token expired; reconnect required');
      return null;
    }
    try {
      const next = await oauthEngine.refresh(manifest, creds, tokens.refreshToken);
      await this.vaultTokens(connectorId, accountId, next);
      await connectorStore.patch(connectorId, accountId, {
        status: 'connected',
        error: null,
        health: 'healthy',
        accessTokenExpiresAt: isoFromMs(next.expiresAt),
      });
      return next.accessToken;
    } catch (err) {
      await this.markReauth(connectorId, accountId, err instanceof Error ? err.message : 'Refresh failed');
      return null;
    }
  }

  /* ───────────────────────── internals ───────────────────────── */

  private toDto(manifest: ConnectorManifest): ConnectorDto {
    const configured = isConfigured(manifest);
    // Recompute health on read so the DTO is always fresh.
    const accounts = connectorStore.byConnector(manifest.id).map((a) => ({ ...a, health: accountHealth(a) }));
    return {
      id: manifest.id,
      name: manifest.name,
      provider: manifest.provider,
      description: manifest.description,
      category: manifest.category,
      website: manifest.website,
      docsUrl: manifest.docsUrl,
      brandColor: manifest.brandColor,
      version: manifest.version,
      authType: manifest.authType,
      capabilities: manifest.capabilities,
      scopes: manifest.scopes,
      multiAccount: manifest.multiAccount,
      configured,
      status: aggregateStatus(accounts, configured),
      health: aggregateHealth(accounts),
      accounts,
      lastSyncAt: latestSync(accounts),
      setupHint: setupHintFor(manifest),
    };
  }

  private async vaultTokens(connectorId: string, accountId: string, t: OAuthTokens): Promise<void> {
    const tokens: AccountTokens = {
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: t.expiresAt,
      scopes: t.scopes,
      tokenType: t.tokenType,
    };
    await connectorVault.set(connectorId, accountId, tokens);
  }

  private async persistConnected(
    manifest: ConnectorManifest,
    accountId: string,
    tokens: OAuthTokens,
  ): Promise<ConnectedAccount> {
    const account: ConnectedAccount = {
      id: accountId,
      connectorId: manifest.id,
      label: tokens.identity.label ?? `${manifest.name} account`,
      externalId: tokens.identity.externalId,
      avatarUrl: null,
      status: 'connected',
      health: 'healthy',
      grantedScopes: tokens.scopes.length ? tokens.scopes : (manifest.oauth?.scopes ?? []),
      connectedAt: now(),
      lastSyncAt: null,
      lastSyncState: 'never',
      accessTokenExpiresAt: isoFromMs(tokens.expiresAt),
      error: null,
    };
    return connectorStore.upsert(account);
  }

  private async markReauth(connectorId: string, accountId: string, message: string): Promise<void> {
    await connectorStore.patch(connectorId, accountId, { status: 'reauth_required', error: message, health: 'down' });
    this.fireStatus(connectorId, accountId, 'reauth_required', 'down', message);
  }

  /**
   * P4.1 — proactive credential rotation. Projects the account's credential metadata (never the secret)
   * and, if the access token is within the proactive window (or already lapsed but refreshable), refreshes
   * it via the existing `refresh()` — so tokens roll over before a sync would otherwise hit an expired one.
   * A refresh failure routes through `markReauth`, exactly as the lazy path does. Reuses the credential
   * lifecycle engine (`credentialAuthState`) and the existing OAuth refresh — no new token logic.
   */
  private async maybeRotate(connectorId: string, account: ConnectedAccount): Promise<void> {
    if (account.status !== 'connected') return;
    const meta: IntegrationCredentialMeta = {
      kind: 'oauth_access',
      connectorId,
      accountId: account.id,
      expiresAt: account.accessTokenExpiresAt ? Date.parse(account.accessTokenExpiresAt) : null,
      issuedAt: null,
      scopes: account.grantedScopes,
      rotationIntervalMs: null,
      lastRotatedAt: null,
      fingerprint: null,
    };
    const state = credentialAuthState(meta, Date.now(), PROACTIVE_SKEW_MS);
    if (state === 'expiring' || state === 'reauth_required') {
      this.log(connectorId, account.id, 'info', 'refresh', 'Access token expiring soon — refreshing proactively.');
      await this.refreshTokens(connectorId, account.id); // coalesced with any concurrent sync refresh
    }
  }

  private setSync(connectorId: string, accountId: string, state: SyncState): void {
    void connectorStore.setSync(connectorId, accountId, state, connectorStore.get(connectorId, accountId)?.lastSyncAt ?? null);
    this.fire({ connectorId, accountId, type: 'sync', status: null, health: null, syncState: state, message: null, at: now() });
  }

  private fireStatus(
    connectorId: string,
    accountId: string,
    status: ConnectorStatus,
    health: ConnectorHealth | null,
    message: string | null,
  ): void {
    this.fire({ connectorId, accountId, type: 'status', status, health, syncState: null, message, at: now() });
  }

  private fire(event: ConnectorEvent): void {
    this.emit('event', event);
  }

  private log(
    connectorId: string,
    accountId: string | null,
    level: ConnectorLogEntry['level'],
    phase: ConnectorLifecyclePhase,
    message: string,
  ): void {
    const entry: ConnectorLogEntry = { id: shortId('clog'), connectorId, accountId, level, phase, message, at: now() };
    this.logs.push(entry);
    if (this.logs.length > LOG_CAP) this.logs.splice(0, this.logs.length - LOG_CAP);
    this.fire({ connectorId, accountId, type: 'log', status: null, health: null, syncState: null, message, at: entry.at });
  }

  /**
   * Public write-activity recorder (P2.4). Records an audited Microsoft 365 write to the connector
   * activity feed under the `write` phase and fires a live event. Timeline/audit/health are recorded by
   * the write executor; this is the connector-activity seam it calls.
   */
  recordWrite(connectorId: string, accountId: string, level: ConnectorLogEntry['level'], message: string): void {
    this.log(connectorId, accountId, level, 'write', message);
  }

  private connectFail(connectorId: string, message: string): ConnectorConnectResult {
    return { ok: false, connectorId, account: null, message };
  }
}

export const connectorService = new ConnectorService();
