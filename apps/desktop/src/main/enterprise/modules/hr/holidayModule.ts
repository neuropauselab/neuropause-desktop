/**
 * HR → Holiday Calendar — company holidays on the Enterprise Module Framework
 * (FW-2). CRUD, RBAC (`operations:read` / `operations:manage`), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one declared holiday date. The calendar feeds the FW-2 leave
 * engine: a declared holiday inside an unpaid-leave span is NOT docked as
 * loss-of-pay (the fairer default, stated on the record). Guards: a strict
 * date, and ONE live holiday per date — the calendar is a set, not a list.
 *
 * Electron-free (store path injected), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordValidation,
  EnterpriseRecordSummary,
} from '@neuropause/shared';
import {
  HOLIDAY_KIND,
  HOLIDAYS_MODULE_ID,
  parseLeaveDate,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a holiday — drives store, CRUD, and the UI. */
export const HOLIDAY_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: HOLIDAYS_MODULE_ID,
  title: 'Holiday Calendar',
  singular: 'Holiday',
  plural: 'Holidays',
  icon: 'calendar',
  description:
    'Declared company holidays — a holiday inside an unpaid-leave span is never docked as loss-of-pay.',
  group: 'HR',
  titleField: 'name',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'name', label: 'Holiday', type: 'text', required: true, placeholder: 'Republic Day' },
    { key: 'date', label: 'Date', type: 'text', required: true, placeholder: '2026-01-26' },
    { key: 'region', label: 'Region', type: 'text', placeholder: 'optional — e.g. GJ', column: false },
    { key: 'note', label: 'Note', type: 'text', column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Holiday Calendar module. */
export function createHolidayModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, HOLIDAYS_MODULE_ID, HOLIDAY_KIND);
  return defineEnterpriseModule({
    descriptor: HOLIDAY_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(HOLIDAY_DESCRIPTOR, input);
        if (!result.ok) return result;
        const date = str(result.values.date).trim();
        if (parseLeaveDate(date) === null) {
          return {
            ok: false,
            errors: { date: 'Date must be a real calendar day (YYYY-MM-DD).' },
            values: result.values,
          };
        }
        result.values.date = date;
        // The calendar is a SET: one live holiday per date.
        const duplicate = store
          .list()
          .some((r) => r.status !== 'deleted' && str(r.fields.date).trim() === date);
        if (duplicate) {
          return {
            ok: false,
            errors: { date: `${date} is already on the holiday calendar — edit the existing record.` },
            values: result.values,
          };
        }
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: HOLIDAYS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.name)} · ${str(f.date)}`,
          summary:
            `${str(f.name)} on ${str(f.date)}` +
            (str(f.region) ? ` (${str(f.region)})` : '') +
            '. Unpaid leave spanning this date is not docked for it.',
          risk: 'low',
          riskReason: 'Holidays are declarative calendar records.',
          executiveExplanation:
            'The holiday calendar is subtracted from unpaid-leave spans before loss-of-pay is computed — declared holidays never dock pay.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
