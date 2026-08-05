/**
 * EPIC 13 — Telemetry Platform. Collects deployment/infrastructure/container/API/database/memory/
 * CPU/latency/availability/throughput/error-rate/storage/worker/AI-runtime/workspace/business
 * metrics. It NEVER fabricates telemetry: a metric is only recorded when a REAL value from a real
 * source is supplied. With no deployed environment emitting values, the snapshot is empty and every
 * metric reads 'No infrastructure data available'. Real in-process values REUSE the operations monitor.
 */
import type { InfraGovernance } from './governance';
import type { InfraContext } from './types';
import { METRIC_KINDS, NO_INFRA_DATA, type MetricKind } from './constants';

export interface MetricReading { kind: MetricKind; value: number; source: string; at: number }

export class TelemetryPlatform {
  private readonly readings = new Map<MetricKind, MetricReading>();

  constructor(
    private readonly governance: InfraGovernance,
    private readonly ctx: InfraContext = {},
  ) {}

  /** Record a REAL metric reading — requires a value and a non-empty real source; never fabricated. */
  async record(input: { kind: MetricKind; value: number; source: string; org?: string }): Promise<MetricReading> {
    if (!METRIC_KINDS.includes(input.kind)) throw new Error(`unknown metric kind: ${input.kind}`);
    if (!input.source) throw new Error('telemetry requires a real source — refusing to record a metric with no origin');
    const reading: MetricReading = { kind: input.kind, value: input.value, source: input.source, at: 0 };
    this.readings.set(input.kind, reading);
    await this.governance.record({ operator: 'system', org: input.org ?? '_platform', environment: '_platform', epic: 'E13', operation: `telemetry.${input.kind}`, targetId: input.kind, evidence: 'business-data-pending', decision: `${input.value} from ${input.source}` });
    return reading;
  }

  /** A metric's live value — 'No infrastructure data available' until a real value is recorded. */
  metric(kind: MetricKind): number | string {
    const r = this.readings.get(kind);
    return r ? r.value : NO_INFRA_DATA;
  }

  /** Snapshot of only the metrics that have real recorded values. */
  snapshot(): MetricReading[] { return [...this.readings.values()]; }
  hasLiveData(): boolean { return this.readings.size > 0; }
  kinds(): readonly MetricKind[] { return METRIC_KINDS; }
  operationsConnected(): boolean { return !!this.ctx.operations; }
  count(): number { return this.readings.size; }
}
