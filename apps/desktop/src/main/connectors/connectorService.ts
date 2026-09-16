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
import type { ConnectionTestResult } from './connectionTest';
import { connectorVault, type AccountTokens } from './connectorVault';
import { oauthEngine, type OAuthTokens } from './oauthEngine';
import { accountHealth, aggregateHealth, aggregateStatus, latestSync } from './health';
import { shortId } from './pkce';
import { mappingsForConnector } from './bridge/entityMap';
import { getAdapter } from '../unified/sync/registry';
import { declareStoreScope } from '../tenancy/storeScope';

type ConnectionTester = (connectorId: string, accountId: string) => Promise<ConnectionTestResult>;

const log = createLogger('connectors');
const REFRESH_SKEW_MS = 60 * 1000;
/** P4.1 — proactively refresh a token when it will expire within this window (well before the lazy path). */
const PROACTIVE_SKEW_MS = 5 * 60 * 1000;
/**
 * Per WORKSPACE, not per install. See `pruneLogs`.
 *
 * Exported so the isolation suite asserts the REAL cap rather than a copy of the
 * number: a test that hardcodes 500 keeps passing after somebody changes it here.
 */
export const LOG_CAP = 500;

/**
 * P13C ROUND 9 — FINDING 7. THE ACTIVITY LOG BELONGS TO A WORKSPACE.
 *
 * `logFeed(connectorId)` filtered `this.logs` on the connector id ALONE, and
 * `this.logs` held every workspace's entries. So any member holding
 * `connectors:read` could ask for `google` and receive another workspace's
 * `accountId`s, the provider's verbatim error strings and its sync timings —
 * exactly the rows `connectorStore.get()` refuses to resolve for them. The
 * account listing beside it was scoped from P10; its activity feed never was.
 *
 * A connector id is not an authorization. The owner is now stamped onto every
 * entry at WRITE time from this service's own bound workspace resolver — the
 * same seam `connectorStore` and `connectorVault` use — and every read filters
 * on it. An entry with no owner is visible to nobody.
 */
declareStoreScope({
  name: 'connector-activity-log',
  scope: 'WORKSPACE',
  persistence: 'memory',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: `Per workspace: the ${LOG_CAP}-entry cap evicts only the owning workspace's own oldest entries (pruneLogs). An install-wide splice let one workspace's activity delete another's.`,
  reason:
    "ConnectorLogEntry.workspaceId, stamped from the service's bound resolver; unresolved reads return []. An account id, a provider error string and a sync timing describe one customer's own SaaS connection.",
});

/**
 * A log line with the OWNER this service stamps onto it.
 *
 * The owner is a field on the RECORD rather than an argument to the read,
 * because a read-side filter is only as good as the caller that remembers to
 * pass the right value. `ConnectorLogEntry` is the shared wire type and gains
 * nothing; the owner is stripped before the entry leaves this process.
 */
type OwnedLogEntry = ConnectorLogEntry & { workspaceId?: string };

/**
 * A connector event with the workspace it HAPPENED IN.
 *
 * P13C ROUND 9 — FINDING 6. Events are emitted from the sync fan-out, which runs
 * once per workspace under each workspace's own principal while the window in
 * front of the user is showing whichever workspace they last opened. Broadcast
 * unconditionally, a pass for workspace B pushes B's connector and account ids
 * into A's window. The stamp is what lets the composition root drop those; see
 * `initConnectors`.
 */
export type OwnedConnectorEvent = ConnectorEvent & { workspaceId: string | null };

/**
 * Drop the owner before a record leaves the process.
 *
 * The owner is an ENFORCEMENT field, not a payload one: `ConnectorLogEntry` is
 * the declared IPC shape and a reader only ever receives its own workspace's
 * rows, so shipping the id would add nothing a caller does not already know
 * while quietly widening the wire contract.
 */
function stripOwner(entry: OwnedLogEntry): ConnectorLogEntry {
  const { workspaceId: _owner, ...wire } = entry;
  void _owner;
  return wire;
}

