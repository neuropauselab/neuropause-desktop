/**
 * Enterprise Knowledge Graph composition root.
 *
 * Loads the persisted graph, then keeps it in sync with the Unified Data Model:
 * every time the unified store changes, it re-projects the UDM (plus connector
 * and installed-application provenance) into nodes and edges and applies the
 * result — which updates the relationship history. Exposes the read side over
 * the secure IPC bridge (counts, node lookup, node list/search, neighbors,
 * subgraph, shortest path, relationship history, manual rebuild) and broadcasts
 * a counts snapshot whenever the graph changes so the renderer can refresh live.
 *
 * It reads only the UDM and platform services — never a connector — per the
 * Phase 5 architecture.
 */
import type {
  GraphHistoryRequest as TGraphHistoryRequest,
  GraphNeighborsRequest as TGraphNeighborsRequest,
  GraphNodeRequest as TGraphNodeRequest,
  GraphNodesRequest as TGraphNodesRequest,
  GraphPathRequest as TGraphPathRequest,
  GraphSubgraphRequest as TGraphSubgraphRequest,
} from '@neuropause/shared';
import {
  EmptyRequest,
  GraphHistoryRequest,
  GraphNeighborsRequest,
  GraphNodeRequest,
  GraphNodesRequest,
  GraphPathRequest,
  GraphSubgraphRequest,
  IpcChannel,
} from '@neuropause/shared';
import type { PlatformEventType, ResourceGraphModel } from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { connectorService } from '../connectors/connectorService';
import { registry } from '../registry/registry';
import { unifiedStore } from '../unified/storeInstance';
import { activeTenantScope } from '../enterprise';
import type { BackgroundPrincipal } from '../tenancy/backgroundPrincipal';
import { runAsPrincipal, tenantPrincipal } from '../tenancy/backgroundPrincipal';
import { getRelationshipModel } from '../enterprise/relationshipProvider';
import { pluginExtensionRegistry } from '../plugins/extensionRegistry';
import { pluginGraphProjection } from '../plugins/pluginExtensionConsumers';
import { graphStore } from './graphInstance';
import { projectGraph } from './projector';
import { runOutsidePrincipal } from '../tenancy/backgroundPrincipal';

const log = createLogger('graph');

/** The job identity every principal this subsystem's reprojection mints carries. */
const REBUILD_JOB_ID = 'graph-reprojection';

/** P2.5 — ERP record + connector-write events that should re-project the graph (UDM 'changed' misses these). */
const GRAPH_REBUILD_EVENTS: readonly PlatformEventType[] = [
  'enterprise.record.created',
  'enterprise.record.updated',
  'enterprise.record.status_changed',
  'enterprise.record.deleted',
  'enterprise.record.converted',
  'connector.write_completed',
];

export interface GraphSubsystemDeps {
  broadcast: IpcBroadcaster;
  /** P2.5 — subscribe to platform events so ERP changes re-project the unified graph. */
  on?: (types: readonly PlatformEventType[], handler: () => void) => void;
  /** P7 — the P6 Resource Graph, merged into the same projection (read-only, guarded, lazy). */
  getResourceModel?: () => ResourceGraphModel | null;
  /** P7 — subscribe to infrastructure discovery changes so cloud/infra re-projects into the unified graph. */
  onResourceChanged?: (handler: () => void) => void;
}

export interface GraphSubsystem {
  handlers: SecureHandlerDef[];
  /** Re-project the graph from the UDM on demand (Recovery Center). */
  rebuild: () => void;
  dispose: () => void;
}

