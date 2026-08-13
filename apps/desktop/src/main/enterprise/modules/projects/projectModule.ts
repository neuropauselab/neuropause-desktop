/**
 * Projects → Projects — the delivery container on the Enterprise Module
 * Framework (W4.1), opening the Projects family. RBAC deliberately reuses
 * `operations:read` / `operations:manage` (the Finance precedent) — no scope
 * registry changes. CRUD, RBAC, audit, timeline, search, offline persistence,
 * and the entire list/detail/form UI are all inherited.
 *
 * DETERMINISTIC discipline:
 *   • `customerRef` and `contractRef` (optional) must resolve against the
 *     injected Customers / Contracts stores — no phantom links.
 *   • Closure is the W1 marker pattern (`Complete` / `Cancel`); closed
 *     projects are immutable history. Being LATE is time-derived at read.
 *   • Task awareness in ACTIONS resolves through the runtime action context
 *     (the W1 cross-module pattern): completing or cancelling a project with
 *     open tasks is allowed, with the derived count stated on the result —
 *     progress comes from the board, never typed in.
 *
 * Kanban and Gantt visual renderers are RENDERER work outside the module
 * framework — deliberately not faked here; the records carry everything those
 * views need (status columns, dates, estimates).
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
  PROJECTS_MODULE_ID,
  PROJECT_KIND,
  PROJECT_TASKS_MODULE_ID,
  assessProjectHealth,
  deriveProjectProgress,
  projectFromRecord,
  projectRuntimeState,
  projectTaskFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The descriptor action keys the Projects module surfaces. */
export const COMPLETE_PROJECT_ACTION = 'complete';
export const CANCEL_PROJECT_ACTION = 'cancel';

