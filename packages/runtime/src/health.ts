/**
 * Unified health subsystem (NCEA 10.2C, Phase 7). Each service exposes a
 * readiness + liveness probe; the system aggregates them (worst-status wins,
 * mirroring the backend's degraded/fail-open posture).
 */
import type { HealthStatus } from '@neuropause/cloud-core';

export type { HealthStatus };

export interface ServiceHealth {
  /** liveness: ok | degraded | down */
  status: HealthStatus;
  /** readiness: is the service ready to serve? */
  ready: boolean;
  detail?: string;
}

export interface RuntimeHealth {
  status: HealthStatus;
  ready: boolean;
  services: Array<{ name: string; status: HealthStatus; ready: boolean; detail?: string }>;
}

export class HealthSystem {
  private readonly probes = new Map<string, () => ServiceHealth>();

  register(name: string, probe: () => ServiceHealth): void {
    this.probes.set(name, probe);
  }
  unregister(name: string): void {
    this.probes.delete(name);
  }

  report(): RuntimeHealth {
    const services = [...this.probes.entries()].map(([name, probe]) => {
      const h = probe();
      return { name, status: h.status, ready: h.ready, ...(h.detail !== undefined ? { detail: h.detail } : {}) };
    });
    let status: HealthStatus = 'ok';
    if (services.some((s) => s.status === 'down')) status = 'down';
    else if (services.some((s) => s.status === 'degraded')) status = 'degraded';
    const ready = services.length > 0 && services.every((s) => s.ready) && status !== 'down';
    return { status, ready, services };
  }
}
