/**
 * Sync engine composition root.
 *
 * Builds the orchestrator over real ports (the unified store, the sync-state
 * store, the connector service for tokens, the adapter registry), wires it as the
 * connector service's sync runner (so manual sync runs adapters), starts the
 * background scheduler, and exposes the sync-state snapshot the Health Dashboard
 * reads. In Part A the registry is empty, so this boots as `adapters: 0` and
 * every sync is verify-only until Part B registers the four adapters.
 */
import type { ConnectorSyncStateRequest as TConnectorSyncStateRequest, PlatformEventInput } from '@neuropause/shared';
import { IpcChannel, ConnectorSyncStateRequest } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { connectorService } from '../../connectors/connectorService';
import { connectorStore } from '../../connectors/connectorStore';
import { CONNECTOR_MANIFESTS, MANIFEST_BY_ID } from '../../connectors/manifests';
import { unifiedStore } from '../storeInstance';
import { syncStateStore } from './syncStateInstance';
import { stateToSnapshot } from './syncStateStore';
import { SyncOrchestrator } from './orchestrator';
import { RateLimiter } from './rateLimiter';
import { SyncScheduler, SCHEDULER_INTERVAL_MS } from './scheduler';
import { adapterConnectorIds, getAdapter } from './registry';
import { registerBuiltinAdapters } from './adapters';

const log = createLogger('sync');

export interface SyncSubsystemDeps {
  publish: (event: PlatformEventInput) => void;
  broadcast: (channel: string, payload: unknown) => void;
}

export interface SyncSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

function connectedAccounts(connectorId?: string): Array<{ connectorId: string; accountId: string }> {
  const manifests = connectorId ? CONNECTOR_MANIFESTS.filter((m) => m.id === connectorId) : CONNECTOR_MANIFESTS;
  return manifests.flatMap((m) =>
    connectorStore
      .byConnector(m.id)
      .filter((a) => a.status === 'connected')
      .map((a) => ({ connectorId: m.id, accountId: a.id })),
  );
}

export async function initSync(deps: SyncSubsystemDeps): Promise<SyncSubsystem> {
  await syncStateStore.load();
  registerBuiltinAdapters();

  const orchestrator = new SyncOrchestrator({
    upsertMany: (entities) => unifiedStore.upsertMany(entities),
    markDeleted: (ids, at) => unifiedStore.markDeleted(ids, at),
    countForConnector: (c) => unifiedStore.countForConnector(c),
    syncState: syncStateStore,
    getAccessToken: (c, a) => connectorService.getValidAccessToken(c, a),
    getAdapter: (c) => getAdapter(c),
    manifestName: (c) => MANIFEST_BY_ID[c]?.name ?? c,
    listConnectedAccounts: () => connectedAccounts(),
    publish: deps.publish,
    rate: new RateLimiter(200),
  });

  // Manual sync (the Connectors UI button / IPC) now runs adapters.
  connectorService.setSyncRunner((c, a) => orchestrator.syncForService(c, a));

  const snapshots = (connectorId?: string) =>
    connectedAccounts(connectorId).map(({ connectorId: c, accountId: a }) =>
      stateToSnapshot(syncStateStore.get(c, a), orchestrator.retrySize(c, a)),
    );

  // Re-broadcast sync-state changes so the dashboard refreshes live.
  const onStateChanged = (): void => deps.broadcast(IpcChannel.ConnectorSyncState, snapshots());
  syncStateStore.on('changed', onStateChanged);

  const scheduler = new SyncScheduler(SCHEDULER_INTERVAL_MS, () => orchestrator.tick());
  scheduler.start();

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ConnectorSyncState,
      schema: ConnectorSyncStateRequest,
      handler: (p) => snapshots((p as TConnectorSyncStateRequest).connectorId),
    },
  ];

  log.info('Sync engine initialized', { adapters: adapterConnectorIds().length });

  return {
    handlers,
    dispose: () => {
      scheduler.stop();
      orchestrator.stop();
      syncStateStore.off('changed', onStateChanged);
    },
  };
}
