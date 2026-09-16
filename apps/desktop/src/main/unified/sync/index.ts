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
import type { ConnectorServiceDescriptor, ConnectorSyncSnapshot, ConnectorSyncStateRequest as TConnectorSyncStateRequest, PlatformEventInput } from '@neuropause/shared';
import { IpcChannel, ConnectorSyncStateRequest } from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { SecureHandlerDef } from '../../ipc/secureBridge';
import { connectorService } from '../../connectors/connectorService';
import { connectorStore } from '../../connectors/connectorStore';
import { CONNECTOR_MANIFESTS, MANIFEST_BY_ID } from '../../connectors/manifests';
import { unifiedStore } from '../storeInstance';
import { activeTenantScope } from '../../enterprise';
import { m365WriteStates } from '../../connectors/m365WriteStates';
import { syncStateStore } from './syncStateInstance';
import { stateToSnapshot } from './syncStateStore';
import { SyncOrchestrator, type OrchestratorPorts } from './orchestrator';
import { RateLimiter } from './rateLimiter';
import { SyncScheduler, SCHEDULER_INTERVAL_MS } from './scheduler';
import { adapterConnectorIds, describeAdapters, getAdapter } from './registry';
import { registerBuiltinAdapters } from './adapters';
import { describeAdapter, type AdapterCapability } from './adapterSdk';
import { googleServiceAvailability } from './adapters/googleWorkspace';
import { githubServiceAvailability } from './adapters/github';
import { slackServiceAvailability } from './adapters/slack';
import { atlassianServiceAvailability } from './adapters/atlassian';
import { hubspotServiceAvailability } from './adapters/hubspot';
import { runOutsidePrincipal } from '../../tenancy/backgroundPrincipal';

const log = createLogger('sync');

export interface SyncSubsystemDeps {
  publish: (event: PlatformEventInput) => void;
  broadcast: IpcBroadcaster;
  /** P4.1 — whether an account's sync is suppressed (paused / disabled). From the Runtime Supervisor. */
  isSuppressed?: (connectorId: string, accountId: string) => boolean;
  /**
   * P9 — write a synced resource into the governed business data.
   *
   * Injected rather than imported so this module keeps no dependency on the
   * Data Plane: the sync engine's job ends at the Unified store, and the
   * bridge is something the composition root chooses to attach.
   */
  bridge?: OrchestratorPorts['bridge'];
  /**
   * P13C PART 3 — run the scheduler tick once per WORKSPACE, each under its own
   * principal.
   *
   * Required, and per-workspace rather than per-tenant, because a CONNECTION is
   * a workspace-level object: `connectorStore.all()` filters on the active
   * workspace id, and a tenant-level principal reports an empty workspace,
   * which that filter correctly matches to nothing. A tenant-level fan-out here
   * would therefore sync nothing at all — the fail-closed direction, but still
   * wrong.
   *
   * Injected so this module gains no dependency on the enterprise root, in
   * keeping with `bridge` above.
   */
  forEachWorkspace: (jobId: string, fn: () => void | Promise<void>) => Promise<unknown>;
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
  /**
   * P5 — Increment 4: the runtime-declared per-service capability list for one connector, projected
   * against an account's granted scopes. Google Workspace maps its scope catalog (per-service ✓/✗);
   * every other adapter reports its declared resources (no per-service scope gating). The Supervisor
   * overlays the live per-module runtime status onto this — so the Connector Center never hardcodes.
   */
  serviceCapabilities: (connectorId: string, grantedScopes: readonly string[]) => ConnectorServiceDescriptor[];
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
  syncStateStore.bindScope(activeTenantScope);
  await syncStateStore.load();
  // P4.1 crash reconciler: reset any account left mid-sync by a crash before the scheduler starts.
  const reconciled = await syncStateStore.reconcile();
  if (reconciled.reset > 0) log.info('Reconciled interrupted syncs on startup', reconciled);
  registerBuiltinAdapters();

  const orchestrator = new SyncOrchestrator({
    // P13B — the same resolver every other scoped surface reads. Null (cold
    // start / signed out / suspended member) declines the run rather than
    // syncing records nobody would own.
    activeTenantId: () => activeTenantScope()?.tenantId ?? null,
    upsertMany: (entities, expectedTenantId) => unifiedStore.upsertMany(entities, expectedTenantId),
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
    ...(deps.bridge ? { bridge: deps.bridge } : {}),
  });

