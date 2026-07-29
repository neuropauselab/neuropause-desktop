/**
 * Mutation governance (Wave 1). The single path every write takes: append to the
 * one audit chain AND publish to the one event bus. No mutation bypasses this.
 */
import type { NemsAudit, AuditInput, AuditRef } from './audit';
import type { NemsEvents, NemsEventType } from './events';

export interface Gov {
  audit: NemsAudit;
  events: NemsEvents;
}

export async function recordMutation(
  gov: Gov,
  args: AuditInput & { event: NemsEventType; eventPayload?: Record<string, unknown> },
): Promise<AuditRef> {
  const ref = gov.audit.record({ ctx: args.ctx, entity: args.entity, entityId: args.entityId, operation: args.operation, before: args.before, after: args.after });
  await gov.events.publish(args.event, args.ctx, {
    entity: args.entity,
    entityId: args.entityId,
    operation: args.operation,
    auditId: ref.auditId,
    replayId: ref.replayId,
    ...(args.eventPayload ?? {}),
  });
  return ref;
}
