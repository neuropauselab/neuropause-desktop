/**
 * Plugin extension consumers (P3.0, Increment 6) — pure mappers that turn declarative
 * plugin extensions into the shapes the existing subsystems already accept. This is
 * how a sandboxed plugin's contributions flow into the platform WITHOUT any new
 * intelligence: executive_kpi → an ExecutiveKpi tile; graph_node/graph_relationship →
 * knowledge-graph nodes/edges. Plugin-contributed nodes/edges are namespaced so they
 * can never collide with real ones.
 */
import type { ExecutiveKpi, GraphEdge, GraphNode, PluginExtension } from '@neuropause/shared';

const KPI_BANDS = new Set(['healthy', 'watch', 'at-risk', 'critical']);

/** executive_kpi extensions → executive KPI tiles. Pure. */
export function pluginExecutiveKpis(exts: PluginExtension[]): ExecutiveKpi[] {
  return exts
    .filter((e) => e.kind === 'executive_kpi')
    .map((e) => {
      const value = typeof e.spec.value === 'number' ? e.spec.value : null;
      const band = KPI_BANDS.has(String(e.spec.band)) ? (e.spec.band as ExecutiveKpi['band']) : undefined;
      return {
        key: `plugin:${e.pluginId}:${e.id}`,
        label: e.label,
        value,
        display: typeof e.spec.display === 'string' ? e.spec.display : value !== null ? String(value) : '—',
        band,
        deepLink: typeof e.spec.deepLink === 'string' ? e.spec.deepLink : 'store',
      };
    });
}

/**
 * graph_node + graph_relationship extensions → knowledge-graph nodes/edges. Plugin
 * nodes are `plugin:<pluginId>:<id>` and use the neutral `application` node type; edges
 * reference node ids the plugin supplies (its own or real ones). Pure.
 */
export function pluginGraphProjection(exts: PluginExtension[], now: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const e of exts) {
    if (e.kind === 'graph_node') {
      nodes.push({
        id: `plugin:${e.pluginId}:${e.id}`,
        type: 'application',
        label: e.label,
        sourceKind: `plugin:${e.pluginId}`,
        sourceId: e.id,
        connectorId: null,
        createdAt: now,
        updatedAt: now,
        metadata: { plugin: e.pluginId, kind: 'plugin-node' },
      });
    } else if (e.kind === 'graph_relationship') {
      const from = String(e.spec.from ?? '');
      const to = String(e.spec.to ?? '');
      if (!from || !to || from === to) continue;
      edges.push({
        id: `plugin:${e.pluginId}:${from}|references|${to}`,
        type: 'references',
        from,
        to,
        label: e.label,
        createdAt: now,
        updatedAt: now,
        evidence: { kind: 'plugin', id: e.id },
        metadata: { plugin: e.pluginId },
      });
    }
  }
  return { nodes, edges };
}
