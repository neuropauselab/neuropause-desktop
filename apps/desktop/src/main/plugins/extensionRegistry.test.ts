/** P3.0 Increment 6 — plugin extension registry tests (register/replace, unregister, hot-reload clear, queries). */
import { describe, expect, it } from 'vitest';
import type { PluginExtension } from '@neuropause/shared';
import { PluginExtensionRegistry } from './extensionRegistry';

function ext(over: Partial<PluginExtension> = {}): PluginExtension {
  return {
    id: 'e1', pluginId: 'p1', pluginVersion: '1.0.0', kind: 'executive_kpi',
    label: 'L', spec: {}, registeredAt: '2026-01-01T00:00:00.000Z', ...over,
  };
}

describe('PluginExtensionRegistry', () => {
  it('registers, replaces by (plugin,kind,id), and queries by kind/plugin', () => {
    const r = new PluginExtensionRegistry();
    r.register(ext());
    r.register(ext({ label: 'L2' })); // same identity → replace
    expect(r.byKind('executive_kpi')).toHaveLength(1);
    expect(r.byKind('executive_kpi')[0].label).toBe('L2');
    r.register(ext({ id: 'e2', kind: 'graph_node' }));
    expect(r.all()).toHaveLength(2);
    expect(r.byPlugin('p1')).toHaveLength(2);
  });

  it('unregisters and clears a whole plugin (hot reload)', () => {
    const r = new PluginExtensionRegistry();
    r.register(ext());
    r.register(ext({ id: 'e2', pluginId: 'p2' }));
    expect(r.unregister('p1', 'executive_kpi', 'e1')).toBe(true);
    expect(r.all()).toHaveLength(1);

    r.register(ext({ id: 'e3' }));
    r.register(ext({ id: 'e4' }));
    expect(r.clearPlugin('p1')).toBe(2);
    expect(r.byPlugin('p1')).toHaveLength(0);
    expect(r.byPlugin('p2')).toHaveLength(1); // other plugin untouched
  });

  it('counts by kind and plugin', () => {
    const r = new PluginExtensionRegistry();
    r.register(ext());
    r.register(ext({ id: 'e2', kind: 'graph_node' }));
    const c = r.counts();
    expect(c.total).toBe(2);
    expect(c.byKind.executive_kpi).toBe(1);
    expect(c.byKind.graph_node).toBe(1);
    expect(c.byPlugin.p1).toBe(2);
  });
});
