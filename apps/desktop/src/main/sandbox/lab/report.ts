/**
 * AI Sandbox — Performance & Security Lab (S5): enterprise reports.
 *
 * Builds the {@link LabReport} (verdict via the shared `labVerdict`) and serializes it to
 * JSON, HTML, CSV, and JUnit XML (Step 10). Reuses the S3 exporter PATTERN; adds CSV. PDF
 * is deferred to whatever the platform's report system supports (see Known Limitations).
 */
import {
  labVerdict,
  recoveryRatePct,
  scenarioSuccessPct,
  type BenchmarkComparison,
  type ChaosResult,
  type LabReport,
  type LoadResult,
  type PerfProfileResult,
  type RecoveryResult,
  type SecurityResult,
  type StressResult,
} from '@neuropause/shared';

export interface LabReportInput {
  id: string;
  title: string;
  generatedAt: string;
  performance: PerfProfileResult[];
  load: LoadResult[];
  stress: StressResult[];
  chaos: ChaosResult[];
  security: SecurityResult[];
  recovery: RecoveryResult[];
  benchmarks: BenchmarkComparison[];
}

export function buildLabReport(input: LabReportInput): LabReport {
  const verdict = labVerdict(input);
  const recommendations = recommend(input);
  const success = scenarioSuccessPct(input.performance);
  const recovery = recoveryRatePct(input.recovery, input.chaos);
  const securityFailures = input.security.filter((s) => !s.passed).length;
  return {
    id: input.id,
    title: input.title,
    generatedAt: input.generatedAt,
    verdict,
    performance: input.performance,
    load: input.load,
    stress: input.stress,
    chaos: input.chaos,
    security: input.security,
    recovery: input.recovery,
    benchmarks: input.benchmarks,
    recommendations,
    summary: `Verdict ${verdict.toUpperCase()} — ${success}% scenario success, ${recovery}% recovery, ${securityFailures} security failure(s), ${input.benchmarks.filter((b) => b.trend === 'regressed').length} regression(s).`,
  };
}

function recommend(input: LabReportInput): string[] {
  const out: string[] = [];
  const slow = input.performance.filter((p) => p.latency.p95Ms > 1000);
  if (slow.length) out.push(`Investigate p95 latency on: ${slow.map((p) => p.target).join(', ')}`);
  if (input.load.some((l) => l.failed > 0)) out.push('Some load runs failed — check per-workspace concurrency and queue backpressure.');
  if (input.load.some((l) => l.backpressure)) out.push('Backpressure engaged under load — consider raising worker concurrency or sharding workspaces.');
  const unrecovered = input.chaos.filter((c) => c.induced && !c.recovered);
  if (unrecovered.length) out.push(`Chaos faults not contained: ${unrecovered.map((c) => c.fault).join(', ')} — review recovery paths.`);
  const secFail = input.security.filter((s) => !s.passed);
  if (secFail.length) out.push(`SECURITY: controls not enforced: ${secFail.map((s) => s.kind).join(', ')} — must fix before release.`);
  if (input.recovery.some((r) => !r.recovered)) out.push('Some recovery mechanisms did not engage — verify retry/rollback policies.');
  const regressed = input.benchmarks.filter((b) => b.trend === 'regressed');
  if (regressed.length) out.push(`Performance regressions vs baseline: ${regressed.map((b) => `${b.metric} +${b.deltaPct}%`).join(', ')}`);
  if (!out.length) out.push('All validation dimensions within thresholds — no action required.');
  return out;
}

/* ── exporters ── */
export function labReportToJson(report: LabReport): string {
  return JSON.stringify(report, null, 2);
}

export function labReportToCsv(report: LabReport): string {
  const rows: string[] = ['section,id,metric,value,status'];
  for (const p of report.performance) rows.push(`performance,${p.id},p95Ms,${p.latency.p95Ms},${p.passed}/${p.runs}`);
  for (const l of report.load) rows.push(`load,${l.id},throughputPerSec,${l.throughputPerSec},${l.completed}/${l.total}`);
  for (const s of report.stress) rows.push(`stress,${s.id},latencyMs,${s.latencyMs},deg${s.degradationPct}%`);
  for (const c of report.chaos) rows.push(`chaos,${c.id},recovered,${c.recovered ? 1 : 0},${c.failureClass}`);
  for (const s of report.security) rows.push(`security,${s.id},passed,${s.passed ? 1 : 0},${s.kind}`);
  for (const r of report.recovery) rows.push(`recovery,${r.id},recovered,${r.recovered ? 1 : 0},${r.recoveryMs}ms`);
  for (const b of report.benchmarks) rows.push(`benchmark,${b.id},deltaPct,${b.deltaPct},${b.trend}`);
  return rows.join('\n');
}

