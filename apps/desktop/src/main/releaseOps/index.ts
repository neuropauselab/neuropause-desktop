/**
 * Release Operations composition root. Constructs the reliability engines
 * (migration, backup, recovery, support bundle, release diagnostics), wires them
 * to existing services, and exposes them over the secure IPC bridge as one unit.
 *
 * It also exposes two startup hooks for the launcher:
 *   - safeModeState()        : whether to start with plugins skipped
 *   - runStartupMigrations() : apply any pending data migrations before use
 *
 * Backups are shared by the migration engine (pre-migration snapshot + restore)
 * and the Recovery Center (restore), so they are constructed once here.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, shell } from 'electron';
import { suppressShutdownFlushOnce } from '../shutdownFlush';
import {
  BackupCreateRequest,
  BackupIdRequest,
  BackupRestoreRequest,
  CrashSetOptInRequest,
  CrashReportRequest,
  EmptyRequest,
  IpcChannel,
  MigrationRunRequest,
  RecoveryRunRequest,
} from '@neuropause/shared';
import type {
  BackupInfo,
  DiagnosticsReport,
  InstalledModule,
  MigrationReport,
  MigrationStatus,
  SafeModeState,
} from '@neuropause/shared';
import type { IpcBroadcaster } from '@neuropause/shared';
import { createLogger } from '../logger';
import { runAsPrincipal, systemPrincipal } from '../tenancy/backgroundPrincipal';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import { getBuildInfo } from '../buildInfo';
import { appUpdater } from '../services/appUpdater';
import { crashReporter } from '../services/crashReporter';
import { registry } from '../registry/registry';
import { connectorService } from '../connectors/connectorService';
import { pluginManager } from '../plugins/pluginManager';
import { packageService } from '../nps/packageService';
import { MigrationEngine, shouldRelaunchAfterMigration } from '../migration/migrationEngine';
import { MIGRATIONS } from '../migration/migrations';
import { BackupManager, LOCAL_DOMAINS } from '../backup/backupManager';
import { RecoveryService } from '../recovery/recoveryService';
import { SupportBundleGenerator } from '../support/supportBundle';
import {
  collectReleaseDiagnostics,
  formatDiagnosticsText,
  type ReleaseDiagnosticsDeps,
} from '../diagnostics/releaseDiagnostics';
import { probeSigningStatus } from '../diagnostics/signingStatus';

const log = createLogger('release-ops');

/**
 * P13C ROUND 37 — GATE 16. A restore that requires a restart GETS one.
 *
 * The delay lets the IPC response reach the renderer first (its restore flow
 * shows the result before the relaunch). `app.quit()` — never `exit()` — so
 * the round-37 shutdown flush barrier drains… which is also why the relaunch
 * is SAFE for the restore itself: the safety snapshot was taken pre-copy, the
 * restored files are complete (atomic per-file rename), and the flushes that
 * drain at quit are the same stale in-memory state that made the restart
 * necessary — they persist over the restore ONCE, and the relaunched process
 * reloads from disk… so the flush must be SKIPPED for a restore-relaunch.
 * `suppressShutdownFlushOnce` does exactly that: after a restore, stale
 * memory must NOT win the race against the restored bytes.
 */
let restoreRelaunchScheduled = false;
function scheduleRestoreRelaunch(cause: string): void {
  if (restoreRelaunchScheduled) return;
  restoreRelaunchScheduled = true;
  log.info('Restore requires a restart — relaunching', { cause });
  setTimeout(() => {
    suppressShutdownFlushOnce(`restore relaunch (${cause})`);
    app.relaunch();
    app.quit();
  }, 1500);
}
const HEAVY_TIMEOUT_MS = 120_000;
const SCHEDULED_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_BACKUP_KEEP = 10;

export interface ReleaseOpsDeps {
  broadcast: IpcBroadcaster;
  /** The platform's authoritative component/database/connector health report. */
  platformDiagnostics: () => Promise<DiagnosticsReport>;
  rebuildGraph: () => void;
  rebuildSearch: () => void;
}

export interface ReleaseOps {
  handlers: SecureHandlerDef[];
  safeModeState: () => Promise<SafeModeState>;
  runStartupMigrations: () => Promise<void>;
  /**
   * Phase 6 Stage 9 — a READ-ONLY accessor over the local backup manager's
   * list, for the Operations Platform's continuity composition. Additive and
   * side-effect-free: no channel, no mutation, no new state — the same list
   * the existing recovery IPC already serves.
   */
  listBackups: () => Promise<BackupInfo[]>;
  dispose: () => void;
}

