/**
 * Module 15 — Executive War Room. Crisis-coordination sessions with participants, a decision log,
 * and a session timeline. Decisions are RECORDED and governed with an evidence level — they are
 * never autonomously executed. A decision tagged with a regulated operation is represented only
 * (evidence regulated-external, approval pending) and its `executed` flag is permanently false.
 * Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { REGULATED_OPS, type Severity } from './constants';

export interface WarRoomDecision {
  id: string;
  text: string;
  by: string;
  regulated: boolean;
  executed: false; // never executed autonomously — represented only
  note: string;
  at: number;
}
export interface WarRoomSession {
  id: string;
  orgId: string;
  title: string;
  severity: Severity;
  participants: string[];
  decisions: WarRoomDecision[];
  state: 'open' | 'closed';
  openedAt: number;
  closedAt?: number;
}

export class WarRoom {
  private readonly sessions = new Map<string, WarRoomSession>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  async open(input: { orgId: string; title: string; severity: Severity }): Promise<WarRoomSession> {
    const s: WarRoomSession = { id: randomId('warroom'), orgId: input.orgId, title: input.title, severity: input.severity, participants: [], decisions: [], state: 'open', openedAt: this.clock.now() };
    this.sessions.set(s.id, s);
    await this.governance.record({ user: 'system', org: input.orgId, mission: '_warroom', operation: `warroom.open.${input.severity}`, targetId: s.id, evidence: 'live-verified' });
    return s;
  }

  addParticipant(id: string, participant: string): WarRoomSession {
    const s = this.require(id);
    if (!s.participants.includes(participant)) s.participants.push(participant);
    return s;
  }

  /** Log a decision. A regulated decision is represented only — never executed autonomously. */
  async decide(input: { sessionId: string; text: string; by: string; regulatedKind?: string }): Promise<WarRoomDecision> {
    const s = this.require(input.sessionId);
    const regulated = input.regulatedKind !== undefined && (REGULATED_OPS as readonly string[]).includes(input.regulatedKind);
    const d: WarRoomDecision = {
      id: randomId('decision'),
      text: input.text,
      by: input.by,
      regulated,
      executed: false,
      note: regulated ? 'regulated decision — represented only, not executed autonomously' : 'human decision recorded for coordination',
      at: this.clock.now(),
    };
    s.decisions.push(d);
    await this.governance.record({ user: input.by, org: s.orgId, mission: '_warroom', operation: 'warroom.decision', targetId: d.id, evidence: regulated ? 'regulated-external' : 'live-verified', decision: input.text, approval: regulated ? 'pending' : 'not-required' });
    return d;
  }

  async close(id: string): Promise<WarRoomSession> {
    const s = this.require(id);
    s.state = 'closed';
    s.closedAt = this.clock.now();
    await this.governance.record({ user: 'system', org: s.orgId, mission: '_warroom', operation: 'warroom.close', targetId: s.id, evidence: 'live-verified' });
    return s;
  }

  private require(id: string): WarRoomSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no war room session ${id}`);
    return s;
  }

  get(id: string): WarRoomSession | undefined { return this.sessions.get(id); }
  list(orgId?: string): WarRoomSession[] {
    const all = [...this.sessions.values()];
    return orgId ? all.filter((s) => s.orgId === orgId) : all;
  }
  count(): number { return this.sessions.size; }
}
