/**
 * NeuroPause Platform — durable command journal (ERP Session 18, Track B).
 *
 * The atomic unit of the outbox pattern for the modular monolith. ONE durable
 * record per committed command holds all three of:
 *   • the IDEMPOTENCY result   (same tenant+key → replay, forever, across restart)
 *   • the immutable DOMAIN EVENT (the business fact)
 *   • the OUTBOX entry          (delivery state PENDING→PROCESSING→DELIVERED/RETRYABLE)
 * so committing them is ONE atomic file write — there is no window in which the
 * state's event exists without its outbox, or vice-versa.
 *
 * ATOMICITY across the whole transaction (state + event + outbox):
 *   - the caller's `execute` performs the state mutation and returns a `rollback`;
 *   - the journal builds the event + outbox and commits the record atomically;
 *   - if the commit write fails, the journal calls `rollback` (compensating the
 *     state) and reports failure — so a state change never survives without its
 *     durable event/outbox, and a failed commit never leaves an event behind.
 *
 * Tenant is part of the idempotency identity (never a global key); every record
 * is stamped with its tenant and only ever read back per tenant.
 */
import { randomUUID } from 'node:crypto';
import {
  EVENT_FOR_COMMAND,
  EVENT_SCHEMA_VERSION,
  type CommandResult,
  type DomainCommandType,
  type DomainEvent,
  type DomainEventType,
  type OutboxStatus,
} from './domainCommand';
import { DurableJsonStore } from '../persistence/durableJsonStore';

export interface OutboxState {
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  deliveredAt?: string;
  /**
   * ERP Session 38 — the PROCESS BOOT EPOCH that set this record to PROCESSING. Stamped by
   * `markProcessing`; a fresh journal instance (a new process) generates a new epoch. It is the
   * reliable, non-arbitrary staleness signal for crash recovery: a PROCESSING record whose epoch
   * is NOT the current process's epoch was necessarily set by a process that is no longer running
   * (single-instance app), so it is provably ABANDONED and safe to reclaim. A record set PROCESSING
   * by the CURRENT process carries the current epoch and is ACTIVE — never reclaimed. Optional
   * because pre-S38 records (and non-PROCESSING states) carry no epoch; absent is treated as stale
   * (it predates this process). This is an identity nonce, NOT a timestamp — no clock, no threshold.
   */
  processingEpoch?: string;
}

/** One committed command: idempotency + event + outbox, atomic. */
export interface CommittedCommand {
  id: string; // txId
  tenantId: string;
  idempotencyKey: string;
  commandType: DomainCommandType;
  result: Record<string, unknown>;
  event: DomainEvent;
  outbox: OutboxState;
  committedAt: string;
}

export interface TxExecuteResult {
  ok: boolean;
  data?: Record<string, unknown>;
  aggregateId?: string;
  aggregateType?: string;
  error?: string;
  /** Compensate the state mutation if the durable commit fails (case C). */
  rollback?: () => Promise<void> | void;
}

export interface JournalRunInput {
  tenantId: string;
  idempotencyKey: string;
  commandId: string;
  commandType: DomainCommandType;
  correlationId: string;
  causationId?: string;
  actor: string;
  source: string;
  execute: () => Promise<TxExecuteResult>;
}

let eventSeq = 0;

export class DurableCommandJournal {
  private readonly store: DurableJsonStore<CommittedCommand>;
  private readonly inflight = new Map<string, Promise<CommandResult>>();
  /**
   * ERP Session 38 — this process instance's boot epoch. Generated ONCE per journal construction,
   * i.e. once per process (runtimeCore builds one journal). Stamped onto every record `markProcessing`
   * transitions, so `reconcileStaleProcessing` can tell a record THIS process is actively delivering
   * (current epoch) from one a dead process left behind (any other epoch). A nonce, not a clock.
   */
  private readonly bootEpoch = randomUUID();

  constructor(filePath: string) {
    this.store = new DurableJsonStore<CommittedCommand>(filePath);
  }

  async load(): Promise<void> {
    await this.store.load();
  }
  /** Re-read from disk — simulates a fresh process after a restart. */
  async reload(): Promise<void> {
    await this.store.reload();
  }

