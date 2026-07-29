/**
 * Enterprise Runtime composition root (NCEA 10.2C, Phases 1 & 11).
 *
 * `createEnterpriseRuntime()` assembles the single event bus, audit chain,
 * health system, scheduler, plugin runtime, observability, and service registry
 * into one runtime with an ordered lifecycle. Desktop, cloud, backend, and future
 * mobile/web all consume this same runtime — they register their services into
 * it and call `start()`. The runtime EXECUTES; governance stays in NeuroPause OS.
 */
import {
  systemClock,
  AuditChain,
  NotificationService,
  TimelineProjection,
  type Clock,
  type LogSink,
} from '@neuropause/cloud-core';
import { RUNTIME_VERSION } from './constants';
import { loadConfig, envSecretProvider, type ConfigInput, type SecretProvider } from './config';
import { ServiceRegistry, type ServiceDefinition, type RuntimeContext } from './registry';
import { createEventRuntime, type EventRuntime } from './events';
import { createObservabilityRuntime, type ObservabilityRuntime } from './observability';
import { HealthSystem, type RuntimeHealth } from './health';
import { LifecycleManager, type RuntimeState } from './lifecycle';
import { Scheduler } from './scheduler';
import { PluginRuntime } from './plugins';

export interface EnterpriseRuntimeOptions extends ConfigInput {
  clock?: Clock;
  secrets?: SecretProvider;
  logSink?: LogSink;
  /** Services to register up front (more can be added via runtime.services()). */
  services?: ServiceDefinition[];
}

export interface EnterpriseRuntime {
  version: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  state(): RuntimeState;
  health(): RuntimeHealth;
  events(): EventRuntime;
  notifications(): NotificationService;
  audit(): AuditChain;
  timeline(): TimelineProjection;
  scheduler(): Scheduler;
  services(): ServiceRegistry;
  plugins(): PluginRuntime;
  observability(): ObservabilityRuntime;
  context(): RuntimeContext;
}

export function createEnterpriseRuntime(options: EnterpriseRuntimeOptions = {}): EnterpriseRuntime {
  const clock = options.clock ?? systemClock;
  const config = loadConfig(options);
  const secrets = options.secrets ?? envSecretProvider(options.env ?? {});
  const obs = createObservabilityRuntime(clock, options.logSink);
  const events = createEventRuntime(clock, obs.logger);
  const audit = new AuditChain();
  const health = new HealthSystem();
  const scheduler = new Scheduler(clock);
  const plugins = new PluginRuntime(RUNTIME_VERSION);
  const registry = new ServiceRegistry();

  const notifications = new NotificationService(clock);
  const timeline = new TimelineProjection();
  timeline.attach(events.bus());

  const instances = new Map<string, unknown>();
  const ctx: RuntimeContext = {
    mode: config.mode,
    config,
    logger: obs.logger,
    metrics: obs.metrics,
    events,
    audit,
    secrets,
    get<T = unknown>(name: string): T {
      const value = instances.get(name);
      if (value === undefined) {
        throw new Error(`service '${name}' is not initialized (check dependsOn ordering)`);
      }
      return value as T;
    },
  };

  for (const def of options.services ?? []) registry.register(def);

  const lifecycle = new LifecycleManager(registry, ctx, health, instances);

  return {
    version: RUNTIME_VERSION,
    async start(): Promise<void> {
      await lifecycle.start();
      await events.publish({
        type: 'lifecycle.started',
        topic: 'lifecycle',
        partitionKey: 'runtime',
        version: 1,
        payload: { mode: config.mode, services: registry.names() },
      });
    },
    async stop(): Promise<void> {
      await events.publish({
        type: 'lifecycle.stopping',
        topic: 'lifecycle',
        partitionKey: 'runtime',
        version: 1,
        payload: {},
      });
      await lifecycle.stop();
    },
    state: () => lifecycle.getState(),
    health: () => health.report(),
    events: () => events,
    notifications: () => notifications,
    audit: () => audit,
    timeline: () => timeline,
    scheduler: () => scheduler,
    services: () => registry,
    plugins: () => plugins,
    observability: () => obs,
    context: () => ctx,
  };
}
