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
import { declareStoreScope } from '../../tenancy/storeScope';

/** P13C ROUND 8 — the structural scope declaration. See tenancy/storeScope.ts. */
declareStoreScope({
  name: 'workspace-directory',
  scope: 'TENANT',
  persistence: 'file',
  authority: 'ORG_ROLE',
  classification: 'CUSTOMER_DERIVED',
  retention: 'No delete path at all.',
  reason: "Workspace.organizationId — a workspace belongs to exactly one organization. list() and get() are install-wide and the org filter lives one layer up in tenantDirectory; recorded here because any NEW in-process caller of list() reads other organizations' workspace names.",
});

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
    /**
     * P13C N9 (second half) — THE SAME FALLBACK, AT LOAD TIME.
     *
     * This repaired an unresolvable active pointer with
     * `this.workspaces.keys().next().value` — the first workspace in insertion
     * order, across every organization. Fixing only the read accessor would
     * have left the guess here, one moment earlier and harder to see: the
     * pointer would already be pointing at a stranger by the time anything
     * read it.
     *
     * The seeded default is preferred when it exists, because that is this
     * install's own first workspace rather than a borrowed one. Otherwise the
     * pointer is left UNRESOLVABLE, so `active()` and `activeWorkspaceIdOrNull`
     * both report nothing and the user is asked to choose — an empty switcher
     * someone reports, rather than a silent landing inside another tenant.
     */
    if (!this.workspaces.has(this.activeId)) {
      if (this.workspaces.has(DEFAULT_WORKSPACE_ID)) this.activeId = DEFAULT_WORKSPACE_ID;
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

  /**
   * The active workspace, or NULL.
   *
   * P13C N9 — this used to end in `?? this.workspaces.values().next().value`:
   * the FIRST workspace on the install, across every organization. So when
   * `activeId` missed — a stale id, a deleted workspace, a cold start — it
   * handed back a foreign tenant's workspace, `name` and `organizationId` and
   * all. `EnterpriseWorkspaceActive` returns this value verbatim and declares
   * no permission, so that was a reachable read.
   *
   * Null is the fail-closed answer and matches `activeWorkspaceIdOrNull` a few
   * lines below, which this file already documents as the correct pattern —
   * "do not trust an absence" cuts both ways, and inventing a presence is
   * worse. The signature changes to `Workspace | null` deliberately: callers
   * now have to say what they do when there is no workspace, which is a
   * question the old signature let them skip.
   */
  active(): Workspace | null {
    return this.workspaces.get(this.activeId) ?? null;
  }

  /** Whether the file has been read. `false` means "do not trust an absence". */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * The active workspace id, or NULL before the file has been read.
   *
   * THE BUG THIS FIXES. `activeId` is initialised to `'workspace-default'` at
   * declaration, so this used to return a plausible-looking id unconditionally —
   * including during the ~270 lines of composition between `initConnectors` and
   * the `workspaceStore.load()` inside `initEnterprise`, and including while the
   * connector sync scheduler was already running. If the persisted active
   * workspace was anything other than the default, every workspace-derived read
   * in that window silently resolved to the WRONG workspace, and the fail-closed
   * guards written against `''` were unreachable.
   *
   * Program 10 got this right twice by accident and once on purpose: the sync
   * service authorizer starts unbound and denies, and the relationship engine
   * returns null with a "not up yet" comment. This was given a DEFAULT instead
   * of a DENIAL. That one-word difference is the whole finding.
   */
  activeWorkspaceIdOrNull(): string | null {
    if (!this.loaded) return null;
    return this.workspaces.has(this.activeId) ? this.activeId : null;
  }

  /**
   * The active workspace id as a bare string.
   *
   * Retained for the callers that only stamp it onto an audit line or a display
   * label, where a wrong-but-plausible value is a cosmetic defect rather than a
   * boundary breach. ANY caller that gates on it must use
   * `activeWorkspaceIdOrNull` — and the tenant resolver, which is the only
   * thing that should be gating, does.
   */
  activeWorkspaceId(): string {
    return this.activeId;
  }

  /**
   * The active workspace id for a LABEL or an AUDIT STAMP. Never for a gate.
   *
   * Same value as `activeWorkspaceId`, under a name that says what it is safe
   * for. The two exist because eleven of the fifteen callers only stamp the id
   * onto an audit line or render it, where a wrong-but-plausible value is a
   * cosmetic defect — and four gated on it, where the same value was a boundary
   * breach. Keeping one function meant every caller looked identical.
   */
  activeWorkspaceIdForDisplay(): string {
    return this.activeId;
  }

  /**
   * Create a workspace inside a tenant.
   *
   * `organizationId` is NOT validated here on purpose — this store does not know
   * what organizations exist, and giving it an org reader would make it the
   * second place that answers a tenant question. The caller validates. What
   * changed in P11 is that the caller now actually does, and no longer accepts
   * the value from the renderer: see `enterprise/index.ts`.
   */
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
