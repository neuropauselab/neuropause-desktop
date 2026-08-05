/**
 * Module 11 — AI Organization. AI departments, teams, managers, a reporting structure, and an org
 * chart that mirrors the enterprise structure. Built from the real agent registry — live-verified;
 * starts empty.
 */
import { randomId } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import type { AgentRegistry } from './registry';

export interface AiDepartment {
  id: string;
  name: string;
  orgId: string;
}
export interface AiTeam {
  id: string;
  name: string;
  departmentId: string;
  managerAgentId?: string;
}

export class AiOrganization {
  private readonly departments = new Map<string, AiDepartment>();
  private readonly teams = new Map<string, AiTeam>();

  constructor(
    private readonly governance: WorkforceGovernance,
    private readonly registry: AgentRegistry,
  ) {}

  async createDepartment(input: { name: string; orgId: string }): Promise<AiDepartment> {
    const d: AiDepartment = { id: randomId('dept'), name: input.name, orgId: input.orgId };
    this.departments.set(d.id, d);
    await this.governance.record({ user: 'system', org: input.orgId, worker: 'org', operation: 'org.department', targetId: d.id, evidence: 'live-verified' });
    return d;
  }
  async createTeam(input: { name: string; departmentId: string; orgId: string; managerAgentId?: string }): Promise<AiTeam> {
    const t: AiTeam = { id: randomId('team'), name: input.name, departmentId: input.departmentId, ...(input.managerAgentId ? { managerAgentId: input.managerAgentId } : {}) };
    this.teams.set(t.id, t);
    await this.governance.record({ user: 'system', org: input.orgId, worker: 'org', operation: 'org.team', targetId: t.id, evidence: 'live-verified' });
    return t;
  }
  assignManager(teamId: string, managerAgentId: string): AiTeam {
    const t = this.teams.get(teamId);
    if (!t) throw new Error(`no team ${teamId}`);
    t.managerAgentId = managerAgentId;
    return t;
  }

  /** Org chart from the real registry — departments → teams → agents. */
  orgChart(orgId: string): { orgId: string; departments: Array<{ name: string; teams: Array<{ name: string; managerAgentId?: string; agents: number }> }> } {
    const depts = [...this.departments.values()].filter((d) => d.orgId === orgId);
    return {
      orgId,
      departments: depts.map((d) => ({
        name: d.name,
        teams: [...this.teams.values()].filter((t) => t.departmentId === d.id).map((t) => ({ name: t.name, ...(t.managerAgentId ? { managerAgentId: t.managerAgentId } : {}), agents: this.registry.byTeam(t.id).length })),
      })),
    };
  }

  departmentList(orgId?: string): AiDepartment[] {
    const all = [...this.departments.values()];
    return orgId ? all.filter((d) => d.orgId === orgId) : all;
  }
  teamList(departmentId?: string): AiTeam[] {
    const all = [...this.teams.values()];
    return departmentId ? all.filter((t) => t.departmentId === departmentId) : all;
  }
  count(): number { return this.departments.size + this.teams.size; }
}
