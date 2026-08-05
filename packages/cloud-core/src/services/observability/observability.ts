/**
 * Observability (NCEA 10.2) — REAL, in-memory.
 * A metrics registry (counters + gauges) and a health aggregator that folds
 * component checks into an overall status using the same fail-open/degraded
 * posture as the backend. Structured logging lives in ../../lib/logger.
 * OTel export + dashboards are the follow-up (STATUS.md).
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthComponent {
  name: string;
  status: HealthStatus;
}

export class HealthAggregator {
  private readonly checks = new Map<string, () => HealthStatus>();

  register(name: string, check: () => HealthStatus): void {
    this.checks.set(name, check);
  }

  report(): { status: HealthStatus; components: HealthComponent[] } {
    const components: HealthComponent[] = [...this.checks.entries()].map(([name, check]) => ({
      name,
      status: check(),
    }));
    let status: HealthStatus = 'ok';
    if (components.some((c) => c.status === 'down')) status = 'down';
    else if (components.some((c) => c.status === 'degraded')) status = 'degraded';
    return { status, components };
  }
}
