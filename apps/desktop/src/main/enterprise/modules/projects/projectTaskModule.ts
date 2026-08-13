/**
 * Projects → Tasks — the working surface of a project on the Enterprise
 * Module Framework (W4.1). CRUD, RBAC (`operations:read` /
 * `operations:manage`), audit, timeline, search, offline persistence, and the
 * entire list/detail/form UI are all inherited.
 *
 * DELIBERATE DESIGN: tasks are NOT marker-locked. A task board changes all
 * day — `todo → in_progress → done` is a plain, user-driven status (the
 * kanban columns), and hours are edited as work happens. The discipline lives
 * at the edges instead: every task must belong to an OPEN project (closed
 * projects accept no task writes), hours are non-negative, and project
 * progress is DERIVED from the task set — never typed in.
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
  PROJECT_TASKS_MODULE_ID,
  PROJECT_TASK_KIND,
  projectTaskFromRecord,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import {
  EnterpriseRecordStore,
  defineEnterpriseModule,
  type EnterpriseModule,
} from '../../framework';

/** The declarative description of a project task — drives store, CRUD, and the UI. */
export const PROJECT_TASK_DESCRIPTOR: EnterpriseModuleDescriptor = {
  id: PROJECT_TASKS_MODULE_ID,
  title: 'Project Tasks',
  singular: 'Task',
  plural: 'Project Tasks',
  icon: 'check-square',
  description:
    'The task board behind every project — kanban statuses, estimates vs logged hours, due dates; open projects only.',
  group: 'Projects',
  titleField: 'title',
  // Reuses the certified operations scopes (the Finance precedent) — no new RBAC surface.
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'taskNumber', label: 'Task #', type: 'text', required: true, placeholder: 'TSK-0001' },
    { key: 'projectRef', label: 'Project', type: 'text', required: true, placeholder: 'Project id' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Design the landing page' },
    { key: 'assignee', label: 'Assignee', type: 'text' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'todo',
      badge: true,
      filterable: true,
      options: [
        { value: 'todo', label: 'To Do', tone: 'neutral' },
        { value: 'in_progress', label: 'In Progress', tone: 'blue' },
        { value: 'done', label: 'Done', tone: 'green' },
      ],
    },
    { key: 'dueDate', label: 'Due', type: 'date', format: 'date' },
    { key: 'estimateHours', label: 'Estimate (h)', type: 'number', min: 0, column: false },
    { key: 'actualHours', label: 'Logged (h)', type: 'number', min: 0 },
    { key: 'notes', label: 'Notes', type: 'textarea', column: false, placeholder: 'Optional notes…' },
  ],
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Build the Project Tasks module. The Projects store is injected so every
 * task must belong to an OPEN project.
 */
export function createProjectTaskModule(
  storePath: string,
  projectStore?: EnterpriseRecordStore,
): EnterpriseModule {
  const store = new EnterpriseRecordStore(storePath, PROJECT_TASKS_MODULE_ID, PROJECT_TASK_KIND);
  return defineEnterpriseModule({
    descriptor: PROJECT_TASK_DESCRIPTOR,
    store,
    hooks: {
      validate: (input: EnterpriseRecordInput): EnterpriseRecordValidation => {
        const result = validateEnterpriseRecordInput(PROJECT_TASK_DESCRIPTOR, input);
        if (!result.ok) return result;
        const errors: Record<string, string> = {};
        const projectRef = str(result.values.projectRef);
        if (projectRef && projectStore) {
          const project = projectStore.get(projectRef);
          if (!project || project.status === 'deleted') {
            errors.projectRef = `No project with id "${projectRef}" was found.`;
          } else if (str(project.fields.completedAt) || str(project.fields.cancelledAt)) {
            errors.projectRef = 'That project is closed — closed projects accept no task writes.';
          }
        }
        if (Object.keys(errors).length > 0) return { ok: false, errors, values: result.values };
        return result;
      },
      summarize: async (record): Promise<EnterpriseRecordSummary> => {
        const task = projectTaskFromRecord(record);
        const dueMs = task.dueDate ? Date.parse(task.dueDate) : NaN;
        const overdue = task.status !== 'done' && Number.isFinite(dueMs) && dueMs < Date.now();
        return {
          moduleId: PROJECT_TASKS_MODULE_ID,
          recordId: record.id,
          headline: `${task.taskNumber} · ${task.status} · ${task.title}`,
          summary:
            `${task.title}${task.assignee ? ` (${task.assignee})` : ''} — ${task.status}` +
            (task.dueDate ? `, due ${task.dueDate}` : '') +
            `; ${task.actualHours}h logged of ${task.estimateHours}h estimated.`,
          risk: overdue ? 'high' : 'low',
          riskReason: overdue ? 'Past due and not done.' : 'On the board.',
          executiveExplanation:
            'Tasks are the kanban surface; project progress is derived from this board, never typed in.',
          grounded: false,
          model: 'none',
        };
      },
    },
  });
}
