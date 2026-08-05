/**
 * Project registry (NCEA 10.5, Phases 1 & 4). Projects are first-class platform
 * entities: they belong to a workspace (and through it an organization), carry a
 * lifecycle status, and are what tasks and milestones attach to. Health is a
 * derived read (see dashboard.ts) computed from the project's tasks — the project
 * stores status, not a hand-maintained health flag. Every change is governed.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export const PROJECT_STATUSES = ['planned', 'active', 'blocked', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  id: string;
  name: string;
  workspaceId: string;
  orgId: string;
  status: ProjectStatus;
  leadPrincipalId?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateProjectInput {
  name: string;
  workspaceId: string;
  orgId: string;
  leadPrincipalId?: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
  actor?: string;
}

export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const project: Project = {
      id: randomId('proj'),
      name: input.name,
      workspaceId: input.workspaceId,
      orgId: input.orgId,
      status: input.status ?? 'planned',
      ...(input.leadPrincipalId ? { leadPrincipalId: input.leadPrincipalId } : {}),
      metadata: input.metadata ?? {},
      createdAt: this.clock.now(),
    };
    this.projects.set(project.id, project);
    await this.governance.record({
      domain: 'project',
      action: 'create',
      entity: project.id,
      actor: input.actor ?? 'system',
      org: project.orgId,
      workspace: project.workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { name: project.name },
    });
    return project;
  }

  get(id: string): Project | undefined {
    return this.projects.get(id);
  }

  has(id: string): boolean {
    return this.projects.has(id);
  }

  list(workspaceId?: string): Project[] {
    const all = [...this.projects.values()];
    return workspaceId ? all.filter((p) => p.workspaceId === workspaceId) : all;
  }

  async setStatus(projectId: string, status: ProjectStatus, actor = 'system'): Promise<Project> {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`project '${projectId}' not found`);
    const from = project.status;
    project.status = status;
    await this.governance.record({
      domain: 'project',
      action: 'status.change',
      entity: projectId,
      actor,
      org: project.orgId,
      workspace: project.workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { from, to: status },
    });
    return project;
  }
}