  /**
   * P9 — disconnecting clears that account's synced entities.
   *
   * `unifiedStore.removeConnector()` was written, documented as "called on
   * disconnect", and had NO CALLERS — so a disconnected connector left every
   * entity resident and searchable, with the credential gone and no way to
   * refresh it. Stale data presented as live is worse than no data.
   *
   * Business RECORDS the bridge wrote are deliberately NOT removed: they are
   * the company's own data now, and their provenance still names where they
   * came from, which is what makes keeping them explainable.
   */
  connectorService.setDisconnectCleanup(async (connectorId, accountId) => {
    const removed = await unifiedStore.removeConnector(connectorId, accountId);
    await syncStateStore.forget(connectorId, accountId);
    if (removed > 0) log.info('Cleared synced data on disconnect', { connectorId, accountId, removed });
  });

  // Manual sync (the Connectors UI button / IPC) now runs adapters.
  connectorService.setSyncRunner((c, a) => orchestrator.syncForService(c, a));

  const snapshots = (connectorId?: string) =>
    connectedAccounts(connectorId).map(({ connectorId: c, accountId: a }) =>
      stateToSnapshot(syncStateStore.get(c, a), orchestrator.retrySize(c, a)),
    );

  /**
   * S19 (FG-7) — join the TRUTHFUL five write states onto each Microsoft 365
   * snapshot from the single S34a ActionRecord source of truth. The key is
   * resolved SYNCHRONOUSLY by the caller (inside its principal context); this
   * async step only needs the id string. No parallel counting: the old disjoint
   * `writeCount` is retired in the panel.
   *
   * ── F-P45 · THE KEY IS A WORKSPACE ID, AND THE PARAMETER SAYS SO ────────────────────────────────────────────
   * This read previously passed `activeTenantScope()?.tenantId` — the ORGANIZATION id — to a store whose rows are
   * written under the WORKSPACE id (`connectors/index.ts:641` → `deps.workspaceId()`). Two separately-seeded
   * namespaces with no mapping at the query boundary, so **every counter read zero on every call, forever** — and
   * `EXTERNALLY_OBSERVED` was pinned to 0 by construction no matter what the read-back reconciler recorded.
   *
   * The parameter is named `workspaceId` deliberately. The persisted column is still called `tenantId` and that
   * RENAME IS OWED AND NOT DONE HERE (it is governance-class and needs its own gate); naming the local truthfully
   * is what stops the next reader repeating the substitution. **The value was never the defect — the name was.**
   *
   * `activeTenantScope()` resolves the workspace from the SAME two authorities in the SAME precedence as the
   * writer's `deps.workspaceId()`: the background principal when one is bound, else the `workspaceStore` session
   * (`backgroundPrincipal.ts:167`, `tenantContext.ts:480`). That is why the two keys meet, and the regression pin
   * derives each side independently rather than asserting the equality into place.
   */
  const withWriteStates = async (
    snaps: ConnectorSyncSnapshot[],
    workspaceId: string | null,
  ): Promise<ConnectorSyncSnapshot[]> => {
    if (workspaceId === null) return snaps;
    return Promise.all(
      snaps.map(async (s) => {
        if (s.connectorId !== 'microsoft-entra') return s;
        const w = await m365WriteStates(workspaceId, s.connectorId, s.accountId);
        return {
          ...s,
          writeStates: {
            requested: w.requested,
            authorized: w.authorized,
            executed: w.executed,
            providerAcknowledged: w.providerAcknowledged,
            externallyObserved: w.externallyObserved,
          },
        };
      }),
    );
  };

  // Re-broadcast sync-state changes so the dashboard refreshes live.
  // P13C Round 7 — `changed` fires synchronously inside the per-workspace sync
  // fan-out, so `connectedAccounts()` and `syncStateStore.get()` resolve to the
  // RUN'S workspace. Same pattern as the six sibling broadcasts.
  const onStateChanged = (): void => {
    // Resolve the snapshots + tenant SYNCHRONOUSLY inside the principal context;
    // the write-state join is async but only needs the tenantId string.
    const { snaps, workspaceId } = runOutsidePrincipal(() => ({
      snaps: snapshots(),
      // F-P45 — the evidence store is WORKSPACE-keyed. See `withWriteStates`.
      workspaceId: activeTenantScope()?.workspaceId ?? null,
    }));
    void withWriteStates(snaps, workspaceId).then((enriched) =>
      deps.broadcast(IpcChannel.ConnectorSyncState, enriched),
    );
  };
  syncStateStore.on('changed', onStateChanged);

