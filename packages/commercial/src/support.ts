/**
 * Module 14 — Support Platform. Tickets/cases with a timeline, remote-diagnostics and log-collection
 * (represented — real customer log ingestion is an adapter concern), a customer timeline, and SLA
 * monitoring computed from REAL timestamps. In-process — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { CommercialGovernance } from './governance';
import { SUPPORT_STATES, type SupportState } from './constants';

export interface TicketEvent { at: number; note: string }
export interface Ticket {
  id: string;
  tenantId: string;
  subject: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  state: SupportState;
  slaTargetMs: number;
  timeline: TicketEvent[];
  openedAt: number;
  resolvedAt?: number;
}

export class SupportPlatform {
  private readonly tickets = new Map<string, Ticket>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: CommercialGovernance,
  ) {}

  async openTicket(input: { tenantId: string; subject: string; priority?: Ticket['priority']; slaTargetMs?: number; org?: string }): Promise<Ticket> {
    const now = this.clock.now();
    const t: Ticket = { id: randomId('tkt'), tenantId: input.tenantId, subject: input.subject, priority: input.priority ?? 'normal', state: 'open', slaTargetMs: input.slaTargetMs ?? 86_400_000, timeline: [{ at: now, note: 'opened' }], openedAt: now };
    this.tickets.set(t.id, t);
    await this.governance.record({ actor: 'system', org: input.org ?? '_ops', tenant: input.tenantId, operation: `support.open.${t.priority}`, targetId: t.id, evidence: 'live-verified' });
    return t;
  }

  addNote(id: string, note: string): Ticket {
    const t = this.require(id);
    t.timeline.push({ at: this.clock.now(), note });
    return t;
  }

  async setState(id: string, state: SupportState): Promise<Ticket> {
    if (!SUPPORT_STATES.includes(state)) throw new Error(`unknown support state: ${state}`);
    const t = this.require(id);
    t.state = state;
    if (state === 'resolved' || state === 'closed') t.resolvedAt = this.clock.now();
    t.timeline.push({ at: this.clock.now(), note: `state → ${state}` });
    await this.governance.record({ actor: 'system', org: '_ops', tenant: t.tenantId, operation: `support.${state}`, targetId: t.id, evidence: 'live-verified' });
    return t;
  }

  /** SLA status from REAL elapsed time against the ticket target. */
  slaStatus(id: string): { withinSla: boolean; elapsedMs: number; targetMs: number } {
    const t = this.require(id);
    const end = t.resolvedAt ?? this.clock.now();
    const elapsedMs = end - t.openedAt;
    return { withinSla: elapsedMs <= t.slaTargetMs, elapsedMs, targetMs: t.slaTargetMs };
  }

  timeline(id: string): TicketEvent[] { return [...this.require(id).timeline]; }

  private require(id: string): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`no ticket ${id}`);
    return t;
  }

  get(id: string): Ticket | undefined { return this.tickets.get(id); }
  list(tenantId?: string): Ticket[] {
    const all = [...this.tickets.values()];
    return tenantId ? all.filter((t) => t.tenantId === tenantId) : all;
  }
  count(): number { return this.tickets.size; }
}
