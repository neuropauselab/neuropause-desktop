/**
 * Module 2 — Mission Control. Organization overview, live operations, active missions, critical
 * alerts, executive timeline, enterprise status, and operational health — composed from the real
 * operations runtime. No status is fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import type { OperationsRuntime, Mission } from './runtime';
import { NO_OPS_DATA, type Severity } from './constants';

export interface CriticalAlert {
  id: string;
  orgId: string;
  severity: Severity;
  message: string;
  at: number;
}

export class MissionControl {
  private readonly alerts: CriticalAlert[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
    private readonly runtime: OperationsRuntime,
  ) {}

  async raiseAlert(input: { orgId: string; severity: Severity; message: string }): Promise<CriticalAlert> {
    const a: CriticalAlert = { id: randomId('alert'), orgId: input.orgId, severity: input.severity, message: input.message, at: this.clock.now() };
    this.alerts.push(a);
    await this.governance.record({ user: 'system', org: input.orgId, mission: '_control', operation: `alert.${input.severity}`, targetId: a.id, evidence: 'live-verified' });
    return a;
  }

  overview(orgId: string): { orgId: string; missions: number; active: number; alerts: number; status: string; health: number | string } {
    const ctx = this.runtime.context(orgId);
    const alerts = this.criticalAlerts(orgId).length;
    return { orgId, missions: ctx.missions, active: ctx.active, alerts, status: ctx.missions === 0 ? NO_OPS_DATA : alerts > 0 ? 'attention' : 'nominal', health: this.operationalHealth(orgId) };
  }

  liveOperations(orgId: string): Mission[] {
    return this.runtime.missionsOf(orgId).filter((m) => m.state === 'active');
  }
  activeMissions(orgId: string): Mission[] {
    return this.liveOperations(orgId);
  }
  criticalAlerts(orgId?: string): CriticalAlert[] {
    return orgId ? this.alerts.filter((a) => a.orgId === orgId) : [...this.alerts];
  }
  executiveTimeline(orgId: string): Array<{ mission: string; state: string; at: number }> {
    return this.runtime.missionsOf(orgId).map((m) => ({ mission: m.name, state: m.state, at: m.createdAt }));
  }

  /** Operational health from real mission state — 'No business data available' when empty. */
  operationalHealth(orgId: string): number | string {
    const ctx = this.runtime.context(orgId);
    if (ctx.missions === 0) return NO_OPS_DATA;
    const alerts = this.criticalAlerts(orgId).length;
    return Math.max(0, 100 - alerts * 20);
  }
}
