/**
 * AI Sandbox — AI QA Agent (S4): the bug report system.
 *
 * Turns a failed task's observation + reflection + reasoner narrative into a complete bug
 * report — summary, severity, priority, steps to reproduce (derived from the scenario
 * spec), artifacts/screenshots/logs, timeline, graph + memory refs, performance, suggested
 * fixes, hypotheses, confidence — and serializes it to JSON, Markdown, and HTML. Pure.
 */
import {
  priorityFromSeverity,
  severityFor,
  type QaAgentDefinition,
  type QaBugReport,
  type QaGoal,
  type QaObservation,
  type QaReflection,
  type QaTask,
  type ScenarioSpec,
} from '@neuropause/shared';
import type { QaReasonerResult } from './ports';

export interface BugReportInput {
  agent: QaAgentDefinition;
  goal: QaGoal;
  task: QaTask;
  observation: QaObservation;
  reflection: QaReflection;
  narrative: QaReasonerResult;
  memoryRefs: string[];
  createdAt: string;
  seq: number;
}

export function buildBugReport(input: BugReportInput): QaBugReport {
  const { task, observation, reflection } = input;
  const severity = severityFor(observation.outcome, reflection.failureClass, task.priority);
  const priority = priorityFromSeverity(severity);
  return {
    id: `bug-${input.seq}-${task.id}`,
    title: `${input.agent.name}: ${task.name} ${observation.outcome ?? observation.status}`,
    summary: input.narrative.text,
    severity,
    priority,
    agent: input.agent.category,
    taskId: task.id,
    stepsToReproduce: stepsFromSpec(task.spec),
    failureClass: reflection.failureClass,
    confidence: reflection.confidence,
    artifacts: observation.artifacts,
    timelinePhases: observation.timelinePhases,
    knowledgeGraphRefs: observation.knowledgeGraphRefs,
    memoryRefs: input.memoryRefs,
    performance: observation.metrics,
    suggestedFixes: reflection.recommendations,
    hypotheses: reflection.hypotheses,
    createdAt: input.createdAt,
  };
}

/** Human steps-to-reproduce derived from the scenario spec (enterprise steps or desktop actions). */
export function stepsFromSpec(spec: ScenarioSpec): string[] {
  const s = spec as { kind?: string; steps?: { name?: string; action?: string; input?: Record<string, unknown> }[]; actions?: { type?: string; selector?: string }[] };
  if (s.kind === 'desktop' && Array.isArray(s.actions)) {
    return s.actions.map((a, i) => `${i + 1}. desktop: ${a.type ?? '?'}${a.selector ? ` ${a.selector}` : ''}`);
  }
  if (Array.isArray(s.steps)) {
    return s.steps.map((step, i) => `${i + 1}. ${step.name ?? step.action ?? 'step'}${step.action ? ` (${step.action})` : ''}`);
  }
  return ['(no reproducible steps recorded)'];
}

/* ── exporters ── */
export function bugReportToJson(report: QaBugReport): string {
  return JSON.stringify(report, null, 2);
}

export function bugReportToMarkdown(report: QaBugReport): string {
  const lines = [
    `# ${report.title}`,
    '',
    `**Severity:** ${report.severity} · **Priority:** ${report.priority} · **Confidence:** ${report.confidence.toFixed(2)} · **Class:** ${report.failureClass}`,
    '',
    `## Summary`,
    report.summary || '(none)',
    '',
    `## Steps to reproduce`,
    ...report.stepsToReproduce.map((s) => `- ${s}`),
    '',
    `## Hypotheses`,
    ...report.hypotheses.map((h) => `- (${h.confidence.toFixed(2)}) ${h.cause}`),
    '',
    `## Suggested fixes`,
    ...report.suggestedFixes.map((f) => `- ${f}`),
    '',
    `## Evidence`,
    `- Timeline: ${report.timelinePhases.join(' → ') || '(none)'}`,
    `- Artifacts: ${report.artifacts.map((a) => a.name).join(', ') || '(none)'}`,
    `- Knowledge graph: ${report.knowledgeGraphRefs.join(', ') || '(none)'}`,
    `- Memory: ${report.memoryRefs.join(', ') || '(none)'}`,
    `- Performance: ${Object.entries(report.performance).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    '',
    `_Filed ${report.createdAt} by ${report.agent} QA agent._`,
  ];
  return lines.join('\n');
}

export function bugReportToHtml(report: QaBugReport): string {
  const color = report.severity === 'critical' ? '#a01212' : report.severity === 'high' ? '#b23b00' : report.severity === 'medium' ? '#8a6d00' : '#0a7d33';
  const li = (xs: string[]): string => xs.map((x) => `<li>${esc(x)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a;max-width:820px}
h1{font-size:20px}.badge{display:inline-block;padding:2px 10px;border-radius:10px;color:#fff;background:${color};font-weight:600}
code{background:#f6f6f6;padding:1px 4px;border-radius:3px}ul{margin:6px 0}</style></head>
<body>
<h1>${esc(report.title)} <span class="badge">${report.severity.toUpperCase()}</span></h1>
<div style="color:#555">Priority ${report.priority} · confidence ${report.confidence.toFixed(2)} · class ${esc(report.failureClass)} · ${esc(report.agent)}</div>
<p>${esc(report.summary || '(no summary)')}</p>
<h3>Steps to reproduce</h3><ul>${li(report.stepsToReproduce)}</ul>
<h3>Hypotheses</h3><ul>${li(report.hypotheses.map((h) => `(${h.confidence.toFixed(2)}) ${h.cause}`))}</ul>
<h3>Suggested fixes</h3><ul>${li(report.suggestedFixes)}</ul>
<h3>Evidence</h3>
<div>Timeline: <code>${esc(report.timelinePhases.join(' → ') || '(none)')}</code></div>
<div>Artifacts: ${esc(report.artifacts.map((a) => a.name).join(', ') || '(none)')}</div>
<div>Memory refs: ${esc(report.memoryRefs.join(', ') || '(none)')}</div>
<div>Performance: ${esc(Object.entries(report.performance).map(([k, v]) => `${k}=${v}`).join(', '))}</div>
<p style="color:#888;font-size:12px">Filed ${esc(report.createdAt)}</p>
</body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
