/**
 * NeuroPause Cloud service (NCEA Phase 10.2, consolidated 10.2A, library-split 10.2B).
 *
 * The reusable platform primitives now live in `@neuropause/cloud-core` so the
 * backend and future surfaces can consume them without depending on this app.
 * This module is the cloud SERVICE composition: it wires the shared primitives
 * into one coordinating surface (`createCloud`) and re-exports the platform for
 * convenience. It is NOT a running server (no HTTP listener, no database).
 *
 * CONSTITUTION: the cloud only coordinates; the gateway ENFORCES an
 * already-authenticated context — it does not mint identity. Governance stays
 * in NeuroPause OS.
 */
import {
  type Clock,
  systemClock,
  Logger,
  type LogSink,
  MemorySink,
  EventBus,
  InMemoryEventStore,
  SyncEngine,
  AuditChain,
  NotificationService,
  TimelineProjection,
  Gateway,
  RateLimiter,
  RequestSigner,
  HealthAggregator,
  MetricsRegistry,
} from '@neuropause/cloud-core';

export interface CloudOptions {
  clock?: Clock;
  logSink?: LogSink;
  /** signing secret — supplied by the deployment, never hard-coded. */
  secret: string;
  rateLimit?: { capacity: number; refillPerSec: number };
}

export interface Cloud {
  clock: Clock;
  logger: Logger;
  metrics: MetricsRegistry;
  health: HealthAggregator;
  events: EventBus;
  sync: SyncEngine;
  audit: AuditChain;
  notifications: NotificationService;
  timeline: TimelineProjection;
  gateway: Gateway;
  signer: RequestSigner;
}

export function createCloud(options: CloudOptions): Cloud {
  const clock = options.clock ?? systemClock;
  const logger = new Logger(options.logSink ?? new MemorySink(), clock, { service: 'cloud' });
  const metrics = new MetricsRegistry();
  const health = new HealthAggregator();

  const events = new EventBus(new InMemoryEventStore(), clock, logger);
  const sync = new SyncEngine();
  const audit = new AuditChain();
  const notifications = new NotificationService(clock);

  const timeline = new TimelineProjection();
  timeline.attach(events);

  const limiter = options.rateLimit ? new RateLimiter(clock, options.rateLimit) : undefined;
  const gateway = new Gateway(limiter);
  const signer = new RequestSigner(options.secret, clock);

  health.register('events', () => 'ok');
  health.register('sync', () => 'ok');

  return {
    clock,
    logger,
    metrics,
    health,
    events,
    sync,
    audit,
    notifications,
    timeline,
    gateway,
    signer,
  };
}

export * from '@neuropause/cloud-core';
