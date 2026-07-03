import { useState } from 'react';
import type { WorkerSkill, WorkflowSpec } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat } from '@renderer/operations/primitives';
import { WorkerGlyph } from '@renderer/workforce/primitives';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { useEnterprise } from './EnterpriseProvider';
import {
  formatPct,
  relativeTime,
  titleCase,
  riskLevelMeta,
  TINT_TONE,
  type EnterpriseTab,
} from './lib';

type Banner = { tone: 'green' | 'orange'; text: string } | null;

export function ExecutiveWorkspacePanel({ onNavigate }: { onNavigate: (tab: EnterpriseTab) => void }): JSX.Element {
  const { snapshot, workers, jobs, recommendations, audit, delegate, runWorkflow } = useEnterprise();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skills, setSkills] = useState<WorkerSkill[]>([]);
  const [skillId, setSkillId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const selectWorker = async (id: string): Promise<void> => {
    setSelectedId(id);
    setSkillId('');
    setSkills([]);
    const w = await ipc.workforce.worker(id);
    if (w) {
      setSkills(w.skills);
      setSkillId(w.skills[0]?.id ?? '');
    }
  };

  const selectedWorker = workers.find((w) => w.id === selectedId) ?? null;
  const selectedSkill = skills.find((s) => s.id === skillId) ?? null;

  const pending = jobs.reduce((n, j) => n + (j.status === 'awaiting_approval' ? j.proposals.filter((p) => p.verdict.decision === 'require_approval' && !p.approval).length : 0), 0);

  const doDelegate = async (): Promise<void> => {
    if (!selectedId || !skillId) return;
    setBusy(true);
    try {
      await delegate(selectedId, skillId);
      setBanner({ tone: 'green', text: `Delegated “${selectedSkill?.title ?? skillId}” to ${selectedWorker?.name}. ${selectedSkill?.sideEffects ? 'It needs your approval — see the Decision Center.' : 'Running now.'}` });
    } finally {
      setBusy(false);
    }
  };

  const launchWorkflow = async (): Promise<void> => {
    if (!selectedId || !skillId) return;
    setBusy(true);
    try {
      const spec: WorkflowSpec = {
        id: `wf-${Date.now().toString(36)}`,
        name: `${selectedSkill?.title ?? 'Task'} (governed)`,
        description: `Executive-launched governed workflow: ${selectedWorker?.name} runs ${selectedSkill?.title ?? skillId}, then a human approval checkpoint.`,
        steps: [
          { id: 's1', kind: 'worker', workerId: selectedId, skillId, dependsOn: [] },
          { id: 's2', kind: 'approval', approvalPrompt: 'Approve to finalize this workflow', dependsOn: ['s1'] },
        ],
      };
      await runWorkflow(spec);
      setBanner({ tone: 'orange', text: `Launched governed workflow “${spec.name}”. The approval checkpoint will appear in the Decision Center / Automation Studio.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-muted">Assign and delegate work to AI workers, launch governed workflows, and keep an eye on the organization — all in one place.</p>

      {/* Monitor */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon="grid" label="Org health" value={snapshot ? Math.round(snapshot.organization.healthScore * 100) : '—'} tone="accent" hint={snapshot?.organization.healthLabel} />
        <Stat icon="cpu" label="Workers active" value={snapshot ? `${snapshot.workforce.running}/${snapshot.workforce.total}` : '—'} tone="blue" hint={snapshot ? `${formatPct(snapshot.workforce.averageTrust)} avg trust` : undefined} />
        <button type="button" onClick={() => onNavigate('decision')} className="text-left">
          <Stat icon="shield" label="Pending approvals" value={pending} tone={pending > 0 ? 'orange' : 'green'} hint="manage in Decision Center" />
        </button>
        <Stat icon="bolt" label="Risk" value={snapshot ? riskLevelMeta(snapshot.risk.level).label : '—'} tone={snapshot ? riskLevelMeta(snapshot.risk.level).tone : 'gray'} hint={snapshot ? `${snapshot.risk.openFindings} open` : undefined} />
      </div>

      {banner && (
        <div className={cn('mb-5 flex items-center gap-2 rounded-xl border p-3 text-sm', banner.tone === 'green' ? 'border-sysgreen/30 bg-sysgreen/10 text-ink' : 'border-sysorange/30 bg-sysorange/10 text-ink')}>
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TINT_TONE[banner.tone])}><Icon name={banner.tone === 'green' ? 'check' : 'shield'} size={14} /></span>
          {banner.text}
          <button type="button" onClick={() => setBanner(null)} className="ml-auto text-faint fill-hover hover:text-ink"><Icon name="close" size={14} /></button>
        </div>
      )}

      {/* Assign & delegate */}
      <OpsPanel title="Assign work to an AI worker" subtitle="Delegate a task or launch it as a governed workflow">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {workers.map((w) => {
            const active = selectedId === w.id;
            return (
              <button key={w.id} type="button" onClick={() => void selectWorker(w.id)} className={cn('flex items-center gap-2.5 rounded-xl border p-3 text-left transition', active ? 'border-accent bg-accent/8' : 'border-[var(--hairline)] fill-hover')}>
                <WorkerGlyph role={w.role} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{w.name}</div>
                  <div className="truncate text-2xs text-faint">{titleCase(w.role)} · {w.skillCount} skills</div>
                </div>
              </button>
            );
          })}
        </div>

        {selectedWorker && (
          <div className="mt-4 rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-4">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Skill for {selectedWorker.name}</div>
            {skills.length === 0 ? (
              <div className="text-sm text-faint">Loading skills…</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {skills.map((s) => (
                    <button key={s.id} type="button" onClick={() => setSkillId(s.id)} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition', skillId === s.id ? 'border-accent bg-accent/12 text-accent' : 'border-[var(--hairline)] text-muted')}>
                      {s.sideEffects && <Icon name="bolt" size={11} />}{s.title}
                    </button>
                  ))}
                </div>
                {selectedSkill && <p className="mt-2.5 text-2xs text-faint">{selectedSkill.description}{selectedSkill.sideEffects ? ' · This skill can have side effects, so it is approval-gated.' : ' · Read-only.'}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !skillId} onClick={() => void doDelegate()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                    <Icon name="launch" size={13} /> Delegate task
                  </button>
                  <button type="button" disabled={busy || !skillId} onClick={() => void launchWorkflow()} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40', TINT_TONE.purple)}>
                    <Icon name="automations" size={13} /> Launch governed workflow
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </OpsPanel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Recommendations */}
        <OpsPanel title="Recommendations" subtitle={recommendations.length === 0 ? 'None right now' : `${recommendations.length} to review`}>
          {recommendations.length === 0 ? (
            <Empty text="No recommendations yet — they surface as the organization accrues activity and evidence." />
          ) : (
            <ul className="space-y-2">
              {recommendations.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-start gap-2.5 rounded-xl border border-[var(--hairline)] p-3">
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.accent)}><Icon name="lightbulb" size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-sm font-medium text-ink">{r.title}</span><span className={cn('text-2xs font-semibold uppercase', r.priority === 'high' ? 'text-syspink' : r.priority === 'normal' ? 'text-sysblue' : 'text-faint')}>{r.priority}</span></div>
                    <p className="text-2xs text-faint">{r.rationale}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>

        {/* Audit history */}
        <OpsPanel title="Audit history" subtitle="Organization Governance Trace" actions={<button type="button" onClick={() => onNavigate('decision')} className="text-2xs font-medium text-accent">Decisions</button>}>
          {audit.length === 0 ? (
            <Empty text="No audit entries yet. Governed actions — approvals, structure changes, policy toggles — are recorded here." />
          ) : (
            <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)]">
              {audit.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-start gap-3 p-3">
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', TINT_TONE.gray)}><Icon name="clipboard" size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink"><span className="font-medium">{titleCase(a.action.replace(/\./g, ' '))}</span> <span className="text-faint">· {a.target}</span></div>
                    <div className="truncate text-2xs text-faint">{a.summary}</div>
                  </div>
                  <span className="shrink-0 text-2xs text-faint">{relativeTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="rounded-xl border border-dashed border-[var(--hairline)] p-5 text-center text-sm text-faint">{text}</div>;
}
