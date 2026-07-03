/**
 * Recovery action engine. Implements the operations the Recovery Center invokes,
 * composing existing capabilities rather than adding new ones:
 *
 *   - safeMode               : persist a flag the launcher reads to skip plugins
 *   - disablePlugins         : disable every enabled plugin
 *   - resetSettings          : clear app settings files (never user data)
 *   - restoreBackup          : delegate to the backup manager
 *   - repairInstallation     : repair each installed app via the package service
 *   - verifyIntegrity        : verify each installed app's package integrity
 *   - rebuildSearchIndexes   : re-index organizational memory
 *   - rebuildKnowledgeGraph  : re-project the knowledge graph from the UDM
 *
 * Safe Mode skips loading plugins WITHOUT mutating their persisted enabled/
 * disabled state, so leaving Safe Mode restores the user's prior plugin set.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  MaintenanceDomain,
  RecoveryAction,
  RecoveryActionResult,
  SafeModeState,
} from '@neuropause/shared';
import { createLogger } from '../logger';
import type { BackupManager } from '../backup/backupManager';

const log = createLogger('recovery');

/** Settings files cleared by Reset Settings — preferences only, never data. */
const SETTINGS_FILES = ['telemetry.json', 'crash-reporting.json', 'update-prefs.json', 'window-state.json'];

export interface RecoveryDeps {
  dataDir: string;
  listPlugins: () => { id: string; enabled?: boolean }[];
  disablePlugin: (id: string) => Promise<unknown>;
  listInstalledApps: () => string[];
  repairApp: (slug: string) => Promise<{ ok: boolean; message?: string | null }>;
  verifyApp: (slug: string) => Promise<{ ok: boolean; reason?: string | null }>;
  backup: BackupManager;
  rebuildGraph: () => void;
  rebuildSearch: () => void;
  now?: () => number;
}

export class RecoveryService {
  private readonly now: () => number;

