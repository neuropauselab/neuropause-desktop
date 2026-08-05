/**
 * Workspace registry (NCEA 10.5, Phase 1). A Workspace is the governed container
 * a team actually works in — it is created from a WorkspaceTemplate that seeds
 * settings and policies, and it carries metadata and a policy set that later
 * domains (tasks, workforce, collaboration) consult. Every workspace change is
 * governed. Policies are declarative allow/deny facts; the permission MODEL lives
 * in identity.ts (one model), and workspace policies are scoping on top of it.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';

export interface WorkspacePolicy {
  name: string;
  allow: boolean;
  detail?: string;
}

export type WorkspaceSettings = Record<string, unknown>;

export interface WorkspaceTemplate {
  id: string;
  name: string;
  defaultSettings: WorkspaceSettings;
  defaultPolicies: WorkspacePolicy[];
  metadata?: Record<string, unknown>;
}

export interface Workspace {
  id: string;
  name: string;
  ownerOrgId: string;
  templateId?: string;
  settings: WorkspaceSettings;
  policies: WorkspacePolicy[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface CreateWorkspaceInput {
  name: string;
  ownerOrgId: string;
  templateId?: string;
  settings?: WorkspaceSettings;
  metadata?: Record<string, unknown>;
  actor?: string;
}

export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly templates = new Map<string, WorkspaceTemplate>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  registerTemplate(template: WorkspaceTemplate): WorkspaceTemplate {
    if (this.templates.has(template.id)) throw new Error(`template '${template.id}' already registered`);
    this.templates.set(template.id, template);
    return template;
  }

  template(id: string): WorkspaceTemplate | undefined {
    return this.templates.get(id);
  }

  templateList(): WorkspaceTemplate[] {
    return [...this.templates.values()];
  }

  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    let seedSettings: WorkspaceSettings = {};
    let seedPolicies: WorkspacePolicy[] = [];
    let seedMetadata: Record<string, unknown> = {};
    if (input.templateId) {
      const template = this.templates.get(input.templateId);
      if (!template) throw new Error(`template '${input.templateId}' not found`);
      seedSettings = { ...template.defaultSettings };
      seedPolicies = template.defaultPolicies.map((p) => ({ ...p }));
      seedMetadata = { ...(template.metadata ?? {}) };
    }
    const workspace: Workspace = {
      id: randomId('ws'),
      name: input.name,
      ownerOrgId: input.ownerOrgId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      settings: { ...seedSettings, ...(input.settings ?? {}) },
      policies: seedPolicies,
      metadata: { ...seedMetadata, ...(input.metadata ?? {}) },
      createdAt: this.clock.now(),
    };
    this.workspaces.set(workspace.id, workspace);
    await this.governance.record({
      domain: 'workspace',
      action: 'create',
      entity: workspace.id,
      actor: input.actor ?? 'system',
      org: input.ownerOrgId,
      workspace: workspace.id,
      approval: 'not-required',
      ok: true,
      meta: { name: workspace.name, templateId: workspace.templateId },
    });
    return workspace;
  }

  get(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  has(id: string): boolean {
    return this.workspaces.has(id);
  }

  list(ownerOrgId?: string): Workspace[] {
    const all = [...this.workspaces.values()];
    return ownerOrgId ? all.filter((w) => w.ownerOrgId === ownerOrgId) : all;
  }

  async setPolicy(workspaceId: string, policy: WorkspacePolicy, actor = 'system'): Promise<Workspace> {
    const workspace = this.require(workspaceId);
    const existing = workspace.policies.findIndex((p) => p.name === policy.name);
    if (existing >= 0) workspace.policies[existing] = policy;
    else workspace.policies.push(policy);
    await this.governance.record({
      domain: 'workspace',
      action: 'policy.set',
      entity: workspaceId,
      actor,
      org: workspace.ownerOrgId,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { policy: policy.name, allow: policy.allow },
    });
    return workspace;
  }

  policy(workspaceId: string, name: string): WorkspacePolicy | undefined {
    return this.get(workspaceId)?.policies.find((p) => p.name === name);
  }

  /** Policy gate: an unset policy defaults to allowed (deny only when explicitly denied). */
  allows(workspaceId: string, name: string): boolean {
    const policy = this.policy(workspaceId, name);
    return policy ? policy.allow : true;
  }

  async setSetting(workspaceId: string, key: string, value: unknown, actor = 'system'): Promise<Workspace> {
    const workspace = this.require(workspaceId);
    workspace.settings[key] = value;
    await this.governance.record({
      domain: 'workspace',
      action: 'setting.set',
      entity: workspaceId,
      actor,
      org: workspace.ownerOrgId,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { key },
    });
    return workspace;
  }

  async updateMetadata(workspaceId: string, patch: Record<string, unknown>, actor = 'system'): Promise<Workspace> {
    const workspace = this.require(workspaceId);
    workspace.metadata = { ...workspace.metadata, ...patch };
    await this.governance.record({
      domain: 'workspace',
      action: 'metadata.update',
      entity: workspaceId,
      actor,
      org: workspace.ownerOrgId,
      workspace: workspaceId,
      approval: 'not-required',
      ok: true,
      meta: { keys: Object.keys(patch) },
    });
    return workspace;
  }

  private require(id: string): Workspace {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error(`workspace '${id}' not found`);
    return workspace;
  }
}
