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
  PlatformEventInput,
} from '@neuropause/shared';
import {
  IpcChannel,
  EmptyRequest,
  ConnectorIdRequest,
  ConnectorAccountRequest,
  ConnectorScopedRequest,
  ConnectorLogsRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { connectorService } from './connectorService';
import { MANIFEST_BY_ID } from './manifests';

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
  await connectorService.init();

  const onEvent = (e: ConnectorEvent): void => {
    deps.broadcast(IpcChannel.ConnectorEventBroadcast, e);
    const pe = toPlatformEvent(e);
    if (pe) deps.publish(pe);
  };
  connectorService.on('event', onEvent);

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
  ];

  log.info('Connector subsystem initialized', { handlers: handlers.length });

  return {
    handlers,
    dispose: () => connectorService.off('event', onEvent),
  };
}
