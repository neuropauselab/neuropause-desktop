/**
 * Application self-updater. Wraps electron-updater behind a small, explicit
 * surface: the app never downloads or installs silently — the renderer drives
 * each step and a side-effecting install requires a user action.
 *
 *   - three release channels: stable (latest), beta, internal
 *   - explicit check / background download / install-on-restart
 *   - release notes surfaced from the feed
 *   - rollback preparation: a version history accrues so the version a failed
 *     update would revert to is always known
 *
 * In development (unpackaged) builds there is no update feed, so the updater is
 * inert and reports `supported: false`; the methods are safe no-ops. This module
 * imports Electron + electron-updater and must not be pulled into unit tests —
 * the testable logic lives in ./updater/updateChannels.
 */
import { EventEmitter } from 'node:events';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo, type ProgressInfo } from 'electron-updater';
import type { UpdateChannel, UpdateInfo, UpdatePhase, UpdateStatus } from '@neuropause/shared';
import { createLogger } from '../logger';
import { getBuildInfo } from '../buildInfo';
import { allowsPrerelease, feedChannel, pickRollbackTarget, resolveChannel } from './updater/updateChannels';

const log = createLogger('app-updater');

function prefsPath(): string {
  return join(app.getPath('userData'), 'update-prefs.json');
}
function historyPath(): string {
  return join(app.getPath('userData'), 'update-history.json');
}

function mapInfo(info: ElectronUpdateInfo, channel: UpdateChannel): UpdateInfo {
  let notes: string | null = null;
  if (typeof info.releaseNotes === 'string') {
    notes = info.releaseNotes;
  } else if (Array.isArray(info.releaseNotes)) {
    notes = info.releaseNotes.map((n) => n.note ?? '').filter(Boolean).join('\n\n') || null;
  }
  return {
    version: info.version,
    channel,
    releaseDate: info.releaseDate ?? null,
    releaseNotes: notes,
  };
}

function mapProgress(p: ProgressInfo): UpdateStatus['progress'] {
  return { percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total };
}

/** A7 — `status` carries a checked `UpdateStatus`; it used to be `any`. */
class AppUpdater extends EventEmitter<{ status: [UpdateStatus] }> {
  readonly name = 'app-updater';
  private phase: UpdatePhase = 'idle';
  private channel: UpdateChannel = 'stable';
  private available: UpdateInfo | null = null;
  private progress: UpdateStatus['progress'] = null;
  private error: string | null = null;
  private checkedAt: string | null = null;
  private wired = false;

  /** Started by the service manager after the app is ready. */
  start(): void {
    this.channel = this.readChannelPref();
    void this.recordVersion(app.getVersion());

    if (!app.isPackaged) {
      log.info('App updater inert (development build); self-update disabled');
      return;
    }
    this.wire();
    // A first background check shortly after launch, then on demand.
    setTimeout(() => void this.checkNow(), 10_000).unref?.();
    log.info('App updater started', { channel: this.channel, version: app.getVersion() });
  }

  stop(): void {
    /* electron-updater holds no resources that require teardown */
  }

  private wire(): void {
    if (this.wired) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = allowsPrerelease(this.channel);
    autoUpdater.channel = feedChannel(this.channel);
    autoUpdater.logger = {
      info: (m: unknown) => log.debug(String(m)),
      warn: (m: unknown) => log.warn(String(m)),
      error: (m: unknown) => log.error(String(m)),
      debug: (m: unknown) => log.debug(String(m)),
    };

    autoUpdater.on('checking-for-update', () => this.transition('checking'));
    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      this.available = mapInfo(info, this.channel);
      this.transition('available');
    });
    autoUpdater.on('update-not-available', () => {
      this.available = null;
      this.transition('not-available');
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      this.progress = mapProgress(p);
      this.transition('downloading');
    });
    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      this.available = mapInfo(info, this.channel);
      this.progress = null;
      this.transition('downloaded');
    });
    autoUpdater.on('error', (err: Error) => {
      this.error = err?.message ?? String(err);
      this.transition('error');
    });
    this.wired = true;
  }

  async checkNow(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status();
    this.error = null;
    try {
      await autoUpdater.checkForUpdates();
      this.checkedAt = new Date().toISOString();
    } catch (err) {
      this.error = (err as Error).message;
      this.transition('error');
    }
    return this.status();
  }

  async download(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status();
    if (this.phase !== 'available') return this.status();
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.error = (err as Error).message;
      this.transition('error');
    }
    return this.status();
  }

  /** Quit, install the downloaded update, and relaunch. Requires user consent. */
  installOnRestart(): UpdateStatus {
    if (app.isPackaged && this.phase === 'downloaded') {
      log.info('Installing update on restart', { version: this.available?.version ?? 'unknown' });
      setImmediate(() => autoUpdater.quitAndInstall());
    }
    return this.status();
  }

  setChannel(input: unknown): UpdateStatus {
    this.channel = resolveChannel(input);
    void this.writeChannelPref(this.channel);
    if (app.isPackaged && this.wired) {
      autoUpdater.allowPrerelease = allowsPrerelease(this.channel);
      autoUpdater.channel = feedChannel(this.channel);
    }
    // Reset discovered state; the next check refills it against the new channel.
    this.available = null;
    this.progress = null;
    this.error = null;
    this.transition('idle');
    log.info('Update channel changed', { channel: this.channel });
    return this.status();
  }

  status(): UpdateStatus {
    return {
      phase: this.phase,
      channel: this.channel,
      currentVersion: app.getVersion(),
      available: this.available,
      progress: this.progress,
      error: this.error,
      supported: app.isPackaged,
      checkedAt: this.checkedAt,
    };
  }

  /** The version a rollback would revert to, derived from recorded history. */
  rollbackTarget(): string | null {
    return pickRollbackTarget(getBuildInfo().version, this.readHistory());
  }

  private transition(phase: UpdatePhase): void {
    this.phase = phase;
    this.emit('status', this.status());
  }

  private readChannelPref(): UpdateChannel {
    try {
      const raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) as { channel?: string };
      return resolveChannel(raw.channel ?? getBuildInfo().channel);
    } catch {
      return getBuildInfo().channel;
    }
  }

  private async writeChannelPref(channel: UpdateChannel): Promise<void> {
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(prefsPath(), JSON.stringify({ channel }), 'utf8');
    } catch {
      /* preference is best-effort; channel still applies for this session */
    }
  }

  private readHistory(): string[] {
    try {
      const raw = JSON.parse(readFileSync(historyPath(), 'utf8')) as { versions?: string[] };
      return Array.isArray(raw.versions) ? raw.versions : [];
    } catch {
      return [];
    }
  }

  /** Append the running version to the rollback history (deduplicated). */
  private async recordVersion(version: string): Promise<void> {
    try {
      const versions = this.readHistory();
      if (!versions.includes(version)) {
        versions.push(version);
        await fs.mkdir(app.getPath('userData'), { recursive: true });
        await fs.writeFile(historyPath(), JSON.stringify({ versions }), 'utf8');
      }
      const target = pickRollbackTarget(version, versions);
      if (target) log.debug('Rollback target available', { target });
    } catch {
      /* history is best-effort */
    }
  }
}

export const appUpdater = new AppUpdater();
