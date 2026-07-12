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
import type { ConnectorSyncSnapshot, ConnectorSyncStateRequest as TConnectorSyncStateRequest, PlatformEventInput } from '@neuropause/shared';
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
import { adapterConnectorIds, describeAdapters, getAdapter } from './registry';
import { registerBuiltinAdapters } from './adapters';
import type { AdapterCapability } from './adapterSdk';

const log = createLogger('sync');

export interface SyncSubsystemDeps {
  publish: (event: PlatformEventInput) => void;
  broadcast: (channel: string, payload: unknown) => void;
  /** P4.1 — whether an account's sync is suppressed (paused / disabled). From the Runtime Supervisor. */
  isSuppressed?: (connectorId: string, accountId: string) => boolean;
}

export interface SyncSubsystem {
  handlers: SecureHandlerDef[];
  /** P4.1 — live sync snapshots (all connected accounts, or one connector) for the diagnostics probe. */
  snapshots: (connectorId?: string) => ConnectorSyncSnapshot[];
  /** P4.1 — a live sync snapshot for one account (the Runtime Supervisor's richer signal source). */
  snapshotFor: (connectorId: string, accountId: string) => ConnectorSyncSnapshot;
  /** P4.1 — subscribe to per-account snapshot changes; returns an unsubscribe handle. */
  onSnapshotChange: (cb: (connectorId: string, accountId: string) => void) => () => void;
  /** P5 — capability/schema report for each registered adapter (what every connector syncs). */
  capabilities: () => AdapterCapability[];
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
  // P4.1 crash reconciler: reset any account left mid-sync by a crash before the scheduler starts.
  const reconciled = await syncStateStore.reconcile();
  if (reconciled.reset > 0) log.info('Reconciled interrupted syncs on startup', reconciled);
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
    isSuppressed: deps.isSuppressed,
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
      requireAuth: true,
      permission: 'connectors:read', // P4.1 RBAC
      handler: (p) => snapshots((p as TConnectorSyncStateRequest).connectorId),
    },
  ];

  const snapshotFor = (c: string, a: string): ConnectorSyncSnapshot =>
    stateToSnapshot(syncStateStore.get(c, a), orchestrator.retrySize(c, a));

  const onSnapshotChange = (cb: (connectorId: string, accountId: string) => void): (() => void) => {
    const listener = (p: { connectorId: string; accountId: string }): void => cb(p.connectorId, p.accountId);
    syncStateStore.on('changed', listener);
    return () => syncStateStore.off('changed', listener);
  };

  log.info('Sync engine initialized', {
    adapters: adapterConnectorIds().length,
    resources: describeAdapters().reduce((n, c) => n + c.resources.length, 0),
  });

  return {
    handlers,
    snapshots,
    snapshotFor,
    onSnapshotChange,
    capabilities: () => describeAdapters(),
    dispose: () => {
      scheduler.stop();
      orchestrator.stop();
      syncStateStore.off('changed', onStateChanged);
    },
  };
}
