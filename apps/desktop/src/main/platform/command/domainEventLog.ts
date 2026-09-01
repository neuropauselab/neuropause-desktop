/**
 * NeuroPause Platform — internal Domain Event log (ERP Session 17, Track B).
 *
 * Append-only, tenant-scoped, immutable events produced by successful commands.
 * An INTERNAL log for the modular monolith — no Kafka, no external broker. A
 * future workflow engine, projection or outbox reads from here; the shape is
 * deliberately transport-agnostic so it can later back an outbox without
 * changing producers.
 *
 * Isolation: events are bucketed by tenant and only ever read back per tenant,
 * so one tenant's stream is never visible to another (the `TenantDedupe`
 * discipline applied to events).
 */
import type { DomainEvent, DomainEventType } from './domainCommand';

let sequence = 0;

export class DomainEventLog {
  private readonly byTenant = new Map<string, DomainEvent[]>();

  /** Append one immutable event. Returns the frozen event (with its minted id). */
  append(input: Omit<DomainEvent, 'eventId'>): DomainEvent {
    const event: DomainEvent = Object.freeze({
      ...input,
      detail: Object.freeze({ ...input.detail }),
      eventId: `evt_${Date.now().toString(36)}_${(sequence += 1)}`,
    });
    // Deny-by-default: an event with no tenant is never logged (the command that
    // produced it already failed the tenant check; this is belt-and-braces).
    if (!input.tenantId) return event;
    const list = this.byTenant.get(input.tenantId) ?? [];
    list.push(event);
    this.byTenant.set(input.tenantId, list);
    return event;
  }

  /** Every event for one tenant, in append order. Never cross-tenant. */
  list(tenantId: string): readonly DomainEvent[] {
    return this.byTenant.get(tenantId) ?? [];
  }

  ofType(tenantId: string, type: DomainEventType): readonly DomainEvent[] {
    return this.list(tenantId).filter((e) => e.type === type);
  }

  /** Test/reset only. */
  clear(): void {
    this.byTenant.clear();
  }
}
