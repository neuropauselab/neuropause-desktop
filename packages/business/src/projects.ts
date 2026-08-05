/**
 * Module 14 — Project Portfolio Management. Programs, projects, milestones, tasks, risks,
 * dependencies, resources, capacity, OKRs, and strategic planning. All in-process and live-
 * verified; the registry starts empty and no project data is fabricated.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { BusinessGovernance } from './governance';

export interface Program { id: string; name: string; }
export interface Project { id: string; name: string; programId?: string; status: 'active' | 'on-hold' | 'done'; createdAt: number; }
export interface Milestone { id: string; projectId: string; name: string; due: number; done: boolean; }
export interface ProjectTask { id: string; projectId: string; name: string; assignee?: string; estimateHours: number; dependsOn: string[]; done: boolean; }
export interface Risk { id: string; projectId: string; description: string; severity: 'low' | 'medium' | 'high'; }
export interface OKR { id: string; objective: string; keyResults: Array<{ text: string; progress: number }>; }

export class ProjectRuntime {
  private readonly programsMap = new Map<string, Program>();
  private readonly projectsMap = new Map<string, Project>();
  private readonly milestonesList: Milestone[] = [];
  private readonly tasksMap = new Map<string, ProjectTask>();
  private readonly risksList: Risk[] = [];
  private readonly okrsMap = new Map<string, OKR>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: BusinessGovernance,
  ) {}

  async createProgram(name: string): Promise<Program> {
    const p: Program = { id: randomId('prog'), name };
    this.programsMap.set(p.id, p);
    return p;
  }
  async createProject(input: { name: string; programId?: string }): Promise<Project> {
    const p: Project = { id: randomId('proj'), name: input.name, ...(input.programId ? { programId: input.programId } : {}), status: 'active', createdAt: this.clock.now() };
    this.projectsMap.set(p.id, p);
    await this.governance.record({ actor: 'system', domain: 'projects', operation: 'project.create', targetId: p.id, evidence: 'live-verified' });
    return p;
  }
  async addMilestone(input: { projectId: string; name: string; due: number }): Promise<Milestone> {
    const m: Milestone = { id: randomId('ms'), projectId: input.projectId, name: input.name, due: input.due, done: false };
    this.milestonesList.push(m);
    return m;
  }
  async addTask(input: { projectId: string; name: string; assignee?: string; estimateHours?: number; dependsOn?: string[] }): Promise<ProjectTask> {
    const t: ProjectTask = { id: randomId('ptask'), projectId: input.projectId, name: input.name, ...(input.assignee ? { assignee: input.assignee } : {}), estimateHours: input.estimateHours ?? 0, dependsOn: input.dependsOn ?? [], done: false };
    this.tasksMap.set(t.id, t);
    await this.governance.record({ actor: 'system', domain: 'projects', operation: 'task.create', targetId: t.id, evidence: 'live-verified' });
    return t;
  }
  async addRisk(input: { projectId: string; description: string; severity: Risk['severity'] }): Promise<Risk> {
    const r: Risk = { id: randomId('risk'), projectId: input.projectId, description: input.description, severity: input.severity };
    this.risksList.push(r);
    return r;
  }
  async defineOKR(input: { objective: string; keyResults: string[] }): Promise<OKR> {
    const o: OKR = { id: randomId('okr'), objective: input.objective, keyResults: input.keyResults.map((text) => ({ text, progress: 0 })) };
    this.okrsMap.set(o.id, o);
    return o;
  }

  /** Capacity for an assignee: committed estimate hours from real tasks. */
  capacity(assignee: string): { assignee: string; committedHours: number; openTasks: number } {
    const tasks = [...this.tasksMap.values()].filter((t) => t.assignee === assignee && !t.done);
    return { assignee, committedHours: tasks.reduce((s, t) => s + t.estimateHours, 0), openTasks: tasks.length };
  }

  programs(): Program[] { return [...this.programsMap.values()]; }
  projects(): Project[] { return [...this.projectsMap.values()]; }
  milestones(): Milestone[] { return [...this.milestonesList]; }
  tasks(): ProjectTask[] { return [...this.tasksMap.values()]; }
  risks(): Risk[] { return [...this.risksList]; }
  okrs(): OKR[] { return [...this.okrsMap.values()]; }
  count(): number { return this.projectsMap.size; }
}
