/**
 * Background Runtime Services. Long-lived services that keep the runtime
 * healthy and current run behind a single manager that starts and stops them
 * together. Part A ships the two the runtime depends on directly — the Health
 * Monitor (liveness + resource sampling) and the Update Checker (release
 * polling). The remaining services (crash reporter, task and
 * notification schedulers, plugin loader) plug into this same manager in Part B.
 *
 * The Download Manager and Runtime Supervisor are also "services" in spirit but
 * are event-driven singletons owned by NPS and the runtime, so they are not on
 * a timer here.
 */
import type { UpdateCheck } from '@neuropause/shared';
import { createLogger } from '../logger';
import { registry } from '../registry/registry';
import { catalogClient } from '../catalog/catalogClient';
import { supervisor } from '../runtime/supervisor';
import { crashReporter } from './crashReporter';
import { taskScheduler } from './taskScheduler';
import { notificationScheduler } from './notificationScheduler';
import { pluginLoader } from './pluginLoader';
import { appUpdater } from './appUpdater';

const log = createLogger('services');

export interface BackgroundService {
  readonly name: string;
  start(): void;
  stop(): void;
}

/** Periodically samples runtime health + resources across all live instances. */
class HealthMonitor implements BackgroundService {
  readonly name = 'health-monitor';
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 5000;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void supervisor.checkHealth();
    }, this.intervalMs);
    this.timer.unref?.();
    log.info('Health monitor started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Polls the Store for updates to installed apps. */
class UpdateChecker implements BackgroundService {
  readonly name = 'update-checker';
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 6 * 60 * 60 * 1000; // 6h
  private available = new Map<string, UpdateCheck>();

  start(): void {
    if (this.timer) return;
    // First sweep shortly after launch, then on the long interval.
    setTimeout(() => void this.sweep(), 30_000).unref?.();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref?.();
    log.info('Update checker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getAvailable(): UpdateCheck[] {
    return [...this.available.values()].filter((u) => u.updateAvailable);
  }

  private async sweep(): Promise<void> {
    const installed = registry.list();
    if (!installed.length) return;
    let count = 0;
    for (const app of installed) {
      try {
        const check = await catalogClient.checkUpdate(app.slug);
        this.available.set(app.slug, check);
        if (check.updateAvailable) count += 1;
      } catch {
        /* offline or not authed; try again next sweep */
      }
    }
    if (count) log.info('Updates available', { count });
  }
}

class ServiceManager {
  private services: BackgroundService[] = [];
  private readonly healthMonitor = new HealthMonitor();
  private readonly updateChecker = new UpdateChecker();
  private started = false;

  constructor() {
    // Crash reporter first (so it captures everything), schedulers next, then
    // the monitors, and the plugin loader last (it enables plugins).
    this.services = [
      crashReporter,
      taskScheduler,
      notificationScheduler,
      this.healthMonitor,
      this.updateChecker,
      appUpdater,
      pluginLoader,
    ];
  }

  startAll(opts: { skip?: string[] } = {}): void {
    if (this.started) return;
    const skip = new Set(opts.skip ?? []);
    for (const s of this.services) {
      if (skip.has(s.name)) {
        log.warn('Service skipped', { name: s.name });
        continue;
      }
      try {
        s.start();
      } catch (err) {
        log.warn('Service failed to start', { name: s.name, message: (err as Error).message });
      }
    }
    this.started = true;
    log.info('Background services started', { count: this.services.length, skipped: [...skip] });
  }

  stopAll(): void {
    for (const s of this.services) s.stop();
    this.started = false;
  }

  updatesAvailable(): UpdateCheck[] {
    return this.updateChecker.getAvailable();
  }
}

export const serviceManager = new ServiceManager();
