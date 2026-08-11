/**
 * The Executive Memory audit trail. Every memory lifecycle event — created,
 * used, forgotten, rejected (governance result), updated, pinned — is appended
 * here as an immutable `MemoryAuditEvent`, giving a complete, queryable record
 * of what Founder AI chose to remember, recall, or refuse, and why.
 *
 * Append-only by contract. Electron-free (constructor takes a file path); the
 * singleton lives in memoryAuditInstance.ts. Persistence is the standard
 * serialized background writer with atomic temp-file + rename — the same shape
 * as the Governance Runtime's audit log.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { MemoryAuditAction, MemoryAuditEvent, MemoryAuditPage } from '@neuropause/shared';
import { createLogger } from '../logger';
import type { TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

const log = createLogger('memory-audit');

const MAX_ENTRIES = 5000;

interface AuditFile {
  entries: MemoryAuditEvent[];
}

export interface MemoryAuditQuery {
  limit?: number;
  offset?: number;
  action?: MemoryAuditAction;
  memoryId?: string;
}

export class MemoryAuditLog extends EventEmitter {
  /**
   * P13C ROUND 7 (final sweep) — the boundary this log never had.
   *
   * No tenant field, no `bindScope`, no registration — and its channel was in
   * `PUBLIC_CHANNELS`: no auth, no permission. `detail` is an assistant-written
   * plain-language summary, so the rows carry record titles verbatim.
   *
   * The memory STORE beside it is scoped and the conversation store was pulled
   * off the public list in an earlier round. This is their sibling.
   */
  private readonly tenancy = new TenantOwnership('memory-audit-log');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  private entries: MemoryAuditEvent[] = [];
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
      const data = JSON.parse(raw) as Partial<AuditFile>;
      this.entries = Array.isArray(data.entries) ? data.entries : [];
    } catch {
      this.entries = [];
    }
    this.loaded = true;
    log.info('Memory audit log ready', { entries: this.entries.length });
  }

  private async persist(): Promise<void> {
    const file: AuditFile = { entries: this.entries };
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
      log.error('Memory audit persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** Append one event. Newest entries are kept; the oldest are trimmed past the cap. */
  record(event: MemoryAuditEvent): void {
    // Stamped from the resolver, never from the caller. An unresolved writer
    // produces an UNATTRIBUTED row rather than one owned by the wrong tenant;
    // unattributed rows reach nobody.
    const owner = this.tenancy.scopeOrDeny()?.tenantId;
    this.entries.push(owner === undefined ? event : { ...event, tenantId: owner });
    /**
     * PER TENANT. `slice(length - MAX_ENTRIES)` was install-wide, so one tenant's
     * memory activity deleted another tenant's audit evidence — the fifth
     * retention cap in this program able to do that, and the second found in this
     * round alone. A retention cap is a write.
     */
    this.entries = this.tenancy.pruneOwn(this.entries, MAX_ENTRIES, (a, b) => a.at.localeCompare(b.at));
    this.schedulePersist();
    this.emit('changed', event);
  }

  /** Page through the audit trail, newest first, with optional filters. */
  page(query: MemoryAuditQuery = {}): MemoryAuditPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);
    // The CALLER'S rows.
    let rows = [...this.tenancy.onlyMine(this.entries)].reverse();
    if (query.action) rows = rows.filter((e) => e.action === query.action);
    if (query.memoryId) rows = rows.filter((e) => e.memoryId === query.memoryId);
    const total = rows.length;
    return { entries: rows.slice(offset, offset + limit), total };
  }

  /** The CALLER'S row count. An install-wide size says how busy another tenant is. */
  size(): number {
    return this.tenancy.onlyMine(this.entries).length;
  }
}
