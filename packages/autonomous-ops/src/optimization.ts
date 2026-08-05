/**
 * Module 8 — Resource Optimization. Workforce / equipment / inventory capacity, budget allocation,
 * resource balancing, and utilization analysis — computed from REAL or supplied data. NEVER
 * invents an optimization result: with no capacity data, utilization is null with an honest note.
 */
import type { OpsContext } from './types';

export interface Utilization {
  allocated: number;
  capacity: number;
  utilizationPct: number | null;
  note: string;
}

export class ResourceOptimization {
  constructor(private readonly ctx: OpsContext = {}) {}

  /** Real utilization = allocated / capacity. Null (not invented) when capacity is unknown. */
  utilization(input: { allocated: number; capacity: number }): Utilization {
    if (input.capacity <= 0) return { allocated: input.allocated, capacity: input.capacity, utilizationPct: null, note: 'no capacity data — utilization not invented' };
    return { allocated: input.allocated, capacity: input.capacity, utilizationPct: Math.round((input.allocated / input.capacity) * 100), note: 'computed from supplied data' };
  }

  /** Proportional balancing of a total capacity across weighted demands — a real computation. */
  balance(items: Array<{ id: string; demand: number }>, totalCapacity: number): Array<{ id: string; allocation: number }> {
    const totalDemand = items.reduce((s, i) => s + i.demand, 0);
    if (totalDemand <= 0 || totalCapacity <= 0) return items.map((i) => ({ id: i.id, allocation: 0 }));
    return items.map((i) => ({ id: i.id, allocation: Math.round((i.demand / totalDemand) * totalCapacity) }));
  }

  /** Real workforce capacity from the reused Wave 11 platform — 0 (not invented) when absent. */
  workforceCapacity(): { agents: number; note: string } {
    const n = this.ctx.workforce ? this.ctx.workforce.agents().count() : 0;
    return { agents: n, note: n > 0 ? 'real AI agent count from Wave 11' : 'no workforce connected — 0, not invented' };
  }
}
