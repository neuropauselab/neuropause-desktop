/**
 * CRM → Activities — the sales activity stream (calls, emails, meetings,
 * tasks, notes) on the Enterprise Module Framework. A descriptor + the
 * framework's record store + hooks; CRUD, RBAC (`crm:read` / `crm:manage`),
 * audit, timeline, search, offline persistence, and the entire
 * list/detail/form UI are all inherited — nothing re-implemented.
 *
 * DETERMINISTIC lifecycle discipline (the W1 marker pattern):
 *   • `status` is marker-derived and read-only — validate stamps it `open` on
 *     every write; only the `Complete` / `Cancel` actions stamp
 *     `completedAt` / `cancelledAt` (writing through the store directly), and
 *     once a marker is set the record is immutable history (validate refuses).
 *   • Meetings must carry a scheduled date — an unscheduled meeting is noise.
 *   • Every related ref must RESOLVE against the injected Leads /
 *     Opportunities / Customers stores — no dangling links.
 *
 * The staleness-clock wiring (existing machinery, never duplicated): the Lead,
 * Opportunity, and Contact health rules already measure relationship activity
 * by `updatedAt`. Logging an activity against a record — and completing one —
 * TOUCHES the related records (a rev-bumping update fanned out through the
 * action context), so "no activity in N days" now means exactly that.
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
  ACTIVITIES_MODULE_ID,
  ACTIVITY_KIND,
  CUSTOMERS_MODULE_ID,
  LEADS_MODULE_ID,
  OPPORTUNITIES_MODULE_ID,
  activityFromRecord,
  activitySummaryFallback,
  activityTypeLabel,
  assessActivityHealth,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
  type EnterpriseModuleActionContext,
} from '../../framework';

/** The descriptor action keys the Activities module surfaces. */
export const COMPLETE_ACTIVITY_ACTION = 'complete';
export const CANCEL_ACTIVITY_ACTION = 'cancel';

