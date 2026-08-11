/**
 * AI Sandbox — persistence base (S1).
 *
 * The reusable store substrate every sandbox store extends. It captures the
 * proven pattern already used across the app (EventEmitter for live refresh +
 * debounced atomic writes with a unique temp filename so concurrent saves never
 * collide, 0600) exactly once, so the concrete stores only own their data + queries.
 * Electron-free — the file path is injected, so every store unit-tests on a temp file.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { TenantScope } from '@neuropause/shared';
import { registerTenantStore } from '../tenancy/tenantOwnedStore';

/** Anything the sandbox persists. `tenantId` absent ⇒ unresolved ⇒ nobody's. */
export interface SandboxOwned {
  tenantId?: string | null;
}

export abstract class PersistentStore<F> extends EventEmitter {
  protected loaded = false;
  private persisting = false;
  private dirty = false;
  private lastPersist: Promise<void> = Promise.resolve();

  /**
   * P13C ROUND 3 — PHASE 4. The base REGISTERS with the startup gate.
   *
   * On the base, so a SIXTH sandbox store cannot be added unregistered: it
   * inherits the seam and the registration together, and the only thing its
   * author must supply is a name. Two of these stores — validation runs and
   * benchmarks — previously shipped UNBOUND and were caught by a hand-rolled
   * boot check in `sandbox/index.ts`. This makes that check the general rule.
   */
  constructor(
    protected readonly filePath: string,
    tenantStoreName: string,
  ) {
    super();
    registerTenantStore(tenantStoreName, () => this.hasScope());
  }

  /* ── P13C N3: the tenant boundary ──────────────────────────────────────
   *
   * WHY THIS LIVES ON THE BASE CLASS
   *
   * All five sandbox stores extend this, and before P13C not one of them had a
   * tenant seam of any kind — no `bindScope`, no `visible()`, no ownership
   * counts. Putting the seam here means the five stores inherit one
   * implementation rather than growing five that can drift, and it means a
   * SIXTH sandbox store added later starts out denying instead of starting out
   * open.
   *
   * WHY THE FILTER IS `tenantId` ONLY, NOT `recordInScope`
   *
   * Every sandbox record already has a `workspaceId`, and it is a SANDBOX
   * workspace id (`sbw_…`) — a different namespace from `TenantScope.workspaceId`,
   * which is an enterprise workspace. Passing a sandbox record to
   * `recordInScope` would compare `sbw_…` against an enterprise workspace id
   * and deny everything, which looks like working isolation right up until
   * someone notices the product is empty.
   *
   * So sandbox ownership is TENANT-level and says so. A sandbox workspace is a
   * container for an organization's test assets; scoping it to one enterprise
   * workspace would mean a scenario written in one workspace vanished when the
   * user switched to another inside the same organization, which is not what
   * the product means.
   */
  private scopeSource: (() => TenantScope | null) | null = null;

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.scopeSource = source;
    return this;
  }

  /** True once a boundary is bound. Evidence for the migration inventory. */
  hasScope(): boolean {
    return this.scopeSource !== null;
  }

  /** The caller's scope, or null. Null means deny — never "everything". */
  protected scopeOrDeny(): TenantScope | null {
    return this.scopeSource === null ? null : this.scopeSource();
  }

  /**
   * The tenant a WRITE belongs to, or a refusal.
   *
   * Writes throw where reads return empty. A read with no tenant has an honest
   * empty answer; a write with no tenant would have to invent an owner, and the
   * record would then be visible to nobody while still consuming an id, a
   * retention slot and a prune budget.
   */
  protected requireTenant(): string {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) {
      throw new Error('No organization is active, so this sandbox object has no owner.');
    }
    return scope.tenantId;
  }

  /** Whether `record` belongs to the caller. Unowned records belong to nobody. */
  protected mine(record: SandboxOwned): boolean {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return false;
    const owner = record.tenantId;
    if (typeof owner !== 'string' || owner === '') return false; // pre-P13C ⇒ unresolved
    return owner === scope.tenantId;
  }

  /** Only the caller's records. The one filter every read goes through. */
  protected onlyMine<T extends SandboxOwned>(records: readonly T[]): T[] {
    const scope = this.scopeOrDeny();
    if (scope === null || !scope.tenantId) return [];
    return records.filter((r) => typeof r.tenantId === 'string' && r.tenantId === scope.tenantId);
  }

  /**
   * Ownership counts across EVERY record, ignoring scope.
   *
   * Deliberately unscoped: this is the migration inventory's evidence that
   * pre-P13C rows exist and are visible to nobody. Three integers, no content.
   */
  protected countOwnership(records: readonly SandboxOwned[]): {
    total: number;
    assigned: number;
    unresolved: number;
  } {
    let assigned = 0;
    for (const r of records) if (typeof r.tenantId === 'string' && r.tenantId !== '') assigned += 1;
    return { total: records.length, assigned, unresolved: records.length - assigned };
  }

  /** Serialize the in-memory state to the persisted file shape. */
  protected abstract snapshot(): F;
  /** Rebuild the in-memory state from a (possibly partial) persisted file. */
  protected abstract hydrate(data: Partial<F>): void;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.hydrate(JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<F>);
    } catch {
      // First run / unreadable — start empty.
    }
    this.loaded = true;
  }

  /** Signal a mutation: notify listeners + schedule a durable write. */
  protected changed(): void {
    this.emit('changed');
    this.schedulePersist();
  }

  /** Await any in-flight persist (tests). */
  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    this.lastPersist = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.write();
      }
    } catch {
      // Best-effort persistence; in-memory state remains the source of truth this session.
    } finally {
      this.persisting = false;
    }
  }

  private async write(): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.mkdir(dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await fs.writeFile(tmp, JSON.stringify(this.snapshot()), { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }
}
