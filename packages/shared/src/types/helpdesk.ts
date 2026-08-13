/**
 * Helpdesk → Tickets — service-desk domain types + pure SLA logic (W5.1). A
 * NEW certification family; RBAC deliberately reuses `operations:read` /
 * `operations:manage` (the Finance/Projects/HR precedent).
 *
 * A ticket is a persistent service record against a customer. Its SLA target
 * is DERIVED from priority (urgent 4h, high 8h, medium 24h, low 72h) and
 * stamped read-only; whether the SLA is BREACHED is TIME-DERIVED at read
 * against `createdAt` — never stored, never stale. Resolution and closure are
 * the W1 marker pattern (`resolvedAt` / `closedAt`); closing without a
 * resolution is allowed but SAID on the record ("closed unresolved"), never
 * silent. Knowledge-base linkage is a plain reference field — deep knowledge-
 * fabric wiring is a future increment, named not faked.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The Tickets module id + record kind (the framework store key). */
export const TICKETS_MODULE_ID = 'helpdesk-tickets';
export const TICKET_KIND = 'ticket';

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

/** The SLA response targets, in hours, by priority. */
export const TICKET_SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 8,
  medium: 24,
  low: 72,
};

export type TicketStatus = 'open' | 'resolved' | 'closed';

/** A typed view over a ticket record's flat fields (+ envelope timestamps). */
export interface HelpdeskTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  customerRef: string;
  priority: TicketPriority;
  slaHours: number;
  category: string;
  assignee: string;
  kbRef: string;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNotes: string;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
function asPriority(v: unknown): TicketPriority {
  const s = str(v);
  return s === 'low' || s === 'high' || s === 'urgent' ? s : 'medium';
}

/** Project a framework record into a typed ticket. */
export function ticketFromRecord(record: EnterpriseEntity): HelpdeskTicket {
  const f = record.fields;
  return {
    id: record.id,
    ticketNumber: str(f.ticketNumber) || record.title,
    subject: str(f.subject),
    customerRef: str(f.customerRef),
    priority: asPriority(f.priority),
    slaHours: num(f.slaHours),
    category: str(f.category),
    assignee: str(f.assignee),
    kbRef: str(f.kbRef),
    resolvedAt: str(f.resolvedAt) || null,
    closedAt: str(f.closedAt) || null,
    resolutionNotes: str(f.resolutionNotes),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The marker-derived status — closure wins, then resolution, else open. */
export function ticketStatusOf(ticket: HelpdeskTicket): TicketStatus {
  if (ticket.closedAt) return 'closed';
  if (ticket.resolvedAt) return 'resolved';
  return 'open';
}

const HOUR_MS = 60 * 60 * 1000;

/** Hours until (positive) or past (negative) the SLA target. Time-derived. */
export function ticketSlaRemainingHours(ticket: HelpdeskTicket, nowMs: number): number {
  const createdMs = Date.parse(ticket.createdAt);
  if (!Number.isFinite(createdMs) || ticket.slaHours <= 0) return Number.POSITIVE_INFINITY;
  const deadline = createdMs + ticket.slaHours * HOUR_MS;
  const end = ticket.resolvedAt ? Date.parse(ticket.resolvedAt) : nowMs;
  return Math.round(((deadline - end) / HOUR_MS) * 10) / 10;
}

export interface TicketHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

/** Deterministic SLA health — breach high, near-breach medium, else low. */
export function assessTicketHealth(ticket: HelpdeskTicket, nowMs: number): TicketHealth {
  const status = ticketStatusOf(ticket);
  const remaining = ticketSlaRemainingHours(ticket, nowMs);
  if (status !== 'open') {
    return remaining < 0
      ? { level: 'low', reason: `${status === 'closed' ? 'Closed' : 'Resolved'} — SLA was missed by ${Math.abs(remaining)}h (history).` }
      : { level: 'low', reason: `${status === 'closed' ? 'Closed' : 'Resolved'} within SLA.` };
  }
  if (remaining < 0) {
    return { level: 'high', reason: `SLA BREACHED ${Math.abs(remaining)}h ago (${ticket.priority} → ${ticket.slaHours}h target).` };
  }
  if (remaining <= ticket.slaHours * 0.25) {
    return { level: 'medium', reason: `${remaining}h left of the ${ticket.slaHours}h SLA — act now.` };
  }
  return { level: 'low', reason: `${remaining}h left of the ${ticket.slaHours}h SLA.` };
}
