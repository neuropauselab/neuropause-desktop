/**
 * Connector subsystem composition root.
 *
 * Boots the connector service, exposes its lifecycle over the secure IPC bridge,
 * and bridges connector events two ways: to the renderer (as a broadcast) and
 * onto the Platform Event Bus (so connector activity shows up in the Timeline,
 * Activity feed, and Diagnostics alongside everything else).
 */
import type {
  ConnectorEvent,
  ConnectorScopedRequest as TConnectorScopedRequest,
  ConnectorIdRequest as TConnectorIdRequest,
  ConnectorAccountRequest as TConnectorAccountRequest,
  ConnectorLogsRequest as TConnectorLogsRequest,
  M365ActionExecuteRequest as TM365ActionExecuteRequest,
  M365DraftRequest as TM365DraftRequest,
  PlatformEventInput,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  ConnectorIdRequest,
  ConnectorAccountRequest,
  ConnectorScopedRequest,
  ConnectorLogsRequest,
  M365ActionExecuteRequest,
  M365DraftRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { connectorService } from './connectorService';
import { connectorStore } from './connectorStore';
import { MANIFEST_BY_ID } from './manifests';
import { unifiedStore } from '../unified/storeInstance';
import { createGitHubSyncRunner } from './adapters/github/githubSyncRunner';
import { syncStateStore } from '../unified/sync/syncStateInstance';
import { RateLimiter } from '../unified/sync/rateLimiter';
import { createM365Executor } from './m365';
import { m365Draft } from './m365/aiDrafts';

const log = createLogger('connectors');

/** OAuth flows open the browser; allow well beyond the 5-minute auth window. */
const OAUTH_TIMEOUT_MS = 6 * 60 * 1000;
const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

export interface ConnectorSubsystemDeps {
  broadcast: (channel: string, payload: unknown) => void;
  publish: (event: PlatformEventInput) => void;
}

export interface ConnectorSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

/** Maps a connector event to a Platform Event, or null to keep it off the bus. */
function toPlatformEvent(e: ConnectorEvent): PlatformEventInput | null {
  const name = MANIFEST_BY_ID[e.connectorId]?.name ?? e.connectorId;
  const base = {
    category: 'connector' as const,
    source: 'connectors',
    actor: { kind: 'connector' as const, id: e.connectorId },
    resource: { type: 'connector', id: e.connectorId, name },
    metadata: {
      accountId: e.accountId,
      status: e.status,
      health: e.health,
      syncState: e.syncState,
      message: e.message,
    },
  };
  if (e.type === 'status') {
    if (e.status === 'connected') return { ...base, type: 'connector.connected' };
    if (e.status === 'reauth_required') return { ...base, type: 'connector.reauth_required', priority: 'high' };
    if (e.status === 'error') return { ...base, type: 'connector.error', priority: 'high' };
    if (e.status === 'disconnected') return { ...base, type: 'connector.disconnected' };
    return null; // 'connecting' is transient; don't record it
  }
  if (e.type === 'account_removed') return { ...base, type: 'connector.disconnected' };
  if (e.type === 'sync') {
    if (e.syncState === 'syncing') return { ...base, type: 'connector.sync_started' };
    if (e.syncState === 'success') return { ...base, type: 'connector.sync_completed' };
    if (e.syncState === 'error') return { ...base, type: 'connector.error', priority: 'high' };
    return null;
  }
  // 'log', 'health', 'account_added' stay off the timeline to avoid flooding it.
  return null;
}

export async function initConnectors(deps: ConnectorSubsystemDeps): Promise<ConnectorSubsystem> {
  // Wire the GitHub data-sync runner into the connector lifecycle's sync() seam.
  // Composes the vault-backed token accessor, the read-only fetch client, the pure
  // normalizer, and the unified store. No new pipeline: memory, timeline, knowledge,
  // and semantic all populate downstream from unifiedStore as they already do.
  connectorService.setSyncRunner(
    createGitHubSyncRunner({
      getToken: (connectorId, accountId) =>
        connectorService.getValidAccessToken(connectorId, accountId),
      getLastSyncAt: (connectorId, accountId) =>
        connectorStore.get(connectorId, accountId)?.lastSyncAt ?? null,
      upsert: (entities) => unifiedStore.upsertMany(entities),
      fetchImpl: (url, init) => fetch(url, init),
    }),
  );

  await connectorService.init();

  const onEvent = (e: ConnectorEvent): void => {
    deps.broadcast(IpcChannel.ConnectorEventBroadcast, e);
    const pe = toPlatformEvent(e);
    if (pe) deps.publish(pe);
  };
  connectorService.on('event', onEvent);

  // P2.4 — Microsoft 365 write executor: audited, confirmation-gated Graph writes on the same account/token.
  const m365 = createM365Executor({
    getToken: (c, a) => connectorService.getValidAccessToken(c, a),
    publish: deps.publish,
    rate: new RateLimiter(200),
    recordActivity: (c, a, level, message) => connectorService.recordWrite(c, a, level, message),
    health: syncStateStore,
    manifestName: (c) => MANIFEST_BY_ID[c]?.name ?? c,
    grantedScopes: (c, a) => connectorStore.get(c, a)?.grantedScopes ?? [],
  });

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.ConnectorsList, schema: EmptyRequest, handler: () => connectorService.list() },
    {
      channel: IpcChannel.ConnectorGet,
      schema: ConnectorIdRequest,
      handler: (p) => connectorService.get((p as TConnectorIdRequest).connectorId),
    },
    { channel: IpcChannel.ConnectorStats, schema: EmptyRequest, handler: () => connectorService.stats() },
    {
      channel: IpcChannel.ConnectorConnect,
      schema: ConnectorIdRequest,
      audit: true,
      timeoutMs: OAUTH_TIMEOUT_MS,
      handler: (p) => connectorService.connect((p as TConnectorIdRequest).connectorId),
    },
    {
      channel: IpcChannel.ConnectorDisconnect,
      schema: ConnectorAccountRequest,
      audit: true,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.disconnect(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorReconnect,
      schema: ConnectorAccountRequest,
      audit: true,
      timeoutMs: OAUTH_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.reconnect(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorRefresh,
      schema: ConnectorAccountRequest,
      audit: true,
      handler: (p) => {
        const r = p as TConnectorAccountRequest;
        return connectorService.refresh(r.connectorId, r.accountId);
      },
    },
    {
      channel: IpcChannel.ConnectorSync,
      schema: ConnectorScopedRequest,
      audit: true,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TConnectorScopedRequest;
        return connectorService.sync(r.connectorId, r.accountId ?? null);
      },
    },
    {
      channel: IpcChannel.ConnectorHealthCheck,
      schema: ConnectorScopedRequest,
      handler: (p) => {
        const r = p as TConnectorScopedRequest;
        return connectorService.checkHealth(r.connectorId, r.accountId ?? null);
      },
    },
    {
      channel: IpcChannel.ConnectorLogs,
      schema: ConnectorLogsRequest,
      handler: (p) => connectorService.logFeed((p as TConnectorLogsRequest).connectorId),
    },
    // P2.4 — Microsoft 365 write actions (audited, confirmation-gated) + AI drafting.
    { channel: IpcChannel.M365ActionList, schema: EmptyRequest, handler: () => m365.list() },
    {
      channel: IpcChannel.M365ActionExecute,
      schema: M365ActionExecuteRequest,
      audit: true,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TM365ActionExecuteRequest;
        return m365.execute(r.connectorId, r.accountId, r.actionId, r.params, r.confirmed);
      },
    },
    {
      channel: IpcChannel.M365Draft,
      schema: M365DraftRequest,
      timeoutMs: SYNC_TIMEOUT_MS,
      handler: (p) => {
        const r = p as TM365DraftRequest;
        return m365Draft(r.kind, r.instruction, r.context);
      },
    },
  ];

  log.info('Connector subsystem initialized', { handlers: handlers.length });

  return {
    handlers,
    dispose: () => connectorService.off('event', onEvent),
  };
}
