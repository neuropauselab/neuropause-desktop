/**
 * AI Sandbox — Performance & Security Lab (S5): the stress engine.
 *
 * Stress (Step 4) runs a scenario carrying a LARGE generated dataset (reusing the S3
 * dataset generator — `magnitude` rows) through the executor and measures latency +
 * degradation vs a baseline + peak RSS. Everything runs against the existing platform via
 * the executor; nothing is fabricated. Safe: bounded, in-sandbox, no host/disk perturbation.
 */
import { type StressPlan, type StressResult, type ScenarioSpec } from '@neuropause/shared';
import { rssBytes, type LabDeps } from './ports';

export function stressSpec(plan: StressPlan): ScenarioSpec {
  return {
    kind: 'enterprise',
    category: 'performance',
    metadata: { title: `Stress ${plan.dimension} ×${plan.magnitude}` },
    dataset: { source: 'generated', generate: { count: plan.magnitude, seed: 7, template: { name: 'Row {{index1}}', code: '{{pick:A|B|C}}' } }, validate: ['name'] },
    steps: [{ id: 'probe', action: 'createCustomer', input: { name: 'Stress ${datasetRow.name}', status: 'active' } }],
    assertions: [],
  };
}

export async function runStress(plan: StressPlan, deps: LabDeps, baselineMs = 0): Promise<StressResult> {
  const rss0 = rssBytes();
  const t0 = deps.now();
  const result = await deps.executor.run({ id: plan.id, name: plan.id, spec: stressSpec(plan) });
  const ms = deps.now() - t0;
  const peakRssBytes = Math.max(rssBytes(), rss0);
  const completed = result.outcome === 'pass' ? 1 : 0;
  const degradationPct = baselineMs > 0 ? Math.max(0, Math.round(((ms - baselineMs) / baselineMs) * 100)) : 0;
  return {
    id: plan.id,
    dimension: plan.dimension,
    magnitude: plan.magnitude,
    completed,
    failed: completed ? 0 : 1,
    latencyMs: ms,
    degradationPct,
    peakRssBytes,
  };
}
