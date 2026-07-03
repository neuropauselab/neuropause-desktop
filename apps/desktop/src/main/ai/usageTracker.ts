/**
 * Usage Tracker — the Token Tracker and Cost Tracker in one place. Accumulates
 * tokens and USD cost across calls, broken down by worker and model, for budget
 * and FinOps surfaces. Cost always arrives pre-computed from pricing.ts, the
 * single source of rates.
 */
import type { AiUsageSummary, AiWorkerId } from '@neuropause/shared';

interface Bucket {
  calls: number;
  costUsd: number;
}

export class UsageTracker {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private readonly byWorker = new Map<string, Bucket>();
  private readonly byModel = new Map<string, Bucket>();

  add(p: {
    worker: AiWorkerId;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): void {
    this.calls++;
    this.inputTokens += p.inputTokens;
    this.outputTokens += p.outputTokens;
    this.costUsd += p.costUsd;
    bump(this.byWorker, p.worker, p.costUsd);
    bump(this.byModel, p.model, p.costUsd);
  }

  summary(): AiUsageSummary {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: round(this.costUsd),
      byWorker: toObj(this.byWorker),
      byModel: toObj(this.byModel),
    };
  }
}

function bump(m: Map<string, Bucket>, key: string, cost: number): void {
  const e = m.get(key) ?? { calls: 0, costUsd: 0 };
  e.calls++;
  e.costUsd = round(e.costUsd + cost);
  m.set(key, e);
}

function toObj(m: Map<string, Bucket>): Record<string, Bucket> {
  const o: Record<string, Bucket> = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
