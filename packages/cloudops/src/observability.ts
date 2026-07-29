/**
 * Module 10 — Observability Platform. Represents metrics / logs / tracing / alerts / dashboards
 * as resource DESCRIPTORS with adapter shapes for Prometheus / Grafana / Loki / Tempo /
 * OpenTelemetry. These are configuration shapes only — NO live telemetry is scraped, stored, or
 * rendered. Live Prometheus metrics and live Grafana dashboards are INFRA-PENDING.
 */
import { randomId } from '@neuropause/cloud-core';
import type { CloudOpsGovernance } from './governance';
import type { ObservabilityResource } from './types';
import { OBSERVABILITY_BACKENDS, OBSERVABILITY_SIGNALS, type ObservabilityBackend, type ObservabilitySignal } from './constants';

export interface RegisterObservabilityInput {
  backend: ObservabilityBackend;
  signal: ObservabilitySignal;
  name: string;
  spec?: Record<string, unknown>;
}

function defaultSpec(backend: ObservabilityBackend, signal: ObservabilitySignal, name: string): Record<string, unknown> {
  switch (backend) {
    case 'prometheus':
      return { scrape_configs: [{ job_name: name, metrics_path: '/metrics', static_configs: [{ targets: [`${name}:8080`] }] }] };
    case 'grafana':
      return { dashboard: { title: name, panels: [{ type: 'timeseries', title: `${name} ${signal}` }] } };
    case 'loki':
      return { pipeline_stages: [{ match: { selector: `{app="${name}"}` } }] };
    case 'tempo':
      return { receivers: { otlp: { protocols: { grpc: {} } } }, service: name };
    case 'opentelemetry':
      return { receivers: ['otlp'], exporters: ['otlphttp'], service: { pipelines: { [signal]: { receivers: ['otlp'], exporters: ['otlphttp'] } } } };
  }
}

export class ObservabilityPlatform {
  private readonly resources = new Map<string, ObservabilityResource>();

  constructor(private readonly governance: CloudOpsGovernance) {}

  async register(input: RegisterObservabilityInput): Promise<ObservabilityResource> {
    if (!OBSERVABILITY_BACKENDS.includes(input.backend)) throw new Error(`unknown observability backend: ${input.backend}`);
    if (!OBSERVABILITY_SIGNALS.includes(input.signal)) throw new Error(`unknown observability signal: ${input.signal}`);
    const resource: ObservabilityResource = {
      id: randomId('obs'),
      backend: input.backend,
      signal: input.signal,
      name: input.name,
      spec: input.spec ?? defaultSpec(input.backend, input.signal, input.name),
      evidence: 'adapter-verified',
      note: `${input.backend} ${input.signal} descriptor registered — live telemetry is INFRA-PENDING (needs live exporters + a running backend)`,
    };
    this.resources.set(resource.id, resource);
    await this.governance.record({ actor: 'system', operation: `observability.register.${input.backend}`, targetId: resource.id, evidence: 'adapter-verified', detail: resource.note });
    return resource;
  }

  get(id: string): ObservabilityResource | undefined {
    return this.resources.get(id);
  }
  list(signal?: ObservabilitySignal): ObservabilityResource[] {
    const all = [...this.resources.values()];
    return signal ? all.filter((r) => r.signal === signal) : all;
  }
  byBackend(backend: ObservabilityBackend): ObservabilityResource[] {
    return [...this.resources.values()].filter((r) => r.backend === backend);
  }
  overview(): { bySignal: Record<string, number>; note: string } {
    const bySignal: Record<string, number> = {};
    for (const r of this.resources.values()) bySignal[r.signal] = (bySignal[r.signal] ?? 0) + 1;
    return { bySignal, note: 'observability descriptors only — no live telemetry is collected or rendered' };
  }
  count(): number {
    return this.resources.size;
  }
}
