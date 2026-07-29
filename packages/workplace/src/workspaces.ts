/**
 * Module 1 — Universal Workspace. Personal / team / department / organization / shared / external
 * workspaces. In-process registry — live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { WorkspaceGovernance } from './governance';
import { WORKSPACE_SCOPES, type WorkspaceScope } from './constants';

export interface Workspace {
  id: string;
  name: string;
  scope: WorkspaceScope;
  ownerId?: string;
  members: string[];
  createdAt: number;
}

export class WorkspaceRuntime {
  private readonly workspaces = new Map<string, Workspace>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: WorkspaceGovernance,
  ) {}

  async create(input: { name: string; scope: WorkspaceScope; ownerId?: string; members?: string[] }): Promise<Workspace> {
    if (!WORKSPACE_SCOPES.includes(input.scope)) throw new Error(`unknown workspace scope: ${input.scope}`);
    const w: Workspace = { id: randomId('ws'), name: input.name, scope: input.scope, ...(input.ownerId ? { ownerId: input.ownerId } : {}), members: input.members ?? [], createdAt: this.clock.now() };
    this.workspaces.set(w.id, w);
    await this.governance.record({ actor: 'system', module: 'workspaces', operation: `create.${input.scope}`, targetId: w.id, evidence: 'live-verified' });
    return w;
  }

  get(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }
  list(): Workspace[] {
    return [...this.workspaces.values()];
  }
  byScope(scope: WorkspaceScope): Workspace[] {
    return this.list().filter((w) => w.scope === scope);
  }
  count(): number {
    return this.workspaces.size;
  }
}