  private key(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}::${idempotencyKey}`;
  }

  private findCommitted(tenantId: string, idempotencyKey: string): CommittedCommand | undefined {
    return this.store.all().find((r) => r.tenantId === tenantId && r.idempotencyKey === idempotencyKey);
  }

  private replay(rec: CommittedCommand): CommandResult {
    return { ok: true, commandId: rec.id, type: rec.commandType, data: rec.result, event: rec.event, replayed: true };
  }

  /**
   * Run one command through the durable transaction boundary. Same tenant + key
   * → exactly one accepted effect (replayed thereafter). Concurrent duplicates
   * share one execution (in-memory single-flight); a failed execute commits
   * nothing; a failed COMMIT compensates the state (rollback).
   */
  async run(input: JournalRunInput): Promise<CommandResult> {
    await this.store.load();
    const existing = this.findCommitted(input.tenantId, input.idempotencyKey);
    if (existing) return this.replay(existing);

    const k = this.key(input.tenantId, input.idempotencyKey);
    const running = this.inflight.get(k);
    if (running) return running;

    const promise = (async (): Promise<CommandResult> => {
      // Re-check after the (possible) await above — a concurrent caller may have committed.
      const committedNow = this.findCommitted(input.tenantId, input.idempotencyKey);
      if (committedNow) return this.replay(committedNow);

      const outcome = await input.execute();
      if (!outcome.ok) {
        // No commit → no event, no outbox (case B). Failure stays retryable.
        return { ok: false, commandId: input.commandId, type: input.commandType, error: outcome.error ?? 'COMMAND_FAILED' };
      }

      const event: DomainEvent = Object.freeze({
        eventId: `evt_${Date.now().toString(36)}_${(eventSeq += 1)}`,
        type: EVENT_FOR_COMMAND[input.commandType],
        tenantId: input.tenantId,
        aggregateId: String(outcome.aggregateId ?? outcome.data?.id ?? ''),
        aggregateType: outcome.aggregateType ?? 'PurchaseRequest',
        correlationId: input.correlationId,
        causationId: input.causationId ?? input.commandId,
        schemaVersion: EVENT_SCHEMA_VERSION,
        actor: input.actor,
        at: new Date().toISOString(),
        detail: Object.freeze({ ...(outcome.data ?? {}), source: input.source }),
      });
      const record: CommittedCommand = {
        id: `tx_${randomUUID()}`,
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
        commandType: input.commandType,
        result: outcome.data ?? {},
        event,
        outbox: { status: 'PENDING', attempts: 0 },
        committedAt: new Date().toISOString(),
      };
      try {
        await this.store.put(record); // ONE atomic write: idempotency + event + outbox commit together
      } catch {
        // Case C: the durable commit failed — compensate the state mutation and
        // report failure. Nothing durable was written.
        try {
          await outcome.rollback?.();
        } catch {
          /* compensation best-effort; the commit failure is the reported error */
        }
        return { ok: false, commandId: input.commandId, type: input.commandType, error: 'COMMIT_FAILED' };
      }
      return { ok: true, commandId: input.commandId, type: input.commandType, data: record.result, event };
    })();

    this.inflight.set(k, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(k);
    }
  }

  // ── read models ────────────────────────────────────────────────────────────

  /** Committed domain events for ONE tenant (never cross-tenant). */
  events(tenantId: string): readonly DomainEvent[] {
    return this.store
      .all()
      .filter((r) => r.tenantId === tenantId)
      .map((r) => r.event);
  }

  ofType(tenantId: string, type: DomainEventType): readonly DomainEvent[] {
    return this.events(tenantId).filter((e) => e.type === type);
  }

  /** Committed records for ONE tenant (idempotency + outbox inspection). */
  records(tenantId: string): readonly CommittedCommand[] {
    return this.store.all().filter((r) => r.tenantId === tenantId);
  }

  /** Outbox entries awaiting delivery (PENDING or RETRYABLE), optionally per tenant. */
  pendingOutbox(tenantId?: string): CommittedCommand[] {
    return this.store
      .all()
      .filter((r) => (r.outbox.status === 'PENDING' || r.outbox.status === 'RETRYABLE') && (tenantId === undefined || r.tenantId === tenantId));
  }

  /** READ-ONLY health probe (S34): is the durable journal file present + parseable? Never mutates. */
  probeHealth(): Promise<{ ok: boolean; state: 'ok' | 'first-run' | 'corrupt' }> {
    return this.store.probe();
  }

  private async setOutbox(id: string, next: OutboxState): Promise<void> {
    const rec = this.store.get(id);
    if (!rec) return;
    // The domain EVENT is never mutated — only the outbox delivery state.
    await this.store.put({ ...rec, outbox: next });
  }

  async markProcessing(id: string): Promise<void> {
    const rec = this.store.get(id);
    if (!rec || rec.outbox.status === 'DELIVERED') return;
    // Stamp THIS process's boot epoch so crash-recovery can distinguish an actively-processing
    // record (current epoch) from one a dead process orphaned (any other/absent epoch). ERP S38.
    await this.setOutbox(id, { ...rec.outbox, status: 'PROCESSING', attempts: rec.outbox.attempts + 1, processingEpoch: this.bootEpoch });
  }
  async markDelivered(id: string): Promise<void> {
    const rec = this.store.get(id);
    if (!rec) return;
    await this.setOutbox(id, { ...rec.outbox, status: 'DELIVERED', deliveredAt: new Date().toISOString() });
  }
  async markRetryable(id: string, error: string): Promise<void> {
    const rec = this.store.get(id);
    if (!rec || rec.outbox.status === 'DELIVERED') return;
    await this.setOutbox(id, { ...rec.outbox, status: 'RETRYABLE', lastError: error });
  }

  /**
   * ERP Session 38 — BOOT-TIME RECOVERY of crash-orphaned PROCESSING outbox records (S37 Finding 1).
   *
   * A record left `PROCESSING` by an unclean termination is excluded from `pendingOutbox` (PENDING |
   * RETRYABLE only), so the relay never re-drives it — it is orphaned. This transitions such a record
   * back to `RETRYABLE` so the EXISTING `pendingOutbox` → `dispatchOutbox` → consumer → DeliveredEventLog
   * machinery retries it. It creates NO new state, NO new queue, NO recovery-specific delivery path, and
   * never invokes a consumer or marks DELIVERED itself.
   *
   * STALE CRITERION (the central safety invariant): a `PROCESSING` record is reclaimed ONLY when its
   * `processingEpoch` is not this process's `bootEpoch` — i.e. it was set PROCESSING by a process that
   * is no longer running (single-instance app), so it is provably ABANDONED. A record set PROCESSING by
   * the CURRENT process (current epoch) is ACTIVE and is NEVER reclaimed. This is not an age threshold
   * and reads no clock, so it cannot false-positive on a slow-but-live delivery. Intended to run ONCE at
   * boot, BEFORE the first drain, so no `PROCESSING` this process created can exist yet.
   *
   * Durable + idempotent: each transition is one atomic `DurableJsonStore` write (S33); a partial failure
   * leaves the other records untouched and valid; a second run reclaims nothing (the records are now
   * RETRYABLE, not PROCESSING). `attempts` is NOT incremented (reclaiming is not a delivery attempt — the
   * next `markProcessing` on re-drive increments it). Tenant attribution is preserved verbatim.
   */
  async reconcileStaleProcessing(): Promise<{ reclaimed: number; ids: string[] }> {
    await this.store.load();
    const stale = this.store
      .all()
      .filter((r) => r.outbox.status === 'PROCESSING' && r.outbox.processingEpoch !== this.bootEpoch);
    const ids: string[] = [];
    for (const rec of stale) {
      await this.setOutbox(rec.id, { ...rec.outbox, status: 'RETRYABLE', lastError: 'reclaimed after unclean shutdown' });
      ids.push(rec.id);
    }
    return { reclaimed: ids.length, ids };
  }

  async destroy(): Promise<void> {
    this.inflight.clear();
    await this.store.destroy();
  }
}
