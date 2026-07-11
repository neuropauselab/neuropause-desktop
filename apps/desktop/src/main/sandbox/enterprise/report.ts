/**
 * AI Sandbox — Enterprise Scenario Runner (S3): run report + exporters.
 *
 * Builds a structured enterprise run report from the executor's step/assertion/metric
 * data and serializes it to JSON, HTML, and JUnit XML — pure functions. These ADD
 * report FORMATS; they do not replace S1's `generateReport` (which still produces the
 * canonical `SandboxReport`). The executor attaches these as S1 artifacts so they land
 * in the one artifact store. (PDF export is deferred to whatever the platform's report
 * system supports — see Known Limitations.)
 */
export interface EnterpriseStepReport {
  id: string;
  name: string;
  action: string;
  channel: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  attempts: number;
  durationMs: number;
  message?: string;
  assertions: { type: string; ok: boolean; message: string }[];
}

export interface EnterpriseRunReport {
  title: string;
  category: string;
  scenario: string;
  outcome: 'pass' | 'fail' | 'error';
  startedAt: string;
  durationMs: number;
  steps: EnterpriseStepReport[];
  assertions: { total: number; passed: number; failed: number };
  metrics: Record<string, number>;
  changes: { recordsCreated: number; timelineEvents: number; connectorSyncs: number };
  summary: string;
}

export function reportToJson(report: EnterpriseRunReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToJUnitXml(report: EnterpriseRunReport): string {
  const failures = report.steps.filter((s) => s.status === 'failed' || s.status === 'error').length;
  const skipped = report.steps.filter((s) => s.status === 'skipped').length;
  const cases = report.steps
    .map((s) => {
      const time = (s.durationMs / 1000).toFixed(3);
      const inner: string[] = [];
      if (s.status === 'skipped') inner.push(`      <skipped/>`);
      if (s.status === 'failed' || s.status === 'error') {
        const detail = [s.message, ...s.assertions.filter((a) => !a.ok).map((a) => a.message)].filter(Boolean).join('; ');
        inner.push(`      <failure type="${s.status}" message="${xml(detail)}"/>`);
      }
      const body = inner.length ? `\n${inner.join('\n')}\n    ` : '';
      return `    <testcase classname="${xml(report.scenario)}" name="${xml(s.name || s.id)}" time="${time}">${body}</testcase>`;
    })
    .join('\n');
  const totalTime = (report.durationMs / 1000).toFixed(3);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="${xml(report.title)}" tests="${report.steps.length}" failures="${failures}" skipped="${skipped}" time="${totalTime}">`,
    `  <testsuite name="${xml(report.scenario)}" tests="${report.steps.length}" failures="${failures}" skipped="${skipped}" time="${totalTime}">`,
    cases,
    `  </testsuite>`,
    `</testsuites>`,
  ].join('\n');
}

export function reportToHtml(report: EnterpriseRunReport): string {
  const badge = report.outcome === 'pass' ? '#0a7d33' : report.outcome === 'fail' ? '#b23b00' : '#a01212';
  const rows = report.steps
    .map((s) => {
      const color = s.status === 'passed' ? '#0a7d33' : s.status === 'skipped' ? '#8a6d00' : '#a01212';
      const asserts = s.assertions.map((a) => `<div style="color:${a.ok ? '#0a7d33' : '#a01212'}">${a.ok ? '✓' : '✗'} ${esc(a.message)}</div>`).join('');
      return `<tr>
        <td>${esc(s.name || s.id)}</td>
        <td><code>${esc(s.action)}</code></td>
        <td>${esc(s.channel)}</td>
        <td style="color:${color};font-weight:600">${s.status}</td>
        <td style="text-align:right">${s.durationMs}ms</td>
        <td>${asserts || '—'}${s.message ? `<div style="color:#a01212">${esc(s.message)}</div>` : ''}</td>
      </tr>`;
    })
    .join('');
  const metrics = Object.entries(report.metrics)
    .map(([k, v]) => `<span style="display:inline-block;margin:2px 10px 2px 0"><b>${esc(k)}</b>: ${v}</span>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a}
h1{font-size:20px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:13px}
th,td{border:1px solid #e2e2e2;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f6f6f6}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;color:#fff;font-weight:600;background:${badge}}</style></head>
<body>
<h1>${esc(report.title)} <span class="badge">${report.outcome.toUpperCase()}</span></h1>
<div style="color:#555">${esc(report.category)} · ${esc(report.scenario)} · ${report.durationMs}ms · started ${esc(report.startedAt)}</div>
<p>${esc(report.summary)}</p>
<div><b>Assertions:</b> ${report.assertions.passed}/${report.assertions.total} passed &nbsp; <b>Changes:</b> ${report.changes.recordsCreated} records, ${report.changes.timelineEvents} timeline events, ${report.changes.connectorSyncs} connector syncs</div>
<div style="margin-top:10px">${metrics}</div>
<table><thead><tr><th>Step</th><th>Action</th><th>Channel</th><th>Status</th><th>Duration</th><th>Assertions / Detail</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

function xml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
