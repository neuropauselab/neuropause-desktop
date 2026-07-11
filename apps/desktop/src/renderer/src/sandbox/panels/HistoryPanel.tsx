/** Sandbox › History — validation-run history + raw execution history. */
import { useState } from 'react';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { OpsTable } from '@renderer/operations/primitives';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { certMeta, execStatusMeta, formatDuration, pipelineLabel, relativeTime, runStatusMeta } from '@renderer/sandbox/sandboxModel';
import { Pill, RunDetailDrawer, SectionCard } from './shared';

export function HistoryPanel(): JSX.Element {
  const { validation, history, historyTotal, runDetail, loadRunDetail, searchQuery } = useSandbox();
  const [drawer, setDrawer] = useState(false);
  const nowMs = Date.now();
  const q = searchQuery.toLowerCase();

  const runs = (validation?.history ?? []).filter((h) => !q || h.pipeline.includes(q) || h.status.includes(q));
  const execs = history.filter((e) => !q || e.scenarioId.toLowerCase().includes(q) || e.status.includes(q));

  const openRun = async (runId: string): Promise<void> => {
    await loadRunDetail(runId);
    setDrawer(true);
  };

  return (
    <div>
      <SectionCard title="Validation runs" subtitle={`${runs.length}`} icon="beaker" tint="accent">
        {runs.length === 0 ? (
          <EmptyState icon="beaker" title="No validation runs" compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-3 py-2">Pipeline</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Cert</th>
                <th className="px-3 py-2">Passed</th>
                <th className="px-3 py-2">When</th>
              </>
            }
          >
            {runs.map((h) => (
              <tr key={h.runId} className="cursor-pointer border-t border-[var(--hairline)] transition fill-hover" onClick={() => void openRun(h.runId)}>
                <td className="px-3 py-2 text-sm font-medium">{pipelineLabel(h.pipeline)}</td>
                <td className="px-3 py-2"><Pill tone={runStatusMeta(h.status).tone} label={runStatusMeta(h.status).label} /></td>
                <td className="px-3 py-2">{h.level ? <Pill tone={certMeta(h.level).tone} label={certMeta(h.level).label} subtle /> : <span className="text-2xs text-faint">—</span>}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{h.passed}/{h.passed + h.failed}</td>
                <td className="px-3 py-2 text-2xs text-faint">{relativeTime(h.at, nowMs)}</td>
              </tr>
            ))}
          </OpsTable>
        )}
      </SectionCard>

      <SectionCard title="Executions" subtitle={`${execs.length} of ${historyTotal}`} icon="activity" tint="blue">
        {execs.length === 0 ? (
          <EmptyState icon="activity" title="No executions" compact />
        ) : (
          <OpsTable
            head={
              <>
                <th className="px-3 py-2">Scenario</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">When</th>
              </>
            }
          >
            {execs.map((e) => (
              <tr key={e.id} className="border-t border-[var(--hairline)]">
                <td className="px-3 py-2 text-sm font-medium">{e.scenarioId}<span className="ml-1.5 text-2xs text-faint">v{e.scenarioVersion}</span></td>
                <td className="px-3 py-2"><Pill tone={execStatusMeta(e.status).tone} label={execStatusMeta(e.status).label} /></td>
                <td className="px-3 py-2 text-xs text-muted">{e.trigger}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{formatDuration(e.durationMs)}</td>
                <td className="px-3 py-2 text-2xs text-faint">{relativeTime(e.queuedAt, nowMs)}</td>
              </tr>
            ))}
          </OpsTable>
        )}
      </SectionCard>

      <RunDetailDrawer detail={runDetail} open={drawer} onClose={() => setDrawer(false)} nowMs={nowMs} />
    </div>
  );
}
