/**
 * HR → Shifts — working-pattern templates on the Enterprise Module Framework
 * (FW-4, certified module #100). CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * UI are all inherited.
 *
 * One record = one shift template: daily start/end (24h HH:MM, overnight
 * declared by end ≤ start and computed across midnight), weekly off days
 * ("SAT,SUN"), and a late-arrival grace. Assigned to employees via the
 * additive `shiftRef` field; the Attendance statement's Import Leave action
 * uses the pattern to prefill expected present days for the month.
 *
 * Guards: strict times, known weekday tokens, sane grace, and a UNIQUE live
 * shift code. Boundaries stated: one weekly pattern per shift (no rosters/
 * rotations yet); grace is contractual metadata until a punch source exists.
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
  SHIFT_KIND,
  SHIFTS_MODULE_ID,
  parseShiftTime,
  parseWeeklyOffDays,
  shiftMinutes,
  validateEnterpriseRecordInput,
  WEEKDAY_TOKENS,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a shift — drives store, CRUD, and the UI. */
export const SHIFT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SHIFTS_MODULE_ID,
  title: 'Shifts',
  singular: 'Shift',
  plural: 'Shifts',
  icon: 'clock',
  description:
    'Working-pattern templates — start/end, weekly offs, grace. Assigned shifts let attendance prefill expected present days.',
  group: 'HR',
  titleField: 'name',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'GEN' },
    { key: 'name', label: 'Shift', type: 'text', required: true, placeholder: 'General Shift' },
    { key: 'startTime', label: 'Start', type: 'text', required: true, placeholder: '09:30' },
    { key: 'endTime', label: 'End', type: 'text', required: true, placeholder: '18:00' },
    { key: 'weeklyOffDays', label: 'Weekly Offs', type: 'text', default: 'SUN', placeholder: 'SAT,SUN (blank = none)' },
    { key: 'graceMinutes', label: 'Grace (min)', type: 'number', default: 0, column: false },
    { key: 'hoursPerDay', label: 'Hours/Day', type: 'number', readOnly: true, default: 0 },
    { key: 'overnight', label: 'Overnight', type: 'text', readOnly: true, column: false },
    { key: 'note', label: 'Note', type: 'text', column: false },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Shifts module. */
export function createShiftModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SHIFTS_MODULE_ID, SHIFT_KIND);
  return defineEnterpriseModule({
    descriptor: SHIFT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SHIFT_DESCRIPTOR, input);
        if (!result.ok) return result;
        const code = str(result.values.code).trim().toUpperCase();
        if (!/^[A-Z0-9-]{1,12}$/.test(code)) {
          return {
            ok: false,
            errors: { code: 'Code must be 1–12 characters: letters, digits, hyphens.' },
            values: result.values,
          };
        }
        const startTime = str(result.values.startTime).trim();
        const endTime = str(result.values.endTime).trim();
        if (parseShiftTime(startTime) === null || parseShiftTime(endTime) === null) {
          return {
            ok: false,
            errors: { startTime: 'Times must be 24-hour HH:MM (e.g. 09:30, 18:00).' },
            values: result.values,
          };
        }
        const offs = parseWeeklyOffDays(result.values.weeklyOffDays);
        if (offs === null) {
          return {
            ok: false,
            errors: { weeklyOffDays: `Weekly offs must be comma-separated day tokens (${WEEKDAY_TOKENS.join(', ')}) or blank.` },
            values: result.values,
          };
        }
        if (offs.length === 7) {
          return {
            ok: false,
            errors: { weeklyOffDays: 'A shift cannot be off all seven days.' },
            values: result.values,
          };
        }
        const grace = Number(result.values.graceMinutes ?? 0);
        if (!Number.isFinite(grace) || grace < 0 || grace > 240) {
          return {
            ok: false,
            errors: { graceMinutes: 'Grace must be between 0 and 240 minutes.' },
            values: result.values,
          };
        }
        // ONE live shift per code.
        const duplicate = store
          .list()
          .some((r) => r.status !== 'deleted' && str(r.fields.code).trim().toUpperCase() === code);
        if (duplicate) {
          return {
            ok: false,
            errors: { code: `Shift code ${code} already exists — codes are unique.` },
            values: result.values,
          };
        }
        const minutes = shiftMinutes(startTime, endTime)!;
        result.values.code = code;
        result.values.startTime = startTime;
        result.values.endTime = endTime;
        result.values.weeklyOffDays = offs.map((d) => WEEKDAY_TOKENS[d]).join(',');
        result.values.graceMinutes = grace;
        result.values.hoursPerDay = Math.round((minutes / 60) * 100) / 100;
        result.values.overnight = parseShiftTime(endTime)! <= parseShiftTime(startTime)! ? 'yes' : '';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        return {
          moduleId: SHIFTS_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.code)} · ${str(f.startTime)}–${str(f.endTime)}${str(f.overnight) ? ' (overnight)' : ''}`,
          summary:
            `${str(f.name)}: ${str(f.startTime)}–${str(f.endTime)} (${Number(f.hoursPerDay ?? 0)}h/day)` +
            `${str(f.overnight) ? ', crosses midnight' : ''}; weekly offs: ${str(f.weeklyOffDays) || 'none'}; grace ${Number(f.graceMinutes ?? 0)}m.`,
          risk: 'low',
          riskReason: 'Shift templates are declarative working patterns.',
          executiveExplanation:
            'Assigned shifts make expected working days computable per month (offs + holidays excluded), so attendance statements can be prefilled instead of hand-counted.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
