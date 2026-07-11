/**
 * AI Sandbox — Continuous Validation Platform (S6): the pipeline runner.
 *
 * Runs a pipeline by dispatching each stage to the EXISTING executor for its kind — a
 * scenario through the S4 `QaExecutor` (→ S1 → S2/S3), an AI QA session (S4), or a lab run
 * (S5) — and collecting {@link StageResult}s. It executes nothing itself and never bypasses
 * an executor.
 */
import type { QaSessionResult, ScenarioSpec, StageResult, StageStatus, ValidationPipeline } from '@neuropause/shared';
import type { LabRunConfig, LabRunOutput, ValidationDeps } from './ports';

export interface PipelineStagesOutput {
  stages: StageResult[];
  labOutputs: LabRunOutput[];
  qaSessions: QaSessionResult[];
  scenario: { total: number; passed: number; failed: number };
}

export async function runPipelineStages(pipeline: ValidationPipeline, deps: ValidationDeps): Promise<PipelineStagesOutput> {
  const stages: StageResult[] = [];
  const labOutputs: LabRunOutput[] = [];
  const qaSessions: QaSessionResult[] = [];
  const scenario = { total: 0, passed: 0, failed: 0 };

  for (const stage of pipeline.stages) {
    const t0 = deps.now();
    let status: StageStatus = 'pass';
    let summary = '';
    let metrics: Record<string, number> = {};

    try {
      if (stage.kind === 'scenario') {
        const spec = stage.config.spec as ScenarioSpec;
        const r = await deps.executors.qaExecutor.run({ id: stage.id, name: stage.name, spec });
        scenario.total += 1;
        if (r.outcome === 'pass') scenario.passed += 1;
        else scenario.failed += 1;
        status = r.outcome === 'pass' ? 'pass' : r.outcome === 'error' ? 'error' : 'fail';
        summary = `${r.assertions.passed}/${r.assertions.total} assertions — ${r.outcome ?? r.status}`;
        metrics = r.metrics;
      } else if (stage.kind === 'ai-qa') {
        const s = await deps.executors.runQaSession(String(stage.config.goal ?? ''));
        qaSessions.push(s);
        status = s.outcome === 'pass' ? 'pass' : s.outcome === 'error' ? 'error' : 'fail';
        summary = `${s.passed}/${s.executed} tasks — ${s.bugs.length} bug(s)`;
        metrics = s.metrics;
      } else {
        const out = await deps.executors.runLab((stage.config.labConfig as LabRunConfig) ?? {});
        labOutputs.push(out);
        status = out.report.verdict === 'pass' ? 'pass' : out.report.verdict === 'warn' ? 'warn' : 'fail';
        summary = out.report.summary;
        metrics = out.metrics;
      }
    } catch (err) {
      status = 'error';
      summary = err instanceof Error ? err.message : String(err);
    }

    // An optional stage's failure degrades to a warning rather than failing the run.
    if (stage.optional && (status === 'fail' || status === 'error')) status = 'warn';

    stages.push({ id: stage.id, name: stage.name, kind: stage.kind, status, durationMs: deps.now() - t0, summary, metrics });
  }

  return { stages, labOutputs, qaSessions, scenario };
}
