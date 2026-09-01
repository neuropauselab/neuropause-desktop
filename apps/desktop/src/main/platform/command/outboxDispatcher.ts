/**
 * NeuroPause Platform — outbox dispatcher (ERP Session 18, Track B).
 *
 * The minimum reliable delivery loop for the durable outbox. Reads PENDING /
 * RETRYABLE committed events, marks each PROCESSING, hands it to a consumer, and
 * marks DELIVERED on success or RETRYABLE on failure. It is itself idempotent —
 * re-running skips DELIVERED entries — and it delivers a durable event once it
 * has been committed, surviving a process restart (the entries are re-read from
 * disk).
 *
 * The platform guarantee is deliberately: DURABLE EVENT PERSISTENCE +
 * AT-LEAST-ONCE DELIVERY + IDEMPOTENT CONSUMERS. It does NOT claim exactly-once
 * external delivery — a consumer may see an event more than once (a crash after
 * deliver but before `markDelivered`), so consumers must be idempotent. The
 * dispatcher never delivers cross-tenant: with a `tenantId` it only drains that
 * tenant's outbox.
 */
import type { DomainEvent } from './domainCommand';
import type { DurableCommandJournal } from './durableCommandJournal';

export type OutboxConsumer = (event: DomainEvent) => Promise<void> | void;

export interface DispatchOutboxResult {
  attempted: number;
  delivered: number;
  retryable: number;
}

export async function dispatchOutbox(
  journal: DurableCommandJournal,
  consumer: OutboxConsumer,
  opts: { tenantId?: string } = {},
): Promise<DispatchOutboxResult> {
  const pending = journal.pendingOutbox(opts.tenantId);
  const result: DispatchOutboxResult = { attempted: 0, delivered: 0, retryable: 0 };
  for (const rec of pending) {
    result.attempted += 1;
    await journal.markProcessing(rec.id);
    try {
      await consumer(rec.event); // consumer MUST be idempotent (at-least-once)
      await journal.markDelivered(rec.id);
      result.delivered += 1;
    } catch (err) {
      await journal.markRetryable(rec.id, err instanceof Error ? err.message : String(err));
      result.retryable += 1;
    }
  }
  return result;
}
