/**
 * HR → Salary Structures — contractual pay templates on the Enterprise
 * Module Framework (W6-A1, Production Readiness / Workstream A). CRUD, RBAC
 * (`operations:read` / `operations:manage` — the HR family's certified
 * scopes), audit, timeline, search, offline persistence, and the UI are all
 * inherited.
 *
 * A structure is a TEMPLATE: BASIC is implicit (scaled from each employee's
 * own basic), components are JSON-per-line (the RFQ precedent) with
 * line-numbered validation. The summary previews the breakup at the
 * structure's reference basic and derives the statutory wage bases (PF /
 * ESI / taxable) from component flags — the effective-dated statutory
 * engine consumes those bases; rates are NEVER hardcoded here. `Archive` is
 * the W1 marker pattern: archived templates are immutable history and can no
 * longer be assigned to employees.
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
  SALARY_STRUCTURES_MODULE_ID,
  SALARY_STRUCTURE_KIND,
  computeSalaryBreakup,
  parseSalaryComponents,
  salaryStructureFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Salary Structures module surfaces. */
export const ARCHIVE_STRUCTURE_ACTION = 'archive';

/** The declarative description of a salary structure — drives store, CRUD, and the UI. */
export const SALARY_STRUCTURE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: SALARY_STRUCTURES_MODULE_ID,
  title: 'Salary Structures',
  singular: 'Salary Structure',
  plural: 'Salary Structures',
  icon: 'layers',
  description:
    'Contractual pay templates — implicit basic, JSON-per-line components, derived statutory wage bases; archives are immutable.',
  group: 'HR',
  titleField: 'structureName',
  // Reuses the certified operations scopes (the HR family precedent).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: ARCHIVE_STRUCTURE_ACTION, label: 'Archive', icon: 'close' }],
  fields: [
    { key: 'structureCode', label: 'Code', type: 'text', required: true, placeholder: 'STD-2026' },
    { key: 'structureName', label: 'Structure', type: 'text', required: true, placeholder: 'Standard 2026' },
    { key: 'referenceBasic', label: 'Reference Basic', type: 'number', min: 0, format: 'currency' },
    {
      key: 'componentsJson',
      label: 'Components',
      type: 'textarea',
      column: false,
      placeholder: '{"code":"HRA","name":"House Rent Allowance","kind":"earning","calc":"percentOfBasic","value":40}',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'green' },
        { value: 'archived', label: 'Archived', tone: 'neutral' },
      ],
    },
    { key: 'archivedAt', label: 'Archived At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function money(value: number): string {
  // Locale pinned — deterministic across machines (the W1 Finance convention).
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Build the Salary Structures module — templates behind the payroll engine. */
export function createSalaryStructureModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, SALARY_STRUCTURES_MODULE_ID, SALARY_STRUCTURE_KIND);
  return defineEnterpriseModule({
    descriptor: SALARY_STRUCTURE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(SALARY_STRUCTURE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.archivedAt)) {
          return {
            ok: false,
            errors: { status: 'This structure is archived — archived templates are immutable history.' },
            values: result.values,
          };
        }
        const parsed = parseSalaryComponents(result.values.componentsJson);
        if (parsed.errors.length > 0) {
          return {
            ok: false,
            errors: { componentsJson: parsed.errors.join(' ') },
            values: result.values,
          };
        }
        result.values.status = 'active';
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const structure = salaryStructureFromRecord(record);
        const reference = structure.referenceBasic;
        const breakup = computeSalaryBreakup(structure.components, reference);
        const unconfigured = structure.components.length === 0 && reference <= 0;
        const preview =
          reference > 0
            ? `At reference basic ${money(reference)}: gross ${money(breakup.grossEarnings)}, contractual deductions ${money(breakup.totalDeductions)}, net-before-statutory ${money(breakup.netPay)}. ` +
              `Wage bases — PF ${money(breakup.pfWageBase)}, ESI ${money(breakup.esiWageBase)}, taxable ${money(breakup.taxableBase)}.`
            : 'Set a reference basic to preview the breakup — the template scales from each employee’s own basic.';
        return {
          moduleId: SALARY_STRUCTURES_MODULE_ID,
          recordId: record.id,
          headline:
            `${structure.structureCode} · ${structure.components.length} component(s) · ` +
            (structure.archivedAt ? 'archived' : 'active'),
          summary:
            `${structure.structureName} — implicit BASIC plus ${structure.components.length} component(s). ${preview}` +
            (structure.parseErrors.length > 0 ? ` ${structure.parseErrors.length} stored line(s) failed to parse — repair the component list.` : ''),
          risk: unconfigured && !structure.archivedAt ? 'medium' : 'low',
          riskReason:
            unconfigured && !structure.archivedAt
              ? 'A template with no components and no reference basic pays exactly basic — configure it before assignment.'
              : 'Breakups and wage bases are derived from the template, never typed in.',
          executiveExplanation:
            'Salary structures are contractual templates; statutory deductions come from the effective-dated rule engine reading these derived wage bases — rates are never hardcoded.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const structure = salaryStructureFromRecord(record);
        if (action !== ARCHIVE_STRUCTURE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (structure.archivedAt) return { ok: false, error: 'This structure is already archived.' };
        store.update(record.id, {
          fields: { archivedAt: actionCtx.now(), status: 'archived' },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        return {
          ok: true,
          message: 'Archived — immutable history; employees can no longer be assigned this template.',
        };
      },
    },
  });
}
