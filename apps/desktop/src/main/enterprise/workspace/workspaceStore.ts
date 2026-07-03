/**
 * The Workspace manager — multi-tenant support for the Enterprise OS. A
 * workspace is an isolated operating context bound to one organization; several
 * coexist with their data kept separate, and exactly one is active at a time.
 *
 * On first run it creates a default workspace bound to the seeded organization.
 * Electron-free (file path injected); the singleton lives in workspaceInstance.ts.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@neuropause/shared';
import { createLogger } from '../../logger';
import { ORG_ID } from '../org/seed';

const log = createLogger('workspace');

export const DEFAULT_WORKSPACE_ID = 'workspace-default';

interface WorkspaceFile {
  workspaces: Workspace[];
  activeId: string;
  seeded: boolean;
}

export class WorkspaceStore extends EventEmitter {
  private workspaces = new Map<string, Workspace>();
  private activeId = DEFAULT_WORKSPACE_ID;
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;

  constructor(private readonly filePath: string) {
    super();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<WorkspaceFile>;
      for (const w of data.workspaces ?? []) if (w?.id) this.workspaces.set(w.id, w);
      if (data.activeId && this.workspaces.has(data.activeId)) this.activeId = data.activeId;
      if (!data.seeded || this.workspaces.size === 0) this.applySeed();
    } catch {
      this.applySeed();
    }
    if (!this.workspaces.has(this.activeId)) {
      this.activeId = this.workspaces.keys().next().value as string;
    }
    this.loaded = true;
    log.info('Workspace manager ready', { workspaces: this.workspaces.size, active: this.activeId });
  }

  private applySeed(): void {
    const now = new Date().toISOString();
    const ws: Workspace = {
      id: DEFAULT_WORKSPACE_ID,
      name: 'Default Workspace',
      organizationId: ORG_ID,
      isolation: 'isolated',
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(ws.id, ws);
    this.activeId = ws.id;
    this.schedulePersist();
  }

  private async persist(): Promise<void> {
    const file: WorkspaceFile = { workspaces: [...this.workspaces.values()], activeId: this.activeId, seeded: true };
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drainPersist();
  }

  private async drainPersist(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.persist();
      }
    } catch (err) {
      log.error('Workspace persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  list(): Workspace[] {
    return [...this.workspaces.values()];
  }

  get(id: string): Workspace | null {
    return this.workspaces.get(id) ?? null;
  }

  active(): Workspace {
    return this.workspaces.get(this.activeId) ?? (this.workspaces.values().next().value as Workspace);
  }

  activeWorkspaceId(): string {
    return this.activeId;
  }

  create(name: string, organizationId: string): Workspace {
    const now = new Date().toISOString();
    const ws: Workspace = {
      id: `workspace_${randomUUID()}`,
      name,
      organizationId,
      isolation: 'isolated',
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(ws.id, ws);
    this.schedulePersist();
    this.emit('changed');
    return ws;
  }

  switch(id: string): Workspace | null {
    const ws = this.workspaces.get(id);
    if (!ws) return null;
    this.activeId = id;
    this.schedulePersist();
    this.emit('changed');
    return ws;
  }

  rename(id: string, name: string): Workspace | null {
    const ws = this.workspaces.get(id);
    if (!ws) return null;
    const next: Workspace = { ...ws, name, updatedAt: new Date().toISOString() };
    this.workspaces.set(id, next);
    this.schedulePersist();
    this.emit('changed');
    return next;
  }
}
