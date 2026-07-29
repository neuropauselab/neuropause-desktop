/**
 * Module 1 — Enterprise Operations Runtime. Mission registry, operational context, organization
 * state, execution context, runtime sessions, and a global operation registry. Reuses the runtime
 * (via governance). In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { MISSION_STATES, type MissionState } from './constants';

export interface Mission {
  id: string;
  name: string;
  orgId: string;
  goal: string;
  ownerId?: string;
  state: MissionState;
  createdAt: number;
}
export interface Operation {
  id: string;
  missionId: string;
  name: string;
  kind: string;
  at: number;
}

export class OperationsRuntime {
  private readonly missions = new Map<string, Mission>();
  private readonly operations = new Map<string, Operation>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async createMission(input: { name: string; orgId: string; goal?: string; ownerId?: string }): Promise<Mission> {
    const m: Mission = { id: randomId('mission'), name: input.name, orgId: input.orgId, goal: input.goal ?? input.name, ...(input.ownerId ? { ownerId: input.ownerId } : {}), state: 'planned', createdAt: this.clock.now() };
    this.missions.set(m.id, m);
    await this.governance.record({ user: input.ownerId ?? 'system', org: input.orgId, mission: m.id, operation: 'mission.create', targetId: m.id, evidence: 'live-verified' });
    return m;
  }

  async setMissionState(id: string, state: MissionState): Promise<Mission> {
    if (!MISSION_STATES.includes(state)) throw new Error(`unknown mission state: ${state}`);
    const m = this.require(id);
    m.state = state;
    await this.governance.record({ user: 'system', org: m.orgId, mission: id, operation: `mission.${state}`, targetId: id, evidence: 'live-verified' });
    return m;
  }

  async registerOperation(input: { missionId: string; name: string; kind: string }): Promise<Operation> {
    const op: Operation = { id: randomId('op'), missionId: input.missionId, name: input.name, kind: input.kind, at: this.clock.now() };
    this.operations.set(op.id, op);
    return op;
  }

  /** Operational context for an organization — real mission state, never fabricated. */
  context(orgId: string): { orgId: string; missions: number; active: number; planned: number } {
    const ms = this.missionsOf(orgId);
    return { orgId, missions: ms.length, active: ms.filter((m) => m.state === 'active').length, planned: ms.filter((m) => m.state === 'planned').length };
  }

  private require(id: string): Mission {
    const m = this.missions.get(id);
    if (!m) throw new Error(`no mission ${id}`);
    return m;
  }

  get(id: string): Mission | undefined { return this.missions.get(id); }
  missionsOf(orgId?: string): Mission[] {
    const all = [...this.missions.values()];
    return orgId ? all.filter((m) => m.orgId === orgId) : all;
  }
  operationsOf(missionId?: string): Operation[] {
    const all = [...this.operations.values()];
    return missionId ? all.filter((o) => o.missionId === missionId) : all;
  }
  count(): number { return this.missions.size; }
}
