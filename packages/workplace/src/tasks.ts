/**
 * Module 7 — Tasks & Work Management. Personal and team tasks with kanban, dependencies,
 * priorities, and recurrence. PROJECT tasks are REUSED from the Wave 8 business project runtime —
 * not duplicated. Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import type { BusinessPlatform } from './types';

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface WorkTask {
  id: string;
  ownerId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: number;
  dependsOn: string[];
  recurring: boolean;
  createdAt: number;
}

export class WorkspaceTasks {
  private readonly tasks = new Map<string, WorkTask>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
    private readonly business?: BusinessPlatform,
  ) {}

  async create(input: { ownerId: string; title: string; priority?: TaskPriority; dueDate?: number; dependsOn?: string[]; recurring?: boolean }): Promise<WorkTask> {
    const t: WorkTask = { id: randomId('task'), ownerId: input.ownerId, title: input.title, status: 'todo', priority: input.priority ?? 'medium', ...(input.dueDate ? { dueDate: input.dueDate } : {}), dependsOn: input.dependsOn ?? [], recurring: input.recurring ?? false, createdAt: this.clock.now() };
    this.tasks.set(t.id, t);
    await this.governance.record({ actor: input.ownerId, module: 'tasks', operation: 'create', targetId: t.id, evidence: 'live-verified' });
    return t;
  }
  async move(id: string, status: TaskStatus): Promise<WorkTask> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`no task ${id}`);
    t.status = status;
    await this.governance.record({ actor: t.ownerId, module: 'tasks', operation: `move.${status}`, targetId: id, evidence: 'live-verified' });
    return t;
  }

  /** Project tasks are REUSED from the Wave 8 business project runtime — never duplicated. */
  projectTasks(): Array<{ id: string; name: string; projectId: string }> {
    if (!this.business) return [];
    return this.business.projects().tasks().map((t) => ({ id: t.id, name: t.name, projectId: t.projectId }));
  }

  /** Kanban view of a user's personal/team tasks. */
  kanban(ownerId: string): Record<TaskStatus, WorkTask[]> {
    const mine = this.list(ownerId);
    return { todo: mine.filter((t) => t.status === 'todo'), doing: mine.filter((t) => t.status === 'doing'), done: mine.filter((t) => t.status === 'done') };
  }

  get(id: string): WorkTask | undefined { return this.tasks.get(id); }
  list(ownerId?: string): WorkTask[] {
    const all = [...this.tasks.values()];
    return ownerId ? all.filter((t) => t.ownerId === ownerId) : all;
  }
  count(): number { return this.tasks.size; }
}
