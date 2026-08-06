/**
 * HR → Employees — work-scoped people records on the Enterprise Module
 * Framework (W4.3), opening the HR family. CRUD, RBAC (`operations:read` /
 * `operations:manage` — the Finance/Projects reuse precedent), audit,
 * timeline, search, offline persistence, and the UI are all inherited.
 *
 * DELIBERATELY WORK-SCOPED: name, role, department, manager, work contact,
 * join date, salary. Nothing more — a privacy decision, not an omission.
 * The org structure is the self-referential `managerRef` chain, CYCLE-GUARDED
 * at validate (an employee can never appear in their own chain). `Exit` is
 * the W1 marker pattern — exited employees are immutable history and leave
 * payroll and the org chart automatically.
 *
 * W6-A1 (ADDITIVE): `salaryStructureRef` + `basicSalary` assign a contractual
 * salary-structure template scaled from this employee's own basic. The
 * reference is guarded against the injected structure store (must exist, must
 * not be archived); `monthlySalary` keeps its W4 meaning — the flat gross the
 * lite payroll run pays — until statutory processing supersedes it.
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
  EMPLOYEES_MODULE_ID,
  EMPLOYEE_KIND,
  IFSC_PATTERN,
  employeeFromRecord,
  managerChainCycle,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action key the Employees module surfaces. */
export const EXIT_EMPLOYEE_ACTION = 'exit';

/** The declarative description of an employee — drives store, CRUD, and the UI. */
export const EMPLOYEE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: EMPLOYEES_MODULE_ID,
  title: 'Employees',
  singular: 'Employee',
  plural: 'Employees',
  icon: 'users',
  description:
    'Work-scoped employee records — role, department, cycle-guarded manager chain, salary for payroll; exits are markers.',
  group: 'HR',
  titleField: 'name',
  // Reuses the certified operations scopes (the Finance/Projects precedent).
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [{ key: EXIT_EMPLOYEE_ACTION, label: 'Exit', icon: 'close' }],
  fields: [
    { key: 'employeeNumber', label: 'Employee #', type: 'text', required: true, placeholder: 'EMP-0001' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Kinjal Mali' },
    { key: 'role', label: 'Role', type: 'text', placeholder: 'Instructor' },
    { key: 'department', label: 'Department', type: 'text', filterable: true },
    { key: 'managerRef', label: 'Manager', type: 'text', column: false, placeholder: 'Employee id (optional)' },
    { key: 'workEmail', label: 'Work Email', type: 'text', column: false },
    { key: 'joinDate', label: 'Joined', type: 'date', format: 'date', column: false },
    { key: 'monthlySalary', label: 'Monthly Salary', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'salaryStructureRef', label: 'Salary Structure', type: 'text', column: false, placeholder: 'Salary structure id (optional)' },
    { key: 'basicSalary', label: 'Basic (Monthly)', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'workState', label: 'Work State', type: 'text', column: false, placeholder: 'GJ (drives professional tax)' },
    { key: 'bankAccountNumber', label: 'Bank Account', type: 'text', column: false, placeholder: 'Salary credit account' },
    { key: 'bankIfsc', label: 'IFSC', type: 'text', column: false, placeholder: 'HDFC0001234' },
    { key: 'bankName', label: 'Bank', type: 'text', column: false, placeholder: 'Optional bank/branch label' },
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
        { value: 'exited', label: 'Exited', tone: 'neutral' },
      ],
    },
    { key: 'exitedAt', label: 'Exited At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Employees module — the org chain guards against its own store;
 * the OPTIONAL salary-structure store guards template assignment (W6-A1,
 * additive: omitting it leaves every W4 behavior untouched).
 */
export function createEmployeeModule(
  storePath: string,
  salaryStructureStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, EMPLOYEES_MODULE_ID, EMPLOYEE_KIND);
  return defineEnterpriseModule({
    descriptor: EMPLOYEE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(EMPLOYEE_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.exitedAt)) {
          return {
            ok: false,
            errors: { status: 'This employee has exited — exited records are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const managerRef = str(result.values.managerRef);
        if (managerRef) {
          const manager = store.get(managerRef);
          if (!manager || manager.status === 'deleted') {
            errors.managerRef = `No employee with id "${managerRef}" was found to manage this one.`;
          } else {
            // Cycle guard: the (possibly not-yet-created) employee must never
            // appear in its own manager chain. On create the id is unknown —
            // a self-cycle is then impossible by construction.
            const employeeId = str(input.fields?.employeeNumber); // stable per-person key is the id on update
            const byId = new Map(store.list().map((r) => [r.id, employeeFromRecord(r)]));
            const selfId = store.list().find((r) => str(r.fields.employeeNumber) === employeeId)?.id ?? '';
            if (selfId) {
              const cycle = managerChainCycle(selfId, managerRef, byId);
              if (cycle) {
                errors.managerRef = `That manager assignment creates a cycle in the org chain (${cycle.length} hop(s)).`;
              }
            }
          }
        }
        const structureRef = str(result.values.salaryStructureRef);
        if (structureRef && salaryStructureStore) {
          const structure = salaryStructureStore.get(structureRef);
          if (!structure || structure.status === 'deleted') {
            errors.salaryStructureRef = `No salary structure with id "${structureRef}" was found.`;
          } else if (str(structure.fields.archivedAt)) {
            errors.salaryStructureRef = 'That salary structure is archived — assign an active template.';
          }
        }
        if (structureRef) {
          const basic = typeof result.values.basicSalary === 'number' ? result.values.basicSalary : 0;
          if (basic <= 0) {
            errors.basicSalary = 'A structure-assigned employee needs a positive basic salary — the template scales from it.';
          }
        }
        // IFSC is well-defined (11 chars) — validate it loudly when present; a
        // bad IFSC would silently strand the employee as "unbanked" at payout.
        const ifsc = str(result.values.bankIfsc).trim().toUpperCase();
        if (ifsc && !IFSC_PATTERN.test(ifsc)) {
          errors.bankIfsc = 'IFSC must be 11 characters: 4 bank letters, a 0, then 6 alphanumeric (e.g. HDFC0001234).';
        }
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const e = employeeFromRecord(record);
        return {
          moduleId: EMPLOYEES_MODULE_ID,
          recordId: record.id,
          headline: `${e.name} · ${e.role || '—'} · ${e.exitedAt ? 'exited' : 'active'}`,
          summary:
            `${e.name}${e.role ? `, ${e.role}` : ''}${e.department ? ` (${e.department})` : ''}` +
            (e.joinDate ? `, joined ${e.joinDate}` : '') +
            (e.exitedAt ? ' — exited.' : ' — active.'),
          risk: 'low',
          riskReason: 'Work-scoped record; payroll reads the salary, the org chart reads the chain.',
          executiveExplanation:
            'Employees carry only what payroll and the org chart need — a privacy decision, not an omission.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const e = employeeFromRecord(record);
        if (action !== EXIT_EMPLOYEE_ACTION) return { ok: false, error: `Unknown action "${action}".` };
        if (e.exitedAt) return { ok: false, error: 'This employee has already exited.' };
        const reports = store
          .list()
          .map(employeeFromRecord)
          .filter((r) => r.managerRef === record.id && !r.exitedAt).length;
        store.update(record.id, {
          fields: { exitedAt: actionCtx.now(), status: 'exited' },
          actor: actionCtx.actor(),
          now: actionCtx.now(),
        });
        const reportsNote = reports > 0 ? ` ${reports} direct report(s) now need a new manager.` : '';
        return { ok: true, message: `${e.name} exited — removed from payroll and the org chart.${reportsNote}` };
      },
    },
  });
}
