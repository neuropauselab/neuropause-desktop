/**
 * Service registry + dependency injection (NCEA 10.2C, Phases 1, 2, 4).
 *
 * Services declare a name, their dependencies, and lifecycle hooks. The registry
 * computes a dependency-ordered startup sequence (Kahn topological sort) and
 * detects circular or missing dependencies before anything starts. A service's
 * `init` receives the RuntimeContext and can resolve already-initialized
 * dependencies via `ctx.get(name)` — that is the DI.
 */
import type { Logger, MetricsRegistry, AuditChain } from '@neuropause/cloud-core';
import type { RuntimeConfig, RuntimeMode, SecretProvider } from './config';
import type { EventRuntime } from './events';
import type { ServiceHealth } from './health';

export interface RuntimeContext {
  mode: RuntimeMode;
  config: RuntimeConfig;
  logger: Logger;
  metrics: MetricsRegistry;
  events: EventRuntime;
  audit: AuditChain;
  secrets: SecretProvider;
  /** Resolve an already-initialized service instance (dependency injection). */
  get<T = unknown>(name: string): T;
}

export interface ServiceDefinition<T = unknown> {
  name: string;
  dependsOn?: string[];
  /** Lazy init — returns the service instance; may resolve deps via ctx.get. */
  init(ctx: RuntimeContext): T | Promise<T>;
  start?(instance: T, ctx: RuntimeContext): void | Promise<void>;
  stop?(instance: T, ctx: RuntimeContext): void | Promise<void>;
  health?(instance: T): ServiceHealth;
  /** Per-service startup/shutdown timeout (ms). */
  timeoutMs?: number;
}

export class ServiceRegistry {
  private readonly defs = new Map<string, ServiceDefinition>();

  register<T>(def: ServiceDefinition<T>): this {
    if (this.defs.has(def.name)) throw new Error(`service '${def.name}' already registered`);
    this.defs.set(def.name, def as ServiceDefinition);
    return this;
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }
  get(name: string): ServiceDefinition | undefined {
    return this.defs.get(name);
  }
  names(): string[] {
    return [...this.defs.keys()];
  }
  size(): number {
    return this.defs.size;
  }

  /** Dependency-ordered startup sequence; throws on missing dep or cycle. */
  order(): string[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const name of this.defs.keys()) {
      inDegree.set(name, 0);
      dependents.set(name, []);
    }
    for (const [name, def] of this.defs) {
      for (const dep of def.dependsOn ?? []) {
        if (!this.defs.has(dep)) {
          throw new Error(`service '${name}' depends on unknown service '${dep}'`);
        }
        dependents.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }
    // deterministic: process ready nodes in sorted order
    const ready = [...inDegree.entries()].filter(([, d]) => d === 0).map(([n]) => n).sort();
    const ordered: string[] = [];
    while (ready.length > 0) {
      const name = ready.shift() as string;
      ordered.push(name);
      for (const next of dependents.get(name)!) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
        if (inDegree.get(next) === 0) {
          ready.push(next);
          ready.sort();
        }
      }
    }
    if (ordered.length !== this.defs.size) {
      const remaining = [...this.defs.keys()].filter((n) => !ordered.includes(n));
      throw new Error(`circular dependency among services: ${remaining.sort().join(', ')}`);
    }
    return ordered;
  }
}