/** The declarative description of a project — drives store, CRUD, and the UI. */
export const PROJECT_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PROJECTS_MODULE_ID,
  title: 'Projects',
  singular: 'Project',
  plural: 'Projects',
  icon: 'briefcase',
  description:
    'Delivery containers linked to customers and contracts — budgeted, dated, task-driven progress, marker-closed.',
  group: 'Projects',
  titleField: 'name',
  // Reuses the certified operations scopes (the Finance precedent) — no new RBAC surface.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  actions: [
    { key: COMPLETE_PROJECT_ACTION, label: 'Complete', icon: 'check' },
    { key: CANCEL_PROJECT_ACTION, label: 'Cancel', icon: 'close' },
  ],
  fields: [
    { key: 'projectNumber', label: 'Project #', type: 'text', required: true, placeholder: 'PRJ-0001' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Website relaunch' },
    { key: 'customerRef', label: 'Customer', type: 'text', placeholder: 'Customer id (optional)' },
    { key: 'contractRef', label: 'Contract', type: 'text', column: false, placeholder: 'Contract id (optional)' },
    { key: 'manager', label: 'Manager', type: 'text' },
    {
      key: 'billingType',
      label: 'Billing',
      type: 'select',
      required: true,
      default: 'fixed',
      badge: true,
      filterable: true,
      options: [
        { value: 'fixed', label: 'Fixed Price', tone: 'blue' },
        { value: 'time_material', label: 'Time & Material', tone: 'teal' },
      ],
    },
    { key: 'budget', label: 'Budget', type: 'number', min: 0, format: 'currency' },
    { key: 'startDate', label: 'Starts', type: 'date', format: 'date', column: false },
    { key: 'endDate', label: 'Ends', type: 'date', format: 'date' },
    { key: 'percentComplete', label: 'Complete %', type: 'number', min: 0, max: 100, default: 0 },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      readOnly: true,
      default: 'active',
      badge: true,
      filterable: true,
      options: [
        { value: 'active', label: 'Active', tone: 'blue' },
        { value: 'completed', label: 'Completed', tone: 'green' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
      ],
    },
    { key: 'completedAt', label: 'Completed At', type: 'text', readOnly: true, column: false },
    { key: 'cancelledAt', label: 'Cancelled At', type: 'text', readOnly: true, column: false },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Projects module. Customers + Contracts stores back the ref
 * guards; task awareness in ACTIONS resolves through the runtime action
 * context (the W1 cross-module pattern) — no construction-time cycle.
 */
export function createProjectModule(
  storePath: string,
  customerStore?: EnterpriseRecordStore,
  contractStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PROJECTS_MODULE_ID, PROJECT_KIND);

  const resolves = (refStore: EnterpriseRecordStore | undefined, ref: string): boolean => {
    if (!refStore) return true;
    const record = refStore.get(ref);
    return Boolean(record && record.status !== 'deleted');
  };

  return defineEnterpriseModule({
    descriptor: PROJECT_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PROJECT_DESCRIPTOR, input);
        if (!result.ok) return result;
        if (str(input.fields?.completedAt) || str(input.fields?.cancelledAt)) {
          return {
            ok: false,
            errors: { status: 'This project is closed — completed/cancelled projects are immutable history.' },
            values: result.values,
          };
        }
        const errors: Record<string, string> = {};
        const customerRef = str(result.values.customerRef);
        if (customerRef && !resolves(customerStore, customerRef)) {
          errors.customerRef = `No customer with id "${customerRef}" was found.`;
        }
        const contractRef = str(result.values.contractRef);
        if (contractRef && !resolves(contractStore, contractRef)) {
          errors.contractRef = `No contract with id "${contractRef}" was found.`;
        }
        result.values.status = 'active';
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const project = projectFromRecord(record);
        const nowMs = Date.now();
        const state = projectRuntimeState(project, nowMs);
        const health = assessProjectHealth(project, nowMs);
        const taskLine = 'Progress detail lives on the task board (derived, never typed in).';
        return {
          moduleId: PROJECTS_MODULE_ID,
          recordId: record.id,
          headline: `${project.projectNumber} · ${state} · ${project.percentComplete}% · ends ${project.endDate ?? '—'}`,
          summary: `${project.name} (${project.billingType === 'fixed' ? 'fixed price' : 'time & material'}) — ${health.reason} ${taskLine}`,
          risk: health.level,
          riskReason: health.reason,
          executiveExplanation:
            'Projects tie delivery to the customer and contract; progress is derived from the task board next to the manager’s own estimate — both visible, neither overriding the other.',
          grounded: false,
          model: 'none',
        };
      },
      runAction: async (action, record, actionCtx) => {
        const project = projectFromRecord(record);
        if (project.completedAt || project.cancelledAt) {
          return { ok: false, error: 'This project is already closed — closed projects are immutable.' };
        }
        const taskModule = actionCtx.moduleFor(PROJECT_TASKS_MODULE_ID);
        if (taskModule) await taskModule.store.load();
        const progress = deriveProjectProgress(
          taskModule
            ? taskModule.store.list().map(projectTaskFromRecord).filter((t) => t.projectRef === record.id)
            : [],
          Date.parse(actionCtx.now()),
        );
        const openTasks = progress.total - progress.done;
        if (action === COMPLETE_PROJECT_ACTION) {
          store.update(record.id, {
            fields: { completedAt: actionCtx.now(), status: 'completed', percentComplete: 100 },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const openNote = openTasks > 0 ? ` ${openTasks} task(s) were still open — review them.` : '';
          return { ok: true, message: `Project completed.${openNote}` };
        }
        if (action === CANCEL_PROJECT_ACTION) {
          store.update(record.id, {
            fields: { cancelledAt: actionCtx.now(), status: 'cancelled' },
            actor: actionCtx.actor(),
            now: actionCtx.now(),
          });
          const openNote = openTasks > 0 ? ` ${openTasks} open task(s) are orphaned by the cancellation.` : '';
          return { ok: true, message: `Project cancelled.${openNote}` };
        }
        return { ok: false, error: `Unknown action "${action}".` };
      },
    },
  });
}
