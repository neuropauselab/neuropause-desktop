/**
 * AI Sandbox — Performance & Security Lab (S5): the load engine.
 *
 * Concurrency (Step 3) as a worker pool over the executor: `concurrency` workers drain a
 * queue of `total` runs, all submitted to the SAME S1 engine (whose queue + per-workspace
 * concurrency provide the real backpressure). Latency is aggregated with the shared
 * perfMetrics helpers; peak queue depth is read from the real sandbox queue. No new queue.
 */
import { aggregateLatency, throughputPerSec, type LoadPlan, type LoadResult, type ScenarioSpec } from '@neuropause/shared';
import type { LabDeps } from './ports';

export async function runLoad(plan: LoadPlan, spec: ScenarioSpec, deps: LabDeps): Promise<LoadResult> {
  const samples: number[] = [];
  let completed = 0;
  let failed = 0;
  let peakQueueDepth = 0;
  const t0 = deps.now();
  const items = Array.from({ length: plan.total }, (_, i) => i);

  const runOne = async (i: number): Promise<void> => {
    const s = deps.now();
    const result = await deps.executor.run({ id: `${plan.id}-${i}`, name: plan.id, spec });
    samples.push(deps.now() - s);
    if (result.outcome === 'pass') completed += 1;
    else failed += 1;
    if (deps.observers?.queueDepth) {
      const d = await deps.observers.queueDepth().catch(() => 0);
      if (d > peakQueueDepth) peakQueueDepth = d;
    }
  };

  const width = Math.max(1, Math.min(plan.concurrency, plan.total));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = items.shift();
      if (i === undefined) break;
      await runOne(i);
    }
  };
  await Promise.all(Array.from({ length: width }, () => worker()));

  const totalMs = deps.now() - t0;
  const { summary, p99Ms } = aggregateLatency(samples);
  return {
    id: plan.id,
    dimension: plan.dimension,
    concurrency: plan.concurrency,
    total: plan.total,
    completed,
    failed,
    latency: summary,
    p99Ms,
    throughputPerSec: throughputPerSec(completed + failed, totalMs),
    peakQueueDepth,
    backpressure: peakQueueDepth > plan.concurrency,
  };
}
