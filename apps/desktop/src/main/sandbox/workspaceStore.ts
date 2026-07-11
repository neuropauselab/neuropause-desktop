/**
 * AI Sandbox — Workspace store (S1). The top-level container every scenario,
 * execution, artifact, and dataset belongs to. Owns settings (concurrency, timeout,
 * retention) the execution engine reads. Electron-free; the singleton is wired in
 * `index.ts`.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE_SETTINGS, type SandboxWorkspace, type SandboxWorkspaceSettings } from '@neuropause/shared';
import { PersistentStore } from './persistentStore';

interface WorkspaceFile {
  workspaces: SandboxWorkspace[];
}

export interface WorkspaceCreateInput {
  name: string;
  description?: string;
  settings?: Partial<SandboxWorkspaceSettings>;
}

export class SandboxWorkspaceStore extends PersistentStore<WorkspaceFile> {
  private workspaces = new Map<string, SandboxWorkspace>();

  constructor(filePath: string, private readonly now: () => number = Date.now) {
    super(filePath);
  }

  protected snapshot(): WorkspaceFile {
    return { workspaces: [...this.workspaces.values()] };
  }
  protected hydrate(data: Partial<WorkspaceFile>): void {
    for (const w of data.workspaces ?? []) if (w?.id) this.workspaces.set(w.id, w);
  }

  create(input: WorkspaceCreateInput): SandboxWorkspace {
    const iso = new Date(this.now()).toISOString();
    const ws: SandboxWorkspace = {
      id: `sbw_${randomUUID()}`,
      name: input.name,
      description: input.description ?? '',
      settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...(input.settings ?? {}) },
      createdAt: iso,
      updatedAt: iso,
    };
    this.workspaces.set(ws.id, ws);
    this.changed();
    return ws;
  }

  /** Return the first workspace, creating a Default one when the store is empty. */
  ensureDefault(): SandboxWorkspace {
    const first = [...this.workspaces.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    if (first) return first;
    return this.create({ name: 'Default', description: 'Default sandbox workspace.' });
  }

  get(id: string): SandboxWorkspace | null {
    return this.workspaces.get(id) ?? null;
  }
  list(): SandboxWorkspace[] {
    return [...this.workspaces.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  has(id: string): boolean {
    return this.workspaces.has(id);
  }
  count(): number {
    return this.workspaces.size;
  }

  update(id: string, patch: { name?: string; description?: string; settings?: Partial<SandboxWorkspaceSettings> }): SandboxWorkspace | null {
    const ws = this.workspaces.get(id);
    if (!ws) return null;
    const next: SandboxWorkspace = {
      ...ws,
      name: patch.name ?? ws.name,
      description: patch.description ?? ws.description,
      settings: { ...ws.settings, ...(patch.settings ?? {}) },
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.workspaces.set(id, next);
    this.changed();
    return next;
  }

  delete(id: string): boolean {
    const ok = this.workspaces.delete(id);
    if (ok) this.changed();
    return ok;
  }
}
