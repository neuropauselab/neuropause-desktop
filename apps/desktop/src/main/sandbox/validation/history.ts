/**
 * AI Sandbox — Continuous Validation Platform (S6): historical intelligence.
 *
 * REUSES the existing memory (never a new store) to track recurring failures, known issues,
 * recovered issues, and certification history — written as explicit `validation`-tagged
 * notes and recalled by tag. Pure over the injected {@link HistoryPort}.
 */
import type { PipelineKind, ValidationRun } from '@neuropause/shared';
import type { HistoryPort } from './ports';

export function recordHistory(run: ValidationRun, history: HistoryPort | undefined): void {
  if (!history) return;
  const failing = run.stages.filter((s) => s.status === 'fail' || s.status === 'error');
  history.remember({
    title: `Validation ${run.pipeline} ${run.status}`,
    content: `Pipeline ${run.pipeline} (${run.trigger}) ${run.status} — ${run.stages.length} stage(s), ${failing.length} failing, ${run.regressionCount} regression(s)${run.certificationLevel ? `, certification ${run.certificationLevel}` : ''}.`,
    tags: ['validation', run.pipeline, run.status, ...(run.certificationLevel ? [`cert-${run.certificationLevel}`] : [])],
    metadata: { pipeline: run.pipeline, status: run.status, regressions: run.regressionCount, durationMs: run.durationMs, ...(run.certificationLevel ? { certification: run.certificationLevel } : {}) },
  });
  for (const f of failing) {
    history.remember({
      title: `Validation failure: ${f.name}`,
      content: f.summary,
      tags: ['validation', 'failure', run.pipeline],
      metadata: { stage: f.id, status: f.status, pipeline: run.pipeline },
    });
  }
}

export function recurringFailures(history: HistoryPort | undefined, pipeline?: PipelineKind): { title: string; content: string }[] {
  if (!history) return [];
  return history.recall({ tag: 'failure', text: pipeline, limit: 25 });
}

export function certificationHistory(history: HistoryPort | undefined): { title: string; content: string }[] {
  if (!history) return [];
  return history.recall({ tag: 'validation', text: 'certification', limit: 25 });
}
