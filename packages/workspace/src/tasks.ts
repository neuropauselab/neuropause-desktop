/**
 * Task Platform (NCEA 10.5, Phase 4). Tasks, subtasks, dependencies, milestones,
 * assignments, priorities, approvals, comments, and attachments — with declarative
 * automation rules that fire on status transitions. Kanban / calendar / timeline
 * are read-only PROJECTIONS over the same task set, not separate stores. Every
 * mutation is governed; assignments and comment mentions carry `notify` so the
 * universal inbox can route them off the shared bus.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'in-review', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type TaskApproval = 'not-required' | 'pending' | 'approved' | 'rejected';

export interface TaskComment {
  id: string;
  authorPrincipalId: string;
  body: string;
  mentions: string[];
  at: number;
}

export interface TaskAttachment {
  id: string;
  name: string;
  ref: string; // knowledge node id, connector ref, or uri — not the bytes
  at: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  dueAt?: number;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  workspaceId: string;
  projectId?: string;
  parentTaskId?: string;
  status: TaskStatus;
  priority: Priority;
  assigneePrincipalId?: string;
  dependsOn: string[];
  milestoneId?: string;
  dueAt?: number;
  approval: TaskApproval;
  comments: TaskComment[];
  attachments: TaskAttachment[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateTaskInput {
  title: string;
  workspaceId: string;
  projectId?: string;
  parentTaskId?: string;
  priority?: Priority;
  assigneePrincipalId?: string;
  dueAt?: number;
  milestoneId?: string;
  actor?: string;
}

export type AutomationAction =
  | { type: 'set-priority'; priority: Priority }
  | { type: 'assign'; principalId: string }
  | { type: 'emit'; eventType: string };

export interface AutomationRule {
  id: string;
  onStatus: TaskStatus;
  action: AutomationAction;
}

export interface TaskFilter {
  workspaceId?: string;
  projectId?: string;
  status?: TaskStatus;
  assigneePrincipalId?: string;
}

export class TaskBoard {
  private readonly tasks = new Map<string, Task>();
  private readonly milestones = new Map<string, Milestone>();
  private readonly rules: AutomationRule[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  // --- creation -------------------------------------------------------------
  async create(input: CreateTaskInput): Promise<Task> {
    if (input.parentTaskId && !this.tasks.has(input.parentTaskId)) {
      throw new Error(`parent task '${input.parentTaskId}' not found`);
    }
    const task: Task = {
      id: randomId('task'),
      title: input.title,
      workspaceId: input.workspaceId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      status: 'todo',
      priority: input.priority ?? 'medium',
      ...(input.assigneePrincipalId ? { assigneePrincipalId: input.assigneePrincipalId } : {}),
      dependsOn: [],
      ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      approval: 'not-required',
      comments: [],
      attachments: [],
      metadata: {},
      createdAt: this.clock.now(),
    };
    this.tasks.set(task.id, task);
    await this.governance.record({
      domain: 'task',
      action: input.parentTaskId ? 'subtask.create' : 'create',
      entity: task.id,
      actor: input.actor ?? 'system',
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      ...(input.assigneePrincipalId ? { notify: [input.assigneePrincipalId] } : {}),
      meta: { title: task.title, projectId: task.projectId },
    });
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(filter: TaskFilter = {}): Task[] {
    return [...this.tasks.values()].filter(
      (t) =>
        (filter.workspaceId === undefined || t.workspaceId === filter.workspaceId) &&
        (filter.projectId === undefined || t.projectId === filter.projectId) &&
        (filter.status === undefined || t.status === filter.status) &&
        (filter.assigneePrincipalId === undefined || t.assigneePrincipalId === filter.assigneePrincipalId),
    );
  }

  subtasks(taskId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.parentTaskId === taskId);
  }

  // --- dependencies ---------------------------------------------------------
  async addDependency(taskId: string, dependsOnId: string, actor = 'system'): Promise<Task> {
    const task = this.require(taskId);
    if (!this.tasks.has(dependsOnId)) throw new Error(`dependency '${dependsOnId}' not found`);
    if (taskId === dependsOnId) throw new Error('a task cannot depend on itself');
    if (this.dependsOnTransitively(dependsOnId, taskId)) throw new Error('dependency would create a cycle');
    if (!task.dependsOn.includes(dependsOnId)) task.dependsOn.push(dependsOnId);
    await this.governance.record({
      domain: 'task',
      action: 'dependency.add',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { dependsOnId },
    });
    return task;
  }

  private dependsOnTransitively(taskId: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [taskId];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const task = this.tasks.get(current);
      if (task) stack.push(...task.dependsOn);
    }
    return false;
  }

  // --- transitions (with dependency gate + automation rules) ----------------
  async transition(taskId: string, status: TaskStatus, actor = 'system'): Promise<Task> {
    const task = this.require(taskId);
    if (status === 'done') {
      const blocking = task.dependsOn.filter((d) => this.tasks.get(d)?.status !== 'done');
      if (blocking.length) throw new Error(`cannot complete: ${blocking.length} dependency(ies) not done`);
      if (task.approval === 'pending') throw new Error('cannot complete: approval is pending');
    }
    const from = task.status;
    task.status = status;
    await this.governance.record({
      domain: 'task',
      action: 'transition',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: task.approval,
      ok: true,
      ...(task.assigneePrincipalId ? { notify: [task.assigneePrincipalId] } : {}),
      meta: { from, to: status },
    });
    await this.applyRules(task, actor);
    return task;
  }

  // --- assignment & priority ------------------------------------------------
  async assign(taskId: string, principalId: string, actor = 'system'): Promise<Task> {
    const task = this.require(taskId);
    task.assigneePrincipalId = principalId;
    await this.governance.record({
      domain: 'task',
      action: 'assign',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      notify: [principalId],
      meta: { assigneePrincipalId: principalId },
    });
    return task;
  }

  async setPriority(taskId: string, priority: Priority, actor = 'system'): Promise<Task> {
    const task = this.require(taskId);
    task.priority = priority;
    await this.governance.record({
      domain: 'task',
      action: 'priority.set',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { priority },
    });
    return task;
  }

  // --- approvals ------------------------------------------------------------
  async requireApproval(taskId: string, approverPrincipalId: string, actor = 'system'): Promise<Task> {
    const task = this.require(taskId);
    task.approval = 'pending';
    await this.governance.record({
      domain: 'task',
      action: 'approval.request',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: 'pending',
      ok: true,
      notify: [approverPrincipalId],
    });
    return task;
  }

  async decideApproval(taskId: string, approve: boolean, decidedBy: string): Promise<Task> {
    const task = this.require(taskId);
    task.approval = approve ? 'approved' : 'rejected';
    await this.governance.record({
      domain: 'task',
      action: 'approval.decide',
      entity: taskId,
      actor: decidedBy,
      workspace: task.workspaceId,
      approval: task.approval,
      ok: true,
      ...(task.assigneePrincipalId ? { notify: [task.assigneePrincipalId] } : {}),
    });
    return task;
  }

  // --- comments & attachments ----------------------------------------------
  async comment(taskId: string, authorPrincipalId: string, body: string, mentions: string[] = []): Promise<TaskComment> {
    const task = this.require(taskId);
    const comment: TaskComment = { id: randomId('cmt'), authorPrincipalId, body, mentions, at: this.clock.now() };
    task.comments.push(comment);
    await this.governance.record({
      domain: 'task',
      action: 'comment',
      entity: taskId,
      actor: authorPrincipalId,
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      ...(mentions.length ? { notify: mentions } : {}),
      meta: { commentId: comment.id, mentions },
    });
    return comment;
  }

  async attach(taskId: string, name: string, ref: string, actor = 'system'): Promise<TaskAttachment> {
    const task = this.require(taskId);
    const attachment: TaskAttachment = { id: randomId('att'), name, ref, at: this.clock.now() };
    task.attachments.push(attachment);
    await this.governance.record({
      domain: 'task',
      action: 'attach',
      entity: taskId,
      actor,
      workspace: task.workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { name, ref },
    });
    return attachment;
  }

  // --- milestones -----------------------------------------------------------
  async createMilestone(projectId: string, name: string, dueAt?: number, actor = 'system'): Promise<Milestone> {
    const milestone: Milestone = {
      id: randomId('mile'),
      projectId,
      name,
      ...(dueAt !== undefined ? { dueAt } : {}),
      createdAt: this.clock.now(),
    };
    this.milestones.set(milestone.id, milestone);
    await this.governance.record({
      domain: 'task',
      action: 'milestone.create',
      entity: milestone.id,
      actor,
      approval: 'not-required',
      ok: true,
      meta: { projectId, name },
    });
    return milestone;
  }

  milestonesOf(projectId: string): Milestone[] {
    return [...this.milestones.values()].filter((m) => m.projectId === projectId);
  }

  // --- automation rules -----------------------------------------------------
  addRule(onStatus: TaskStatus, action: AutomationAction): AutomationRule {
    const rule: AutomationRule = { id: randomId('rule'), onStatus, action };
    this.rules.push(rule);
    return rule;
  }

  private async applyRules(task: Task, actor: string): Promise<void> {
    for (const rule of this.rules.filter((r) => r.onStatus === task.status)) {
      if (rule.action.type === 'set-priority') task.priority = rule.action.priority;
      else if (rule.action.type === 'assign') task.assigneePrincipalId = rule.action.principalId;
      await this.governance.record({
        domain: 'task',
        action: `automation.${rule.action.type}`,
        entity: task.id,
        actor,
        workspace: task.workspaceId,
        approval: 'not-required',
        ok: true,
        meta: { ruleId: rule.id, onStatus: rule.onStatus },
      });
    }
  }

  // --- views (projections) --------------------------------------------------
  kanban(workspaceId: string): Record<TaskStatus, Task[]> {
    const board = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>;
    for (const task of this.list({ workspaceId })) board[task.status].push(task);
    return board;
  }

  timeline(workspaceId: string): Task[] {
    return this.list({ workspaceId }).sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  }

  calendar(workspaceId: string): Array<{ dueAt: number; tasks: Task[] }> {
    const byDay = new Map<number, Task[]>();
    for (const task of this.list({ workspaceId })) {
      if (task.dueAt === undefined) continue;
      const day = Math.floor(task.dueAt / 86_400_000) * 86_400_000;
      (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(task);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([dueAt, tasks]) => ({ dueAt, tasks }));
  }

  private require(id: string): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`task '${id}' not found`);
    return task;
  }
}
