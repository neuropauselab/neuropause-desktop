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
import { app, crashReporter as nativeCrashReporter } from 'electron';
import type { CrashCategory, CrashRecord, CrashStatus, RecoveryRecommendation } from '@neuropause/shared';
import { createLogger } from '../logger';

const log = createLogger('crash-reporter');

interface OptInSettings {
  optedIn: boolean;
}

class CrashReporter {
  readonly name = 'crash-reporter';
  private count = 0;
  private optedIn = false;
  private nativeActive = false;

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
    const record: CrashRecord = { at: new Date().toISOString(), category, kind, message, stack: stack ?? null };
    log.error('Crash captured', { category, kind, message });
    void fs
      .mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
      .then(() => fs.appendFile(this.logPath(), `${JSON.stringify(record)}\n`))
      .catch(() => undefined);
  }

  async setOptIn(optedIn: boolean): Promise<CrashStatus> {
    this.optedIn = optedIn;
    await fs.writeFile(this.optInPath(), JSON.stringify({ optedIn }), { mode: 0o600 });
    if (optedIn) this.startNative();
    // Native capture cannot be torn down mid-session; turning off applies next launch.
    return this.status();
  }

  /** Parse the local crash archive into structured records (newest first). */
  async export(limit = 200): Promise<CrashRecord[]> {
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
