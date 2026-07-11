/** Sandbox › Artifacts — the Artifact Explorer: browse an execution's artifacts, result, report, timeline. */
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { formatBytes } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { execStatusMeta, formatDuration, reasoningSummary, relativeTime } from '@renderer/sandbox/sandboxModel';
import { Drawer, Metric, Pill, SectionCard } from './shared';

const KIND_ICON: Record<string, IconName> = {
  screenshot: 'image',
  video: 'camera',
  log: 'list',
  report: 'doc',
  result: 'checklist',
  trace: 'activity',
  other: 'folder',
};

export function ArtifactsPanel(): JSX.Element {
  const { dashboard, history, execDetail, selectedExecutionId, selectExecution, clearExecution, generateReport } = useSandbox();
  const nowMs = Date.now();
  const byKind = dashboard?.artifacts.byKind ?? {};
  const kinds = Object.keys(byKind);

  return (
    <div>
      <SectionCard title="Artifacts" subtitle={`${dashboard?.artifacts.total ?? 0} total`} icon="folder" tint="purple">
        {kinds.length === 0 ? (
          <EmptyState icon="folder" title="No artifacts yet" description="Executions produce screenshots, logs, traces, results, and reports as they run." compact />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {kinds.map((k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg [background:var(--fill-2)]">
                  <Icon name={KIND_ICON[k] ?? 'folder'} size={15} />
                </span>
                <div>
                  <div className="text-lg font-semibold leading-none">{byKind[k]}</div>
                  <div className="text-2xs capitalize text-faint">{k}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Executions" subtitle="select to explore" icon="activity" tint="accent">
        {history.length === 0 ? (
          <EmptyState icon="activity" title="No executions" compact />
        ) : (
          <div className="space-y-1">
            {history.slice(0, 20).map((e) => {
              const m = execStatusMeta(e.status);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => void selectExecution(e.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition fill-hover"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon name="activity" size={14} className="shrink-0 text-faint" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{e.scenarioId}</div>
                      <div className="text-2xs text-faint">v{e.scenarioVersion} · {e.trigger} · {relativeTime(e.queuedAt, nowMs)}</div>
                    </div>
                  </div>
                  <Pill tone={m.tone} label={m.label} />
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      <Drawer
        open={selectedExecutionId !== null}
        title="Execution"
        subtitle={execDetail ? `${execDetail.execution.scenarioId} · v${execDetail.execution.scenarioVersion}` : undefined}
        onClose={clearExecution}
        width={620}
      >
        {!execDetail ? (
          <div className="py-8 text-center text-sm text-faint">Loading…</div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Pill tone={execStatusMeta(execDetail.execution.status).tone} label={execStatusMeta(execDetail.execution.status).label} />
              <span className="text-2xs text-faint">{formatDuration(execDetail.execution.durationMs)}</span>
            </div>

            {execDetail.result && (
              <div className="mb-4">
                <div className="mb-2 text-sm font-semibold">Result</div>
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Outcome" value={execDetail.result.outcome} tone={execDetail.result.outcome === 'pass' ? 'green' : execDetail.result.outcome === 'fail' ? 'orange' : 'red'} />
                  <Metric label="Assertions" value={`${execDetail.result.assertions.passed}/${execDetail.result.assertions.total}`} />
                  <Metric label="Failed" value={execDetail.result.assertions.failed} tone={execDetail.result.assertions.failed ? 'red' : 'green'} />
                </div>
                {execDetail.result.summary && <p className="mt-2 text-xs leading-relaxed text-muted">{reasoningSummary(execDetail.result.summary)}</p>}
              </div>
            )}

            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Report</span>
                {!execDetail.report && (
                  <Button size="sm" variant="ghost" icon="doc" onClick={() => void generateReport(execDetail.execution.id)}>Generate</Button>
                )}
              </div>
              {execDetail.report ? (
                <div className="rounded-lg border border-[var(--hairline)] px-3 py-2.5">
                  <div className="text-sm font-medium">{execDetail.report.title}</div>
                  <p className="mt-1 text-2xs text-faint">{execDetail.report.summary}</p>
                  {execDetail.report.sections.slice(0, 4).map((sec, i) => (
                    <div key={i} className="mt-2 border-t border-[var(--hairline)] pt-2">
                      <div className="text-2xs font-semibold uppercase tracking-wider text-faint">{sec.heading}</div>
                      <p className="mt-0.5 text-xs text-muted">{sec.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-2xs text-faint">No report generated yet.</p>
              )}
            </div>

            <div className="mb-4">
              <div className="mb-2 text-sm font-semibold">Artifacts · {execDetail.artifacts.length}</div>
              {execDetail.artifacts.length === 0 ? (
                <p className="text-2xs text-faint">No artifacts captured.</p>
              ) : (
                <div className="space-y-1">
                  {execDetail.artifacts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--hairline)] px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon name={KIND_ICON[a.kind] ?? 'folder'} size={13} className="shrink-0 text-faint" />
                        <span className="truncate text-xs">{a.name}</span>
                      </div>
                      <span className="shrink-0 text-2xs text-faint">{formatBytes(a.sizeBytes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {execDetail.timeline.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-semibold">Timeline</div>
                <div className="space-y-1">
                  {execDetail.timeline.slice(-14).map((t) => (
                    <div key={t.id} className="flex items-start gap-2 text-2xs">
                      <span className="mt-0.5 shrink-0 rounded [background:var(--fill-2)] px-1.5 py-0.5 font-mono text-faint">{t.phase}</span>
                      <span className="text-muted">{t.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
