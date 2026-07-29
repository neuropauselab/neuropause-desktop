/**
 * Module 14 — AI Workforce Orchestration. Assigns AI workers to missions and reads the AI org chart
 * by REUSING the Wave 11 workforce platform (agent registry + AI organization) — it never
 * re-implements the workforce. With no workforce connected there are zero workers to assign and the
 * result says so honestly rather than inventing a roster; the governance evidence downgrades to
 * business-data-pending in that case.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import type { OpsContext } from './types';

export interface WorkerAssignment {
  id: string;
  missionId: string;
  orgId: string;
  aiWorkers: string[];
  note: string;
  at: number;
}

export class WorkforceOrchestration {
  private readonly assignments: WorkerAssignment[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
    private readonly ctx: OpsContext = {},
  ) {}

  /** Assign real AI agents (from the reused Wave 11 registry) to a mission — 0 when none connected. */
  async assign(input: { missionId: string; orgId: string; max?: number }): Promise<WorkerAssignment> {
    const wf = this.ctx.workforce;
    const all = wf ? wf.agents().list(input.orgId).map((a) => a.id) : [];
    const aiWorkers = input.max !== undefined ? all.slice(0, input.max) : all;
    const a: WorkerAssignment = {
      id: randomId('assign'),
      missionId: input.missionId,
      orgId: input.orgId,
      aiWorkers,
      note: aiWorkers.length > 0 ? 'real AI agents from the reused Wave 11 workforce' : 'no AI workforce connected — 0 workers assigned, not fabricated',
      at: this.clock.now(),
    };
    this.assignments.push(a);
    await this.governance.record({ user: 'system', org: input.orgId, mission: input.missionId, operation: 'workforce.assign', targetId: a.id, evidence: aiWorkers.length > 0 ? 'live-verified' : 'business-data-pending', ...(aiWorkers.length > 0 ? { aiWorkers } : {}) });
    return a;
  }

  /** AI org chart reused from Wave 11 — empty (honest) when no workforce is connected. */
  orgChart(orgId: string): { orgId: string; departments: Array<{ name: string; teams: Array<{ name: string; agents: number }> }>; note: string } {
    const wf = this.ctx.workforce;
    if (!wf) return { orgId, departments: [], note: 'no AI workforce connected' };
    const chart = wf.organization().orgChart(orgId);
    return { orgId, departments: chart.departments.map((d) => ({ name: d.name, teams: d.teams.map((t) => ({ name: t.name, agents: t.agents })) })), note: 'reused Wave 11 AI organization' };
  }

  capacity(): { agents: number; note: string } {
    const n = this.ctx.workforce ? this.ctx.workforce.agents().count() : 0;
    return { agents: n, note: n > 0 ? 'real AI agent count from Wave 11' : 'no workforce connected — 0, not invented' };
  }

  list(missionId?: string): WorkerAssignment[] {
    return missionId ? this.assignments.filter((a) => a.missionId === missionId) : [...this.assignments];
  }
  count(): number { return this.assignments.length; }
}
