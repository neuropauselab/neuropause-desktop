/**
 * Plugin Manager — the lifecycle authority for the Plugin Runtime SDK. It
 * discovers plugins, validates manifests, checks host compatibility, manages
 * install / enable / disable / update / reload / remove, owns permission grants
 * per plugin, exposes UI surface contributions, and (for code plugins) drives
 * the isolated plugin host. State persists in plugins.json.
 *
 * Permissions are granted at install time (standing in for the install-time
 * prompt until the dialog UI lands in Stage 3) and are revocable later. Crash
 * recovery is delegated to the plugin host's process supervision; a crashed
 * plugin is marked unhealthy and can be reloaded.
 */
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type {
  HealthStatus,
  PluginContribution,
  PluginDto,
  PluginInstallResult,
  PluginManifest,
  PluginState,
  PluginSurfaceKind,
  RuntimePermissionKey,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import { validateManifest, satisfiesRange } from './manifest';
import { pluginHost } from './pluginHost';

const log = createLogger('plugins');
const MANIFEST_FILE = 'neuropause.plugin.json';

interface PluginRecord {
  id: string;
  root: string;
  enabled: boolean;
  version: string;
  grantedPermissions: RuntimePermissionKey[];
  installedAt: string;
  updatedAt: string;
  /** True for plugins loaded in place from the dev dir (not copied/managed). */
  dev: boolean;
}

interface Loaded {
  manifest: PluginManifest;
  record: PluginRecord;
  lastError: string | null;
}

interface StateFile {
  schemaVersion: number;
  plugins: Record<string, PluginRecord>;
}

function managedDir(): string {
  return join(app.getPath('userData'), 'plugins');
}
function statePath(): string {
  return join(app.getPath('userData'), 'plugins.json');
}
function devDir(): string | null {
  return process.env.NEUROPAUSE_PLUGINS_DIR || null;
}

async function readManifestFrom(root: string): Promise<PluginManifest | null> {
  const file = join(root, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const v = validateManifest(raw);
    return v.ok ? v.manifest : null;
  } catch {
    return null;
  }
}

class PluginManager {
  private plugins = new Map<string, Loaded>();
  private records: Record<string, PluginRecord> = {};

  private hostVersion(): string {
    return app.getVersion();
  }

  async load(): Promise<void> {
    await fs.mkdir(managedDir(), { recursive: true });
    // persisted records
    try {
      const state = JSON.parse(await fs.readFile(statePath(), 'utf8')) as StateFile;
      this.records = state.plugins ?? {};
    } catch {
      this.records = {};
    }
    this.plugins.clear();

    // managed plugins (installed under userData/plugins)
    await this.discoverInto(managedDir(), false);
    // dev plugins (loaded in place if NEUROPAUSE_PLUGINS_DIR is set)
    const dd = devDir();
    if (dd && existsSync(dd)) await this.discoverInto(dd, true);

    log.info('Plugins loaded', { count: this.plugins.size });
  }

  private async discoverInto(dir: string, dev: boolean): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const root = join(dir, name);
      const manifest = await readManifestFrom(root);
      if (!manifest) continue;
      const existing = this.records[manifest.id];
      const record: PluginRecord =
        existing && existing.root === root
          ? existing
          : {
              id: manifest.id,
              root,
              enabled: existing?.enabled ?? false,
              version: manifest.version,
              grantedPermissions: existing?.grantedPermissions ?? manifest.permissions,
              installedAt: existing?.installedAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              dev,
            };
      this.records[manifest.id] = record;
      this.plugins.set(manifest.id, { manifest, record, lastError: null });
    }
  }

  private async persist(): Promise<void> {
    const state: StateFile = { schemaVersion: 1, plugins: this.records };
    const tmp = `${statePath()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, statePath());
  }

  private compatible(manifest: PluginManifest): boolean {
    return satisfiesRange(this.hostVersion(), manifest.engine.neuropause);
  }

  private state(loaded: Loaded): PluginState {
    if (loaded.lastError) return 'error';
    if (loaded.record.enabled) return 'enabled';
    return 'disabled';
  }

  private toDto(loaded: Loaded): PluginDto {
    const { manifest, record } = loaded;
    const running = pluginHost.statusOf(manifest.id);
    const health: HealthStatus =
      loaded.lastError ? 'unhealthy' : record.enabled && manifest.kind !== 'ui'
        ? running === 'running'
          ? 'healthy'
          : running === 'crashed'
            ? 'unhealthy'
            : 'unknown'
        : 'unknown';
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      kind: manifest.kind,
      state: this.state(loaded),
      health,
      runtimeStatus: manifest.kind === 'ui' ? 'stopped' : running,
      permissions: manifest.permissions,
      grantedPermissions: record.grantedPermissions,
      contributions: manifest.contributions,
      engineRange: manifest.engine.neuropause,
      compatible: this.compatible(manifest),
      lastError: loaded.lastError,
      source: record.root,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
    };
  }

  list(): PluginDto[] {
    return [...this.plugins.values()].map((l) => this.toDto(l));
  }
  get(id: string): PluginDto | null {
    const l = this.plugins.get(id);
    return l ? this.toDto(l) : null;
  }

  contributions(surface?: PluginSurfaceKind): PluginContribution[] {
    const out: PluginContribution[] = [];
    for (const l of this.plugins.values()) {
      if (!l.record.enabled) continue;
      for (const c of l.manifest.contributions) {
        if (!surface || c.surface === surface) out.push(c);
      }
    }
    return out;
  }

  /* ── lifecycle ── */

  async install(source: string): Promise<PluginInstallResult> {
    if (!existsSync(source)) return { ok: false, plugin: null, message: 'Source not found', incompatible: false, missingPermissions: [] };
    const manifest = await readManifestFrom(source);
    if (!manifest) {
      return { ok: false, plugin: null, message: 'Invalid or missing manifest', incompatible: false, missingPermissions: [] };
    }
    const compatible = this.compatible(manifest);
    const dest = join(managedDir(), manifest.id);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(source, dest, { recursive: true });

    const now = new Date().toISOString();
    const existing = this.records[manifest.id];
    const record: PluginRecord = {
      id: manifest.id,
      root: dest,
      enabled: existing?.enabled ?? false,
      version: manifest.version,
      // Install-time grant of requested permissions (revocable later).
      grantedPermissions: manifest.permissions,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      dev: false,
    };
    this.records[manifest.id] = record;
    this.plugins.set(manifest.id, { manifest, record, lastError: null });
    await this.persist();
    log.info('Plugin installed', { id: manifest.id, version: manifest.version });
    return { ok: true, plugin: this.get(manifest.id), message: null, incompatible: !compatible, missingPermissions: [] };
  }

  async enable(id: string): Promise<PluginDto> {
    const loaded = this.require(id);
    if (!this.compatible(loaded.manifest)) {
      loaded.lastError = `Incompatible: requires NeuroPause ${loaded.manifest.engine.neuropause}`;
      throw new Error(loaded.lastError);
    }
    loaded.lastError = null;
    loaded.record.enabled = true;
    await this.persist();
    if (loaded.manifest.kind !== 'ui') {
      try {
        await pluginHost.start(loaded.manifest, loaded.record.root, loaded.record.grantedPermissions);
      } catch (err) {
        loaded.lastError = (err as Error).message;
        loaded.record.enabled = false;
        await this.persist();
        throw err;
      }
    }
    return this.toDto(loaded);
  }

  async disable(id: string): Promise<PluginDto> {
    const loaded = this.require(id);
    loaded.record.enabled = false;
    await this.persist();
    if (loaded.manifest.kind !== 'ui') await pluginHost.stop(id);
    return this.toDto(loaded);
  }

  async reload(id: string): Promise<PluginDto> {
    const loaded = this.require(id);
    const wasEnabled = loaded.record.enabled;
    if (loaded.manifest.kind !== 'ui') await pluginHost.stop(id);
    // Re-read the manifest from disk so code/manifest changes are picked up.
    const fresh = await readManifestFrom(loaded.record.root);
    if (fresh) loaded.manifest = fresh;
    if (wasEnabled) return this.enable(id);
    return this.toDto(loaded);
  }

  async update(id: string): Promise<PluginInstallResult> {
    const loaded = this.require(id);
    // Re-install from the plugin's own root re-reads its (possibly bumped) manifest.
    const res = await this.install(loaded.record.root);
    if (res.ok && loaded.record.enabled) await this.reload(id);
    return res;
  }

  async remove(id: string): Promise<{ ok: boolean }> {
    const loaded = this.plugins.get(id);
    if (!loaded) return { ok: false };
    if (loaded.manifest.kind !== 'ui') await pluginHost.stop(id);
    if (!loaded.record.dev) await fs.rm(loaded.record.root, { recursive: true, force: true });
    this.plugins.delete(id);
    delete this.records[id];
    await this.persist();
    return { ok: true };
  }

  async grant(id: string, permission: RuntimePermissionKey): Promise<PluginDto> {
    const loaded = this.require(id);
    if (!loaded.record.grantedPermissions.includes(permission)) {
      loaded.record.grantedPermissions.push(permission);
      await this.persist();
    }
    return this.toDto(loaded);
  }

  async revoke(id: string, permission: RuntimePermissionKey): Promise<PluginDto> {
    const loaded = this.require(id);
    loaded.record.grantedPermissions = loaded.record.grantedPermissions.filter((p) => p !== permission);
    await this.persist();
    return this.toDto(loaded);
  }

  /** Enables all plugins marked enabled. Called by the Plugin Loader on startup. */
  async enablePersisted(): Promise<void> {
    for (const loaded of this.plugins.values()) {
      if (loaded.record.enabled) {
        try {
          await this.enable(loaded.manifest.id);
        } catch (err) {
          log.warn('Failed to enable plugin on startup', { id: loaded.manifest.id, message: (err as Error).message });
        }
      }
    }
  }

  private require(id: string): Loaded {
    const l = this.plugins.get(id);
    if (!l) throw new Error(`Plugin ${id} not found`);
    return l;
  }
}

export const pluginManager = new PluginManager();
