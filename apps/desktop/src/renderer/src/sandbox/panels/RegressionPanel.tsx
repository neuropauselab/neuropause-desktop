/** Sandbox › Regression — the Regression Center: findings vs baseline for the current run. */
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsTable } from '@renderer/operations/primitives';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { pipelineLabel, severityMeta } from '@renderer/sandbox/sandboxModel';
import { Metric, Pill, SectionCard } from './shared';

export function RegressionPanel(): JSX.Element {
  const { runDetail } = useSandbox();
  const regression = runDetail?.regression ?? null;
  const run = runDetail?.run ?? null;

  if (!run) {
    return <EmptyState icon="pulse" title="No run selected" description="Open a run from Validation or History to inspect its regression analysis." />;
  }

  const worst = regression ? severityMeta(regression.worst) : null;

  return (
    <div>
      <SectionCard
        title="Regression analysis"
        subtitle={`${pipelineLabel(run.pipeline)}`}
        icon="pulse"
        tint={regression?.regressed ? 'orange' : 'green'}
        action={worst && regression?.regressed ? <Pill tone={worst.tone} label={`worst: ${worst.label}`} /> : <Pill tone="green" label="No regression" subtle />}
      >
        {!regression ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Metric label="Regressions" value={run.regressionCount} tone={run.regressionCount ? 'orange' : 'green'} />
            <Metric label="Status" value={run.status} />
            <Metric label="Detail" value="not captured" caption="run a fresh pipeline for full analysis" />
          </div>
        ) : regression.findings.length === 0 ? (
          <EmptyState icon="shield" title="No regressions vs baseline" description={regression.summary} compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-3 py-2">Metric</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Baseline</th>
                <th className="px-3 py-2">Current</th>
                <th className="px-3 py-2">Δ</th>
                <th className="px-3 py-2">Severity</th>
              </>
            }
          >
            {regression.findings.map((f, i) => {
              const m = severityMeta(f.severity);
              return (
                <tr key={`${f.metric}-${i}`} className="border-t border-[var(--hairline)]">
                  <td className="px-3 py-2">
                    <div className="text-sm font-medium">{f.metric}</div>
                    {f.detail && <div className="text-2xs text-faint">{f.detail}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{f.kind}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{f.baseline ?? '—'}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{f.current}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{f.deltaPct > 0 ? '+' : ''}{f.deltaPct}%</td>
                  <td className="px-3 py-2"><Pill tone={m.tone} label={m.label} /></td>
                </tr>
              );
            })}
          </OpsTable>
        )}
        {regression?.summary && regression.findings.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-muted">{regression.summary}</p>
        )}
      </SectionCard>
    </div>
  );
}
