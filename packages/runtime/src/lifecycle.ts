/**
 * Lifecycle manager (NCEA 10.2C, Phase 5). Ordered startup (init → start in
 * dependency order, each with an optional timeout), readiness, graceful reverse-
 * order shutdown with resource cleanup, and rollback: if a service fails to
 * start, the already-started services are stopped in reverse. Shutdown errors
 * are swallowed so cleanup always completes.
 */
import type { ServiceRegistry, RuntimeContext } from './registry';
import type { HealthSystem } from './health';

export type RuntimeState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';

function withTimeout<T>(work: T | Promise<T>, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class LifecycleManager {
  private state: RuntimeState = 'idle';
  private readonly started: string[] = [];

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly ctx: RuntimeContext,
    private readonly health: HealthSystem,
    /** Shared instance map — also read by ctx.get for DI. */
    private readonly instances: Map<string, unknown>,
  ) {}

  getState(): RuntimeState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'ready') return;
    this.state = 'starting';
    try {
      for (const name of this.registry.order()) {
        const def = this.registry.get(name);
        if (!def) continue;
        const instance = await withTimeout(def.init(this.ctx), def.timeoutMs, `init '${name}'`);
        this.instances.set(name, instance);
        if (def.start) {
          await withTimeout(def.start(instance, this.ctx), def.timeoutMs, `start '${name}'`);
        }
        if (def.health) {
          const probe = def.health.bind(def);
          this.health.register(name, () => probe(this.instances.get(name)));
        }
        this.started.push(name);
      }
      this.state = 'ready';
    } catch (error) {
      this.state = 'error';
      await this.rollback();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') return;
    this.state = 'stopping';
    await this.teardown();
    this.state = 'stopped';
  }

  private async rollback(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    for (const name of [...this.started].reverse()) {
      const def = this.registry.get(name);
      const instance = this.instances.get(name);
      if (def?.stop && instance !== undefined) {
        try {
          await withTimeout(def.stop(instance, this.ctx), def.timeoutMs, `stop '${name}'`);
        } catch {
          /* swallow shutdown errors so cleanup always completes */
        }
      }
      this.health.unregister(name);
      this.instances.delete(name);
    }
    this.started.length = 0;
  }
}
