/** Sandbox › Settings — validation schedules (opt-in), workspace configuration, safety notes. */
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Toggle } from '@renderer/components/ui/controls';
import { TEXT_TONE } from '@renderer/operations/lib';
import { useSandbox } from '@renderer/sandbox/SandboxProvider';
import { pipelineLabel, relativeTime } from '@renderer/sandbox/sandboxModel';
import { Metric, Pill, SectionCard } from './shared';

export function SettingsPanel(): JSX.Element {
  const { summary, workspaces, workspaceId, setWorkspaceId, setSchedule } = useSandbox();
  const nowMs = Date.now();
  const schedules = summary?.scheduled ?? [];
  const active = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null;

  return (
    <div>
      <SectionCard title="Validation schedules" subtitle="opt-in" icon="clock" tint="accent">
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] px-4 py-2.5">
          <Icon name="shield" size={15} className={TEXT_TONE.orange.split(' ')[0]} />
          <p className="text-2xs leading-relaxed text-muted">
            Scheduled validations run against the live platform and mutate real data, so they are <strong>off by default</strong>.
            Enable a cadence only after pointing it at a sandbox tenant.
          </p>
        </div>
        {schedules.length === 0 ? (
          <EmptyState icon="clock" title="No schedules registered" compact />
        ) : (
          <div className="space-y-1.5">
            {schedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--hairline)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{pipelineLabel(s.pipeline)}</span>
                    <Pill tone={s.enabled ? 'green' : 'gray'} label={s.enabled ? 'Enabled' : 'Off'} subtle />
                  </div>
                  <div className="text-2xs text-faint">
                    {s.nextDueLabel} · {s.trigger}
                    {s.lastRunAt ? ` · last ${relativeTime(s.lastRunAt, nowMs)}` : ''}
                  </div>
                </div>
                <Toggle checked={s.enabled} onChange={(v) => void setSchedule(s.id, v)} label={`Toggle ${s.pipeline} schedule`} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Workspace" subtitle={active ? active.name : undefined} icon="grid" tint="blue">
        {!active ? (
          <EmptyState icon="grid" title="No workspace" compact />
        ) : (
          <>
            {workspaces.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWorkspaceId(w.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${w.id === active.id ? 'surface-raised text-ink shadow-sm' : 'text-muted fill-hover hover:text-ink'}`}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Metric label="Default timeout" value={`${Math.round(active.settings.defaultTimeoutMs / 1000)}s`} />
              <Metric label="Max concurrency" value={active.settings.maxConcurrency} />
              <Metric label="Retention" value={active.settings.retentionDays ? `${active.settings.retentionDays}d` : 'keep all'} />
            </div>
            {active.description && <p className="mt-3 text-xs leading-relaxed text-muted">{active.description}</p>}
          </>
        )}
      </SectionCard>
    </div>
  );
}
