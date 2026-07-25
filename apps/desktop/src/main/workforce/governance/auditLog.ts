/**
 * The Governance Runtime's audit trail. Every governance decision (allow / deny /
 * require_approval) is appended here as a `WorkforceAuditEntry`.
 *
 * Integrity: entries are hash-chained via the shared `AuditChain` primitive
 * (SHA-256) — any mutation, deletion, or reordering of a retained entry is
 * detectable through `verifyIntegrity()`. Retention is bounded (`maxEntries`,
 * default 5000) with a rolling drop of the oldest; the chain is checkpointed at
 * each drop so the retained tail still verifies, and `dropped` / `totalAppended`
 * are tracked so rotation is explicit — never the silent "never removed" it once
 * claimed to be. Threat model + external-WORM note live in `security/auditChain.ts`.
 *
 * Electron-free (constructor takes a file path); the singleton lives in
 * auditInstance.ts. Persistence is the standard serialized background writer with
 * atomic temp-file + rename.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import type { WorkforceAuditEntry, WorkforceAuditPage } from '@neuropause/shared';
import { AuditChain, type AuditChainSnapshot, type AuditVerifyResult } from '../../security/auditChain';
import { createLogger } from '../../logger';

const log = createLogger('workforce-audit');

const DEFAULT_MAX_ENTRIES = 5000;

/** Deterministic serialization of an entry's fields (fixed key order) for hashing. */
function canonicalEntry(e: WorkforceAuditEntry): string {
  return JSON.stringify({
    at: e.at,
    decision: e.decision,
    id: e.id,
    requestId: e.requestId,
    risk: e.risk,
    skillId: e.skillId,
    summary: e.summary,
    workerId: e.workerId,
    workerRole: e.workerRole,
  });
}

interface AuditFile {
  entries: WorkforceAuditEntry[];
  integrity?: AuditChainSnapshot;
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
  private readonly maxEntries: number;
  private readonly chain = new AuditChain<WorkforceAuditEntry>(canonicalEntry, 'workforce-governance');

  constructor(
    private readonly filePath: string,
    opts: { maxEntries?: number } = {},
  ) {
    super();
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Partial<AuditFile>;
      this.entries = Array.isArray(data.entries) ? data.entries : [];
      if (this.chain.restore(data.integrity)) {
        const report = this.chain.verify(this.entries);
        if (!report.ok) {
          log.error('Workforce audit integrity check FAILED on load', {
            head: report.head.slice(0, 16),
            recomputed: report.recomputed.slice(0, 16),
            retained: report.retained,
          });
          this.emit('integrity-violation', report);
        }
      } else if (this.entries.length > 0) {
        // Legacy / unchained file — rebuild the chain in place (upgrade path).
        this.chain.rebuild(this.entries);
        log.info('Upgraded legacy workforce audit log to hash-chain', { entries: this.entries.length });
        this.schedulePersist();
      }
    } catch {
      this.entries = [];
      this.chain.rebuild([]);
    }
    this.loaded = true;
    log.info('Workforce audit log ready', {
      entries: this.entries.length,
      dropped: this.chain.droppedCount,
      totalAppended: this.chain.totalAppended,
    });
  }

  private async persist(): Promise<void> {
    const file: AuditFile = { entries: this.entries, integrity: this.chain.snapshot() };
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

  /**
   * Append one decision. The entry is folded into the SHA-256 chain. Retention is
   * bounded: past `maxEntries` the oldest entries are rotated out, advancing the
   * chain checkpoint so the retained tail still verifies, and counting the drop.
   */
  record(entry: WorkforceAuditEntry): void {
    this.chain.append(entry);
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries) {
      this.chain.dropOldest(this.entries[0]);
      this.entries.shift();
    }
    this.schedulePersist();
    this.emit('changed', entry);
  }

  /** Recompute the chain over the retained entries; `ok:false` means it was altered. */
  verifyIntegrity(): AuditVerifyResult {
    return this.chain.verify(this.entries);
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

  /** Total entries ever appended, including those rotated out of retention. */
  totalRecorded(): number {
    return this.chain.totalAppended;
  }
}