  /**
   * P13C PART 3 — the scheduled sync now happens for EVERY workspace.
   *
   * Before this there was one tick, and everything inside it resolved through
   * the signed-in user's active workspace: `listConnectedAccounts()` returned
   * only that workspace's accounts and `activeTenantId()` returned only that
   * organization. So scheduled sync served exactly one workspace on the whole
   * install — the one the user happened to have open — and every other
   * workspace's connectors silently never synced. The single-tenant reading of
   * that behaviour is "it works"; the two-tenant reading is "tenant B's data is
   * permanently stale and nothing says so".
   *
   * Each pass runs under its own workspace principal, so both of those
   * resolvers answer for the workspace being synced. MANUAL sync is unchanged
   * and still runs on the caller's own session — it is an interactive request
   * with a real user behind it, not background work.
   */
  const scheduler = new SyncScheduler(SCHEDULER_INTERVAL_MS, () =>
    deps
      .forEachWorkspace('connector-sync', () => orchestrator.tick())
      .then(() => undefined),
  );
  scheduler.start();

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.ConnectorSyncState,
      schema: ConnectorSyncStateRequest,
      requireAuth: true,
      permission: 'connectors:read', // P4.1 RBAC
      handler: async (p) =>
        withWriteStates(
          snapshots((p as TConnectorSyncStateRequest).connectorId),
          // F-P45 — MINIMUM ACCOMPANIMENT, not scope creep (§2 #2). `withWriteStates` has TWO callers: this
          // on-demand IPC read and the live broadcast above. Correcting only one would leave the shared
          // parameter carrying a different namespace per caller — the panel would read 0 on first load and
          // real counts on the next sync event, or the reverse. An inconsistent contract is a worse defect
          // than the one being fixed, so both callers move together or neither does.
          activeTenantScope()?.workspaceId ?? null,
        ),
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
    serviceCapabilities: (connectorId, grantedScopes) => {
      // Google Workspace is a scope-gated family: the runtime source of truth is its service catalog
      // projected against the scopes Google actually granted (docs/sheets/slides ride the Drive scope).
      if (connectorId === 'google-workspace') {
        return googleServiceAvailability(grantedScopes).map((s) => ({
          id: s.id,
          label: s.label,
          kind: null,
          scope: s.scope,
          scopeGranted: s.available,
        }));
      }
      // GitHub is likewise a scope-gated family: project its service catalog against the granted scopes
      // (repo / read:org / notifications) for correct pre-flight ✓/✗, exactly like Google Workspace.
      if (connectorId === 'github') {
        return githubServiceAvailability(grantedScopes).map((s) => ({
          id: s.id,
          label: s.label,
          kind: null,
          scope: s.scope,
          scopeGranted: s.available,
        }));
      }
      // Slack is a scope-gated family too: project its service catalog against the granted BOT scopes
      // (channels:read / channels:history / users:read / files:read) for ✓/✗, exactly like the above.
      if (connectorId === 'slack') {
        return slackServiceAvailability(grantedScopes).map((s) => ({
          id: s.id,
          label: s.label,
          kind: null,
          scope: s.scope,
          scopeGranted: s.available,
        }));
      }
      // Atlassian (Jira + Confluence) is a scope-gated family too: project its service catalog against
      // the granted 3LO scopes (read:jira-work / read:confluence-*) for ✓/✗, exactly like the above.
      if (connectorId === 'atlassian') {
        return atlassianServiceAvailability(grantedScopes).map((s) => ({
          id: s.id,
          label: s.label,
          kind: null,
          scope: s.scope,
          scopeGranted: s.available,
        }));
      }
      // HubSpot (Sales/Service/Commerce hubs) is a scope-gated family too: project its CRM-object service
      // catalog against the granted per-object scopes (crm.objects.*.read / tickets / e-commerce) for ✓/✗,
      // exactly like the above. Runtime hub detection with nothing hardcoded.
      if (connectorId === 'hubspot') {
        return hubspotServiceAvailability(grantedScopes).map((s) => ({
          id: s.id,
          label: s.label,
          kind: s.kind,
          scope: s.scope,
          scopeGranted: s.available,
        }));
      }
      // Every other adapter: its declared resources are its services. No per-service scope gating — a
      // module's real availability surfaces at runtime through the per-module stats the Supervisor overlays.
      const adapter = getAdapter(connectorId);
      if (!adapter) return [];
      return describeAdapter(adapter).resources.map((r) => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        scope: null,
        scopeGranted: true,
      }));
    },
    dispose: () => {
      scheduler.stop();
      orchestrator.stop();
      syncStateStore.off('changed', onStateChanged);
    },
  };
}
