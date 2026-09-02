/**
 * NeuroPause Platform — Delivered-event log (ERP Session 31, production-readiness track).
 *
 * The production OUTBOX SINK. The durable command journal (Session 18) commits a domain event to
 * its outbox as PENDING on every governed write, and `dispatchOutbox` (the at-least-once relay)
 * drains it. Until now that relay had ONLY test callers — in production the outbox was written and
 * never drained, so the platform's advertised "durable at-least-once delivery" delivered nowhere.
 *
 * This is the missing downstream consumer: a durable, tenant-scoped, idempotent record that a
 * committed domain event was DELIVERED. It is deliberately a downstream READ-MODEL fed BY the
 * journal's outbox — it is NOT a second outbox, event bus, command bus, or audit system:
 *   • it emits no events and drives no workflow (no side effects, no automation trigger);
 *   • it holds no PENDING/RETRYABLE state (delivery state stays in the journal's outbox);
 *   • its only write is one row per delivered event, keyed by the event id.
 *
 * Tenant attribution comes from the EVENT (`event.tenantId`), never from ambient process state, so
 * a background drain that spans tenants attributes each delivery to its own tenant. Reads are
 * tenant-scoped and can never return another tenant's delivered events.
 *
 * Idempotency is by construction: the store is a Map keyed by `event.eventId`, so an at-least-once
 * re-delivery (a crash after deliver, before the journal's `markDelivered`) writes at most one row.
 */
import { DurableJsonStore } from '../persistence/durableJsonStore';
import type { DomainEvent } from './domainCommand';

/** A durable, tenant-attributed record that a committed domain event was delivered. */
export interface DeliveredEventRecord {
  /** = the domain event id — the idempotency key (one row per event, at-most-once). */
  id: string;
  /** From the EVENT, never ambient state — the delivery's authoritative tenant. */
  tenantId: string;
  type: string;
  aggregateId: string;
  aggregateType?: string;
  correlationId: string;
  /** When the event was minted (from the event). */
  eventAt: string;
  /** When the relay delivered it (server clock). */
  deliveredAt: string;
}

export class DeliveredEventLog {
  private readonly store: DurableJsonStore<DeliveredEventRecord>;

  constructor(filePath: string) {
    this.store = new DurableJsonStore<DeliveredEventRecord>(filePath);
  }

  /** Force a re-read from disk — used by restart/durability tests. */
  async reload(): Promise<void> {
    await this.store.reload();
  }

  /**
   * Deliver = durably record the event, keyed by its id. Idempotent: a repeated delivery of the
   * same event (the at-least-once guarantee) is a no-op after the first row. Attribution is the
   * EVENT's tenant, so a cross-tenant drain never mis-attributes.
   */
  async record(event: DomainEvent): Promise<void> {
    if (this.store.get(event.eventId)) return; // already delivered — at-most-once row
    await this.store.put({
      id: event.eventId,
      tenantId: event.tenantId,
      type: event.type,
      aggregateId: event.aggregateId,
      ...(event.aggregateType ? { aggregateType: event.aggregateType } : {}),
      correlationId: event.correlationId,
      eventAt: event.at,
      deliveredAt: new Date().toISOString(),
    });
  }

  /** Tenant-scoped read — never returns another tenant's delivered events. */
  delivered(tenantId: string): DeliveredEventRecord[] {
    return this.store.all().filter((r) => r.tenantId === tenantId);
  }

  count(tenantId: string): number {
    return this.delivered(tenantId).length;
  }

  /** Test/reset only. */
  async destroy(): Promise<void> {
    await this.store.destroy();
  }
}