/** The declarative description of an activity — drives store, CRUD, and the UI. */
export const ACTIVITY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: ACTIVITIES_MODULE_ID,
  title: 'Activities',
  singular: 'Activity',
  plural: 'Activities',
  icon: 'calendar',
  description:
    'The sales activity stream — calls, emails, meetings, tasks, and notes linked to leads, opportunities, and customers.',
  group: 'CRM',
  titleField: 'subject',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  actions: [
    { key: COMPLETE_ACTIVITY_ACTION, label: 'Complete', icon: 'check' },
    { key: CANCEL_ACTIVITY_ACTION, label: 'Cancel', icon: 'x' },
  ],
  fields: [
    { key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Demo call with Acme' },
    {
      key: 'activityType',
      label: 'Type',
      type: 'select',
      required: true,
      default: 'task',
      badge: true,
      filterable: true,
      options: [
        { value: 'call', label: 'Call', tone: 'blue' },
        { value: 'email', label: 'Email', tone: 'teal' },
        { value: 'meeting', label: 'Meeting', tone: 'purple' },
        { value: 'task', label: 'Task', tone: 'neutral' },
        { value: 'note', label: 'Note', tone: 'orange' },
      ],
    },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      column: false,
      options: [
        { value: 'outbound', label: 'Outbound' },
        { value: 'inbound', label: 'Inbound' },
      ],
    },
    { key: 'relatedLeadRef', label: 'Lead', type: 'text', column: false, placeholder: 'Lead id (optional)' },
    { key: 'relatedOpportunityRef', label: 'Opportunity', type: 'text', column: false, placeholder: 'Opportunity id (optional)' },
    { key: 'relatedCustomerRef', label: 'Customer', type: 'text', column: false, placeholder: 'Customer id (optional)' },
    { key: 'scheduledFor', label: 'Scheduled', type: 'date', format: 'date' },
    { key: 'durationMinutes', label: 'Duration (min)', type: 'number', min: 0, column: false },
    { key: 'dueDate', label: 'Due', type: 'date', format: 'date' },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      default: 'medium',
      badge: true,
      filterable: true,
      column: false,
      options: [
        { value: 'low', label: 'Low', tone: 'neutral' },
        { value: 'medium', label: 'Medium', tone: 'blue' },
        { value: 'high', label: 'High', tone: 'pink' },
      ],
    },
    { key: 'assignedTo', label: 'Assigned To', type: 'text' },
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
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'completedAt', label: 'Completed At', type: 'text', readOnly: true, column: false },
    { key: 'cancelledAt', label: 'Cancelled At', type: 'text', readOnly: true, column: false },
    { key: 'outcome', label: 'Outcome', type: 'textarea', column: false, placeholder: 'What happened / what was agreed…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Activities module. The Leads / Opportunities / Customers stores are
 * injected so the ref guards can resolve links and the touch wiring can reach
 * the related records (the W2.1 injection pattern).
 */
export function createActivityModule(
  storePath: string,
  leadStore?: EnterpriseRecordStore,
  opportunityStore?: EnterpriseRecordStore,
  customerStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, ACTIVITIES_MODULE_ID, ACTIVITY_KIND);

  /** The injected store for each related-ref field (validate-time resolution). */
  const REF_STORES: Array<[key: string, label: string, refStore?: EnterpriseRecordStore]> = [
    ['relatedLeadRef', 'lead', leadStore],
    ['relatedOpportunityRef', 'opportunity', opportunityStore],
    ['relatedCustomerRef', 'customer', customerStore],
  ];

  /** The module each related-ref field resolves through at touch time. */
  const REF_MODULES: Array<[key: 'relatedLeadRef' | 'relatedOpportunityRef' | 'relatedCustomerRef', moduleId: string]> = [
    ['relatedLeadRef', LEADS_MODULE_ID],
    ['relatedOpportunityRef', OPPORTUNITIES_MODULE_ID],
    ['relatedCustomerRef', CUSTOMERS_MODULE_ID],
  ];

  /**
   * Touch every resolvable related record: a rev-bumping, field-preserving
   * update + an `updated` fan-out, so the Lead/Opportunity/Contact staleness
   * clocks (`updatedAt`-based) register the activity. Graceful no-op when a
   * module is unavailable.
   */
  async function touchRelated(
    refs: { relatedLeadRef: string; relatedOpportunityRef: string; relatedCustomerRef: string },
    ctx: EnterpriseModuleActionContext,
  ): Promise<void> {
    for (const [key, moduleId] of REF_MODULES) {
      const ref = refs[key];
      if (!ref) continue;
      const module = ctx.moduleFor(moduleId);
      if (!module) continue;
      await module.store.load();
      const record = module.store.get(ref);
      if (!record || record.status === 'deleted') continue;
      const updated = module.store.update(record.id, { fields: {}, actor: ctx.actor(), now: ctx.now() });
      if (updated) ctx.emit(module, 'updated', updated);
    }
  }

  return defineEnterpriseModule({
    descriptor: ACTIVITY_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(ACTIVITY_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Immutability: the framework validates the MERGED field set on update,
        // so a closed record carries its marker here — closed activities are history.
        if (str(input.fields?.completedAt) || str(input.fields?.cancelledAt)) {
          return {
            ok: false,
            errors: { status: 'This activity is completed or cancelled — closed activities are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        if (str(result.values.activityType) === 'meeting' && !str(result.values.scheduledFor)) {
          errors.scheduledFor = 'Meetings need a scheduled date.';
        }
        for (const [key, label, refStore] of REF_STORES) {
          const ref = str(result.values[key]);
          if (!ref || !refStore) continue;
          const record = refStore.get(ref);
          if (!record || record.status === 'deleted') {
            errors[key] = `No ${label} with id "${ref}" was found.`;
          }
        }
        // Marker-derived, forge-proof: an open record's status is always `open` —
        // completed/cancelled exist only through the actions' marker stamps.
        result.values.status = 'open';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      // Logging an activity IS relationship activity: touch the related records
      // so their staleness clocks reset to now.
      onChange: async (event, ctx) => {
        if (event.action !== 'created') return;
        const activity = activityFromRecord(event.record);
        await touchRelated(activity, ctx);
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const activity = activityFromRecord(record);
        const health = assessActivityHealth(activity, Date.now());
        const fallback = activitySummaryFallback(activity, health);
        const when = activity.dueDate ?? activity.scheduledFor ?? '—';
        return {
          moduleId: ACTIVITIES_MODULE_ID,
          recordId: record.id,
          headline: `${activity.subject} · ${activityTypeLabel(activity.activityType)} · ${when}`,
          summary: fallback.summary,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation: fallback.executiveExplanation,
          grounded: false,
          model: 'none',
        };
      },
      // Completion + cancellation stamp markers through the store directly
      // (the W1 pattern) — validate's refusal guards EDITS, not these audited
      // transitions. Completing also touches the related records.
      runAction: async (action, record, actionCtx) => {
        const activity = activityFromRecord(record);
        if (activity.completedAt || activity.cancelledAt) {
          return { ok: false, error: 'This activity is already closed — closed activities are immutable.' };
        }
        if (action === COMPLETE_ACTIVITY_ACTION) {
          store.update(record.id, {
            fields: { completedAt: actionCtx.now(), status: 'completed' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          await touchRelated(activity, actionCtx);
          const outcomeNote = activity.outcome ? '' : ' Record the outcome for the follow-up trail.';
          return { ok: true, message: `${activityTypeLabel(activity.activityType)} completed.${outcomeNote}` };
        }
        if (action === CANCEL_ACTIVITY_ACTION) {
          store.update(record.id, {
            fields: { cancelledAt: actionCtx.now(), status: 'cancelled' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `${activityTypeLabel(activity.activityType)} cancelled.` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