export async function initReleaseOps(deps: ReleaseOpsDeps): Promise<ReleaseOps> {
  const dataDir = app.getPath('userData');
  const backupsDir = join(dataDir, 'backups');
  const supportDir = join(dataDir, 'support');
  const versionPath = join(dataDir, 'data-version.json');
  const auditPath = join(dataDir, 'migration-audit.json');

  let cachedVersion = 0;

  async function readVersion(): Promise<number> {
    try {
      const raw = JSON.parse(await fs.readFile(versionPath, 'utf8')) as { version: number };
      cachedVersion = typeof raw.version === 'number' ? raw.version : 0;
    } catch {
      cachedVersion = 0;
    }
    return cachedVersion;
  }
  async function writeVersion(v: number): Promise<void> {
    cachedVersion = v;
    await fs.writeFile(versionPath, JSON.stringify({ version: v }, null, 2), { mode: 0o600 });
  }
  await readVersion();

  /**
   * P13C ROUND 10 — F22. THE RESTORATION BOUNDARY, DECLARED AT THE COMPOSITION
   * ROOT AND ENFORCED BY THE MANAGER.
   *
   * `restoreBoundary` is a REQUIRED dependency, so this wiring cannot exist
   * without stating in source what its restores put back. `ALL_TENANTS_AT_ONCE`
   * is not a euphemism: the archive is a verbatim, unpartitioned copy of every
   * organization's records, so one operator choosing one archive rolls every
   * tenant on the machine back to that point. The per-call acknowledgements
   * below override this one so the audit and any refusal name the exact surface
   * that asked. See backup/backupArchive.ts for the full declaration and for
   * what this does NOT do — it does not narrow the blast radius, it makes
   * crossing it explicit and refusable.
   */
  const backup = new BackupManager({
    dataDir,
    backupsDir,
    appVersion: getBuildInfo().version,
    dataVersion: () => cachedVersion,
    restoreBoundary: {
      boundary: 'ALL_TENANTS_AT_ONCE',
      declaredBy: 'releaseOps composition root (Recovery Center + migration rollback)',
    },
  });

  const engine = new MigrationEngine({
    getCurrentVersion: () => readVersion(),
    setCurrentVersion: (v) => writeVersion(v),
    definitions: MIGRATIONS,
    backup: async () => (await backup.create('pre-migration', LOCAL_DOMAINS)).id,
    restore: async (id) => {
      await backup.restore(id, undefined, {
        boundary: 'ALL_TENANTS_AT_ONCE',
        declaredBy: 'migration rollback',
      });
    },
    context: { dataDir, log: (m, meta) => log.info(m, meta) },
  });

  const recovery = new RecoveryService({
    dataDir,
    listPlugins: () =>
      pluginManager.list().map((p) => ({ id: p.id, enabled: p.state === 'enabled' })),
    disablePlugin: (id) => pluginManager.disable(id),
    listInstalledApps: () => registry.list().map((e) => e.slug),
    repairApp: (slug) => packageService.repair(slug),
    verifyApp: (slug) => packageService.verify(slug),
    backup,
    rebuildGraph: deps.rebuildGraph,
    rebuildSearch: deps.rebuildSearch,
  });

  // ── migration audit log ──
  async function readAudit(): Promise<MigrationReport[]> {
    try {
      return JSON.parse(await fs.readFile(auditPath, 'utf8')) as MigrationReport[];
    } catch {
      return [];
    }
  }
  async function appendAudit(report: MigrationReport): Promise<void> {
    const history = await readAudit();
    history.push(report);
    await fs.writeFile(auditPath, JSON.stringify(history.slice(-50), null, 2), { mode: 0o600 });
  }

  async function migrationStatus(): Promise<MigrationStatus> {
    const status = await engine.status();
    const history = await readAudit();
    return { ...status, lastRun: history.length ? history[history.length - 1] : null };
  }
  async function migrationRun(req: { dryRun?: boolean }): Promise<MigrationReport> {
    const report = await engine.run({ dryRun: req.dryRun });
    if (!req.dryRun) await appendAudit(report);
    return report;
  }
  async function runStartupMigrations(): Promise<void> {
    const status = await engine.status();
    if (status.upToDate) return;
    log.info('Applying pending data migrations', {
      from: status.currentVersion,
      to: status.targetVersion,
    });
    const report = await engine.run();
    await appendAudit(report);
    if (!report.ok) {
      log.error('Startup migration failed — data restored to prior version', {
        steps: report.steps.length,
      });
      return;
    }
    // The stores loaded their pre-migration shape earlier in boot; a transforming
    // migration just changed those bytes on disk, so the live instances are now
    // stale and their next persist would overwrite the migration. Relaunch so
    // every store reloads from the migrated bytes — the same mechanism the
    // restore path uses. Gated to genuine upgrades (see the helper), so a fresh
    // install does not restart on first boot.
    if (shouldRelaunchAfterMigration(report)) {
      log.info('Data migration applied — relaunching so stores reload migrated bytes', {
        from: report.fromVersion,
        to: report.toVersion,
      });
      scheduleRestoreRelaunch('data migration');
    }
  }

  // ── release diagnostics + support bundle data providers ──
  async function modules(): Promise<InstalledModule[]> {
    const apps: InstalledModule[] = registry
      .list()
      .map((e) => ({ name: e.name, kind: 'app', version: e.installedVersion, enabled: true }));
    const plugins: InstalledModule[] = pluginManager
      .list()
      .map((p) => ({
        name: p.name,
        kind: 'plugin',
        version: p.version,
        enabled: p.state === 'enabled',
      }));
    return [...apps, ...plugins];
  }
  async function connectors(): Promise<{ id: string; name: string; status: string }[]> {
    return connectorService.list().map((c) => ({ id: c.id, name: c.name, status: c.status }));
  }
  function diagnosticsDeps(): ReleaseDiagnosticsDeps {
    return {
      build: () => getBuildInfo(),
      signing: () => probeSigningStatus(),
      update: () => appUpdater.status(),
      health: () => deps.platformDiagnostics(),
      modules,
      connectors,
    };
  }

  const support = new SupportBundleGenerator({
    dataDir,
    outDir: supportDir,
    collect: async () => ({
      build: getBuildInfo(),
      diagnostics: await collectReleaseDiagnostics(diagnosticsDeps()),
      modules: await modules(),
      connectors: await connectors(),
      plugins: pluginManager.list(),
      crashes: await crashReporter.export(),
    }),
  });

  // ── scheduled backups ──
  /**
   * P13C PART 3 — CLASSIFIED SYSTEM_GLOBAL. The rationale, not a guess:
   *
   * `backup.create` is `fs.copyFile` over `DOMAIN_FILES`. It never opens a
   * scoped store, never calls a resolver, and never reads a record — it copies
   * BYTES from one directory under `userData` to another. It therefore operates
   * BELOW the application's authorization layer, at exactly the level the
   * migration inventory already names as BLOCKED ("the filesystem itself:
   * anyone who can read those files reads every tenant directly").
   *
   * WHY A TENANT-SCOPED BACKUP WOULD BE A FICTION HERE
   *
   * Every tenant's records live inside the SAME mode-0600 JSON file per module.
   * There is no per-tenant file to copy, so a "tenant-scoped backup" would
   * either copy the same whole-install files under a tenant's name — claiming
   * an isolation that does not exist — or require re-architecting local storage,
   * which is not this program's scope and would not improve the boundary.
   *
   * WHAT THE CLASSIFICATION OBLIGES INSTEAD
   *
   * Two things, both done here. (1) The job runs under an explicit SYSTEM
   * principal, so any event it publishes is stamped `system` rather than
   * inheriting whichever organization the UI had open — a global maintenance
   * job must not appear in one customer's timeline as their own activity.
   * (2) The destination stays inside `userData`, the same trust boundary as the
   * source, so this is not an EGRESS: nothing crosses a process or network
   * boundary, and no tenant gains a read it did not already have at the OS level.
   *
   * The honest limit is stated rather than papered over: a privileged local
   * user can read a backup exactly as they can read the live files, and this
   * program does not change that.
   *
   * P13C ROUND 10 — F22. What that classification could not express, the archive
   * declaration now does: `backup/backupArchive.ts` names the archive
   * MULTI_TENANT_INSTALL, states what is inside it, who may restore it, how long
   * it is kept and — the question a store scope never has to answer — what a
   * restore puts back. The paragraph above is still true and is still not a
   * partition; the difference is that it is now written on every archive this
   * job produces, and a restore refuses an archive that does not carry it.
   */
  async function scheduledBackup(): Promise<void> {
    await runAsPrincipal(systemPrincipal('scheduled-backup'), async () => {
      try {
        await backup.create('scheduled', LOCAL_DOMAINS);
        const all = await backup.list();
        const scheduled = all.filter((b) => b.trigger === 'scheduled');
        for (const old of scheduled.slice(SCHEDULED_BACKUP_KEEP)) await backup.delete(old.id);
      } catch (err) {
        log.warn('Scheduled backup failed', { message: (err as Error).message });
      }
    });
  }
  const timer = setInterval(() => void scheduledBackup(), SCHEDULED_BACKUP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  const handlers: SecureHandlerDef[] = [
    { channel: IpcChannel.MigrationStatus, schema: EmptyRequest, handler: () => migrationStatus() },
    {
      channel: IpcChannel.MigrationRun,
      schema: MigrationRunRequest,
      audit: true,
      timeoutMs: HEAVY_TIMEOUT_MS,
      handler: (p) => migrationRun(p as MigrationRunRequest),
    },
    { channel: IpcChannel.BackupList, schema: EmptyRequest, handler: () => backup.list() },
    {
      channel: IpcChannel.BackupCreate,
      schema: BackupCreateRequest,
      audit: true,
      timeoutMs: HEAVY_TIMEOUT_MS,
      handler: (p) =>
        backup.create(
          (p as BackupCreateRequest).trigger ?? 'manual',
          (p as BackupCreateRequest).domains,
        ),
    },
    {
      channel: IpcChannel.BackupValidate,
      schema: BackupIdRequest,
      handler: (p) => backup.validate((p as BackupIdRequest).id),
    },
    {
      channel: IpcChannel.BackupRestore,
      schema: BackupRestoreRequest,
      audit: true,
      timeoutMs: HEAVY_TIMEOUT_MS,
      /**
       * F22 — the caller-chosen-archive surface names itself. The manager
       * refuses unless this acknowledgement matches the boundary the archive's
       * own manifest declares, so this handler cannot perform an install-wide
       * rollback while appearing to ask for something narrower. `domains`
       * narrows WHICH STORES come back, never WHOSE.
       */
      handler: async (p) => {
        const result = await backup.restore(
          (p as BackupRestoreRequest).id,
          (p as BackupRestoreRequest).domains,
          {
            boundary: 'ALL_TENANTS_AT_ONCE',
            declaredBy: 'backup:restore IPC handler',
          },
        );
        // Round 37 — Gate 16: `requiresRestart` is now ENFORCED, not returned
        // and forgotten — without this, the live stores' next background
        // persist overwrote the restore and the whole operation silently
        // undid itself.
        if (result.ok && result.requiresRestart) scheduleRestoreRelaunch('backup restore');
        return result;
      },
    },
    {
      channel: IpcChannel.BackupDelete,
      schema: BackupIdRequest,
      audit: true,
      handler: (p) => backup.delete((p as BackupIdRequest).id),
    },
    {
      channel: IpcChannel.CrashGetStatus,
      schema: EmptyRequest,
      handler: () => crashReporter.status(),
    },
    {
      channel: IpcChannel.CrashSetOptIn,
      schema: CrashSetOptInRequest,
      audit: true,
      handler: (p) => crashReporter.setOptIn((p as CrashSetOptInRequest).optedIn),
    },
    {
      channel: IpcChannel.CrashExport,
      schema: EmptyRequest,
      handler: () => crashReporter.export(),
    },
    {
      channel: IpcChannel.CrashRecommendations,
      schema: EmptyRequest,
      handler: () => crashReporter.recommendations(),
    },
    {
      channel: IpcChannel.CrashReport,
      schema: CrashReportRequest,
      handler: (p) => {
        const r = p as CrashReportRequest;
        crashReporter.report('renderer', r.kind, r.message, r.stack);
        return crashReporter.status();
      },
    },
    {
      channel: IpcChannel.ReleaseDiagnosticsGet,
      schema: EmptyRequest,
      timeoutMs: HEAVY_TIMEOUT_MS,
      handler: () => collectReleaseDiagnostics(diagnosticsDeps()),
    },
    {
      channel: IpcChannel.ReleaseDiagnosticsExport,
      schema: EmptyRequest,
      timeoutMs: HEAVY_TIMEOUT_MS,
      handler: async () => {
        const report = await collectReleaseDiagnostics(diagnosticsDeps());
        return { report, text: formatDiagnosticsText(report) };
      },
    },
    {
      channel: IpcChannel.RecoverySafeModeStatus,
      schema: EmptyRequest,
      handler: () => recovery.safeModeState(),
    },
    {
      channel: IpcChannel.RecoveryRun,
      schema: RecoveryRunRequest,
      audit: true,
      timeoutMs: HEAVY_TIMEOUT_MS,
      handler: async (p) => {
        const i = p as RecoveryRunRequest;
        const result = await recovery.run(i.action, {
          backupId: i.backupId,
          domains: i.domains,
          reason: i.reason,
        });
        // Round 37 — Gate 16: same enforcement as backup:restore above.
        if (result.ok && result.requiresRestart) scheduleRestoreRelaunch(`recovery:${i.action}`);
        return result;
      },
    },
    {
      channel: IpcChannel.SupportGenerateBundle,
      schema: EmptyRequest,
      audit: true,
      timeoutMs: HEAVY_TIMEOUT_MS,
      // Phase 8 (8.4): reveal the generated bundle in the file manager — the
      // user was previously told a path and left to find it by hand.
      handler: async () => {
        const info = await support.generate();
        shell.showItemInFolder(info.path);
        return info;
      },
    },
  ];

  log.info('Release operations initialized', {
    dataVersion: cachedVersion,
    handlers: handlers.length,
  });

  return {
    handlers,
    safeModeState: () => recovery.safeModeState(),
    runStartupMigrations,
    listBackups: () => backup.list(),
    dispose: () => clearInterval(timer),
  };
}
