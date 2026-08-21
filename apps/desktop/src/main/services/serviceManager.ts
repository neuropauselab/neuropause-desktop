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
import { runAsPrincipal, systemPrincipal } from '../tenancy/backgroundPrincipal';
import { registry } from '../registry/registry';
import { catalogClient } from '../catalog/catalogClient';
import { supervisor } from '../runtime/supervisor';
import { crashReporter } from './crashReporter';
import { taskScheduler } from './taskScheduler';
import { notificationScheduler } from './notificationScheduler';
import { pluginLoader } from './pluginLoader';
import { appUpdater } from './appUpdater';
import { companionGatewayService } from '../companion/gatewayService';
// F-P39 — the production read-back caller. Registered HERE rather than on deliveryEngine because a
// delivery source is gated by user notification preferences, and a preference must never be able to
// switch off evidence production. `startAll` below is already called from runtimeCore — zero frozen lines.
import { readBackReconciler } from '../reconciliation/readBackReconcilerInstance';

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

  /**
   * P13C PART 3 — CLASSIFIED SYSTEM_GLOBAL, under an explicit principal.
   *
   * Instance health is a property of the PROCESS, not of a customer. The
   * principal is not decoration: without one, this 5-second timer resolves the
   * signed-in user's tenant, so every health sample it publishes lands in
   * whichever organization is open — and the sample rate means that tenant's
   * timeline fills with work it did not do.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void runAsPrincipal(systemPrincipal('health-monitor'), () => supervisor.checkHealth());
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
    /**
     * P13C PART 3 — CLASSIFIED SYSTEM_GLOBAL. The Store's catalogue of app
     * versions is product data, identical for every customer, so this poll
     * belongs to the product. Both entry points — the launch sweep and the
     * recurring one — run under the principal, because a job is only
     * fail-closed if EVERY path into it is.
     */
    const sweepAsSystem = (): Promise<void> =>
      runAsPrincipal(systemPrincipal('update-checker'), () => this.sweep());
    // First sweep shortly after launch, then on the long interval.
    setTimeout(() => void sweepAsSystem(), 30_000).unref?.();
    this.timer = setInterval(() => void sweepAsSystem(), this.intervalMs);
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
      // Mobile M1-03 — the companion LAN gateway (no-op until initCompanion binds it
      // and only listens when the user has enabled it in Settings).
      companionGatewayService,
      // F-P39 — read-back verification. Independent of every other service: it reads the evidence store,
      // classifies, records a terminal, and stops. It never executes and never resolves a HOLD.
      readBackReconciler,
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
