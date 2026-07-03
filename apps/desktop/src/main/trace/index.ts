/**
 * Trace composition root. Wires the live UDM, Enterprise Timeline, AI Memory, and
 * Knowledge Graph into the three trace builders and exposes them over secure IPC.
 * Stateless — traces are computed on demand from derived state.
 */
import type {
  ContextTraceRequest as TContext,
  GovernanceTraceListRequest as TGovList,
  GovernanceTraceRequest as TGovTrace,
  RelationshipPathRequest as TRelPath,
  RelationshipTraceRequest as TRelTrace,
  TraceEntityRef,
} from '@neuropause/shared';
import {
  ContextTraceRequest,
  GovernanceTraceListRequest,
  GovernanceTraceRequest,
  IpcChannel,
  RelationshipPathRequest,
  RelationshipTraceRequest,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { unifiedStore } from '../unified/storeInstance';
import { graphStore } from '../graph/graphInstance';
import { memoryStore } from '../memory/memoryInstance';
import { getEnterpriseTimeline } from '../timeline';
import {
  buildContextTrace,
  buildGovernanceTrace,
  buildRelationshipPath,
  buildRelationshipTrace,
  listGovernanceDecisions,
  type TraceNeighbor,
} from './traceBuilders';

const log = createLogger('trace');

export interface TraceSubsystem {
  handlers: SecureHandlerDef[];
  dispose: () => void;
}

function neighborsOf(nodeId: string): TraceNeighbor[] {
  const n = graphStore.neighbors({ id: nodeId, limit: 100 });
  if (!n) return [];
  return n.neighbors.map((x) => ({
    id: x.node.id,
    type: x.node.type,
    label: x.node.label,
    connectorId: x.node.connectorId,
    updatedAt: x.node.updatedAt,
    rel: x.edge.type,
    direction: x.direction,
  }));
}

function resolveRef(nodeId: string): TraceEntityRef | null {
  const gn = graphStore.getNode(nodeId);
  if (!gn) return null;
  return { id: gn.id, kind: gn.type, title: gn.label, connectorId: gn.connectorId, at: gn.updatedAt };
}

function pathRefs(from: string, to: string): TraceEntityRef[] {
  const r = graphStore.path({ from, to });
  if (!r.path) return [];
  return r.nodes.map((gn) => ({
    id: gn.id,
    kind: gn.type,
    title: gn.label,
    connectorId: gn.connectorId,
    at: gn.updatedAt,
  }));
}

function snapshot() {
  const entities = unifiedStore.query({ limit: 1_000_000, includeDeleted: false }).items;
  const tl = getEnterpriseTimeline();
  const events = tl ? tl.query({ limit: 5000, order: 'desc' }).entries : [];
  const memories = memoryStore.recall({ limit: 100_000 }).hits.map((h) => h.item);
  return { entities, events, memories };
}

export function initTrace(): TraceSubsystem {
  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.GovernanceList,
      schema: GovernanceTraceListRequest,
      handler: (p) => {
        const req = p as TGovList;
        return listGovernanceDecisions(snapshot().memories, req.text, req.limit ?? 50);
      },
    },
    {
      channel: IpcChannel.GovernanceTrace,
      schema: GovernanceTraceRequest,
      handler: (p) => buildGovernanceTrace((p as TGovTrace).decisionId, snapshot()),
    },
    {
      channel: IpcChannel.ContextTrace,
      schema: ContextTraceRequest,
      handler: (p) => {
        const s = snapshot();
        return buildContextTrace((p as TContext).entityRef, { ...s, neighbors: neighborsOf });
      },
    },
    {
      channel: IpcChannel.RelationshipTrace,
      schema: RelationshipTraceRequest,
      handler: (p) =>
        buildRelationshipTrace((p as TRelTrace).nodeId, { resolveRef, neighbors: neighborsOf }),
    },
    {
      channel: IpcChannel.RelationshipPath,
      schema: RelationshipPathRequest,
      handler: (p) => {
        const req = p as TRelPath;
        return buildRelationshipPath(req.from, req.to, { pathRefs });
      },
    },
  ];

  log.info('Trace subsystem initialized', { traces: ['governance', 'context', 'relationship'] });
  return { handlers, dispose: () => undefined };
}
