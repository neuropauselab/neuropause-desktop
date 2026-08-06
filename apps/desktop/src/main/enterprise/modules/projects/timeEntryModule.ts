/**
 * Projects → Time Entries — the billable record on the Enterprise Module
 * Framework (W4.2). CRUD, RBAC (`operations:read` / `operations:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * Guards: hours in (0, 24], the project must exist and be OPEN, and once an
 * entry is invoiced (`invoicedBy` — stamped by a billing run) it is IMMUTABLE
 * billing history. Rate-less entries are legal to log but billing runs skip
 * and count them — nothing is ever billed at zero silently.
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
  TIME_ENTRIES_MODULE_ID,
  TIME_ENTRY_KIND,
  timeEntryFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a time entry — drives store, CRUD, and the UI. */
export const TIME_ENTRY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: TIME_ENTRIES_MODULE_ID,
  title: 'Time Entries',
  singular: 'Time Entry',
  plural: 'Time Entries',
  icon: 'timer',
  description:
    'Billable time on projects — person, date, hours, rate; invoiced entries are immutable billing history.',
  group: 'Projects',
  titleField: 'entryNumber',
  // Reuses the certified operations scopes (the Finance precedent) — no new RBAC surface.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'entryNumber', label: 'Entry #', type: 'text', required: true, placeholder: 'TE-0001' },
    { key: 'projectRef', label: 'Project', type: 'text', required: true, placeholder: 'Project id' },
    { key: 'person', label: 'Person', type: 'text', required: true, placeholder: 'kinjal' },
    { key: 'date', label: 'Date', type: 'date', required: true, format: 'date' },
    { key: 'hours', label: 'Hours', type: 'number', required: true, min: 0, max: 24 },
    { key: 'hourlyRate', label: 'Rate/h', type: 'number', min: 0, format: 'currency' },
    {
      key: 'billable',
      label: 'Billable',
      type: 'select',
      required: true,
      default: 'yes',
      badge: true,
      filterable: true,
      options: [
        { value: 'yes', label: 'Billable', tone: 'green' },
        { value: 'no', label: 'Non-billable', tone: 'neutral' },
      ],
    },
    { key: 'description', label: 'Description', type: 'text', column: false },
    { key: 'invoicedBy', label: 'Invoiced By', type: 'text', readOnly: true, column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Time Entries module. The Projects store backs the open-project
 * guard (the W4.1 pattern).
 */
export function createTimeEntryModule(
  storePath: string,
  projectStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, TIME_ENTRIES_MODULE_ID, TIME_ENTRY_KIND);
  return defineEnterpriseModule({
    descriptor: TIME_ENTRY_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(TIME_ENTRY_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.invoicedBy)) {
          return {
            ok: false,
            errors: { invoicedBy: 'This entry has been invoiced — invoiced time is immutable billing history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const hours = Number(result.values.hours ?? 0);
        if (hours <= 0) errors.hours = 'Hours must be greater than zero.';
        const projectRef = str(result.values.projectRef);
        if (projectRef && projectStore) {
          const project = projectStore.get(projectRef);
          if (!project || project.status === 'deleted') {
            errors.projectRef = `No project with id "${projectRef}" was found.`;
          } else if (str(project.fields.completedAt) || str(project.fields.cancelledAt)) {
            errors.projectRef = 'That project is closed — closed projects accept no time.';
          }
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const entry = timeEntryFromRecord(record);
        return {
          moduleId: TIME_ENTRIES_MODULE_ID,
          recordId: record.id,
          headline: `${entry.entryNumber} · ${entry.person} · ${entry.hours}h · ${entry.invoicedBy ? 'billed' : entry.billable ? 'unbilled' : 'non-billable'}`,
          summary:
            `${entry.person} logged ${entry.hours}h on ${entry.date ?? '—'}` +
            (entry.hourlyRate > 0 ? ` at ${entry.hourlyRate}/h` : ' (no rate — billing runs will skip and count it)') +
            `${entry.description ? ` — ${entry.description}` : ''}.`,
          risk: entry.billable && entry.hourlyRate <= 0 ? 'medium' : 'low',
          riskReason:
            entry.billable && entry.hourlyRate <= 0
              ? 'Billable time without a rate cannot be billed — set the rate.'
              : 'Ready for the next billing run (or already billed).',
          executiveExplanation:
            'Time entries are the raw material of project billing; once a billing run invoices them they freeze.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
