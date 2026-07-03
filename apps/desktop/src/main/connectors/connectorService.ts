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
  SyncState,
} from '@neuropause/shared';
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

  /** Wire in the data-sync runner (called once by the sync subsystem at init). */
  setSyncRunner(runner: SyncRunner): void {
    this.syncRunner = runner;
  }

  private logs: ConnectorLogEntry[] = [];

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

  /** Force a token refresh for one account. */
  async refresh(connectorId: string, accountId: string): Promise<ConnectorActionResult> {
    const manifest = MANIFEST_BY_ID[connectorId];
    const account = connectorStore.get(connectorId, accountId);
    if (!manifest || !account) return { ok: false, message: 'No such account' };
    const creds = resolveCredentials(manifest);
    const tokens = await connectorVault.get(connectorId, accountId);
    if (!creds || !tokens) return { ok: false, message: 'Connector is not configured' };
    if (!tokens.refreshToken) {
      await this.markReauth(connectorId, accountId, 'No refresh token; reconnect required');
      return { ok: false, message: 'No refresh token; reconnect required' };
    }
    try {
      const fresh = await oauthEngine.refresh(manifest, creds, tokens.refreshToken);
      await this.vaultTokens(connectorId, accountId, fresh);
      await connectorStore.patch(connectorId, accountId, {
        status: 'connected',
        error: null,
        health: 'healthy',
        accessTokenExpiresAt: isoFromMs(fresh.expiresAt),
      });
      this.fireStatus(connectorId, accountId, 'connected', 'healthy', null);
      this.log(connectorId, accountId, 'info', 'refresh', 'Access token refreshed.');
      return { ok: true, message: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed';
      await this.markReauth(connectorId, accountId, message);
      this.log(connectorId, accountId, 'error', 'refresh', message);
      return { ok: false, message };
    }
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
        const h = accountHealth(account);
        if (h !== account.health) {
          await connectorStore.patch(manifest.id, account.id, { health: h });
          this.fire({ connectorId: manifest.id, accountId: account.id, type: 'health', status: null, health: h, syncState: null, message: null, at: now() });
          this.log(manifest.id, account.id, h === 'down' ? 'warn' : 'info', 'health_check', `Health is now ${h}.`);
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

    const manifest = MANIFEST_BY_ID[connectorId];
    const creds = manifest ? resolveCredentials(manifest) : null;
    if (!manifest || !creds || !tokens.refreshToken) {
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

  private connectFail(connectorId: string, message: string): ConnectorConnectResult {
    return { ok: false, connectorId, account: null, message };
  }
}

export const connectorService = new ConnectorService();
