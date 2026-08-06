/**
 * Projects → Projects + Tasks — project-management domain types + pure
 * deterministic logic (W4.1). A NEW certification family; RBAC deliberately
 * reuses `operations:read` / `operations:manage` (the Finance precedent) so
 * no scope registry changes ship with it.
 *
 * A Project is the billing- and delivery-scoped container: linked to a
 * customer (and optionally a W2.3 contract), budgeted, dated, and closed
 * through the W1 marker pattern (`completedAt` / `cancelledAt` — closed
 * projects are immutable history). Being LATE is TIME-DERIVED at read
 * (overdue when active past the end date), never stored.
 *
 * Tasks are the working surface — DELIBERATELY not marker-locked: a task
 * board changes all day, and `todo → in_progress → done` is a plain status
 * the team drags across kanban columns. The discipline lives at the edges:
 * tasks must belong to an OPEN project, and progress numbers are derived from
 * the task set, never typed in.
 *
 * Pure (no I/O), so it is shared by the backend hooks and the tests.
 */
import type { EnterpriseEntity, EnterpriseRiskLevel } from './enterpriseModule';

/** The Projects module id + record kind (the framework store key). */
export const PROJECTS_MODULE_ID = 'projects-projects';
export const PROJECT_KIND = 'project';

/** The Project Tasks module id + record kind (the framework store key). */
export const PROJECT_TASKS_MODULE_ID = 'projects-tasks';
export const PROJECT_TASK_KIND = 'projectTask';

export type ProjectBillingType = 'fixed' | 'time_material';
export type ProjectRuntimeState = 'active' | 'overdue' | 'completed' | 'cancelled';
export type ProjectTaskStatus = 'todo' | 'in_progress' | 'done';
export const PROJECT_TASK_STATUSES: readonly ProjectTaskStatus[] = ['todo', 'in_progress', 'done'];

/** A typed view over a project record's flat fields (+ envelope timestamps). */
export interface Project {
  id: string;
  projectNumber: string;
  name: string;
  customerRef: string;
  contractRef: string;
  manager: string;
  billingType: ProjectBillingType;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A typed view over a project-task record's flat fields. */
export interface ProjectTask {
  id: string;
  taskNumber: string;
  projectRef: string;
  title: string;
  assignee: string;
  status: ProjectTaskStatus;
  dueDate: string | null;
  estimateHours: number;
  actualHours: number;
  createdAt: string;
  updatedAt: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v)) || 0;
}
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Project a framework record into a typed project. */
export function projectFromRecord(record: EnterpriseEntity): Project {
  const f = record.fields;
  return {
    id: record.id,
    projectNumber: str(f.projectNumber) || record.title,
    name: str(f.name),
    customerRef: str(f.customerRef),
    contractRef: str(f.contractRef),
    manager: str(f.manager),
    billingType: str(f.billingType) === 'time_material' ? 'time_material' : 'fixed',
    budget: num(f.budget),
    startDate: str(f.startDate) || null,
    endDate: str(f.endDate) || null,
    percentComplete: clamp(num(f.percentComplete), 0, 100),
    completedAt: str(f.completedAt) || null,
    cancelledAt: str(f.cancelledAt) || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Project a framework record into a typed task. */
export function projectTaskFromRecord(record: EnterpriseEntity): ProjectTask {
  const f = record.fields;
  const status = str(f.status);
  return {
    id: record.id,
    taskNumber: str(f.taskNumber) || record.title,
    projectRef: str(f.projectRef),
    title: str(f.title),
    assignee: str(f.assignee),
    status: (PROJECT_TASK_STATUSES as readonly string[]).includes(status)
      ? (status as ProjectTaskStatus)
      : 'todo',
    dueDate: str(f.dueDate) || null,
    estimateHours: num(f.estimateHours),
    actualHours: num(f.actualHours),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The time-derived runtime state — markers first, then the end-date clock. */
export function projectRuntimeState(project: Project, nowMs: number): ProjectRuntimeState {
  if (project.cancelledAt) return 'cancelled';
  if (project.completedAt) return 'completed';
  const endMs = project.endDate ? Date.parse(project.endDate) : NaN;
  if (Number.isFinite(endMs) && endMs < nowMs) return 'overdue';
  return 'active';
}

export interface ProjectHealth {
  level: EnterpriseRiskLevel;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic delivery health from the runtime state + progress. */
export function assessProjectHealth(project: Project, nowMs: number): ProjectHealth {
  const state = projectRuntimeState(project, nowMs);
  if (state === 'completed') return { level: 'low', reason: 'Completed.' };
  if (state === 'cancelled') return { level: 'low', reason: 'Cancelled.' };
  const endMs = project.endDate ? Date.parse(project.endDate) : NaN;
  if (state === 'overdue') {
    const daysOver = Number.isFinite(endMs) ? Math.max(1, Math.round((nowMs - endMs) / DAY_MS)) : 0;
    return { level: 'high', reason: `Overdue by ${daysOver} day${daysOver === 1 ? '' : 's'} at ${project.percentComplete}% complete.` };
  }
  if (Number.isFinite(endMs) && endMs - nowMs <= 14 * DAY_MS && project.percentComplete < 80) {
    return { level: 'medium', reason: `Ends within 14 days at ${project.percentComplete}% complete — at risk of slipping.` };
  }
  return { level: 'low', reason: 'On track.' };
}

export interface ProjectProgress {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  /** done ÷ total × 100; null when the project has no tasks yet. */
  pctByTasks: number | null;
  estimateHours: number;
  actualHours: number;
  overdueTasks: number;
}

/** Roll a project's task set into derived progress. Pure — never typed in. */
export function deriveProjectProgress(tasks: ProjectTask[], nowMs: number): ProjectProgress {
  let todo = 0;
  let inProgress = 0;
  let done = 0;
  let estimateHours = 0;
  let actualHours = 0;
  let overdueTasks = 0;
  for (const task of tasks) {
    if (task.status === 'done') done += 1;
    else if (task.status === 'in_progress') inProgress += 1;
    else todo += 1;
    estimateHours += task.estimateHours;
    actualHours += task.actualHours;
    const dueMs = task.dueDate ? Date.parse(task.dueDate) : NaN;
    if (task.status !== 'done' && Number.isFinite(dueMs) && dueMs < nowMs) overdueTasks += 1;
  }
  const total = tasks.length;
  return {
    total,
    todo,
    inProgress,
    done,
    pctByTasks: total === 0 ? null : Math.round((done / total) * 100),
    estimateHours: Math.round(estimateHours * 10) / 10,
    actualHours: Math.round(actualHours * 10) / 10,
    overdueTasks,
  };
}
