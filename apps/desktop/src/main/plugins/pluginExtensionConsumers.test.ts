/** P3.0 Increment 6 — plugin extension consumer tests (KPI + graph projection mapping). */
import { describe, expect, it } from 'vitest';
import type { PluginExtension } from '@neuropause/shared';
import { pluginExecutiveKpis, pluginGraphProjection } from './pluginExtensionConsumers';

function ext(over: Partial<PluginExtension> = {}): PluginExtension {
  return {
    id: 'e1', pluginId: 'p1', pluginVersion: '1', kind: 'executive_kpi',
    label: 'L', spec: {}, registeredAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

describe('pluginExecutiveKpis', () => {
  it('maps executive_kpi extensions to namespaced KPI tiles', () => {
    const kpis = pluginExecutiveKpis([
      ext({ id: 'rev', label: 'Revenue', spec: { value: 90, display: '$90k', band: 'healthy', deepLink: 'store' } }),
      ext({ id: 'x', kind: 'graph_node' }), // ignored (wrong kind)
    ]);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]).toMatchObject({ key: 'plugin:p1:rev', label: 'Revenue', value: 90, display: '$90k', band: 'healthy', deepLink: 'store' });
  });

  it('drops invalid bands and defaults the display', () => {
    const [k] = pluginExecutiveKpis([ext({ id: 'x', spec: { value: 5, band: 'weird' } })]);
    expect(k.band).toBeUndefined();
    expect(k.display).toBe('5');
  });
});

describe('pluginGraphProjection', () => {
  it('projects namespaced nodes + reference edges, skipping self-loops', () => {
    const { nodes, edges } = pluginGraphProjection(
      [
        ext({ id: 'n1', kind: 'graph_node', label: 'Node1' }),
        ext({ id: 'r1', kind: 'graph_relationship', label: 'rel', spec: { from: 'plugin:p1:n1', to: 'connector:x' } }),
        ext({ id: 'r2', kind: 'graph_relationship', spec: { from: 'a', to: 'a' } }), // self-loop → skipped
      ],
      '2026-01-01T00:00:00.000Z',
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'plugin:p1:n1', type: 'application', sourceKind: 'plugin:p1' });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ type: 'references', from: 'plugin:p1:n1', to: 'connector:x' });
  });
});
