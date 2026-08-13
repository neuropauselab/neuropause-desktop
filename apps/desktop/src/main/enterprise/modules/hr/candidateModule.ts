/**
 * HR → Candidates — the recruitment pipeline on the Enterprise Module
 * Framework (FW-10). CRUD, RBAC (`operations:read` / `operations:manage`),
 * audit, timeline, search, offline persistence, and the UI are all inherited.
 *
 * One record = one person's application for one position. The stage is
 * ACTION-DRIVEN, never typed: Advance moves one step along the fixed happy
 * path (applied → screening → interview → offer), Reject ends any live
 * application, and Hire — legal only from `offer` — is the integration seam:
 * it creates a REAL Employee record through the Employees module's own
 * validate hook (name/role/department/email carried over, joinDate = today,
 * the next free EMP-<n> number derived from the numbers that exist), then
 * cross-links the two records. Hired and rejected applications are decided
 * history — immutable.
 *
 * Guards: one LIVE application per email + position (re-applying after a
 * rejection is fine); decided records refuse edits; stage is always derived.
 *
 * Electron-free (store path injected; the Employees module resolves from the
 * action context at runtime), so it unit-tests without the app runtime.
 */
import type {
  EnterpriseModuleDescriptor,
  EnterpriseRecordInput,
  EnterpriseRecordSummary,
  EnterpriseRecordValidation,
} from '@neuropause/shared';
import {
  CANDIDATES_MODULE_ID,
  CANDIDATE_KIND,
  EMPLOYEES_MODULE_ID,
  deriveRecordTitle,
  isLiveRecruitmentStage,
  nextEmployeeNumber,
  nextRecruitmentStage,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** Move one step along the happy path. */
export const ADVANCE_CANDIDATE_ACTION = 'advance';
/** End a live application — final. */
export const REJECT_CANDIDATE_ACTION = 'reject';
/** offer → hired: creates the Employee record and cross-links it. */
export const HIRE_CANDIDATE_ACTION = 'hire';

/** The declarative description of a candidate — drives store, CRUD, and the UI. */
export const CANDIDATE_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: CANDIDATES_MODULE_ID,
  title: 'Candidates',
  singular: 'Candidate',
  plural: 'Candidates',
  icon: 'users',
  description:
    'Recruitment pipeline — applications advance applied → screening → interview → offer; hiring creates the employee record.',
  group: 'HR',
  titleField: 'candidateName',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: ADVANCE_CANDIDATE_ACTION, label: 'Advance', icon: 'arrow-right' },
    { key: HIRE_CANDIDATE_ACTION, label: 'Hire', icon: 'check' },
    { key: REJECT_CANDIDATE_ACTION, label: 'Reject', icon: 'close' },
  ],
  fields: [
    { key: 'candidateName', label: 'Candidate', type: 'text', required: true, placeholder: 'Meera Iyer' },
    { key: 'email', label: 'Email', type: 'text', placeholder: 'meera@example.com' },
    { key: 'position', label: 'Position', type: 'text', required: true, placeholder: 'Backend Engineer' },
    { key: 'department', label: 'Department', type: 'text', filterable: true },
    {
      key: 'source',
      label: 'Source',
      type: 'select',
      default: 'direct',
      column: false,
      filterable: true,
      options: [
        { value: 'direct', label: 'Direct' },
        { value: 'referral', label: 'Referral' },
        { value: 'portal', label: 'Job Portal' },
        { value: 'agency', label: 'Agency' },
      ],
    },
    { key: 'appliedDate', label: 'Applied', type: 'date', format: 'date' },
    {
      key: 'stage',
      label: 'Stage',
      type: 'select',
      readOnly: true,
      default: 'applied',
      badge: true,
      filterable: true,
      options: [
        { value: 'applied', label: 'Applied', tone: 'neutral' },
        { value: 'screening', label: 'Screening', tone: 'blue' },
        { value: 'interview', label: 'Interview', tone: 'teal' },
        { value: 'offer', label: 'Offer', tone: 'orange' },
        { value: 'hired', label: 'Hired', tone: 'green' },
        { value: 'rejected', label: 'Rejected', tone: 'pink' },
      ],
    },
    { key: 'expectedSalary', label: 'Expected Salary', type: 'number', min: 0, format: 'currency', column: false },
    { key: 'hiredEmployee', label: 'Employee Record', type: 'text', readOnly: true, column: false },
    { key: 'decidedAt', label: 'Decided At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Interview feedback, CV highlights…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Build the Candidates module. (Injected path, so tests run Electron-free.) */
export function createCandidateModule(storePath: string): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, CANDIDATES_MODULE_ID, CANDIDATE_KIND);
  return defineEnterpriseModule({
    descriptor: CANDIDATE_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(CANDIDATE_DESCRIPTOR, input);
        if (!result.ok) return result;
        // Decided applications are recruitment history — immutable.
        if (str(input.fields?.decidedAt)) {
          return {
            ok: false,
            errors: { stage: 'This application is decided (hired/rejected) — decided applications are immutable history.' },
            values: result.values,
          };
        }
        const email = str(result.values.email).trim().toLowerCase();
        const position = str(result.values.position).trim().toLowerCase();
        // One LIVE application per email + position — re-applying after a
        // rejection is legitimate; racing a live application is not.
        if (email) {
          const duplicate = store
            .list()
            .some(
              (r) =>
                r.status !== 'deleted' &&
                isLiveRecruitmentStage(str(r.fields.stage)) &&
                str(r.fields.email).trim().toLowerCase() === email &&
                str(r.fields.position).trim().toLowerCase() === position,
            );
          if (duplicate) {
            return {
              ok: false,
              errors: { email: 'A live application for this email and position already exists — advance or decide it first.' },
              values: result.values,
            };
          }
        }
        result.values.stage = 'applied'; // derived, never user-forged
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const f = record.fields;
        const stage = str(f.stage);
        return {
          moduleId: CANDIDATES_MODULE_ID,
          recordId: record.id,
          headline: `${str(f.candidateName)} · ${str(f.position)} · ${stage}`,
          summary:
            `${str(f.candidateName)} for ${str(f.position)}${str(f.department) ? ` (${str(f.department)})` : ''} — ` +
            (stage === 'hired'
              ? 'hired; the employee record is linked.'
              : stage === 'rejected'
                ? 'rejected; this application is closed.'
                : `in ${stage}; next step is ${nextRecruitmentStage(stage) ?? 'a hire/reject decision'}.`),
          risk: stage === 'offer' ? 'medium' : 'low',
          riskReason:
            stage === 'offer'
              ? 'An open offer is a commitment awaiting a decision — hire or close it.'
              : 'Pipeline stage and decision state agree.',
          executiveExplanation:
            'The stage is action-driven, never typed; hiring creates the employee through the Employees module’s own guards, so recruitment can never mint an employee the register would refuse.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const f = record.fields;
        const stage = str(f.stage);

        if (action === ADVANCE_CANDIDATE_ACTION) {
          const next = nextRecruitmentStage(stage);
          if (!next) {
            return {
              ok: false,
              error:
                stage === 'offer'
                  ? 'An offer advances only through Hire (or ends with Reject).'
                  : `A ${stage} application cannot advance.`,
            };
          }
          store.update(record.id, { fields: { stage: next }, actor: actionCtx.actor(), now: actionCtx.now() });
          return { ok: true, message: `${str(f.candidateName)} moved to ${next}.` };
        }

        if (action === REJECT_CANDIDATE_ACTION) {
          if (!isLiveRecruitmentStage(stage)) {
            return { ok: false, error: `This application is already ${stage}.` };
          }
          store.update(record.id, {
            fields: { stage: 'rejected', decidedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return { ok: true, message: `${str(f.candidateName)} rejected for ${str(f.position)} — this is final.` };
        }

        if (action === HIRE_CANDIDATE_ACTION) {
          if (stage !== 'offer') {
            return { ok: false, error: `Hire is legal only from an offer — this application is in ${stage}.` };
          }
          const employees = actionCtx.moduleFor(EMPLOYEES_MODULE_ID);
          if (!employees) {
            return { ok: false, error: 'The Employees module is not available — hiring needs the employee register.' };
          }
          await employees.store.load();
          const employeeNumber = nextEmployeeNumber(
            employees.store
              .list()
              .filter((r) => r.status !== 'deleted')
              .map((r) => str(r.fields.employeeNumber)),
          );
          // Through the Employees module's OWN validate — recruitment can never
          // mint an employee the register would refuse.
          const validation = employees.hooks.validate({
            fields: {
              employeeNumber,
              name: str(f.candidateName),
              role: str(f.position),
              department: str(f.department),
              workEmail: str(f.email),
              joinDate: actionCtx.now().slice(0, 10),
            },
          });
          if (!validation.ok) {
            return { ok: false, error: `Employee record: ${Object.values(validation.errors)[0] ?? 'invalid input'}` };
          }
          const employee = employees.store.create({
            title: deriveRecordTitle(employees.descriptor, validation.values),
            fields: validation.values,
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          actionCtx.emit(employees, 'created', employee);
          store.update(record.id, {
            fields: { stage: 'hired', hiredEmployee: employee.id, decidedAt: actionCtx.now() },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          return {
            ok: true,
            message: `${str(f.candidateName)} hired as ${str(f.position)} — employee ${employeeNumber} created and linked.`,
          };
        }

        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
