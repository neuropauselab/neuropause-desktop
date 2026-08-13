/**
 * Medical Device Pack — traceability queries.
 *
 * Thin by design: the traversal itself is pure and lives in
 * `medicalDeviceTrace.ts`, where it is tested without a store. This file does
 * the three things that need the runtime — scope the graph to the tenant,
 * resolve node labels to something a person recognizes, and state honestly what
 * the answer does and does not cover.
 *
 * The `scopeNote` on every result exists because a trace that returns nothing
 * is ambiguous in the worst possible way: it could mean "this lot went nowhere"
 * or "nothing was ever recorded". The note says which.
 */
import type {
  DeviceTraceView,
  TraceNodeRef,
  TraceNodeType,
  TraceResult,
} from '@neuropause/shared';
import {
  TRACE_NODE_TYPES,
  deviceLotFromRecord,
  deviceProductFromRecord,
  toTraceLines,
  traceBackward,
  traceForward,
} from '@neuropause/shared';
import type { EnterpriseModule } from '../enterprise/framework';
import type { TraceEdgeStore } from './traceStore';

export interface TraceServiceDeps {
  lots: EnterpriseModule;
  products: EnterpriseModule;
  edges: TraceEdgeStore;
  tenantId: () => string;
  authorize: (permission: 'medicalDevice:traceability.read') => void;
}

export class TraceService {
  constructor(private readonly deps: TraceServiceDeps) {}

  async forward(nodeType: TraceNodeType, nodeId: string, maxDepth?: number): Promise<DeviceTraceView> {
    return this.run('forward', nodeType, nodeId, maxDepth);
  }

  async backward(nodeType: TraceNodeType, nodeId: string, maxDepth?: number): Promise<DeviceTraceView> {
    return this.run('backward', nodeType, nodeId, maxDepth);
  }

  private async run(
    direction: 'forward' | 'backward',
    nodeType: TraceNodeType,
    nodeId: string,
    maxDepth?: number,
  ): Promise<DeviceTraceView> {
    this.deps.authorize('medicalDevice:traceability.read');
    await this.deps.lots.store.load();
    await this.deps.products.store.load();

    const tenantId = this.deps.tenantId();
    const edges = this.deps.edges.forTenant(tenantId);
    const root = await this.resolveRef(nodeType, nodeId);

    const options = maxDepth ? { maxDepth } : undefined;
    const result: TraceResult =
      direction === 'forward' ? traceForward(edges, root, options) : traceBackward(edges, root, options);

    // Re-label every node from the live records. Edges carry the label that was
    // true when they were written; a lot renumbered since would otherwise
    // display under a number that no longer exists.
    const relabelled = await this.relabel(result);

    return {
      result: relabelled,
      lines: toTraceLines(relabelled),
      root,
      truncated: relabelled.truncated,
      scopeNote: this.scopeNote(direction, relabelled, edges.length),
    };
  }

  /** Resolve a node id to a ref with the label the record actually carries. */
  private async resolveRef(type: TraceNodeType, id: string): Promise<TraceNodeRef> {
    if (type === 'lot') {
      const record = this.deps.lots.store.get(id);
      if (record && String(record.metadata?.tenantId ?? '') === this.deps.tenantId()) {
        return { type, id, label: deviceLotFromRecord(record).lotNumber };
      }
    }
    if (type === 'product') {
      const record = this.deps.products.store.get(id);
      if (record && String(record.metadata?.tenantId ?? '') === this.deps.tenantId()) {
        return { type, id, label: deviceProductFromRecord(record).productCode };
      }
    }
    // Warehouses, shipments, customers, orders and suppliers are referenced by
    // the business code the source system used. The code IS the label — inventing
    // a friendlier one would mean guessing at a record this pack does not own.
    return { type, id, label: id };
  }

  private async relabel(result: TraceResult): Promise<TraceResult> {
    const label = async (ref: TraceNodeRef): Promise<TraceNodeRef> =>
      ref.type === 'lot' || ref.type === 'product' ? this.resolveRef(ref.type, ref.id) : ref;
    const nodes = await Promise.all(result.nodes.map(label));
    const byId = new Map(nodes.map((n) => [`${n.type}:${n.id}`, n]));
    const swap = (ref: TraceNodeRef): TraceNodeRef => byId.get(`${ref.type}:${ref.id}`) ?? ref;
    return {
      ...result,
      root: swap(result.root),
      nodes,
      steps: result.steps.map((s) => ({
        ...s,
        edge: { ...s.edge, from: swap(s.edge.from), to: swap(s.edge.to) },
      })),
      // Rebuilt key-by-key rather than via `Object.fromEntries`, so the result
      // is a complete `Record<TraceNodeType, …>` by construction and a new node
      // type added later fails to compile here instead of arriving as an
      // undefined bucket at a call site.
      byType: TRACE_NODE_TYPES.reduce(
        (acc, type) => {
          acc[type] = (result.byType[type] ?? []).map(swap);
          return acc;
        },
        {} as Record<TraceNodeType, TraceNodeRef[]>,
      ),
    };
  }

  /**
   * What this answer covers.
   *
   * The distinction that matters: an empty result because nothing was recorded
   * is not the same as an empty result because the material went nowhere, and a
   * truncated result is not a complete one. Each gets its own sentence.
   */
  private scopeNote(direction: 'forward' | 'backward', result: TraceResult, tenantEdgeCount: number): string {
    const question =
      direction === 'forward' ? 'Where this went' : 'What went into this';
    if (tenantEdgeCount === 0) {
      return `${question}: nothing has been recorded yet. No lots have been consumed, moved, split or shipped in this workspace, so there is no trace to show — this is not a statement that the material went nowhere.`;
    }
    if (result.steps.length === 0) {
      return `${question}: no recorded movement. ${tenantEdgeCount} traceability records exist in this workspace, and none of them touch this item.`;
    }
    const truncation = result.truncated
      ? ' The walk stopped at its depth or size limit, so there may be more beyond what is shown.'
      : '';
    return `${question}: ${result.steps.length} recorded step${result.steps.length === 1 ? '' : 's'} across ${result.nodes.length} item${result.nodes.length === 1 ? '' : 's'}. Every step is a record of something that happened — nothing here is inferred from a name that looks similar.${truncation}`;
  }
}
