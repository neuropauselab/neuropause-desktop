/**
 * AI Sandbox — Performance & Security Lab (S5): performance profiles.
 *
 * A profile measures one target (Step 2) by running a representative scenario N times
 * through the executor and aggregating latency with the SHARED perfMetrics helpers
 * (`summarizeDurations` / `percentile` via `aggregateLatency`). The scenarios REUSE the
 * S4 templates — the lab writes no new scenarios and performs no operation directly.
 */
import { aggregateLatency, throughputPerSec, type LabTargetKind, type PerfProfileResult, type ScenarioSpec } from '@neuropause/shared';
import {
  automationCheck,
  connectorCheck,
  crmSmoke,
  desktopSmoke,
  developerChannels,
  executiveCheck,
  knowledgeGraphCheck,
  pluginCheck,
  procureToPay,
  timelineCheck,
} from '../agent/scenarioTemplates';
import type { LabDeps } from './ports';

export interface PerfProfile {
  id: string;
  target: LabTargetKind;
  label: string;
  spec: ScenarioSpec;
  iterations: number;
}

/** The 15 default performance profiles — one representative scenario per target. */
export function defaultProfiles(iterations = 3): PerfProfile[] {
  const p = (target: LabTargetKind, label: string, spec: ScenarioSpec): PerfProfile => ({ id: `perf-${target}`, target, label, spec, iterations });
  return [
    p('startup', 'Cold path (representative)', crmSmoke()),
    p('shutdown', 'Teardown path (representative)', crmSmoke()),
    p('desktop', 'Desktop UI', desktopSmoke()),
    p('rest', 'REST API', developerChannels()),
    p('sdk', 'SDK', developerChannels()),
    p('cli', 'CLI', developerChannels()),
    p('automation', 'Automation', automationCheck('rule-1')),
    p('connectors', 'Connectors', connectorCheck('github')),
    p('plugins', 'Plugins', pluginCheck('sample-plugin')),
    p('graph', 'Knowledge Graph', knowledgeGraphCheck()),
    p('timeline', 'Timeline', timelineCheck()),
    p('memory', 'Memory (record write path)', crmSmoke()),
    p('executive', 'Executive Center', executiveCheck()),
    p('scenario-runner', 'Scenario Runner (P2P)', procureToPay()),
    p('ai-qa', 'AI QA', crmSmoke()),
  ];
}

export async function runProfile(profile: PerfProfile, deps: LabDeps): Promise<PerfProfileResult> {
  const samples: number[] = [];
  let passed = 0;

  // The `ai-qa` target measures a real S4 session when one is injected.
  if (profile.target === 'ai-qa' && deps.qaSession) {
    for (let i = 0; i < profile.iterations; i += 1) {
      const r = await deps.qaSession('Validate the customer lifecycle');
      samples.push(r.ms);
      if (r.ok) passed += 1;
    }
  } else {
    for (let i = 0; i < profile.iterations; i += 1) {
      const t0 = deps.now();
      const result = await deps.executor.run({ id: `${profile.id}-${i}`, name: profile.label, spec: profile.spec });
      samples.push(deps.now() - t0);
      if (result.outcome === 'pass') passed += 1;
    }
  }

  const { summary, p99Ms } = aggregateLatency(samples);
  const totalMs = samples.reduce((a, b) => a + b, 0);
  return {
    id: profile.id,
    target: profile.target,
    runs: profile.iterations,
    passed,
    latency: summary,
    p99Ms,
    throughputPerSec: throughputPerSec(profile.iterations, totalMs),
  };
}

export async function runProfiles(profiles: PerfProfile[], deps: LabDeps): Promise<PerfProfileResult[]> {
  const out: PerfProfileResult[] = [];
  for (const profile of profiles) out.push(await runProfile(profile, deps));
  return out;
}
