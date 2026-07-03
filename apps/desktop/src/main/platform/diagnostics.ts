/**
 * Diagnostics aggregator. Assembles a single health report from:
 *   - built-in checks for the Event Bus and Timeline (derived from live metrics);
 *   - injected service probes (runtime, registry, package service, plugin host,
 *     background services, backend/database/cache) — injected so this module
 *     stays decoupled from the services and remains unit-testable.
 *
 * The report carries an overall status (worst of all checks), per-check
 * recovery recommendations, the bus metrics, timeline stats, and subscriber
 * status. Health *history* and the rendered Diagnostics Center arrive in II·B;
 * this produces the authoritative snapshot they consume.
 */
import type {
  DiagnosticCheck,
  DiagnosticStatus,
  DiagnosticsReport,
} from '@neuropause/shared';
import type { EventBus } from './eventBus';
import type { TimelineService } from './timelineService';

/** A probe returns one check; it may be async (e.g., a backend ping). */
export type DiagnosticProbe = () => DiagnosticCheck | Promise<DiagnosticCheck>;

export interface DiagnosticsDeps {
  bus: EventBus;
  timeline: TimelineService;
  startedAt: number;
  now?: () => number;
  probes: DiagnosticProbe[];
}

const RANK: Record<DiagnosticStatus, number> = { ok: 0, unknown: 1, degraded: 2, down: 3 };

/** Convenience builder for probe authors. */
export function makeCheck(
  id: string,
  label: string,
  status: DiagnosticStatus,
  opts: { detail?: string | null; latencyMs?: number | null; recommendation?: string | null; at?: string } = {},
): DiagnosticCheck {
  return {
    id,
    label,
    status,
    detail: opts.detail ?? null,
    latencyMs: opts.latencyMs ?? null,
    lastChecked: opts.at ?? new Date().toISOString(),
    recommendation: opts.recommendation ?? null,
  };
}

export class DiagnosticsService {
  private readonly bus: EventBus;
  private readonly timeline: TimelineService;
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly probes: DiagnosticProbe[];

  constructor(deps: DiagnosticsDeps) {
    this.bus = deps.bus;
    this.timeline = deps.timeline;
    this.startedAt = deps.startedAt;
    this.now = deps.now ?? (() => Date.now());
    this.probes = deps.probes;
  }

  async report(): Promise<DiagnosticsReport> {
    const at = new Date(this.now()).toISOString();
    const checks: DiagnosticCheck[] = [this.busCheck(at), this.timelineCheck(at)];

    for (const probe of this.probes) {
      try {
        checks.push(await probe());
      } catch (err) {
        checks.push(
          makeCheck('probe', 'Service check', 'down', {
            detail: err instanceof Error ? err.message : String(err),
            recommendation: 'Check the logs for this service.',
            at,
          }),
        );
      }
    }

    const overall = checks.reduce<DiagnosticStatus>(
      (worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst),
      'ok',
    );

    return {
      generatedAt: at,
      overall,
      uptimeMs: Math.max(0, this.now() - this.startedAt),
      checks,
      metrics: this.bus.metrics(),
      timeline: this.timeline.stats(),
      subscribers: this.bus.subscriberStatuses(),
    };
  }

  private busCheck(at: string): DiagnosticCheck {
    const m = this.bus.metrics();
    const errored = this.bus.subscriberStatuses().filter((s) => s.errors > 0);
    let status: DiagnosticStatus = 'ok';
    let recommendation: string | null = null;
    if (m.droppedEvents > 0) {
      status = 'degraded';
      recommendation = 'Events are being dropped — reduce publish volume or increase buffer size.';
    } else if (errored.length > 0) {
      status = 'degraded';
      recommendation = `Subscriber(s) failing: ${errored.map((s) => s.id).join(', ')}. Inspect their handlers.`;
    }
    return makeCheck('event-bus', 'Event Bus', status, {
      detail: `${m.eventsPublished} published · ${m.subscribers} subscribers · ${m.eventsPerMinute}/min · avg ${m.avgDispatchMs}ms`,
      recommendation,
      at,
    });
  }

  private timelineCheck(at: string): DiagnosticCheck {
    const s = this.timeline.stats();
    return makeCheck('timeline', 'Timeline Service', 'ok', {
      detail: `${s.total} events recorded · newest ${s.newest ?? 'none'}`,
      at,
    });
  }
}
