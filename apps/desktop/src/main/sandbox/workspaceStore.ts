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

  /** Create a sandbox workspace OWNED BY the caller's organization. */
  create(input: WorkspaceCreateInput): SandboxWorkspace {
    const iso = new Date(this.now()).toISOString();
    const ws: SandboxWorkspace = {
      id: `sbw_${randomUUID()}`,
      // P13C N3 — stamped from the resolved tenant, never from a payload.
      // Throws when no tenant resolves, so an unowned workspace cannot exist.
      tenantId: this.requireTenant(),
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

  /**
   * This tenant's default workspace, creating one when they have none.
   *
   * P13C N3 — this returned THE FIRST WORKSPACE ON THE INSTALL, sorted by
   * creation date. That is the `organizations[0]` fallback in another costume:
   * every tenant's default sandbox was whichever tenant created one first, so
   * every subsequent scenario, execution and artifact was written into that
   * tenant's workspace. "First" is now "first of MINE", and a tenant with none
   * gets their own rather than adopting a stranger's.
   */
  ensureDefault(): SandboxWorkspace {
    const first = this.list()[0];
    if (first) return first;
    return this.create({ name: 'Default', description: 'Default sandbox workspace.' });
  }

  /** The workspace, IF it is the caller's. A foreign id reads as absent. */
  get(id: string): SandboxWorkspace | null {
    const ws = this.workspaces.get(id) ?? null;
    return ws !== null && this.mine(ws) ? ws : null;
  }
  /** Only this tenant's workspaces. Was every workspace on the install. */
  list(): SandboxWorkspace[] {
    return this.onlyMine([...this.workspaces.values()]).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1,
    );
  }
  has(id: string): boolean {
    return this.get(id) !== null;
  }
  /** Scoped: an install-wide count tells one tenant how busy another is. */
  count(): number {
    return this.list().length;
  }

  /** Unscoped ownership counts, for the migration inventory only. */
  ownershipCounts(): { total: number; assigned: number; unresolved: number } {
    return this.countOwnership([...this.workspaces.values()]);
  }

  /**
   * The raw row regardless of scope — for the ENGINE only.
   *
   * The execution engine drains every tenant's queue and must be able to read
   * the settings (concurrency) of a workspace it is not currently "in". It then
   * runs each execution under that execution's OWN principal, so this accessor
   * hands out no data to a caller: it is used to decide scheduling, never to
   * answer a request. Kept deliberately ugly to name so it cannot be mistaken
   * for `get`.
   */
  unscopedForEngine(id: string): SandboxWorkspace | null {
    return this.workspaces.get(id) ?? null;
  }

  update(id: string, patch: { name?: string; description?: string; settings?: Partial<SandboxWorkspaceSettings> }): SandboxWorkspace | null {
    // Scoped lookup: a foreign id is "not found", not "found and updated".
    const ws = this.get(id);
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
    if (this.get(id) === null) return false; // not the caller's ⇒ nothing to delete
    const ok = this.workspaces.delete(id);
    if (ok) this.changed();
    return ok;
  }
}
