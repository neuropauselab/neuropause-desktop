/**
 * Helpdesk → Tickets — the service desk on the Enterprise Module Framework
 * (W5.1), opening the Helpdesk family. CRUD, RBAC (`operations:read` /
 * `operations:manage` — the established reuse precedent), audit, timeline,
 * search, offline persistence, and the UI are all inherited.
 *
 * DETERMINISTIC service discipline: the SLA target is stamped read-only from
 * priority (urgent 4h / high 8h / medium 24h / low 72h) and BREACH is
 * time-derived at read — never stored, never stale. `customerRef` (optional)
 * must resolve against the injected Customers store. `Resolve` and `Close`
 * are the W1 marker pattern; closing an unresolved ticket is allowed and SAID
 * ("closed unresolved") — never silent. Closed tickets are immutable history.
 *
 * Electron-free (store paths injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  TICKETS_MODULE_ID,
  TICKET_KIND,
  TICKET_SLA_HOURS,
  assessTicketHealth,
  ticketFromRecord,
  ticketStatusOf,
  validateEnterpriseRecordInput,
  type TicketPriority,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the Tickets module surfaces. */
export const RESOLVE_TICKET_ACTION = 'resolve';
export const CLOSE_TICKET_ACTION = 'close';

/** The declarative description of a ticket — drives store, CRUD, and the UI. */
export const TICKET_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TICKETS_MODULE_ID,
  title: 'Tickets',
  singular: 'Ticket',
  plural: 'Tickets',
  icon: 'life-buoy',
  description:
    'The service desk — priority-derived SLA targets with time-derived breach, marker resolution and closure.',
  group: 'Helpdesk',
  titleField: 'subject',
  // Reuses the certified operations scopes (the established precedent).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: RESOLVE_TICKET_ACTION, label: 'Resolve', icon: 'check' },
    { key: CLOSE_TICKET_ACTION, label: 'Close', icon: 'close' },
  ],
  fields: [
    { key: 'ticketNumber', label: 'Ticket #', type: 'text', required: true, placeholder: 'TIC-0001' },
    { key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'App will not start' },
    { key: 'customerRef', label: 'Customer', type: 'text', column: false, placeholder: 'Customer id (optional)' },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      default: 'medium',
      badge: true,
      filterable: true,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'orange' },
        { value: 'urgent', label: 'Urgent', tone: 'pink' },
      ],
    },
    { key: 'slaHours', label: 'SLA (h)', type: 'number', readOnly: true },
    { key: 'category', label: 'Category', type: 'text', filterable: true, column: false },
    { key: 'assignee', label: 'Assignee', type: 'text' },
    { key: 'description', label: 'Description', type: 'textarea', column: false },
    { key: 'kbRef', label: 'Knowledge Ref', type: 'text', column: false, placeholder: 'KB article ref (optional)' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'open',
      badge: true,
      filterable: true,
      options: [
        { value: 'open', label: 'Open', tone: 'blue' },
        { value: 'resolved', label: 'Resolved', tone: 'teal' },
        { value: 'closed', label: 'Closed', tone: 'green' },
      ],
    },
    { key: 'resolvedAt', label: 'Resolved At', type: 'text', readOnly: true, column: false },
    { key: 'closedAt', label: 'Closed At', type: 'text', readOnly: true, column: false },
    { key: 'resolutionNotes', label: 'Resolution', type: 'textarea', column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Tickets module. The Customers store backs the optional ref guard.
 */
export function createTicketModule(
  storePath: string,
  customerStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TICKETS_MODULE_ID, TICKET_KIND);
  return defineEnterpriseModule({
    descriptor: TICKET_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(TICKET_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.closedAt)) {
          return {
            ok: false,
            errors: { status: 'This ticket is closed — closed tickets are immutable service history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const customerRef = str(result.values.customerRef);
        if (customerRef && customerStore) {
          const customer = customerStore.get(customerRef);
          if (!customer || customer.status === 'deleted') {
            errors.customerRef = `No customer with id "${customerRef}" was found.`;
          }
        }
        // Priority → SLA, stamped read-only (never user-supplied).
        const priority = str(result.values.priority) as TicketPriority;
        result.values.slaHours = TICKET_SLA_HOURS[priority] ?? TICKET_SLA_HOURS.medium;
        if (!str(result.values.resolvedAt)) result.values.status = 'open';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const ticket = ticketFromRecord(record);
        const health = assessTicketHealth(ticket, Date.now());
        const status = ticketStatusOf(ticket);
        const unresolvedNote =
          status === 'closed' && !ticket.resolvedAt ? ' Closed UNRESOLVED — said, not hidden.' : '';
        return {
          moduleId: TICKETS_MODULE_ID,
          recordId: record.id,
          headline: `${ticket.ticketNumber} · ${status} · ${ticket.priority} · SLA ${ticket.slaHours}h`,
          summary: `${ticket.subject} — ${health.reason}${unresolvedNote}`,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation:
            'Tickets carry priority-derived SLA targets; breach is computed at read so the queue is always honestly ranked.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const ticket = ticketFromRecord(record);
        if (ticket.closedAt) return { ok: false, error: 'This ticket is already closed.' };
        if (action === RESOLVE_TICKET_ACTION) {
          if (ticket.resolvedAt) return { ok: false, error: 'This ticket is already resolved — close it or reopen by policy.' };
          store.update(record.id, {
            fields: { resolvedAt: actionCtx.now(), status: 'resolved' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const notesNote = ticket.resolutionNotes ? '' : ' Record resolution notes for the knowledge trail.';
          return { ok: true, message: `Resolved.${notesNote}` };
        }
        if (action === CLOSE_TICKET_ACTION) {
          const unresolved = !ticket.resolvedAt;
          store.update(record.id, {
            fields: { closedAt: actionCtx.now(), status: 'closed' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: unresolved ? 'Closed UNRESOLVED — recorded as such, not hidden.' : 'Closed.',
          };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
