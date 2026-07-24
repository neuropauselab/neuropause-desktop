/**
 * The Governance Runtime's audit trail. Every governance decision (allow / deny /
 * require_approval) is appended here as a `WorkforceAuditEntry`.
 *
 * Integrity model (REP: real tamper-evidence, honest retention):
 *  - Entries are **hash-chained** with SHA-256: each entry's chain value is
 *    `sha256(previousHash + canonical(entry))`, so any mutation, deletion, or
 *    reordering of a retained entry is *detectable* via `verifyIntegrity()`.
 *  - Retention is **bounded** (`maxEntries`, default 5000) with a rolling drop of
 *    the oldest entries. This is NOT "never removed" — rotation is explicit: the
 *    chain is *checkpointed* at each drop (the `base` hash advances over the
 *    dropped entry) so integrity still verifies over the retained tail, and
 *    `dropped` / `totalAppended` are tracked so loss is never silent.
 *  - Threat model (honest): the chain detects accidental corruption and casual
 *    tampering of the on-disk file. A local attacker with write access to BOTH
 *    the entries and the `integrity.head` can still forge a consistent chain; the
 *    production-grade mitigation is shipping entries to append-only external
 *    storage (WORM / SIEM), which this class is structured to feed. It is a
 *    strict improvement over the previous plain, unverifiable JSON.
 *
 * Electron-free (constructor takes a file path); the singleton lives in
 * auditInstance.ts. Persistence is the standard serialized background writer with
 * atomic temp-file + rename.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { WorkforceAuditEntry, WorkforceAuditPage } from '@neuropause/shared';
import { createLogger } from '../../logger';

const log = createLogger('workforce-audit');

const DEFAULT_MAX_ENTRIES = 5000;
const CHAIN_ALGO = 'sha256-chain-v1';
/** Fixed genesis so an empty log has a well-defined, reproducible chain base. */
const GENESIS = createHash('sha256').update('neuropause-workforce-audit-v1').digest('hex');

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

/** One step of the hash chain: fold an entry into the running hash. */
function chainStep(prevHash: string, e: WorkforceAuditEntry): string {
  return createHash('sha256').update(`${prevHash}\n${canonicalEntry(e)}`).digest('hex');
}

interface IntegrityMeta {
  algo: string;
  /** Chain value up to (and including) the last DROPPED entry — the anchor for the retained tail. */
  base: string;
  /** Chain value including the last retained entry. Invariant: head === chain(base, entries). */
  head: string;
  /** Count of entries rotated out of the retained window. */
  dropped: number;
  /** Monotonic count of every entry ever appended (retained + dropped). */
  totalAppended: number;
}

interface AuditFile {
  entries: WorkforceAuditEntry[];
  integrity?: IntegrityMeta;
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  workerId?: string;
  decision?: WorkforceAuditEntry['decision'];
}

export interface AuditIntegrityReport {
  ok: boolean;
  algo: string;
  head: string;
  recomputed: string;
  retained: number;
  dropped: number;
  totalAppended: number;
}

export class AuditLog extends EventEmitter {
  private entries: WorkforceAuditEntry[] = [];
  private loaded = false;
  private lastPersist: Promise<void> = Promise.resolve();
  private persisting = false;
  private dirty = false;
  private readonly maxEntries: number;

  // Hash-chain state.
  private base = GENESIS; // chain value before the first retained entry
  private head = GENESIS; // chain value after the last retained entry
  private dropped = 0;
  private totalAppended = 0;

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
      if (data.integrity && data.integrity.algo === CHAIN_ALGO) {
        this.base = data.integrity.base;
        this.head = data.integrity.head;
        this.dropped = data.integrity.dropped ?? 0;
        this.totalAppended = data.integrity.totalAppended ?? this.entries.length;
        const report = this.verifyIntegrity();
        if (!report.ok) {
          // Do not crash — surface it. A failed chain means the file was mutated
          // or corrupted since it was written.
          log.error('Workforce audit integrity check FAILED on load', {
            head: report.head.slice(0, 16),
            recomputed: report.recomputed.slice(0, 16),
            retained: report.retained,
          });
          this.emit('integrity-violation', report);
        }
      } else {
        // Legacy / unchained file — rebuild the chain in place (upgrade path).
        this.base = GENESIS;
        this.head = this.entries.reduce((h, e) => chainStep(h, e), GENESIS);
        this.dropped = 0;
        this.totalAppended = this.entries.length;
        if (this.entries.length > 0) {
          log.info('Upgraded legacy workforce audit log to hash-chain', {
            entries: this.entries.length,
          });
          this.schedulePersist();
        }
      }
    } catch {
      this.entries = [];
      this.base = GENESIS;
      this.head = GENESIS;
      this.dropped = 0;
      this.totalAppended = 0;
    }
    this.loaded = true;
    log.info('Workforce audit log ready', {
      entries: this.entries.length,
      dropped: this.dropped,
      totalAppended: this.totalAppended,
    });
  }

  private async persist(): Promise<void> {
    const integrity: IntegrityMeta = {
      algo: CHAIN_ALGO,
      base: this.base,
      head: this.head,
      dropped: this.dropped,
      totalAppended: this.totalAppended,
    };
    const file: AuditFile = { entries: this.entries, integrity };
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
   * chain `base` so the retained tail still verifies, and incrementing `dropped`.
   */
  record(entry: WorkforceAuditEntry): void {
    this.head = chainStep(this.head, entry);
    this.entries.push(entry);
    this.totalAppended += 1;
    while (this.entries.length > this.maxEntries) {
      // Checkpoint: advance base over the entry being dropped so the invariant
      // head === chain(base, entries) is preserved for the retained window.
      this.base = chainStep(this.base, this.entries[0]);
      this.entries.shift();
      this.dropped += 1;
    }
    this.schedulePersist();
    this.emit('changed', entry);
  }

  /**
   * Recompute the chain over the retained entries from `base` and compare to
   * `head`. `ok:false` means an entry was mutated, deleted, or reordered.
   */
  verifyIntegrity(): AuditIntegrityReport {
    const recomputed = this.entries.reduce((h, e) => chainStep(h, e), this.base);
    return {
      ok: recomputed === this.head,
      algo: CHAIN_ALGO,
      head: this.head,
      recomputed,
      retained: this.entries.length,
      dropped: this.dropped,
      totalAppended: this.totalAppended,
    };
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
    return this.totalAppended;
  }
}
