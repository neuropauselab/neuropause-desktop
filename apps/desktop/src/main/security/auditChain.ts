/**
 * Tamper-evident, honestly-bounded audit chain (SHA-256) — the single shared
 * integrity primitive for the app's governance/audit logs.
 *
 * Motivation (REP): several audit trails independently claimed to be "append-only"
 * while silently trimming past a cap and carrying no integrity protection. Rather
 * than copy a hash chain into each, this is the one canonical implementation both
 * the workforce and enterprise governance logs drive.
 *
 * Pure and Electron-free. Each consumer owns its own entry array + persistence and
 * drives this helper:
 *   - `append(entry)`      when an entry is added,
 *   - `dropOldest(entry)`  when the oldest retained entry is rotated out (bounded
 *                          retention) — the chain `base` is checkpointed so the
 *                          retained tail still verifies,
 *   - `verify(entries)`    recompute the chain over the retained window and compare
 *                          to `head` (detects mutation / deletion / reordering),
 *   - `snapshot()`/`restore()`  persist / reload the chain state,
 *   - `rebuild(entries)`   upgrade a legacy (unchained) log in place.
 *
 * `canonical` must be a deterministic serialization of an entry (fixed key order).
 *
 * Threat model (honest): the chain detects accidental corruption and casual
 * tampering of the on-disk log. A local attacker with write access to BOTH the
 * entries and the persisted `head` can still forge a consistent chain; the
 * production-grade mitigation is shipping entries to append-only external storage
 * (WORM / SIEM). It is a strict improvement over plain, unverifiable JSON.
 */
import { createHash } from 'node:crypto';

export const AUDIT_CHAIN_ALGO = 'sha256-chain-v1';

/** A fixed, reproducible starting hash for an empty chain in a given namespace. */
export function auditGenesis(namespace: string): string {
  return createHash('sha256').update(`neuropause-audit:${namespace}`).digest('hex');
}

/** One step of the chain: fold a canonical entry string into the running hash. */
export function auditStep(prevHash: string, canonical: string): string {
  return createHash('sha256').update(`${prevHash}\n${canonical}`).digest('hex');
}

export interface AuditChainSnapshot {
  algo: string;
  /** Chain value up to (and including) the last DROPPED entry — anchors the retained tail. */
  base: string;
  /** Chain value including the last retained entry. Invariant: head === chain(base, entries). */
  head: string;
  dropped: number;
  totalAppended: number;
}

export interface AuditVerifyResult {
  ok: boolean;
  algo: string;
  head: string;
  recomputed: string;
  retained: number;
  dropped: number;
  totalAppended: number;
}

export class AuditChain<T> {
  private base: string;
  private head: string;
  private dropped = 0;
  private total = 0;

  constructor(
    private readonly canonical: (entry: T) => string,
    private readonly namespace: string,
  ) {
    this.base = this.head = auditGenesis(namespace);
  }

  /** Fold a newly-appended entry into the chain head. */
  append(entry: T): string {
    this.head = auditStep(this.head, this.canonical(entry));
    this.total += 1;
    return this.head;
  }

  /** Advance the base over an entry being rotated out, so the retained tail still verifies. */
  dropOldest(entry: T): void {
    this.base = auditStep(this.base, this.canonical(entry));
    this.dropped += 1;
  }

  /** Recompute the chain over the retained entries and compare to head. */
  verify(entries: readonly T[]): AuditVerifyResult {
    const recomputed = entries.reduce((h, e) => auditStep(h, this.canonical(e)), this.base);
    return {
      ok: recomputed === this.head,
      algo: AUDIT_CHAIN_ALGO,
      head: this.head,
      recomputed,
      retained: entries.length,
      dropped: this.dropped,
      totalAppended: this.total,
    };
  }

  snapshot(): AuditChainSnapshot {
    return {
      algo: AUDIT_CHAIN_ALGO,
      base: this.base,
      head: this.head,
      dropped: this.dropped,
      totalAppended: this.total,
    };
  }

  /** Load persisted chain state. Returns false for a missing/incompatible snapshot. */
  restore(s: AuditChainSnapshot | undefined): boolean {
    if (!s || s.algo !== AUDIT_CHAIN_ALGO || typeof s.base !== 'string' || typeof s.head !== 'string') {
      return false;
    }
    this.base = s.base;
    this.head = s.head;
    this.dropped = s.dropped ?? 0;
    this.total = s.totalAppended ?? 0;
    return true;
  }

  /** Upgrade a legacy (unchained) log: derive the chain from the retained entries. */
  rebuild(entries: readonly T[]): void {
    this.base = auditGenesis(this.namespace);
    this.head = entries.reduce((h, e) => auditStep(h, this.canonical(e)), this.base);
    this.dropped = 0;
    this.total = entries.length;
  }

  get totalAppended(): number {
    return this.total;
  }

  get droppedCount(): number {
    return this.dropped;
  }
}
