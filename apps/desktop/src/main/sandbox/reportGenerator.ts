/**
 * AI Sandbox — Report generator (S1). Pure: turns a finished execution plus its
 * result, artifacts, and timeline into a structured {@link SandboxReport}. It reads
 * only what the stores already hold — it runs nothing and captures nothing — so it
 * is deterministic and unit-tested directly. Later stages enrich the same report
 * shape without changing this contract.
 */
import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  Execution,
  ExecutionTimelineEntry,
  ReportSection,
  RunResult,
  SandboxReport,
  Scenario,
} from '@neuropause/shared';

export interface GenerateReportInput {
  execution: Execution;
  scenario: Scenario;
  result: RunResult | null;
  artifacts: readonly Artifact[];
  timeline: readonly ExecutionTimelineEntry[];
  now: () => number;
}

export function generateReport(input: GenerateReportInput): SandboxReport {
  const { execution, scenario, result, artifacts, timeline } = input;

  const overview: ReportSection = {
    heading: 'Overview',
    body: `Scenario “${scenario.name}” (v${execution.scenarioVersion}) ${describeStatus(execution.status)}.`,
    items: [
      `Status: ${execution.status}`,
      `Trigger: ${execution.trigger}`,
      `Priority: ${execution.priority}`,
      `Duration: ${execution.durationMs ?? 0}ms`,
      ...(execution.error ? [`Error: ${execution.error}`] : []),
    ],
  };

  const resultSection: ReportSection = {
    heading: 'Result',
    body: result ? result.summary : 'No result was recorded for this execution.',
    items: result
      ? [
          `Outcome: ${result.outcome}`,
          `Assertions: ${result.assertions.passed}/${result.assertions.total} passed`,
          ...Object.entries(result.metrics).map(([k, v]) => `${k}: ${v}`),
        ]
      : [],
  };

  const byKind = new Map<string, number>();
  for (const a of artifacts) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  const artifactsSection: ReportSection = {
    heading: 'Artifacts',
    body: artifacts.length ? `${artifacts.length} artifact(s) captured.` : 'No artifacts were captured.',
    items: [...byKind.entries()].map(([kind, n]) => `${kind}: ${n}`),
  };

  const errors = timeline.filter((t) => t.level === 'error').length;
  const timelineSection: ReportSection = {
    heading: 'Timeline',
    body: `${timeline.length} timeline event(s)${errors ? `, ${errors} error(s)` : ''}.`,
    items: timeline
      .filter((t) => t.phase !== 'log')
      .slice(-12)
      .map((t) => `${t.at} · ${t.phase} · ${t.message}`),
  };

  return {
    id: `sbr_${randomUUID()}`,
    executionId: execution.id,
    scenarioId: scenario.id,
    workspaceId: execution.workspaceId,
    title: `${scenario.name} — run report`,
    status: execution.status,
    summary: result
      ? result.summary
      : `${scenario.name} ${describeStatus(execution.status)} in ${execution.durationMs ?? 0}ms.`,
    sections: [overview, resultSection, artifactsSection, timelineSection],
    generatedAt: new Date(input.now()).toISOString(),
  };
}

function describeStatus(status: Execution['status']): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'error':
      return 'errored';
    case 'cancelled':
      return 'was cancelled';
    case 'timed_out':
      return 'timed out';
    default:
      return `is ${status}`;
  }
}