export function labReportToJUnitXml(report: LabReport): string {
  const cases: string[] = [];
  const tc = (suite: string, name: string, ok: boolean, detail: string): void => {
    cases.push(ok
      ? `    <testcase classname="${xml(suite)}" name="${xml(name)}"/>`
      : `    <testcase classname="${xml(suite)}" name="${xml(name)}">\n      <failure message="${xml(detail)}"/>\n    </testcase>`);
  };
  for (const p of report.performance) tc('performance', p.id, p.passed === p.runs, `${p.passed}/${p.runs} passed`);
  for (const l of report.load) tc('load', l.id, l.failed === 0, `${l.failed} failed`);
  for (const c of report.chaos) tc('chaos', c.id, !c.induced || c.recovered, `not contained (${c.failureClass})`);
  for (const s of report.security) tc('security', s.id, s.passed, s.detail);
  for (const r of report.recovery) tc('recovery', r.id, r.recovered, 'did not recover');
  const failures = cases.filter((c) => c.includes('<failure')).length;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="${xml(report.title)}" tests="${cases.length}" failures="${failures}">`,
    `  <testsuite name="lab" tests="${cases.length}" failures="${failures}">`,
    cases.join('\n'),
    `  </testsuite>`,
    `</testsuites>`,
  ].join('\n');
}

export function labReportToHtml(report: LabReport): string {
  const color = report.verdict === 'pass' ? '#0a7d33' : report.verdict === 'warn' ? '#8a6d00' : '#a01212';
  const perfRows = report.performance.map((p) => `<tr><td>${esc(p.target)}</td><td>${p.passed}/${p.runs}</td><td>${p.latency.p50Ms}ms</td><td>${p.latency.p95Ms}ms</td><td>${p.p99Ms}ms</td><td>${p.throughputPerSec}/s</td></tr>`).join('');
  const loadRows = report.load.map((l) => `<tr><td>${esc(l.dimension)}</td><td>${l.concurrency}×${l.total}</td><td>${l.completed}/${l.total}</td><td>${l.latency.p95Ms}ms</td><td>${l.throughputPerSec}/s</td><td>${l.backpressure ? 'yes' : 'no'}</td></tr>`).join('');
  const chaosRows = report.chaos.map((c) => `<tr><td>${esc(c.fault)}</td><td>${c.mode}</td><td style="color:${c.recovered ? '#0a7d33' : '#a01212'}">${c.recovered ? 'contained' : 'NOT contained'}</td><td>${esc(c.failureClass)}</td><td>${esc(c.healthLevelAfter)}</td></tr>`).join('');
  const secRows = report.security.map((s) => `<tr><td>${esc(s.kind)}</td><td style="color:${s.passed ? '#0a7d33' : '#a01212'}">${s.passed ? 'enforced' : 'FAILED'}</td><td>${esc(s.detail)}</td></tr>`).join('');
  const recRows = report.recovery.map((r) => `<tr><td>${esc(r.kind)}</td><td style="color:${r.recovered ? '#0a7d33' : '#a01212'}">${r.recovered ? 'ok' : 'no'}</td><td>${r.recoveryMs}ms</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a}
h1{font-size:20px}h3{margin-top:20px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
th,td{border:1px solid #e2e2e2;padding:5px 8px;text-align:left}th{background:#f6f6f6}
.badge{display:inline-block;padding:2px 12px;border-radius:10px;color:#fff;background:${color};font-weight:600}</style></head>
<body>
<h1>${esc(report.title)} <span class="badge">${report.verdict.toUpperCase()}</span></h1>
<div style="color:#555">${esc(report.summary)} · ${esc(report.generatedAt)}</div>
<h3>Performance</h3><table><thead><tr><th>Target</th><th>Passed</th><th>p50</th><th>p95</th><th>p99</th><th>Throughput</th></tr></thead><tbody>${perfRows}</tbody></table>
<h3>Load</h3><table><thead><tr><th>Dimension</th><th>Plan</th><th>Completed</th><th>p95</th><th>Throughput</th><th>Backpressure</th></tr></thead><tbody>${loadRows}</tbody></table>
<h3>Chaos</h3><table><thead><tr><th>Fault</th><th>Mode</th><th>Result</th><th>Class</th><th>Health after</th></tr></thead><tbody>${chaosRows}</tbody></table>
<h3>Security</h3><table><thead><tr><th>Control</th><th>Status</th><th>Detail</th></tr></thead><tbody>${secRows}</tbody></table>
<h3>Recovery</h3><table><thead><tr><th>Mechanism</th><th>Recovered</th><th>Latency</th></tr></thead><tbody>${recRows}</tbody></table>
<h3>Recommendations</h3><ul>${report.recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
</body></html>`;
}

function xml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
