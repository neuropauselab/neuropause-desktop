/**
 * Plugin extension registry (P3.0, Increment 6) — the single place plugin-contributed
 * extensions live. Electron-free + pure (no I/O), so it unit-tests directly; the
 * singleton at the bottom is what the plugin host + the consuming subsystems use.
 * Hot reload is `clearPlugin` (called when a plugin stops); versioning is the
 * `pluginVersion` stamped on each extension.
 */
import { EventEmitter } from 'node:events';
import type { PluginExtension, PluginExtensionCounts, PluginExtensionKind } from '@neuropause/shared';

function key(pluginId: string, kind: string, id: string): string {
  return `${pluginId}::${kind}::${id}`;
}

export class PluginExtensionRegistry extends EventEmitter {
  private items = new Map<string, PluginExtension>();

  /** Register (or replace, same plugin+kind+id) an extension. */
  register(ext: PluginExtension): PluginExtension {
    this.items.set(key(ext.pluginId, ext.kind, ext.id), ext);
    this.emit('changed');
    return ext;
  }

  unregister(pluginId: string, kind: PluginExtensionKind, id: string): boolean {
    const ok = this.items.delete(key(pluginId, kind, id));
    if (ok) this.emit('changed');
    return ok;
  }

  /** Hot-reload / cleanup: drop every extension a plugin contributed. Returns the count removed. */
  clearPlugin(pluginId: string): number {
    let n = 0;
    for (const [k, ext] of this.items) {
      if (ext.pluginId === pluginId) {
        this.items.delete(k);
        n += 1;
      }
    }
    if (n > 0) this.emit('changed');
    return n;
  }

  byKind(kind: PluginExtensionKind): PluginExtension[] {
    return [...this.items.values()].filter((e) => e.kind === kind);
  }
  byPlugin(pluginId: string): PluginExtension[] {
    return [...this.items.values()].filter((e) => e.pluginId === pluginId);
  }
  all(): PluginExtension[] {
    return [...this.items.values()];
  }

  counts(): PluginExtensionCounts {
    const byKind: Record<string, number> = {};
    const byPlugin: Record<string, number> = {};
    for (const e of this.items.values()) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      byPlugin[e.pluginId] = (byPlugin[e.pluginId] ?? 0) + 1;
    }
    return { total: this.items.size, byKind, byPlugin };
  }
}

/** The application singleton — the plugin host writes it; subsystems read it. */
export const pluginExtensionRegistry = new PluginExtensionRegistry();
