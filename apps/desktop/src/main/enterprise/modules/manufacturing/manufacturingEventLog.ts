/**
 * postManufacturingEvent — the ONE seam any manufacturing action uses to append an immutable
 * event to the Shop-Floor Event Ledger. It mirrors the Inventory `postStockMovement` seam:
 * validate through the Events module, assign a monotonic sequence + timestamp, persist, and fan
 * the event out to audit + Timeline + Search. The ledger is append-only — corrections are new
 * events, never edits. Best-effort: returns null (no throw) when the Events module is not
 * registered, so emitting telemetry never breaks the execution action that produced it.
 */
import type { EnterpriseEntity, ManufacturingEventType } from '@neuropause/shared';
import { MANUFACTURING_EVENTS_MODULE_ID, deriveRecordTitle } from '@neuropause/shared';
import type { EnterpriseModuleActionContext } from '../../framework';

export interface ManufacturingEventInput {
  eventType: ManufacturingEventType;
  productionOrder?: string;
  execution?: string;
  operation?: string;
  machine?: string;
  workCenter?: string;
  operator?: string;
  quantity?: number;
  reason?: string;
  metadata?: string;
  /** Event time; defaults to the injected clock (`ctx.now()`). */
  timestamp?: string;
}

/** Append one immutable event to the ledger. Returns the created event, or null if unavailable. */
export async function postManufacturingEvent(
  ctx: EnterpriseModuleActionContext,
  input: ManufacturingEventInput,
): Promise<EnterpriseEntity | null> {
  const mod = ctx.moduleFor(MANUFACTURING_EVENTS_MODULE_ID);
  if (!mod) return null;
  ctx.authorize(mod.descriptor.permissions.write); // requires manufacturing:manage
  await mod.store.load();
  const sequence = mod.store.list().length + 1;
  const validation = mod.hooks.validate({
    fields: {
      eventNumber: `EVT-${sequence}`,
      sequence,
      timestamp: input.timestamp ?? ctx.now(),
      eventType: input.eventType,
      productionOrder: input.productionOrder ?? '',
      execution: input.execution ?? '',
      operation: input.operation ?? '',
      machine: input.machine ?? '',
      workCenter: input.workCenter ?? '',
      operator: input.operator ?? '',
      quantity: input.quantity ?? 0,
      reason: input.reason ?? '',
      metadata: input.metadata ?? '',
      user: ctx.actor() ?? '',
    },
  });
  if (!validation.ok) return null;
  const record = mod.store.create({
    title: deriveRecordTitle(mod.descriptor, validation.values),
    fields: validation.values,
    actor: ctx.actor(),
    now: ctx.now(),
  });
  ctx.emit(mod, 'created', record);
  return record;
}
