/**
 * AI Sandbox — Desktop Automation (S2): the Electron Launcher.
 *
 * Owns desktop session lifecycle + isolation over the driver port: launch / close /
 * restart / reset, and profile isolation via real user-data dirs — `fresh`/`temporary`
 * get a throwaway `mkdtemp` dir removed on close, `persistent` reuses a named dir.
 * `reset` wipes a profile's contents (cache / cookies / storage / settings). Multiple
 * sessions coexist. It also answers window discovery, health, and app state. The
 * launch target (host Electron binary + app args) is injected, so it is testable with
 * the in-memory driver.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  type DesktopLaunchOptions,
  type DesktopProfileMode,
  type DesktopSessionInfo,
  type DesktopWindowInfo,
} from '@neuropause/shared';
import { createLogger } from '../../logger';
import type { DesktopDriver, DesktopSession, DesktopWindow } from './driver';

const log = createLogger('sandbox-desktop-launcher');

export interface LaunchTarget {
  executablePath: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface SessionManagerDeps {
  driver: DesktopDriver;
  /** Base dir isolated profiles live under (e.g. <userData>/sandbox/profiles). */
  profilesDir: string;
  launchTarget: LaunchTarget;
  now?: () => number;
}

export interface ManagedSession {
  id: string;
  session: DesktopSession;
  profile: DesktopProfileMode;
  profileDir: string;
  args: string[];
  startedAt: number;
}

export interface SessionHealth {
  running: boolean;
  windows: number;
  responsive: boolean;
}

let profileSeq = 0;

export class SessionManager {
  private readonly managed = new Map<string, ManagedSession>();
  private readonly now: () => number;
  private seq = 0;

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private async resolveProfileDir(opts: DesktopLaunchOptions): Promise<string> {
    if (opts.profile === 'persistent') {
      const dir = join(this.deps.profilesDir, 'persistent', opts.profileKey ?? 'default');
      await fs.mkdir(dir, { recursive: true });
      return dir;
    }
    // fresh / temporary — unique, isolated, removed on close.
    await fs.mkdir(this.deps.profilesDir, { recursive: true });
    profileSeq += 1;
    const dir = join(this.deps.profilesDir, `run-${this.now()}-${profileSeq}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async launch(opts: DesktopLaunchOptions): Promise<ManagedSession> {
    const profileDir = await this.resolveProfileDir(opts);
    const args = [...this.deps.launchTarget.args, ...opts.args];
    const session = await this.deps.driver.launch({
      executablePath: this.deps.launchTarget.executablePath,
      args,
      userDataDir: profileDir,
      env: this.deps.launchTarget.env ?? {},
      timeoutMs: opts.timeoutMs,
      cwd: this.deps.launchTarget.cwd,
    });
    this.seq += 1;
    const managed: ManagedSession = { id: `sess_${this.seq}`, session, profile: opts.profile, profileDir, args, startedAt: this.now() };
    this.managed.set(managed.id, managed);
    log.info('desktop session launched', { id: managed.id, profile: opts.profile });
    return managed;
  }

  get(id: string): ManagedSession | null {
    return this.managed.get(id) ?? null;
  }
  list(): ManagedSession[] {
    return [...this.managed.values()];
  }

  async close(id: string): Promise<boolean> {
    const m = this.managed.get(id);
    if (!m) return false;
    await m.session.close().catch(() => undefined);
    // Throwaway profiles are removed; persistent ones are kept.
    if (m.profile !== 'persistent') await fs.rm(m.profileDir, { recursive: true, force: true }).catch(() => undefined);
    this.managed.delete(id);
    return true;
  }

  /** Restart: close then relaunch, preserving a persistent profile (fresh dir otherwise). */
  async restart(id: string, opts: DesktopLaunchOptions): Promise<ManagedSession | null> {
    const m = this.managed.get(id);
    if (!m) return null;
    const restartOpts: DesktopLaunchOptions = m.profile === 'persistent'
      ? { ...opts, profile: 'persistent', profileKey: opts.profileKey }
      : opts;
    await this.close(id);
    return this.launch(restartOpts);
  }

  /** Reset a session: stop it and wipe its profile (cache / cookies / storage / settings). */
  async reset(id: string): Promise<boolean> {
    const m = this.managed.get(id);
    if (!m) return false;
    await m.session.close().catch(() => undefined);
    await fs.rm(m.profileDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(m.profileDir, { recursive: true }).catch(() => undefined);
    this.managed.delete(id);
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.managed.keys()].map((id) => this.close(id)));
  }

  async windows(id: string): Promise<DesktopWindowInfo[]> {
    const m = this.managed.get(id);
    if (!m) return [];
    const ws = await m.session.windows();
    return Promise.all(ws.map(async (w: DesktopWindow, index): Promise<DesktopWindowInfo> => ({ id: w.id, index, title: await w.title(), url: await w.url() })));
  }

  async health(id: string): Promise<SessionHealth> {
    const m = this.managed.get(id);
    if (!m) return { running: false, windows: 0, responsive: false };
    const running = m.session.isRunning();
    let windows = 0;
    let responsive = false;
    try {
      windows = (await m.session.windows()).length;
      await m.session.firstWindow({ timeoutMs: 2000 });
      responsive = running && windows > 0;
    } catch {
      responsive = false;
    }
    return { running, windows, responsive };
  }

  async appState(id: string): Promise<DesktopSessionInfo | null> {
    const m = this.managed.get(id);
    if (!m) return null;
    let windows = 0;
    try {
      windows = (await m.session.windows()).length;
    } catch {
      windows = 0;
    }
    return { id: m.id, profile: m.profile, profileDir: m.profileDir, running: m.session.isRunning(), windows, startedAt: new Date(m.startedAt).toISOString() };
  }
}