export async function initGraph(deps: GraphSubsystemDeps): Promise<GraphSubsystem> {
  await graphStore.load();

  /**
   * P13B — a rebuild has an owner, or it does not happen.
   *
   * The projection reads the (now scoped) unified store, so it can only see
   * one tenant's entities; the tenant is passed explicitly so the SYNTHESISED
   * node ids (`person:`, `connector:`, `app:`) are qualified too. Without a
   * resolved tenant there is nothing to project and nobody to own it.
   *
   * This is the IMMEDIATE path — `graph:rebuild` and the Recovery Center —
   * where the caller IS the request, so resolving here resolves at the only
   * moment there is. The DEBOUNCED path is `enqueueRebuild` below.
   */
  const rebuild = (): void => {
    const principal = tenantPrincipal({ jobId: REBUILD_JOB_ID, scope: activeTenantScope() });
    if (principal === null) {
      log.info('Graph rebuild skipped: no organization is active');
      return;
    }
    const tenantId = principal.tenantId as string;
    return runAsPrincipal(principal, () => rebuildUnderPrincipal(tenantId));
  };

  const rebuildUnderPrincipal = (tenantId: string): void => {
    const now = new Date().toISOString();
    const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
    const connectors = connectorService.list().map((c) => ({ id: c.id, name: c.name }));
    const applications = registry.list().map((a) => ({ slug: a.slug, name: a.name }));
    // P2.5 — unify the ERP business graph (customers, invoices, POs, machines, …) into the same projection.
    // Read-only, cached, derived from ERP records; guarded so graph rebuilds never fail if ERP isn't ready.
    let erpModel: ReturnType<typeof getRelationshipModel> | null = null;
    try {
      erpModel = getRelationshipModel();
    } catch (err) {
      log.warn('ERP relationship model unavailable for graph projection', { error: String(err) });
    }
    // P3.0 — plugin-contributed graph nodes/edges (Plugin SDK v2), merged into the same graph.
    const pluginExts = [
      ...pluginExtensionRegistry.byKind('graph_node'),
      ...pluginExtensionRegistry.byKind('graph_relationship'),
    ];
    const pluginProjection = pluginExts.length > 0 ? pluginGraphProjection(pluginExts, now) : null;
    // P7 — merge the P6 Resource Graph (cloud/infra/identity) into the SAME projection. Guarded so a graph rebuild
    // never fails if infrastructure isn't ready (discovery may not have run).
    let resourceModel: ResourceGraphModel | null = null;
    try {
      resourceModel = deps.getResourceModel?.() ?? null;
    } catch (err) {
      log.warn('Resource graph unavailable for graph projection', { error: String(err) });
    }
    const projection = projectGraph({ tenantId, entities, connectors, applications, now, erpModel, pluginProjection, resourceModel });
    const result = graphStore.apply(projection.nodes, projection.edges, now);
    log.info('Knowledge graph rebuilt', {
      nodes: projection.nodes.length,
      edges: projection.edges.length,
      ...result,
    });
  };

  const safeRebuild = (): void => {
    try {
      rebuild();
    } catch (err) {
      log.error('Graph rebuild failed', { error: String(err) });
    }
  };

  /**
   * ONE QUEUED REPROJECTION. P13C ROUND 10 — NEW-M10.
   *
   * The principal is a FIELD on the queue item rather than something the drain
   * works out — the contract `tenancy/backgroundPrincipal.ts` states: "captured
   * by the CALLER, at the moment the job is scheduled or enqueued — not resolved
   * inside `fn`".
   */
  interface QueuedReprojection {
    /** WHO THIS REPROJECTION IS FOR, decided when the change arrived. */
    principal: BackgroundPrincipal;
    tenantId: string;
    workspaceId: string;
    /** WHAT asked for it — the UDM, an ERP event, a plugin, or discovery. */
    operation: string;
    enqueuedAt: string;
  }

  /**
   * Keyed by tenant + workspace: a debounce coalesces WITHIN an owner, never
   * ACROSS one. Two organizations' stores can change inside the same 750 ms
   * window (a fanned-out sync writes A's records then B's), and folding those
   * into one job would mean silently dropping one tenant's reprojection.
   */
  const pendingReprojections = new Map<string, QueuedReprojection>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * THE ENQUEUE. Resolves the tenant HERE, where the caller's context is right.
   *
   * `tenantPrincipal({ scope: activeTenantScope() })` used to run INSIDE the
   * 750 ms `setTimeout` callback, so the tenant was resolved at DRAIN: a
   * workspace switch inside the debounce window made A's store change reproject
   * as B, with A's change silently never reprojected at all. `graphStore.apply`
   * is owner-scoped, so no cross-tenant write was reachable — what was wrong was
   * whose work ran, and the comment on `rebuild` asserted the opposite.
   *
   * Null means the change arrived with no resolvable tenant: DROPPED, not run
   * as whoever is on screen.
   */
  const enqueueRebuild = (operation: string): void => {
    const principal = tenantPrincipal({ jobId: REBUILD_JOB_ID, scope: activeTenantScope() });
    if (principal === null) {
      log.info('Graph reprojection not queued: no organization is active', { operation });
      return;
    }
    const workspaceId = principal.workspaceId ?? '';
    const key = `${principal.tenantId}::${workspaceId}`;
    if (!pendingReprojections.has(key)) {
      pendingReprojections.set(key, {
        principal,
        tenantId: principal.tenantId as string,
        workspaceId,
        operation,
        enqueuedAt: new Date().toISOString(),
      });
    }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      drainReprojections();
    }, 750);
  };

  /**
   * THE DRAIN. Each item under ITS OWN captured principal, and nothing here
   * reads `activeTenantScope()` — which is what makes the shared timer harmless.
   */
  const drainReprojections = (): void => {
    const items = [...pendingReprojections.values()];
    pendingReprojections.clear();
    for (const item of items) {
      try {
        runAsPrincipal(item.principal, () => rebuildUnderPrincipal(item.tenantId));
      } catch (err) {
        log.error('Graph rebuild failed', {
          tenantId: item.tenantId,
          operation: item.operation,
          error: String(err),
        });
      }
    }
  };

  const onUnifiedChanged = (): void => enqueueRebuild('unified-store:changed');
  const onPlatformRebuildEvent = (): void => enqueueRebuild('platform-event:record-changed');
  const onPluginExtensionsChanged = (): void => enqueueRebuild('plugin-extensions:changed');
  const onResourceModelChanged = (): void => enqueueRebuild('infrastructure:discovered');
  unifiedStore.on('changed', onUnifiedChanged);
  // P2.5 — ERP record + connector-write events also re-project the unified graph.
  // The handler runs inside `bus.publish`, so the publishing principal is still
  // in scope and the capture above names the event's own tenant.
  if (deps.on) deps.on(GRAPH_REBUILD_EVENTS, onPlatformRebuildEvent);
  // P3.0 — a plugin registering/removing graph extensions re-projects the graph.
  pluginExtensionRegistry.on('changed', onPluginExtensionsChanged);
  // P7 — infrastructure discovery changes re-project the unified graph (debounced with the rest).
  if (deps.onResourceChanged) deps.onResourceChanged(onResourceModelChanged);

  /**
   * First projection shortly after boot. Deliberately NOT queued: armed before
   * any change exists, so the enqueue moment and the fire moment are the same
   * moment and there is nothing earlier to capture.
   */
  const initialTimer = setTimeout(safeRebuild, 1500);

  /**
   * P13C ROUND 7 — COMPUTED FOR THE VIEWER, NOT FOR THE JOB.
   *
   * THE CLASS: a background pass runs as tenant A while the window in front of
   * the user is showing tenant B. Any value computed for the RENDERER during
   * that pass is computed under A's principal, so a correctly-scoped store
   * honestly answers for A — and the answer is delivered into B's window.
   *
   * The store is not the defect. The store is right, which is exactly why this
   * survived seven rounds of auditing stores: every isolation test on it passes,
   * because the boundary holds and the READER is standing on the wrong side of
   * it.
   *
   * `runOutsidePrincipal` exists for precisely this and had ONE caller in the
   * whole main process (the unread badge), with a comment describing the general
   * case. This is the general case, in the five other places it occurs.
   *
   * It grants nothing: leaving the principal falls back to the SESSION, so the
   * value is what the signed-in viewer is entitled to and never more.
   */
  const onChanged = (): void =>
    deps.broadcast(IpcChannel.GraphEventBroadcast, runOutsidePrincipal(() => graphStore.counts()));
  graphStore.on('changed', onChanged);

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.GraphCounts, schema: EmptyRequest, handler: () => graphStore.counts() },
    {
      channel: IpcChannel.GraphNode,
      schema: GraphNodeRequest,
      handler: (p) => graphStore.getNode((p as TGraphNodeRequest).id),
    },
    {
      channel: IpcChannel.GraphNodes,
      schema: GraphNodesRequest,
      handler: (p) => graphStore.listNodes(p as TGraphNodesRequest),
    },
    {
      channel: IpcChannel.GraphNeighbors,
      schema: GraphNeighborsRequest,
      handler: (p) => graphStore.neighbors(p as TGraphNeighborsRequest),
    },
    {
      channel: IpcChannel.GraphSubgraph,
      schema: GraphSubgraphRequest,
      handler: (p) => graphStore.subgraph(p as TGraphSubgraphRequest),
    },
    {
      channel: IpcChannel.GraphPath,
      schema: GraphPathRequest,
      handler: (p) => graphStore.path(p as TGraphPathRequest),
    },
    {
      channel: IpcChannel.GraphHistory,
      schema: GraphHistoryRequest,
      handler: (p) => graphStore.historyFor(p as TGraphHistoryRequest),
    },
    {
      channel: IpcChannel.GraphRebuild,
      schema: EmptyRequest,
      handler: () => {
        rebuild();
        return graphStore.counts();
      },
    },
  ];

  log.info('Knowledge graph initialized', graphStore.counts());

  return {
    handlers,
    rebuild,
    dispose: () => {
      unifiedStore.off('changed', onUnifiedChanged);
      pluginExtensionRegistry.off('changed', onPluginExtensionsChanged);
      graphStore.off('changed', onChanged);
      pendingReprojections.clear();
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    },
  };
}
