/**
 * Runtime Health Platform (NCEA 15.0, Phase 1). The one global health registry,
 * composed on — not duplicating — the runtime's existing `HealthSystem`. Services
 * and dependencies register liveness + readiness probes; the registry aggregates
 * them (worst-status wins) together with the runtime's own service health into a
 * single report, tracks health history, verifies startup and shutdown, and models
 * graceful-degradation states. There is one health truth: this expands it.
 */
import { systemClock, type Clock } from '@neuropause/cloud-core';

export type HealthStatus = 'ok' | 'degraded' | 'down';
/** Graceful-degradation posture layered over raw liveness. */
export type DegradationState = 'normal' | 'degraded' | 'partial' | 'maintenance' | 'offline';
export type ComponentKind = 'service' | 'dependency';

export interface ComponentHealth {
  status: HealthStatus; // liveness
  ready: boolean; // readiness
  detail?: string;
}
export type HealthProbe = () => ComponentHealth;

export interface DependencyOptions {
  /** A failed critical dependency blocks readiness; a non-critical one only degrades. Default true. */
  critical?: boolean;
  /** database | cache | queue | external | provider | … (informational). */
  kind?: string;
}

interface Component {
  name: string;
  kind: ComponentKind;
  critical: boolean;
  depKind?: string;
  probe: HealthProbe;
}

export interface ComponentReport {
  name: string;
  kind: ComponentKind;
  critical: boolean;
  status: HealthStatus;
  ready: boolean;
  detail?: string;
}

export interface HealthReport {
  status: HealthStatus;
  ready: boolean;
  degradation: DegradationState;
  at: number;
  components: ComponentReport[];
}

export interface VerificationStep {
  name: string;
  ok: boolean;
  status: HealthStatus;
  ready: boolean;
  detail?: string;
}
export interface VerificationReport {
  ok: boolean;
  steps: VerificationStep[];
}

/** The shape of `runtime.health()` — folded in so there is one health truth. */
export interface RuntimeHealthLike {
  status: HealthStatus;
  ready: boolean;
  services: Array<{ name: string; status: HealthStatus; ready: boolean; detail?: string }>;
}

export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.some((s) => s === 'down')) return 'down';
  if (statuses.some((s) => s === 'degraded')) return 'degraded';
  return 'ok';
}

export class HealthRegistry {
  private readonly components = new Map<string, Component>();
  private readonly historyLog: HealthReport[] = [];
  private degradationState: DegradationState = 'normal';

  constructor(
    private readonly clock: Clock = systemClock,
    /** Optional source of the runtime's own service health — the ONE runtime health, folded in. */
    private readonly runtimeHealth?: () => RuntimeHealthLike,
    private readonly historyLimit = 200,
  ) {}

  registerService(name: string, probe: HealthProbe): void {
    this.components.set(name, { name, kind: 'service', critical: true, probe });
  }
  registerDependency(name: string, probe: HealthProbe, opts: DependencyOptions = {}): void {
    this.components.set(name, {
      name,
      kind: 'dependency',
      critical: opts.critical ?? true,
      ...(opts.kind !== undefined ? { depKind: opts.kind } : {}),
      probe,
    });
  }
  unregister(name: string): void {
    this.components.delete(name);
  }
  names(): string[] {
    return [...this.components.keys()];
  }

  private evaluate(c: Component): ComponentReport {
    let h: ComponentHealth;
    try {
      h = c.probe();
    } catch (e) {
      h = { status: 'down', ready: false, detail: e instanceof Error ? e.message : 'probe threw' };
    }
    return {
      name: c.name,
      kind: c.kind,
      critical: c.critical,
      status: h.status,
      ready: h.ready,
      ...(h.detail !== undefined ? { detail: h.detail } : {}),
    };
  }

  /** All component reports, with the runtime's own services folded in (deduped by name). */
  private allReports(): ComponentReport[] {
    const reports = [...this.components.values()].map((c) => this.evaluate(c));
    const seen = new Set(reports.map((r) => r.name));
    const rt = this.runtimeHealth?.();
    if (rt) {
      for (const s of rt.services) {
        if (seen.has(s.name)) continue;
        reports.push({ name: s.name, kind: 'service', critical: true, status: s.status, ready: s.ready, ...(s.detail !== undefined ? { detail: s.detail } : {}) });
      }
    }
    return reports;
  }

  status(name: string): ComponentReport | undefined {
    const c = this.components.get(name);
    return c ? this.evaluate(c) : undefined;
  }

  /** Liveness — worst status across every component and the runtime. */
  liveness(): { status: HealthStatus; at: number } {
    const status = worstStatus(this.allReports().map((r) => r.status));
    return { status, at: this.clock.now() };
  }

  /** Readiness — every CRITICAL component ready, nothing down, not in maintenance/offline. */
  readiness(): { ready: boolean; at: number; blockers: string[] } {
    const reports = this.allReports();
    const blockers = reports.filter((r) => r.critical && (!r.ready || r.status === 'down')).map((r) => r.name);
    const gated = this.degradationState === 'maintenance' || this.degradationState === 'offline';
    if (gated) blockers.push(`degradation:${this.degradationState}`);
    return { ready: reports.length > 0 && blockers.length === 0, at: this.clock.now(), blockers };
  }

  /** The single aggregated health report. */
  aggregate(): HealthReport {
    const components = this.allReports();
    const rawStatus = worstStatus(components.map((r) => r.status));
    const criticalReady = components.filter((r) => r.critical).every((r) => r.ready);
    // Degradation is the more-severe of the raw liveness and any operator-set posture.
    let degradation: DegradationState = this.degradationState;
    if (degradation === 'normal') {
      if (rawStatus === 'down') degradation = 'offline';
      else if (rawStatus === 'degraded' || !criticalReady) degradation = 'degraded';
      else if (components.some((r) => !r.ready)) degradation = 'partial';
    }
    const gated = degradation === 'maintenance' || degradation === 'offline';
    return {
      status: rawStatus,
      ready: components.length > 0 && criticalReady && rawStatus !== 'down' && !gated,
      degradation,
      at: this.clock.now(),
      components,
    };
  }

  /** Record the current report into history and return it. */
  snapshot(): HealthReport {
    const report = this.aggregate();
    this.historyLog.push(report);
    if (this.historyLog.length > this.historyLimit) this.historyLog.shift();
    return report;
  }
  history(): HealthReport[] {
    return [...this.historyLog];
  }

  /** Startup verification — every critical component must be live and ready. */
  startupVerification(): VerificationReport {
    const steps: VerificationStep[] = this.allReports().map((r) => ({
      name: r.name,
      ok: r.critical ? r.ready && r.status !== 'down' : r.status !== 'down',
      status: r.status,
      ready: r.ready,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));
    return { ok: steps.length > 0 && steps.every((s) => s.ok), steps };
  }

  /** Shutdown verification — every component is safely stoppable (no component is still failing/`down`). */
  shutdownVerification(): VerificationReport {
    const steps: VerificationStep[] = this.allReports().map((r) => ({
      name: r.name,
      ok: r.status !== 'down',
      status: r.status,
      ready: r.ready,
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    }));
    return { ok: steps.every((s) => s.ok), steps };
  }

  setDegradation(state: DegradationState): void {
    this.degradationState = state;
  }
  degradation(): DegradationState {
    return this.degradationState;
  }
}
