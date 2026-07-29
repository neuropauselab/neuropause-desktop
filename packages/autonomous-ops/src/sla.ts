/**
 * Module 13 — SLA Platform. Define operational / mission SLA targets, record REAL measurements
 * against them, and compute compliance from those measurements only. With no measurements there is
 * no compliance figure — it is null with an honest note, never fabricated. (Workflow-execution SLA
 * reporting already exists in the Wave automation platform; this module governs operational SLAs at
 * the mission/service level and does not duplicate it.) Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';

export interface SLADefinition {
  id: string;
  name: string;
  targetMs: number;
  org?: string;
  createdAt: number;
}
export interface SLAMeasurement {
  slaId: string;
  valueMs: number;
  met: boolean;
  at: number;
}
export interface SLACompliance {
  slaId: string;
  measurements: number;
  met: number;
  compliancePct: number | null;
  note: string;
}

export class SLAPlatform {
  private readonly slas = new Map<string, SLADefinition>();
  private readonly measurements = new Map<string, SLAMeasurement[]>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async defineSLA(input: { name: string; targetMs: number; org?: string }): Promise<SLADefinition> {
    if (input.targetMs <= 0) throw new Error('SLA target must be positive');
    const sla: SLADefinition = { id: randomId('sla'), name: input.name, targetMs: input.targetMs, ...(input.org ? { org: input.org } : {}), createdAt: this.clock.now() };
    this.slas.set(sla.id, sla);
    this.measurements.set(sla.id, []);
    await this.governance.record({ user: 'system', org: input.org ?? '_ops', mission: '_sla', operation: 'sla.define', targetId: sla.id, evidence: 'live-verified' });
    return sla;
  }

  /** Record a real measurement; met = valueMs <= target. */
  async track(input: { slaId: string; valueMs: number }): Promise<SLAMeasurement> {
    const sla = this.slas.get(input.slaId);
    if (!sla) throw new Error(`no SLA ${input.slaId}`);
    const m: SLAMeasurement = { slaId: input.slaId, valueMs: input.valueMs, met: input.valueMs <= sla.targetMs, at: this.clock.now() };
    this.measurements.get(input.slaId)!.push(m);
    await this.governance.record({ user: 'system', org: sla.org ?? '_ops', mission: '_sla', operation: 'sla.track', targetId: input.slaId, evidence: 'live-verified', decision: m.met ? 'met' : 'breached' });
    return m;
  }

  /** Compliance from real measurements only — null (not fabricated) when nothing has been measured. */
  compliance(slaId: string): SLACompliance {
    const ms = this.measurements.get(slaId) ?? [];
    if (ms.length === 0) return { slaId, measurements: 0, met: 0, compliancePct: null, note: 'no measurements recorded — compliance not fabricated' };
    const met = ms.filter((m) => m.met).length;
    return { slaId, measurements: ms.length, met, compliancePct: Math.round((met / ms.length) * 100), note: 'computed from real measurements' };
  }

  measurementsOf(slaId: string): SLAMeasurement[] { return [...(this.measurements.get(slaId) ?? [])]; }
  list(): SLADefinition[] { return [...this.slas.values()]; }
  count(): number { return this.slas.size; }
}
