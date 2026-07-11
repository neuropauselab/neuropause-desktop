/** P3.0 Increment 6 — plugin extension host-call tests (permission gating, kind validation, sanitization). */
import { describe, expect, it } from 'vitest';
import type { RuntimePermissionKey } from '@neuropause/shared';
import { PluginExtensionRegistry } from './extensionRegistry';
import { applyExtensionCall, type ExtensionCallContext } from './extensionHostCalls';

function ctx(perms: RuntimePermissionKey[]): ExtensionCallContext {
  return {
    pluginId: 'p1',
    pluginVersion: '2.1.0',
    hasPermission: (p) => perms.includes(p),
    now: () => '2026-01-01T00:00:00.000Z',
  };
}

describe('applyExtensionCall', () => {
  it('registers when the plugin holds the required permission, stamping version', () => {
    const r = new PluginExtensionRegistry();
    const res = applyExtensionCall(r, ctx(['background']), 'extension.register', {
      kind: 'executive_kpi', id: 'k1', label: 'Revenue', spec: { value: 80, display: '80', band: 'healthy' },
    });
    expect(res).toEqual({ ok: true, id: 'k1' });
    const [e] = r.byKind('executive_kpi');
    expect(e.pluginVersion).toBe('2.1.0');
    expect(e.spec).toEqual({ value: 80, display: '80', band: 'healthy' });
  });

  it('denies registration without the mapped permission', () => {
    const r = new PluginExtensionRegistry();
    expect(() => applyExtensionCall(r, ctx([]), 'extension.register', { kind: 'executive_kpi', id: 'k1' })).toThrow(/Permission "background"/);
    expect(() => applyExtensionCall(r, ctx(['background']), 'extension.register', { kind: 'automation_action', id: 'a1' })).toThrow(/Permission "automation"/);
    expect(applyExtensionCall(r, ctx(['automation']), 'extension.register', { kind: 'automation_action', id: 'a1' })).toEqual({ ok: true, id: 'a1' });
  });

  it('rejects unknown kinds + empty id, and sanitizes non-scalar spec values', () => {
    const r = new PluginExtensionRegistry();
    expect(() => applyExtensionCall(r, ctx(['background']), 'extension.register', { kind: 'bogus', id: 'x' })).toThrow(/Unknown extension kind/);
    expect(() => applyExtensionCall(r, ctx(['background']), 'extension.register', { kind: 'executive_kpi', id: '' })).toThrow(/id is required/);
    applyExtensionCall(r, ctx(['background']), 'extension.register', {
      kind: 'executive_kpi', id: 'k', spec: { ok: 'yes', n: 5, flag: true, nested: { a: 1 }, arr: [1, 2] },
    });
    expect(r.byKind('executive_kpi')[0].spec).toEqual({ ok: 'yes', n: 5, flag: true }); // nested/arr dropped
  });

  it('unregisters', () => {
    const r = new PluginExtensionRegistry();
    applyExtensionCall(r, ctx(['background']), 'extension.register', { kind: 'executive_kpi', id: 'k' });
    expect(applyExtensionCall(r, ctx(['background']), 'extension.unregister', { kind: 'executive_kpi', id: 'k' })).toEqual({ ok: true });
    expect(r.all()).toHaveLength(0);
  });
});