  constructor(private readonly deps: RecoveryDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  private safeModePath(): string {
    return join(this.deps.dataDir, 'safe-mode.json');
  }

  /** Read the persisted Safe Mode flag (consumed by the launcher at startup). */
  async safeModeState(): Promise<SafeModeState> {
    try {
      const raw = JSON.parse(await fs.readFile(this.safeModePath(), 'utf8')) as SafeModeState;
      return { enabled: !!raw.enabled, reason: raw.reason ?? null, setAt: raw.setAt ?? null };
    } catch {
      return { enabled: false, reason: null, setAt: null };
    }
  }

  async run(action: RecoveryAction, params: { backupId?: string; domains?: MaintenanceDomain[]; reason?: string } = {}): Promise<RecoveryActionResult> {
    try {
      switch (action) {
        case 'safeMode':
          return await this.toggleSafeMode(params.reason ?? 'requested from Recovery Center');
        case 'disablePlugins':
          return await this.disablePlugins();
        case 'resetSettings':
          return await this.resetSettings();
        case 'restoreBackup':
          return await this.restoreBackup(params.backupId, params.domains);
        case 'repairInstallation':
          return await this.repairInstallation();
        case 'verifyIntegrity':
          return await this.verifyIntegrity();
        case 'rebuildSearchIndexes':
          return this.rebuildSearchIndexes();
        case 'rebuildKnowledgeGraph':
          return this.rebuildKnowledgeGraph();
        default:
          return this.fail(action, `unknown action: ${action as string}`);
      }
    } catch (err) {
      return this.fail(action, err instanceof Error ? err.message : String(err));
    }
  }

  private async toggleSafeMode(reason: string): Promise<RecoveryActionResult> {
    const current = await this.safeModeState();
    if (current.enabled) {
      await this.clearSafeMode();
      log.warn('Safe Mode disarmed');
      return {
        action: 'safeMode',
        ok: true,
        requiresRestart: true,
        message: 'Safe Mode disabled. Restart to load plugins normally.',
        detail: null,
      };
    }
    const state: SafeModeState = { enabled: true, reason, setAt: new Date(this.now()).toISOString() };
    await fs.writeFile(this.safeModePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
    log.warn('Safe Mode armed', { reason });
    return {
      action: 'safeMode',
      ok: true,
      requiresRestart: true,
      message: 'Safe Mode is armed. Restart the app to launch with plugins disabled.',
      detail: 'Plugin preferences are preserved; leaving Safe Mode restores your plugins.',
    };
  }

  /** Clear the Safe Mode flag (used by the launcher / "leave safe mode"). */
  async clearSafeMode(): Promise<void> {
    await fs.rm(this.safeModePath(), { force: true });
  }

  private async disablePlugins(): Promise<RecoveryActionResult> {
    const plugins = this.deps.listPlugins();
    let disabled = 0;
    for (const p of plugins) {
      if (p.enabled === false) continue;
      try {
        await this.deps.disablePlugin(p.id);
        disabled += 1;
      } catch (err) {
        log.warn('Failed to disable plugin', { id: p.id, message: (err as Error).message });
      }
    }
    return {
      action: 'disablePlugins',
      ok: true,
      requiresRestart: false,
      message: disabled === 0 ? 'No enabled plugins to disable.' : `Disabled ${disabled} plugin(s).`,
      detail: null,
    };
  }

  private async resetSettings(): Promise<RecoveryActionResult> {
    let cleared = 0;
    for (const name of SETTINGS_FILES) {
      try {
        await fs.rm(join(this.deps.dataDir, name), { force: true });
        cleared += 1;
      } catch {
        /* already absent */
      }
    }
    return {
      action: 'resetSettings',
      ok: true,
      requiresRestart: true,
      message: `Reset ${cleared} settings file(s) to defaults.`,
      detail: 'App settings were reset. Your registry, knowledge graph, memory, and workspaces were not touched.',
    };
  }

  private async restoreBackup(backupId?: string, domains?: MaintenanceDomain[]): Promise<RecoveryActionResult> {
    if (!backupId) return this.fail('restoreBackup', 'no backup id provided');
    const result = await this.deps.backup.restore(backupId, domains);
    return {
      action: 'restoreBackup',
      ok: result.ok,
      requiresRestart: true,
      message: result.ok ? `Restored ${result.restored.length} domain(s) from backup.` : `Restore failed: ${result.detail ?? 'unknown error'}`,
      detail: result.safetyBackupId ? `A safety backup of the prior state was saved (${result.safetyBackupId}).` : result.detail,
    };
  }

  private async repairInstallation(): Promise<RecoveryActionResult> {
    const slugs = this.deps.listInstalledApps();
    let repaired = 0;
    let failed = 0;
    for (const slug of slugs) {
      try {
        const r = await this.deps.repairApp(slug);
        if (r.ok) repaired += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      action: 'repairInstallation',
      ok: failed === 0,
      requiresRestart: false,
      message: `Repaired ${repaired}/${slugs.length} installed app(s)${failed ? `, ${failed} failed` : ''}.`,
      detail: null,
    };
  }

  private async verifyIntegrity(): Promise<RecoveryActionResult> {
    const slugs = this.deps.listInstalledApps();
    const failures: string[] = [];
    for (const slug of slugs) {
      try {
        const r = await this.deps.verifyApp(slug);
        if (!r.ok) failures.push(slug);
      } catch {
        failures.push(slug);
      }
    }
    return {
      action: 'verifyIntegrity',
      ok: failures.length === 0,
      requiresRestart: false,
      message: failures.length === 0 ? `All ${slugs.length} installed app(s) passed integrity verification.` : `${failures.length} app(s) failed verification: ${failures.join(', ')}.`,
      detail: null,
    };
  }

  private rebuildSearchIndexes(): RecoveryActionResult {
    this.deps.rebuildSearch();
    return {
      action: 'rebuildSearchIndexes',
      ok: true,
      requiresRestart: false,
      message: 'Search indexes rebuilt from organizational memory.',
      detail: null,
    };
  }

  private rebuildKnowledgeGraph(): RecoveryActionResult {
    this.deps.rebuildGraph();
    return {
      action: 'rebuildKnowledgeGraph',
      ok: true,
      requiresRestart: false,
      message: 'Knowledge graph re-projected from the Unified Data Model.',
      detail: null,
    };
  }

  private fail(action: RecoveryAction, message: string): RecoveryActionResult {
    log.warn('Recovery action failed', { action, message });
    return { action, ok: false, requiresRestart: false, message, detail: null };
  }
}
