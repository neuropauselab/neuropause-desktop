/**
 * Event integration (Wave 1, Module 8). NEMS publishes domain events to the ONE
 * runtime event bus (topic `nems`), partitioned by tenant. No second bus.
 */
import type { EnterpriseRuntime } from '@neuropause/runtime';
import type { MutationContext } from './types';

export type NemsEventType =
  | 'nems.organization.created'
  | 'nems.organization.updated'
  | 'nems.user.created'
  | 'nems.user.updated'
  | 'nems.session.started'
  | 'nems.session.ended'
  | 'nems.dashboard.updated'
  | 'nems.okr.updated'
  | 'nems.settings.changed';

export class NemsEvents {
  private readonly published: Array<{ type: string; tenantId: string }> = [];

  constructor(private readonly runtime: EnterpriseRuntime) {}

  async publish(type: NemsEventType, ctx: MutationContext, payload: Record<string, unknown>): Promise<void> {
    await this.runtime.events().publish({
      type,
      topic: 'nems',
      partitionKey: ctx.tenantId,
      version: 1,
      payload: { ...payload, tenantId: ctx.tenantId, actor: ctx.actorId },
    });
    this.published.push({ type, tenantId: ctx.tenantId });
  }

  /** Local tally (the durable record is the runtime event bus + persistence event store). */
  count(type?: NemsEventType): number {
    return type ? this.published.filter((e) => e.type === type).length : this.published.length;
  }
}
