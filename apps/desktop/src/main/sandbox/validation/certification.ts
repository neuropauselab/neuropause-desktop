/**
 * AI Sandbox — Continuous Validation Platform (S6): release certification.
 *
 * Composes an enterprise certification report (Step 7) from a real pipeline run — build
 * status, scenario/AI-QA/performance/security/recovery/benchmark results, regression
 * summary, executive KPIs, and diagnostics — with an overall Pass/Warning/Fail via the
 * shared `certifyLevel`. Serializes to JSON, HTML, and Markdown (reusing the S5 exporter
 * pattern). Everything comes from real execution.
 */
import { randomUUID } from 'node:crypto';
import { certifyLevel, type CertificationReport, type PipelineKind, type QaSessionResult, type RegressionAnalysis, type StageResult } from '@neuropause/shared';
import type { LabRunOutput } from '../lab';

export interface CertifyInput {
  pipeline: PipelineKind;
  version: string;
  generatedAt: string;
  stages: StageResult[];
  regression: RegressionAnalysis;
  scenario: { total: number; passed: number; failed: number };
  qaSessions: QaSessionResult[];
  labOutputs: LabRunOutput[];
  kpis: { key: string; value: number | null }[];
  health: { level: string; cpuPercent: number; memoryUsedMb: number } | null;
  buildStatus: string;
}

export function buildCertification(input: CertifyInput): CertificationReport {
  const securityFailures = input.labOutputs.reduce((n, o) => n + o.report.security.filter((s) => !s.passed).length, 0);
  const level = certifyLevel({ stages: input.stages, regression: input.regression, securityFailures });
  const latencyP95Ms = input.labOutputs.length ? Math.max(0, ...input.labOutputs.map((o) => o.dashboard.latencyP95Ms)) : 0;
  const throughputPerSec = input.labOutputs.length ? Math.max(0, ...input.labOutputs.map((o) => o.dashboard.throughputPerSec)) : 0;
  const recoveryRate = input.labOutputs.length ? Math.round(input.labOutputs.reduce((s, o) => s + o.dashboard.recoveryRatePct, 0) / input.labOutputs.length) : 100;
  const securityChecks = input.labOutputs.reduce((n, o) => n + o.report.security.length, 0);
  const benchmarksCompared = input.labOutputs.reduce((n, o) => n + o.report.benchmarks.length, 0);
  const benchmarksRegressed = input.labOutputs.reduce((n, o) => n + o.report.benchmarks.filter((b) => b.trend === 'regressed').length, 0);
  const aiQaBugs = input.qaSessions.reduce((n, s) => n + s.bugs.length, 0);

  return {
    id: `cert_${randomUUID()}`,
    pipeline: input.pipeline,
    level,
    generatedAt: input.generatedAt,
    buildStatus: input.buildStatus,
    scenarioResults: input.scenario,
    aiQaResults: { sessions: input.qaSessions.length, bugs: aiQaBugs },
    performance: { latencyP95Ms, throughputPerSec },
    security: { checks: securityChecks, failures: securityFailures },
    recovery: { rate: recoveryRate },
    benchmarks: { compared: benchmarksCompared, regressed: benchmarksRegressed },
    regressionSummary: input.regression.summary,
    kpis: input.kpis.slice(0, 12),
    diagnostics: input.health ?? { level: 'unknown', cpuPercent: 0, memoryUsedMb: 0 },
    summary: `Certification ${level.toUpperCase()} for ${input.pipeline} — ${input.scenario.passed}/${input.scenario.total} scenarios, ${securityFailures} security failure(s), ${input.regression.findings.length} regression(s).`,
  };
}

/* ── exporters ── */
export function certificationToJson(report: CertificationReport): string {
  return JSON.stringify(report, null, 2);
}

export function certificationToMarkdown(report: CertificationReport): string {
  return [
    `# Release Certification — ${report.pipeline}`,
    '',
    `**Overall: ${report.level.toUpperCase()}** · ${report.generatedAt}`,
    '',
    report.summary,
    '',
    `## Results`,
    `- Build: ${report.buildStatus}`,
    `- Scenarios: ${report.scenarioResults.passed}/${report.scenarioResults.total} passed (${report.scenarioResults.failed} failed)`,
    `- AI QA: ${report.aiQaResults.sessions} session(s), ${report.aiQaResults.bugs} bug(s)`,
    `- Performance: p95 ${report.performance.latencyP95Ms}ms, ${report.performance.throughputPerSec}/s`,
    `- Security: ${report.security.checks} checks, ${report.security.failures} failure(s)`,
    `- Recovery: ${report.recovery.rate}%`,
    `- Benchmarks: ${report.benchmarks.compared} compared, ${report.benchmarks.regressed} regressed`,
    `- Regressions: ${report.regressionSummary}`,
    '',
    `## Executive KPIs`,
    ...report.kpis.map((k) => `- ${k.key}: ${k.value ?? 'n/a'}`),
    '',
    `## Diagnostics`,
    `- Health: ${report.diagnostics.level} · CPU ${Math.round(report.diagnostics.cpuPercent)}% · Mem ${Math.round(report.diagnostics.memoryUsedMb)}MB`,
  ].join('\n');
}

export function certificationToHtml(report: CertificationReport): string {
  const color = report.level === 'pass' ? '#0a7d33' : report.level === 'warning' ? '#8a6d00' : '#a01212';
  const row = (k: string, v: string): string => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certification — ${esc(report.pipeline)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a;max-width:820px}
h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}
td{border:1px solid #e2e2e2;padding:6px 8px}.badge{display:inline-block;padding:2px 12px;border-radius:10px;color:#fff;background:${color};font-weight:600}</style></head>
<body>
<h1>Release Certification — ${esc(report.pipeline)} <span class="badge">${report.level.toUpperCase()}</span></h1>
<div style="color:#555">${esc(report.summary)} · ${esc(report.generatedAt)}</div>
<table>
${row('Build', report.buildStatus)}
${row('Scenarios', `${report.scenarioResults.passed}/${report.scenarioResults.total} passed`)}
${row('AI QA', `${report.aiQaResults.sessions} session(s), ${report.aiQaResults.bugs} bug(s)`)}
${row('Performance', `p95 ${report.performance.latencyP95Ms}ms · ${report.performance.throughputPerSec}/s`)}
${row('Security', `${report.security.checks} checks, ${report.security.failures} failure(s)`)}
${row('Recovery', `${report.recovery.rate}%`)}
${row('Benchmarks', `${report.benchmarks.compared} compared, ${report.benchmarks.regressed} regressed`)}
${row('Regressions', report.regressionSummary)}
${row('Diagnostics', `${report.diagnostics.level} · CPU ${Math.round(report.diagnostics.cpuPercent)}% · Mem ${Math.round(report.diagnostics.memoryUsedMb)}MB`)}
</table>
<h3>Executive KPIs</h3><ul>${report.kpis.map((k) => `<li>${esc(k.key)}: ${k.value ?? 'n/a'}</li>`).join('')}</ul>
</body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
