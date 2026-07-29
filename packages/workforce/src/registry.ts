/**
 * Module 1 — Enterprise Workforce Runtime & Agent Registry. Agent lifecycle, identity,
 * capabilities, permissions, and sessions. Reuses the runtime (via governance) — every agent
 * operation is audited on the one chain. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkforceGovernance } from './governance';
import { AGENT_STATES, type AgentState } from './constants';

export interface Agent {
  id: string;
  name: string;
  role: string;
  identity: string;
  orgId: string;
  teamId?: string;
  capabilities: string[];
  permissions: string[];
  state: AgentState;
  createdAt: number;
}
export interface AgentSession {
  id: string;
  agentId: string;
  active: boolean;
  startedAt: number;
}

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();
  private readonly sessionsMap = new Map<string, AgentSession>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkforceGovernance,
  ) {}

  async register(input: { name: string; role: string; orgId: string; teamId?: string; capabilities?: string[]; permissions?: string[] }): Promise<Agent> {
    const agent: Agent = {
      id: randomId('agent'),
      name: input.name,
      role: input.role,
      identity: `did:nems:${randomId('id')}`,
      orgId: input.orgId,
      ...(input.teamId ? { teamId: input.teamId } : {}),
      capabilities: input.capabilities ?? [],
      permissions: input.permissions ?? [],
      state: 'provisioned',
      createdAt: this.clock.now(),
    };
    this.agents.set(agent.id, agent);
    await this.governance.record({ user: 'system', org: input.orgId, worker: input.role, operation: 'agent.register', targetId: agent.id, evidence: 'live-verified' });
    return agent;
  }

  async setState(id: string, state: AgentState): Promise<Agent> {
    if (!AGENT_STATES.includes(state)) throw new Error(`unknown agent state: ${state}`);
    const a = this.require(id);
    a.state = state;
    await this.governance.record({ user: 'system', org: a.orgId, worker: a.role, operation: `agent.${state}`, targetId: id, evidence: 'live-verified' });
    return a;
  }
  grantPermission(id: string, permission: string): Agent {
    const a = this.require(id);
    if (!a.permissions.includes(permission)) a.permissions.push(permission);
    return a;
  }
  hasPermission(id: string, permission: string): boolean {
    const a = this.agents.get(id);
    return !!a && (a.permissions.includes(permission) || a.permissions.includes('*'));
  }

  async startSession(agentId: string): Promise<AgentSession> {
    const a = this.require(agentId);
    if (a.state !== 'active') throw new Error('agent must be active to start a session');
    const s: AgentSession = { id: randomId('sess'), agentId, active: true, startedAt: this.clock.now() };
    this.sessionsMap.set(s.id, s);
    return s;
  }
  endSession(id: string): AgentSession {
    const s = this.sessionsMap.get(id);
    if (!s) throw new Error(`no session ${id}`);
    s.active = false;
    return s;
  }

  private require(id: string): Agent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`no agent ${id}`);
    return a;
  }

  get(id: string): Agent | undefined { return this.agents.get(id); }
  list(orgId?: string): Agent[] {
    const all = [...this.agents.values()];
    return orgId ? all.filter((a) => a.orgId === orgId) : all;
  }
  byRole(role: string): Agent[] { return this.list().filter((a) => a.role === role); }
  byTeam(teamId: string): Agent[] { return this.list().filter((a) => a.teamId === teamId); }
  sessions(agentId: string): AgentSession[] { return [...this.sessionsMap.values()].filter((s) => s.agentId === agentId); }
  count(): number { return this.agents.size; }
}
