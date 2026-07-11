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
import type { PlatformEventType } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { connectorService } from '../connectors/connectorService';
import { registry } from '../registry/registry';
import { unifiedStore } from '../unified/storeInstance';
import { getRelationshipModel } from '../enterprise/relationshipProvider';
import { pluginExtensionRegistry } from '../plugins/extensionRegistry';
import { pluginGraphProjection } from '../plugins/pluginExtensionConsumers';
import { graphStore } from './graphInstance';
import { projectGraph } from './projector';

const log = createLogger('graph');

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
  broadcast: (channel: string, payload: unknown) => void;
  /** P2.5 — subscribe to platform events so ERP changes re-project the unified graph. */
  on?: (types: readonly PlatformEventType[], handler: () => void) => void;
}

export interface GraphSubsystem {
  handlers: SecureHandlerDef[];
  /** Re-project the graph from the UDM on demand (Recovery Center). */
  rebuild: () => void;
  dispose: () => void;
}

export async function initGraph(deps: GraphSubsystemDeps): Promise<GraphSubsystem> {
  await graphStore.load();

  const rebuild = (): void => {
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
    const projection = projectGraph({ entities, connectors, applications, now, erpModel, pluginProjection });
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

  // Debounce rebuilds so a burst of unified-store writes coalesces into one.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRebuild = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      safeRebuild();
    }, 750);
  };
  unifiedStore.on('changed', scheduleRebuild);
  // P2.5 — ERP record + connector-write events also re-project the unified graph.
  if (deps.on) deps.on(GRAPH_REBUILD_EVENTS, scheduleRebuild);
  // P3.0 — a plugin registering/removing graph extensions re-projects the graph.
  pluginExtensionRegistry.on('changed', scheduleRebuild);

  // First projection shortly after boot, once the store has settled.
  const initialTimer = setTimeout(safeRebuild, 1500);

  const onChanged = (): void => deps.broadcast(IpcChannel.GraphEventBroadcast, graphStore.counts());
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
      unifiedStore.off('changed', scheduleRebuild);
      pluginExtensionRegistry.off('changed', scheduleRebuild);
      graphStore.off('changed', onChanged);
      if (timer) clearTimeout(timer);
      clearTimeout(initialTimer);
    },
  };
}
