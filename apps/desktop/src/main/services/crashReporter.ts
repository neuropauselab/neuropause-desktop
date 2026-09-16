/**
 * Crash Reporter. Captures faults across the app and keeps them in a local,
 * on-device archive. Native minidump capture (Electron's crashReporter) is
 * strictly OPT-IN and disabled by default; nothing is ever uploaded (there is
 * no crash-ingest endpoint). The public report() lets the wiring layer record
 * worker/plugin/connector faults without those modules importing Electron.
 *
 *   - categories: main · renderer · worker · plugin · connector
 *   - opt-in native capture (minidumps stay in userData)
 *   - local crash archive (crashes.log) + structured export
 *   - recovery recommendations derived from recent crash patterns
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createBoundedLog } from '../storage/boundedLog';
import { app, crashReporter as nativeCrashReporter } from 'electron';
import type { CrashCategory, CrashRecord, CrashStatus, RecoveryRecommendation } from '@neuropause/shared';
import { createLogger } from '../logger';
import { buildCrashRecord } from './crashRecord';
import { declareStoreScope } from '../tenancy/storeScope';

/** P13C ROUND 9 — F18. The structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'crash-archive',
  scope: 'INSTALL_GLOBAL',
  persistence: 'file',
  // `crash:setOptIn` is the only mutation and it is the person at the keyboard
  // consenting to native minidump capture on their own machine — not an
  // organizational decision, so USER rather than ORG_ROLE (which is refused).
  authority: 'USER',
  classification: 'INSTALL_METADATA',
  /** P13C ROUND 10. INSTALL is honest and is NOT the finding class: `crashes.log` rotates by size install-wide, and the rows have NO OWNER FIELD, so there is no tenant partition for a rotation to cross. A store with nothing per-tenant to protect cannot delete across a boundary that does not exist. */
  retentionScope: 'INSTALL',
  retentionAuthority: 'SYSTEM',
  retention:
    'INSPECTED, AND STATED RATHER THAN CLAIMED SAFE. `crashes.log` rotates by SIZE, install-wide: ' +
    '`createBoundedLog(2 MiB, keep 2)` — so a crash loop in one subsystem does push older crash ' +
    'lines out, and those lines have no owner to preserve them for. That is NOT the install-wide-cap ' +
    'finding class: a crash row is a fault in the software with no tenant field and no tenant ' +
    'meaning, so there is no per-owner partition a rotation could respect. `crash-reporting.json` is ' +
    'a single boolean overwritten in place. `recovery:run resetSettings` deletes that opt-in file.',
  reason:
    'WHY GLOBAL: one process on one machine faults, and a fault belongs to the software, not to a ' +
    'customer. WHAT DATA: category (main/renderer/worker/plugin/connector), kind, message and stack ' +
    '— every one of which is passed through `redactSensitive` in `buildCrashRecord` BEFORE it is ' +
    'written, so the archive at rest is scrubbed rather than scrubbed only on export. Nothing is ' +
    'ever uploaded: native capture is opt-in and `uploadToServer:false`, and there is no ingest ' +
    'endpoint. STATED LIMIT: a stack frame is redacted, not tenant-partitioned — an exception ' +
    'message that quoted a record name would be scrubbed of secrets and paths but is not proven free ' +
    'of record text, which is why the archive stays local and the support bundle re-scrubs on export.',
});

const log = createLogger('crash-reporter');

interface OptInSettings {
  optedIn: boolean;
}

class CrashReporter {
  readonly name = 'crash-reporter';
  private count = 0;
  private optedIn = false;
  private nativeActive = false;
  /** Phase 8 (8.4): rotating sink for crashes.log — 2 MiB per generation, 2 kept. */
  private readonly crashLog = createBoundedLog(() => this.logPath(), { maxBytes: 2 * 1024 * 1024, keep: 2 });

  private onUncaught = (err: Error): void => this.report('main', 'uncaughtException', err.message, err.stack);
  private onRejection = (reason: unknown): void =>
    this.report('main', 'unhandledRejection', reason instanceof Error ? reason.message : String(reason));

  private optInPath(): string {
    return join(app.getPath('userData'), 'crash-reporting.json');
  }
  private logPath(): string {
    return join(app.getPath('userData'), 'logs', 'crashes.log');
  }

  start(): void {
    void this.init();
    process.on('uncaughtException', this.onUncaught);
    process.on('unhandledRejection', this.onRejection);
    app.on('render-process-gone', (_e, _wc, details) => this.report('renderer', 'render-process-gone', details.reason));
    // The only child process is the plugin host, so categorize it as plugin.
    app.on('child-process-gone', (_e, details) => this.report('plugin', 'child-process-gone', details.reason));
    log.info('Crash reporter started');
  }

  stop(): void {
    process.off('uncaughtException', this.onUncaught);
    process.off('unhandledRejection', this.onRejection);
  }

