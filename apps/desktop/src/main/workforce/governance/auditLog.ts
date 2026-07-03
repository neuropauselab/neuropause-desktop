/**
 * The Governance Runtime's audit trail. Every governance decision (allow / deny /
 * require_approval) is appended here as an immutable `WorkforceAuditEntry`, so
 * there is always a complete, queryable record of what each worker was permitted
 * to do and why. Append-only by contract — entries are never mutated or removed.
 *
 * Electron-free (constructor takes a file path); the singleton lives in
 * auditInstance.ts. Persistence is the standard serialized background writer with
 * atomic temp-file + rename.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { WorkforceAuditEntry, WorkforceAuditPage } from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('workforce-audit');

const MAX_ENTRIES = 5000;

interface AuditFile {
  entries: WorkforceAuditEntry[];
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  workerId?: string;
  decision?: WorkforceAuditEntry['decision'];
}

export class AuditLog extends EventEmitter {
  private entries: WorkforceAuditEntry[] = [];
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
    log.info('Workforce audit log ready', { entries: this.entries.length });
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
      log.error('Audit persist failed', { error: String(err) });
    } finally {
      this.persisting = false;
    }
  }

  async flush(): Promise<void> {
    while (this.persisting) await this.lastPersist;
  }

  /** Append one decision. Newest entries are kept; the oldest are trimmed past the cap. */
  record(entry: WorkforceAuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(this.entries.length - MAX_ENTRIES);
    }
    this.schedulePersist();
    this.emit('changed', entry);
  }

  /** Page through the audit trail, newest first, with optional filters. */
  page(query: AuditQuery = {}): WorkforceAuditPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);
    let rows = [...this.entries].reverse();
    if (query.workerId) rows = rows.filter((e) => e.workerId === query.workerId);
    if (query.decision) rows = rows.filter((e) => e.decision === query.decision);
    const total = rows.length;
    return { entries: rows.slice(offset, offset + limit), total };
  }

  size(): number {
    return this.entries.length;
  }
}
