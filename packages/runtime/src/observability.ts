/**
 * Observability runtime (NCEA 10.2C, Phase 8). Structured (redacting) logging,
 * trace ids, performance timers, metrics, and a per-trace diagnostic context —
 * all from the single cloud-core primitives.
 */
import {
  Logger,
  MemorySink,
  MetricsRegistry,
  randomId,
  type Clock,
  type LogSink,
} from '@neuropause/cloud-core';

export interface PerfTimer {
  end(): number;
}

export interface ObservabilityRuntime {
  logger: Logger;
  metrics: MetricsRegistry;
  newTraceId(): string;
  startTimer(name: string): PerfTimer;
  withTrace(traceId: string): Logger;
}

export function createObservabilityRuntime(clock: Clock, sink?: LogSink): ObservabilityRuntime {
  const logger = new Logger(sink ?? new MemorySink(), clock, { runtime: true });
  const metrics = new MetricsRegistry();
  return {
    logger,
    metrics,
    newTraceId: () => randomId('trace'),
    startTimer: (name) => {
      const start = clock.now();
      return {
        end: () => {
          const elapsed = clock.now() - start;
          metrics.set(`timer.${name}.ms`, elapsed);
          return elapsed;
        },
      };
    },
    withTrace: (traceId) => logger.child({ traceId }),
  };
}