  private async init(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.optInPath(), 'utf8')) as OptInSettings;
      this.optedIn = !!raw.optedIn;
    } catch {
      this.optedIn = false; // default off
    }
    if (this.optedIn) this.startNative();
    log.info('Crash reporting initialized', { optedIn: this.optedIn, nativeActive: this.nativeActive });
  }

  private startNative(): void {
    if (this.nativeActive) return;
    try {
      // uploadToServer:false keeps minidumps in userData/Crashpad; nothing leaves the device.
      nativeCrashReporter.start({ submitURL: 'https://invalid.localhost/', uploadToServer: false, compress: true });
      this.nativeActive = true;
    } catch (err) {
      log.warn('Native crash capture failed to start', { message: (err as Error).message });
    }
  }

  /** Record a fault. Categories beyond main/renderer/plugin come via the wiring layer. */
  report(category: CrashCategory, kind: string, message: string, stack?: string): void {
    this.count += 1;
    // Scrub secrets/PII from message + stack before anything is persisted or logged.
    const record: CrashRecord = buildCrashRecord(category, kind, message, stack, new Date().toISOString());
    log.error('Crash captured', { category, kind, message: record.message });
    // Phase 8 (8.4): bounded append — a crash loop can no longer grow this
    // file without limit (rotations remain in logs/ for the support bundle).
    this.crashLog.append(JSON.stringify(record));
  }

  async setOptIn(optedIn: boolean): Promise<CrashStatus> {
    this.optedIn = optedIn;
    await fs.writeFile(this.optInPath(), JSON.stringify({ optedIn }), { mode: 0o600 });
    if (optedIn) this.startNative();
    // Native capture cannot be torn down mid-session; turning off applies next launch.
    return this.status();
  }

  /**
   * Parse the local crash archive into structured records (newest first).
   *
   * P13C — F-11c. `crashLog.append()` is fire-and-forget BY DESIGN: recording a
   * fault must never block the fault path. That makes every read of the file a
   * read-past-an-unflushed-write unless it awaits the barrier first, and
   * `createBoundedLog().flush()` exists for exactly this. Without it the export
   * can omit the crash that triggered it.
   *
   * This is not cosmetic. `status()` and `recommendations()` both derive from
   * here, so a stale read UNDER-COUNTS the patterns that raise a Safe Mode
   * recommendation — three renderer crashes can read as zero and the guidance
   * never appears.
   *
   * Same class as F-11b (TimelineService.flush was not a barrier), found by the
   * census that finding prompted. `boundedLog` already serializes appends on one
   * promise chain and returns it from `flush()`, so the barrier is correct here;
   * only the call was missing.
   */
  async export(limit = 200): Promise<CrashRecord[]> {
    await this.crashLog.flush();
    try {
      const raw = await fs.readFile(this.logPath(), 'utf8');
      const records = raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CrashRecord);
      return records.reverse().slice(0, limit);
    } catch {
      return [];
    }
  }

  async status(): Promise<CrashStatus> {
    const records = await this.export(10);
    return { optedIn: this.optedIn, nativeActive: this.nativeActive, total: this.count, recent: records };
  }

  /** Turn recent crash patterns into actionable recovery suggestions. */
  async recommendations(): Promise<RecoveryRecommendation[]> {
    const records = await this.export(50);
    const out: RecoveryRecommendation[] = [];
    const byCategory = new Map<CrashCategory, number>();
    for (const r of records) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);

    if ((byCategory.get('renderer') ?? 0) >= 3) {
      out.push({
        id: 'renderer-instability',
        severity: 'warning',
        title: 'Repeated window crashes detected',
        detail: 'The app window has crashed several times. Try Safe Mode, which starts with plugins disabled.',
        action: 'safeMode',
      });
    }
    if ((byCategory.get('plugin') ?? 0) >= 2) {
      out.push({
        id: 'plugin-instability',
        severity: 'warning',
        title: 'A plugin may be unstable',
        detail: 'The plugin host has crashed more than once. Disabling plugins isolates the cause.',
        action: 'disablePlugins',
      });
    }
    if ((byCategory.get('connector') ?? 0) >= 3) {
      out.push({
        id: 'connector-instability',
        severity: 'info',
        title: 'A connector is failing repeatedly',
        detail: 'One or more connectors are erroring. Reconnect them from the Connectors page.',
        action: null,
      });
    }
    if ((byCategory.get('main') ?? 0) >= 1) {
      out.push({
        id: 'main-fault',
        severity: 'critical',
        title: 'A core fault was recorded',
        detail: 'The main process logged a fatal error. Generate a support bundle so it can be investigated.',
        action: null,
      });
    }
    return out;
  }

  crashCount(): number {
    return this.count;
  }
}

export const crashReporter = new CrashReporter();
