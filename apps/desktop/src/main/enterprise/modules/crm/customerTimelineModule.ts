/**
 * CRM → Customer Timeline — immutable one-customer chronology snapshots on the
 * Enterprise Module Framework (W2.7): CREATING a timeline generates it. The
 * validate hook resolves the customer (by record id or exact name), then walks
 * the injected Quotes + Invoices + Opportunities + Activities + Contracts
 * stores through the pure `deriveCustomerTimeline` — the account's whole story
 * newest-first, capped at 200 events with the cap REPORTED, never silent.
 * CRUD, RBAC (`crm:read` / `crm:manage`), audit, timeline, search, offline
 * persistence, and the entire list/detail/form UI are all inherited.
 *
 * Match basis (stated on every snapshot): finance documents and quotes match
 * by exact customer NAME (their historical convention); activities and
 * contracts match by customer record ID (the W2 convention). Snapshots are
 * IMMUTABLE (the `generatedAt` marker refuses edits) — regenerate for the
 * current view; the sequence is meeting-prep history.
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
  CUSTOMER_TIMELINE_CAP,
  CUSTOMER_TIMELINE_MODULE_ID,
  CUSTOMER_TIMELINE_KIND,
  activityFromRecord,
  contractFromRecord,
  deriveCustomerTimeline,
  invoiceFromRecord,
  opportunityFromRecord,
  quoteFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a customer timeline — drives store, CRUD, and the UI. */
export const CUSTOMER_TIMELINE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CUSTOMER_TIMELINE_MODULE_ID,
  title: 'Customer Timelines',
  singular: 'Customer Timeline',
  plural: 'Customer Timelines',
  icon: 'clock',
  description:
    'Immutable one-customer chronologies — quotes, invoices, opportunities, activities, and contracts in one newest-first story.',
  group: 'CRM',
  titleField: 'timelineNumber',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [
    { key: 'timelineNumber', label: 'Timeline #', type: 'text', readOnly: true },
    { key: 'customerRef', label: 'Customer', type: 'text', required: true, placeholder: 'Customer id or exact name' },
    { key: 'customerName', label: 'Name', type: 'text', readOnly: true },
    { key: 'eventCount', label: 'Events', type: 'number', readOnly: true, default: 0 },
    { key: 'rows', label: 'Events', type: 'textarea', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', readOnly: true, column: false },
    { key: 'generatedAt', label: 'Generated At', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Customer Timeline module. Customer + Quote + Invoice +
 * Opportunity + Activity + Contract stores are injected so generation reads
 * real records.
 */
export function createCustomerTimelineModule(
  storePath: string,
  customerStore: EnterpriseRecordStore,
  quoteStore: EnterpriseRecordStore,
  invoiceStore: EnterpriseRecordStore,
  opportunityStore: EnterpriseRecordStore,
  activityStore: EnterpriseRecordStore,
  contractStore: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CUSTOMER_TIMELINE_MODULE_ID, CUSTOMER_TIMELINE_KIND);
  return defineEnterpriseModule({
    descriptor: CUSTOMER_TIMELINE_DESCRIPTOR,
    store,
    hooks: {
      // Creating a timeline IS generating it; a generated timeline is immutable.
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CUSTOMER_TIMELINE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(result.values.generatedAt)) {
          return {
            ok: false,
            errors: { _: 'Customer timelines are immutable snapshots — generate a new timeline instead.' },
            values: result.values,
          };
        }
        const ref = str(result.values.customerRef).trim();
        const byId = customerStore.get(ref);
        const record =
          byId && byId.status !== 'deleted'
            ? byId
            : (customerStore.list().find((r) => str(r.fields.name) === ref) ?? null);
        if (!record) {
          return {
            ok: false,
            errors: { customerRef: `No customer with id or exact name "${ref}" was found.` },
            values: result.values,
          };
        }
        const customer = { id: record.id, name: str(record.fields.name) || record.title };
        const timeline = deriveCustomerTimeline(customer, {
          quotes: quoteStore.list().map(quoteFromRecord),
          invoices: invoiceStore.list().map(invoiceFromRecord),
          opportunities: opportunityStore.list().map(opportunityFromRecord),
          activities: activityStore.list().map(activityFromRecord),
          contracts: contractStore.list().map(contractFromRecord),
        });
        const priorCount = store.list().filter((r) => str(r.fields.customerName) === customer.name).length;
        result.values.customerRef = record.id;
        result.values.customerName = customer.name;
        result.values.timelineNumber = `CT-${customer.name.replace(/\s+/g, '-')}-${priorCount + 1}`;
        result.values.eventCount = timeline.events.length;
        result.values.rows = JSON.stringify(timeline.events);
        result.values.note =
          timeline.events.length === 0
            ? `no linked records for ${customer.name} yet — the timeline is empty, not fabricated`
            : `finance/quotes matched by name, activities/contracts by id` +
              (timeline.totalBeforeCap > CUSTOMER_TIMELINE_CAP
                ? `; showing the newest ${CUSTOMER_TIMELINE_CAP} of ${timeline.totalBeforeCap} events`
                : '');
        result.values.generatedAt = new Date().toISOString();
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: CUSTOMER_TIMELINE_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.timelineNumber)} · ${Number(f.eventCount ?? 0)} event(s)`,
          summary: `${str(f.customerName)}: ${Number(f.eventCount ?? 0)} event(s) across quotes, invoices, opportunities, activities, and contracts — newest first. ${str(f.note)}.`,
          risk: 'low',
          riskReason: 'Timelines are read-only history; risk lives on the underlying records.',
          executiveExplanation:
            'One account, one story: the immutable snapshot a rep reads before the call, regenerated on demand.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
