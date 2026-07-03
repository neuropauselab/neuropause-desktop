/**
 * Plugin Loader — boots the plugin runtime: enables previously-enabled plugins
 * on startup and, when a dev plugins directory is configured, watches it to
 * hot-reload changed plugins. Discovery + validation happen in the Plugin
 * Manager; this service owns the startup + watch lifecycle.
 */
import { watch, type FSWatcher } from 'node:fs';
import { existsSync } from 'node:fs';
import { createLogger } from '../logger';
import { pluginManager } from '../plugins/pluginManager';

const log = createLogger('plugin-loader');

class PluginLoader {
  readonly name = 'plugin-loader';
  private watcher: FSWatcher | null = null;
  private debounce: NodeJS.Timeout | null = null;

  start(): void {
    void pluginManager.enablePersisted();

    const devDir = process.env.NEUROPAUSE_PLUGINS_DIR;
    if (devDir && existsSync(devDir)) {
      try {
        this.watcher = watch(devDir, { recursive: true }, () => this.onChange());
        log.info('Watching dev plugins for hot reload', { dir: devDir });
      } catch (err) {
        log.warn('Could not watch dev plugins dir', { message: (err as Error).message });
      }
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounce) clearTimeout(this.debounce);
  }

  private onChange(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.reloadDevPlugins();
    }, 400);
    this.debounce.unref?.();
  }

  private async reloadDevPlugins(): Promise<void> {
    await pluginManager.load();
    for (const p of pluginManager.list()) {
      if (p.state === 'enabled') {
        try {
          await pluginManager.reload(p.id);
          log.info('Hot-reloaded plugin', { id: p.id });
        } catch (err) {
          log.warn('Hot reload failed', { id: p.id, message: (err as Error).message });
        }
      }
    }
  }
}

export const pluginLoader = new PluginLoader();
