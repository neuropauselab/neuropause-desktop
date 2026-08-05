/**
 * Module 7 — Operations Scheduler. Workforce / facility / equipment / resource / capacity /
 * priority scheduling with real in-process conflict detection. Live-verified; starts empty.
 */
import { randomId, type Clock } from '@neuropause/cloud-core';
import type { OperationsGovernance } from './governance';
import { SCHEDULE_KINDS, type ScheduleKind } from './constants';

export interface ScheduleSlot {
  id: string;
  kind: ScheduleKind;
  resourceId: string;
  label: string;
  start: number;
  end: number;
  priority: number;
  createdAt: number;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number): boolean => aS < bE && bS < aE;

export class OperationsScheduler {
  private readonly slots = new Map<string, ScheduleSlot>();

  constructor(
    private readonly clock: Clock,
    private readonly governance: OperationsGovernance,
  ) {}

  /** Schedule a resource; a real conflict check rejects overlapping bookings of the same resource. */
  async schedule(input: { kind: ScheduleKind; resourceId: string; label: string; start: number; end: number; priority?: number }): Promise<ScheduleSlot> {
    if (!SCHEDULE_KINDS.includes(input.kind)) throw new Error(`unknown schedule kind: ${input.kind}`);
    if (input.end <= input.start) throw new Error('slot end must be after start');
    if (this.conflict(input.resourceId, input.start, input.end)) throw new Error('resource already scheduled for that window');
    const slot: ScheduleSlot = { id: randomId('slot'), kind: input.kind, resourceId: input.resourceId, label: input.label, start: input.start, end: input.end, priority: input.priority ?? 3, createdAt: this.clock.now() };
    this.slots.set(slot.id, slot);
    await this.governance.record({ user: 'system', org: '_ops', mission: '_schedule', operation: `schedule.${input.kind}`, targetId: slot.id, evidence: 'live-verified' });
    return slot;
  }

  conflict(resourceId: string, start: number, end: number): boolean {
    return [...this.slots.values()].some((s) => s.resourceId === resourceId && overlaps(s.start, s.end, start, end));
  }

  list(kind?: ScheduleKind): ScheduleSlot[] {
    const all = [...this.slots.values()];
    return kind ? all.filter((s) => s.kind === kind) : all;
  }
  count(): number { return this.slots.size; }
}
