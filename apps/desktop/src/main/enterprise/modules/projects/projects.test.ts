import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PROJECT_TASKS_MODULE_ID,
  assessProjectHealth,
  deriveProjectProgress,
  projectFromRecord,
  projectRuntimeState,
  type EnterpriseEntity,
  type Project,
  type ProjectTask,
} from '@neuropause/shared';
import type { EnterpriseModule, EnterpriseModuleActionContext } from '../../framework';
import { createCustomerModule } from '../crm/customerModule';
import { createProjectModule } from './projectModule';
import { createProjectTaskModule } from './projectTaskModule';

const T0 = '2026-08-06T00:00:00.000Z';
const NOW = Date.parse('2026-08-06T00:00:00.000Z');

const project = (over: Partial<Project>): Project => ({
  id: 'p1', projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: '', contractRef: '', manager: '',
  billingType: 'fixed', budget: 100000, startDate: '2026-07-01', endDate: '2026-12-31',
  percentComplete: 40, completedAt: null, cancelledAt: null, createdAt: T0, updatedAt: T0, ...over,
});

const task = (over: Partial<ProjectTask>): ProjectTask => ({
  id: 't1', taskNumber: 'TSK-1', projectRef: 'p1', title: 'Design', assignee: '', status: 'todo',
  dueDate: null, estimateHours: 8, actualHours: 0, createdAt: T0, updatedAt: T0, ...over,
});

describe('project domain rules (pure)', () => {
  it('derives runtime state and health from markers, the end date, and progress', () => {
    expect(projectRuntimeState(project({}), NOW)).toBe('active');
    expect(projectRuntimeState(project({ endDate: '2026-08-01' }), NOW)).toBe('overdue');
    expect(projectRuntimeState(project({ completedAt: T0, endDate: '2026-08-01' }), NOW)).toBe('completed');
    expect(assessProjectHealth(project({ endDate: '2026-08-01' }), NOW).reason).toContain('Overdue by 5 days');
    expect(assessProjectHealth(project({ endDate: '2026-08-15', percentComplete: 40 }), NOW).level).toBe('medium');
    expect(assessProjectHealth(project({ endDate: '2026-08-15', percentComplete: 90 }), NOW).level).toBe('low');
  });

  it('derives progress from the task board — done ratio, hours, overdue count', () => {
    const p = deriveProjectProgress(
      [task({}), task({ id: 't2', status: 'in_progress', actualHours: 3.5 }), task({ id: 't3', status: 'done', actualHours: 8 }), task({ id: 't4', dueDate: '2026-08-01' })],
      NOW,
    );
    expect(p).toMatchObject({ total: 4, todo: 2, inProgress: 1, done: 1, pctByTasks: 25, overdueTasks: 1 });
    expect(p.actualHours).toBe(11.5);
    expect(deriveProjectProgress([], NOW).pctByTasks).toBeNull(); // no tasks → null, not fabricated 0
  });
});

describe('Projects + Tasks over real stores — guards, board flow, closure', () => {
  let dir: string;
  let customers: EnterpriseModule;
  let projects: EnterpriseModule;
  let tasks: EnterpriseModule;
  let ctx: EnterpriseModuleActionContext;
  let customerId: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-prj-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    customers = createCustomerModule(join(dir, 'customers.json'));
    projects = createProjectModule(join(dir, 'projects.json'), customers.store);
    tasks = createProjectTaskModule(join(dir, 'tasks.json'), projects.store);
    await Promise.all([customers.store.load(), projects.store.load(), tasks.store.load()]);
    customerId = customers.store.create({ title: 'Acme Inc.', fields: { name: 'Acme Inc.' }, actor: 't@np', now: T0 }).id;
    ctx = {
      actor: () => 't@np',
      now: () => T0,
      authorize: () => undefined,
      moduleFor: (id: string) => (id === PROJECT_TASKS_MODULE_ID ? tasks : null),
      emit: () => undefined,
    };
  });

  afterEach(async () => {
    await Promise.all([customers.store.flush(), projects.store.flush(), tasks.store.flush()]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const newProject = (): EnterpriseEntity => {
    const v = projects.hooks.validate({
      fields: { projectNumber: 'PRJ-1', name: 'Relaunch', customerRef: customerId, billingType: 'fixed', budget: 100000, endDate: '2026-12-31' },
    });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return projects.store.create({ title: 'Relaunch', fields: v.values, actor: 't@np', now: T0 });
  };

  const newTask = (projectRef: string, over: Record<string, unknown> = {}): EnterpriseEntity => {
    const v = tasks.hooks.validate({ fields: { taskNumber: 'TSK-1', projectRef, title: 'Design', status: 'todo', ...over } });
    expect(v.ok, JSON.stringify('errors' in v ? v.errors : {})).toBe(true);
    if (!v.ok) throw new Error('unreachable');
    return tasks.store.create({ title: 'Design', fields: v.values, actor: 't@np', now: T0 });
  };

  it('guards refs both ways and moves tasks across the board freely', () => {
    expect(projects.hooks.validate({ fields: { projectNumber: 'X', name: 'X', customerRef: 'ghost', billingType: 'fixed' } }).ok).toBe(false);
    const prj = newProject();
    expect(tasks.hooks.validate({ fields: { taskNumber: 'T', projectRef: 'ghost', title: 'X', status: 'todo' } }).ok).toBe(false);
    const t = newTask(prj.id);
    // Kanban flow: plain status edits — deliberately NOT marker-locked.
    const move = tasks.hooks.validate({ fields: { ...tasks.store.get(t.id)!.fields, status: 'done', actualHours: 6 } });
    expect(move.ok).toBe(true);
  });

  it('completing a project states the open-task count and freezes; closed projects refuse task writes', async () => {
    const prj = newProject();
    newTask(prj.id);
    newTask(prj.id, { taskNumber: 'TSK-2', status: 'done' });
    const res = await projects.hooks.runAction!('complete', prj, ctx);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (res.ok) expect(String(res.message)).toContain('1 task(s) were still open');
    const closed = projectFromRecord(projects.store.get(prj.id)!);
    expect(closed.completedAt).toBe(T0);
    expect(closed.percentComplete).toBe(100);
    // Immutable project; and the closed project refuses NEW task writes.
    expect(projects.hooks.validate({ fields: { ...projects.store.get(prj.id)!.fields, budget: 1 } }).ok).toBe(false);
    const late = tasks.hooks.validate({ fields: { taskNumber: 'TSK-3', projectRef: prj.id, title: 'Late', status: 'todo' } });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(JSON.stringify(late.errors)).toContain('closed');
    expect((await projects.hooks.runAction!('cancel', projects.store.get(prj.id)!, ctx)).ok).toBe(false);
  });
});