/**
 * Does a stamped record belong to the workspace currently ON SCREEN?
 *
 * The ONE predicate the broadcast seam uses, exported so it is testable as
 * itself. Both halves fail closed: a record with no owner belongs to nobody
 * (pre-boundary rows are not adopted by whoever looks first), and a viewer with
 * no workspace is entitled to nothing (a cold start or a tenant-level
 * background principal is not "everyone").
 */
export function ownedByViewer(owner: string | null | undefined, viewer: string | null): boolean {
  if (typeof owner !== 'string' || owner === '') return false;
  if (viewer === null || viewer === '') return false;
  return owner === viewer;
}

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

/**
 * Exported for its TYPE. `connectorService` below is the only instance the
 * application constructs — a second one would hold a second activity log — but a
 * test that loads this module dynamically (to get a fresh singleton, or with
 * Electron doubled) needs a name to annotate the binding with.
 */
export class ConnectorService extends EventEmitter {
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

  private logs: OwnedLogEntry[] = [];
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

  /**
   * The CALLER'S WORKSPACE'S activity, newest first. Was the whole install's.
   *
   * The connector id narrows an already-authorized set; it does not authorize
   * one. An unresolved workspace reads nothing — a caller who cannot say which
   * workspace it is in has no business seeing a connection's activity, which is
   * the same answer `connectorStore.all()` gives to the same question.
   */
  logFeed(connectorId?: string): ConnectorLogEntry[] {
    const owner = this.currentWorkspace();
    if (owner === null) return [];
    const mine = this.logs.filter(
      (l) => l.workspaceId === owner && (!connectorId || l.connectorId === connectorId),
    );
    return mine.reverse().map(stripOwner); // newest first, owner off the wire
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

    // Fail before opening a browser if there is nowhere to put the result.
    try {
      this.requireWorkspace();
    } catch (err) {
      return this.connectFail(connectorId, err instanceof Error ? err.message : 'No workspace is active.');
    }

    const accountId = shortId('acct');
    this.fireStatus(connectorId, accountId, 'connecting', null, null);
    this.log(connectorId, accountId, 'info', 'authenticate', 'Opening your browser to sign in…');

    try {
      const tokens = await oauthEngine.authorize(manifest, creds);
      await this.vaultTokens(connectorId, accountId, tokens);
      let account = await this.persistConnected(manifest, accountId, tokens);

      /**
       * A REAL round-trip before "Connected" is shown.
       *
       * A token exchange returning 200 is not a working connection: it does
       * not prove the credential is usable, and it does not tell us whose
       * account this is. `externalId` used to come from whatever the token
       * response happened to carry — `null` for GitHub, Salesforce, HubSpot
       * and most others — so accounts read as "GitHub account" and a
       * reconnect produced a duplicate nothing could detect.
       */
      const test = await this.runConnectionTest(connectorId, accountId);
      if (test.status === 'invalid_credential') {
        await connectorStore.patch(connectorId, accountId, { status: 'error', error: test.message, health: 'down' });
        this.fireStatus(connectorId, accountId, 'error', 'down', test.message);
        this.log(connectorId, accountId, 'error', 'connect', test.message);
        return { ok: false, connectorId, account: null, message: test.message };
      }
      if (test.status === 'verified') {
        // `patch` returns null only when the row vanished; keeping the row we
        // just wrote is the correct fallback, not throwing away a live
        // connection over a race that cannot happen here.
        account =
          (await connectorStore.patch(connectorId, accountId, {
            externalId: test.externalId,
            ...(test.label ? { label: test.label } : {}),
          })) ?? account;
      } else {
        // Not a failure, and not a green tick either. The reason is on the
        // account so the screen can say which of the two it is.
        this.log(connectorId, accountId, 'warn', 'connect', test.message);
      }

      this.fire({ connectorId, accountId, type: 'account_added', status: 'connected', health: account.health, syncState: null, message: account.label, at: now() });
      this.fireStatus(connectorId, accountId, 'connected', account.health, null);
      this.log(connectorId, accountId, 'info', 'connect', test.status === 'verified' ? test.message : `Connected ${account.label}.`);
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
      const test = await this.runConnectionTest(connectorId, accountId);

      /**
       * Reconnecting must land on the SAME provider account.
       *
       * The browser flow signs in whoever is signed in to the provider. Left
       * unchecked, reconnecting a HubSpot connection while logged into a
       * different portal silently rebinds every record this connection has
       * ever produced — the provenance would say one account and the data
       * would come from another, and nothing would ever show it.
       */
      if (
        test.status === 'verified' &&
        existing.externalId !== null &&
        test.externalId !== null &&
        test.externalId !== existing.externalId
      ) {
        const message = `That sign-in is a different ${manifest.name} account (${test.label ?? test.externalId}). Reconnect with the account this connection was set up for, or disconnect and connect the new one.`;
        await connectorVault.delete(this.requireWorkspace(), connectorId, accountId);
        await connectorStore.patch(connectorId, accountId, { status: 'reauth_required', error: message, health: 'down' });
        this.fireStatus(connectorId, accountId, 'reauth_required', 'down', message);
        this.log(connectorId, accountId, 'error', 'reconnect', message);
        return { ok: false, connectorId, account: null, message };
      }
      if (test.status === 'invalid_credential') {
        await connectorStore.patch(connectorId, accountId, { status: 'error', error: test.message, health: 'down' });
        this.fireStatus(connectorId, accountId, 'error', 'down', test.message);
        return { ok: false, connectorId, account: null, message: test.message };
      }

      const account = await connectorStore.patch(connectorId, accountId, {
        status: 'connected',
        error: null,
        grantedScopes: tokens.scopes.length ? tokens.scopes : existing.grantedScopes,
        accessTokenExpiresAt: isoFromMs(tokens.expiresAt),
        health: 'healthy',
        // Back-fill the identity on an older connection that never had one.
        ...(test.status === 'verified' && existing.externalId === null ? { externalId: test.externalId } : {}),
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
    const tokens = await connectorVault.get(this.requireWorkspace(), connectorId, accountId);
    if (creds && tokens) await oauthEngine.revoke(manifest, creds, tokens.accessToken);

    await connectorVault.delete(this.requireWorkspace(), connectorId, accountId);
    await connectorStore.remove(connectorId, accountId);
    /**
     * Synced entities go with the connection; business RECORDS do not.
     *
     * The Unified store's copy of the provider's data cannot be refreshed
     * once the credential is gone, so keeping it would be presenting stale
     * data as live. Records the bridge wrote into the business modules STAY —
     * they are the company's own data now, and their provenance still names
     * where they came from, which is what makes the deletion explainable.
     */
    if (this.onDisconnected) {
      try {
        await this.onDisconnected(connectorId, accountId);
      } catch (err) {
        this.log(connectorId, accountId, 'warn', 'disconnect', 'Some synced data could not be cleared.');
        void err;
      }
    }
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
    const tokens = await connectorVault.get(this.requireWorkspace(), connectorId, accountId);
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
    const tokens = await connectorVault.get(this.requireWorkspace(), connectorId, accountId);
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
      // See `ConnectorDto.needsReconnect`. Counted here so every surface that
      // reads a connector sees the same number.
      needsReconnect: connectorStore.unclaimed().filter((a) => a.connectorId === manifest.id).length,
      // Lifecycle is derived from REAL adapter presence, not credentials: a connector with no data adapter
      // is 'preview' (shown in the catalog, not connectable), never offered as ready.
      lifecycle: getAdapter(manifest.id) ? 'production' : 'preview',
      /**
       * What this connector's data becomes. Read from the declared mapping
       * table, so a screen can never claim a destination the bridge does not
       * actually write to.
       */
      businessData: (() => {
        const mapped = mappingsForConnector(manifest.id).map((m) => ({
          resourceId: m.resourceId,
          label: m.label.split('→')[0]?.trim() ?? m.resourceId,
          entityLabel: m.label.split('→')[1]?.trim() ?? m.entityId,
        }));
        return {
          mapped,
          unmappedNote:
            mapped.length > 0
              ? null
              : `${manifest.name} data is synced, searchable and on your timeline, but none of it maps to a business record type NeuroPause holds, so nothing is written to your business data.`,
        };
      })(),
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
    await connectorVault.set(this.requireWorkspace(), connectorId, accountId, tokens);
  }

  private async persistConnected(
    manifest: ConnectorManifest,
    accountId: string,
    tokens: OAuthTokens,
  ): Promise<ConnectedAccount> {
    const account: ConnectedAccount = {
      id: accountId,
      connectorId: manifest.id,
      // Stamped at birth. A connection with no workspace is unclaimed, and the
      // only thing that can produce one now is a file written before P10.
      workspaceId: this.requireWorkspace(),
      label: tokens.identity.label ?? `${manifest.name} account`,
      externalId: tokens.identity.externalId,
      avatarUrl: null,
      status: 'connected',
      health: 'healthy',
      /**
       * P0 — REQUESTED GRANTED SCOPE IS NOT GRANTED GRANTED SCOPE.
       *
       * This read `tokens.scopes.length ? tokens.scopes : (manifest.oauth?.scopes ?? [])`, so a token
       * response that omitted its scope list caused the manifest — what we ASKED FOR — to be recorded as
       * what we were GIVEN. Both `m365/executor.ts` and the CST send transition consume this field, so a
       * fabricated grant would have been checked against a fiction: fail-OPEN on authority, the inverse of
       * CLAUDE §2 #8, and the AUTHORITY family's own law that presence in the system is never authority.
       *
       * An absent scope list is UNKNOWN, and an unknown granted-scope set must REFUSE. Storing `[]` refuses
       * at the executor's least-privilege check (`missing.length > 0` → a named "Missing Graph
       * permission(s)" denial), so the refusal is fail-closed AND loud.
       *
       * HONEST BOUND, stated rather than glossed: `ConnectedAccount.grantedScopes` is `string[]` in the
       * FROZEN shared contract, so `[]` cannot distinguish "we were told nothing" from "we were granted
       * nothing". **This trades a FAIL-OPEN LIE for a FAIL-CLOSED CONFLATION** — a net safety gain and a
       * lateral honesty move. Modelling UNKNOWN properly needs a nullable field and is queued as FG-13.
       *
       * NOT changed: the refresh path's `tokens.scopes.length ? tokens.scopes : existing.grantedScopes`.
       * RFC 6749 §5.1 makes `scope` optional on refresh when it is identical to the original grant, so
       * clearing it there would break every working connection at its first refresh. Carrying forward is
       * correct semantics — and once this line is honest, it carries forward an honest value.
       */
      grantedScopes: tokens.scopes,
      connectedAt: now(),
      lastSyncAt: null,
      lastSyncState: 'never',
      accessTokenExpiresAt: isoFromMs(tokens.expiresAt),
      error: null,
    };
    return connectorStore.upsert(account);
  }

  /**
   * The provider round-trip. Injected so tests drive the real code without a
   * socket, and so a build with no network still connects deterministically.
   */
  /**
   * The workspace every credential and connection in this service belongs to.
   *
   * Injected once at composition. Until it is bound, the service refuses to
   * read or write a credential at all — a token whose owning workspace is
   * unknown is a token that must not be spent, and defaulting to "the active
   * one" is the guess this boundary exists to remove.
   */
  private workspaceId: (() => string) | null = null;

  bindWorkspace(fn: () => string): void {
    this.workspaceId = fn;
  }

  /**
   * The workspace this call is acting in, or null. THE ONE OWNER SEAM.
   *
   * Every activity entry is stamped from here and every read is filtered by it,
   * so an owner can never arrive from a caller argument. `null` is a refusal,
   * never "all of them" — the resolver already prefers a background principal
   * over the session (see `initConnectors`), so a fanned-out sync stamps the
   * workspace being SYNCED rather than the one being looked at.
   */
  private currentWorkspace(): string | null {
    const id = this.workspaceId?.();
    return id === undefined || id === null || id === '' ? null : id;
  }

  private requireWorkspace(): string {
    const id = this.currentWorkspace();
    if (id === null) {
      throw new Error('No workspace is active, so connector credentials cannot be used.');
    }
    return id;
  }

  private connectionTester: ConnectionTester | null = null;

  setConnectionTester(tester: ConnectionTester): void {
    this.connectionTester = tester;
  }

  private async runConnectionTest(connectorId: string, accountId: string): Promise<ConnectionTestResult> {
    if (!this.connectionTester) {
      return {
        status: 'not_verifiable',
        externalId: null,
        label: null,
        organization: null,
        message: 'The connection could not be verified in this build.',
      };
    }
    try {
      return await this.connectionTester(connectorId, accountId);
    } catch {
      // A tester that throws must not take down a connect that otherwise
      // succeeded. Unverified is the honest outcome.
      return {
        status: 'not_verifiable',
        externalId: null,
        label: null,
        organization: null,
        message: 'The connection check could not be completed.',
      };
    }
  }

  /**
   * Called on disconnect, after the credential is gone.
   *
   * `unifiedStore.removeConnector()` was written, documented as the disconnect
   * path, and had no callers — so disconnecting left every synced entity
   * resident and searchable with no way to refresh it. Injected rather than
   * imported so this service keeps no dependency on the sync layer.
   */
  private onDisconnected: ((connectorId: string, accountId: string) => void | Promise<void>) | null = null;

  setDisconnectCleanup(fn: (connectorId: string, accountId: string) => void | Promise<void>): void {
    this.onDisconnected = fn;
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

  /**
   * Emit, stamped with the workspace the event happened in.
   *
   * Subscribers (the renderer broadcast, the Platform Event Bus, the Runtime
   * Supervisor) receive an `OwnedConnectorEvent`; the composition root decides
   * what reaches a window. Stamped HERE rather than at the broadcast because
   * here is where the acting workspace is still known — by the time a listener
   * runs, "the active workspace" would mean whoever is looking.
   */
  private fire(event: ConnectorEvent): void {
    const owned: OwnedConnectorEvent = { ...event, workspaceId: this.currentWorkspace() };
    this.emit('event', owned);
  }

  private log(
    connectorId: string,
    accountId: string | null,
    level: ConnectorLogEntry['level'],
    phase: ConnectorLifecyclePhase,
    message: string,
  ): void {
    /**
     * The owner is resolved, never passed. A log line records something this
     * service just did, so the workspace it did it in is the authoritative
     * owner — and it is the only value that cannot be influenced by the
     * connector id or account id a renderer asked about.
     *
     * An unresolved workspace still WRITES the line, without an owner. It is
     * then invisible to every reader (`logFeed` matches on the owner) rather
     * than silently attributed to whoever happens to look next, which is how
     * `recordInScope` treats a pre-boundary record everywhere else in this
     * program. Throwing instead would turn a diagnostic into an outage: `log`
     * is called on the failure paths of `connect`, including the one that runs
     * before a workspace is required.
     */
    const owner = this.currentWorkspace();
    const entry: OwnedLogEntry = {
      id: shortId('clog'),
      connectorId,
      accountId,
      level,
      phase,
      message,
      at: now(),
      ...(owner === null ? {} : { workspaceId: owner }),
    };
    this.logs.push(entry);
    this.pruneLogs(owner);
    this.fire({ connectorId, accountId, type: 'log', status: null, health: null, syncState: null, message, at: entry.at });
  }

  /**
   * Evict the OWNER'S oldest entries beyond the cap. P13C ROUND 9 — FINDING 12.
   *
   * `this.logs.splice(0, this.logs.length - LOG_CAP)` was install-wide and
   * oldest-first, so a workspace that logged 500 lines did not merely consume
   * capacity — it CHOSE which of another workspace's connector history was
   * destroyed, including the reauth and sync-failure lines an operator needs to
   * explain an outage. A retention cap is a write, and this one crossed a
   * boundary every read respected.
   *
   * The cap is now per workspace, so an install with more workspaces holds more
   * lines. That is the honest trade; the alternative is one customer able to
   * delete another's.
   */
  private pruneLogs(owner: string | null): void {
    const mine = this.logs.filter((l) => (l.workspaceId ?? null) === owner);
    if (mine.length <= LOG_CAP) return;
    const doomed = new Set(mine.slice(0, mine.length - LOG_CAP));
    this.logs = this.logs.filter((l) => !doomed.has(l));
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
