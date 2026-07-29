/**
 * Module 7 — Task Orchestration. Create / assign / depend / prioritize / deadline /
 * complete / escalate, with completion tracking and dependency gating (a task can't
 * complete until its dependencies are done). In-process and audited; can reference NEMS
 * tasks by id. This is the orchestration layer, not a second task store for NEMS.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { AutomationGovernance } from './governance';

export type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface OrchestratedTask {
  id: string;
  tenantId: string;
  title: string;
  assignee?: string;
  priority: TaskPriority;
  deadline?: number;
  status: TaskStatus;
  dependsOn: string[];
  nemsTaskId?: string;
  createdAt: number;
  completedAt?: number;
}

export class TaskOrchestration {
  private readonly tasks = new Map<string, OrchestratedTask>();

  constructor(
    private readonly clock: Clock,
    private readonly governance?: AutomationGovernance,
  ) {}

  create(input: { tenantId: string; title: string; assignee?: string; priority?: TaskPriority; deadline?: number; dependsOn?: string[]; nemsTaskId?: string }): OrchestratedTask {
    const t: OrchestratedTask = {
      id: randomId('otask'),
      tenantId: input.tenantId,
      title: input.title,
      ...(input.assignee ? { assignee: input.assignee } : {}),
      priority: input.priority ?? 'normal',
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      status: 'open',
      dependsOn: input.dependsOn ?? [],
      ...(input.nemsTaskId ? { nemsTaskId: input.nemsTaskId } : {}),
      createdAt: this.clock.now(),
    };
    this.tasks.set(t.id, t);
    return t;
  }

  private mut(id: string): OrchestratedTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`unknown task '${id}'`);
    return t;
  }

  assign(id: string, assignee: string): OrchestratedTask {
    const t = this.mut(id);
    t.assignee = assignee;
    return t;
  }
  setPriority(id: string, priority: TaskPriority): OrchestratedTask {
    const t = this.mut(id);
    t.priority = priority;
    return t;
  }
  setDeadline(id: string, deadline: number): OrchestratedTask {
    const t = this.mut(id);
    t.deadline = deadline;
    return t;
  }
  addDependency(id: string, dependsOn: string): OrchestratedTask {
    const t = this.mut(id);
    if (!t.dependsOn.includes(dependsOn)) t.dependsOn.push(dependsOn);
    return t;
  }
  start(id: string): OrchestratedTask {
    const t = this.mut(id);
    t.status = 'in-progress';
    return t;
  }

  complete(id: string): OrchestratedTask {
    const t = this.mut(id);
    const blockers = t.dependsOn.filter((d) => this.tasks.get(d)?.status !== 'done');
    if (blockers.length) throw new Error(`task '${id}' blocked by incomplete dependencies: ${blockers.join(', ')}`);
    t.status = 'done';
    t.completedAt = this.clock.now();
    void this.governance?.recordNotification(t.tenantId, 'in-app', 'task-completed');
    return t;
  }

  /** Escalate an overdue/at-risk task — bumps priority and records it. */
  escalate(id: string): OrchestratedTask {
    const t = this.mut(id);
    t.priority = 'urgent';
    void this.governance?.recordNotification(t.tenantId, 'in-app', 'task-escalated');
    return t;
  }

  /** Tasks whose dependencies are all done and are not yet complete. */
  ready(tenantId: string): OrchestratedTask[] {
    return this.list(tenantId).filter((t) => t.status !== 'done' && t.dependsOn.every((d) => this.tasks.get(d)?.status === 'done'));
  }

  get(id: string): OrchestratedTask | undefined {
    return this.tasks.get(id);
  }
  list(tenantId: string): OrchestratedTask[] {
    return [...this.tasks.values()].filter((t) => t.tenantId === tenantId);
  }
  tracking(tenantId: string): { total: number; open: number; inProgress: number; done: number; overdue: number } {
    const ts = this.list(tenantId);
    const now = this.clock.now();
    return {
      total: ts.length,
      open: ts.filter((t) => t.status === 'open').length,
      inProgress: ts.filter((t) => t.status === 'in-progress').length,
      done: ts.filter((t) => t.status === 'done').length,
      overdue: ts.filter((t) => t.deadline !== undefined && t.deadline < now && t.status !== 'done').length,
    };
  }
}
