import { useEffect, useMemo, useState } from 'react';
import type { WorkerSkill, WorkflowRun, WorkflowSpec, WorkflowStep, WorkflowStepRun } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { OpsPanel } from '@renderer/operations/primitives';
import { useWorkforce } from './WorkforceProvider';
import { MetaDot, Pill } from './primitives';
import { workflowStatusMeta, type WorkforceTab } from './lib';

let seq = 0;
const uid = (): string => `step_${Date.now().toString(36)}_${(seq++).toString(36)}`;

interface BuilderStep {
  uid: string;
  kind: 'worker' | 'approval';
  workerId: string;
  skillId: string;
  prompt: string;
}

function StageChip({ icon, label, muted }: { icon: 'bolt' | 'filter' | 'cpu' | 'shield' | 'connectors' | 'bell'; label: string; muted?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium',
        muted ? 'border-dashed border-[var(--hairline)] text-faint' : 'border-[var(--hairline)] text-muted',
      )}
    >
      <Icon name={icon} size={12} />
      {label}
    </div>
  );
}

export function AutomationStudioPanel({ onNavigate }: { onNavigate: (tab: WorkforceTab) => void }): JSX.Element {
  const { workers, loadWorker, runWorkflow, resumeWorkflow, approveCheckpoint } = useWorkforce();
  const [skillsByWorker, setSkillsByWorker] = useState<Map<string, WorkerSkill[]>>(new Map());
  const [name, setName] = useState('Untitled workflow');
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(workers.map((w) => loadWorker(w.id))).then((details) => {
      if (cancelled) return;
      const map = new Map<string, WorkerSkill[]>();
      for (const d of details) if (d) map.set(d.identity.id, d.skills);
      setSkillsByWorker(map);
    });
    return () => {
      cancelled = true;
    };
  }, [workers, loadWorker]);

  const stepKind = useMemo(() => new Map(steps.map((s) => [s.uid, s.kind])), [steps]);

  const addWorker = (): void =>
    setSteps((s) => [...s, { uid: uid(), kind: 'worker', workerId: '', skillId: '', prompt: '' }]);
  const addApproval = (): void =>
    setSteps((s) => [...s, { uid: uid(), kind: 'approval', workerId: '', skillId: '', prompt: 'Approve to continue' }]);
  const remove = (id: string): void => setSteps((s) => s.filter((x) => x.uid !== id));
  const update = (id: string, patch: Partial<BuilderStep>): void =>
    setSteps((s) => s.map((x) => (x.uid === id ? { ...x, ...patch } : x)));

  const valid = steps.length > 0 && steps.every((s) => (s.kind === 'approval' ? true : s.workerId && s.skillId));

  const run_ = async (): Promise<void> => {
    setError(null);
    if (!valid) {
      setError('Every AI Worker step needs a worker and a skill.');
      return;
    }
    const wfSteps: WorkflowStep[] = steps.map((s, i) => ({
      id: s.uid,
      kind: s.kind,
      workerId: s.kind === 'worker' ? s.workerId : undefined,
      skillId: s.kind === 'worker' ? s.skillId : undefined,
      dependsOn: i === 0 ? [] : [steps[i - 1].uid],
      retry: 1,
      approvalPrompt: s.kind === 'approval' ? s.prompt || 'Approve to continue' : undefined,
    }));
    const spec: WorkflowSpec = {
      id: `wf-${Date.now().toString(36)}`,
      name: name.trim() || 'Workflow',
      description: 'Built in Automation Studio',
      steps: wfSteps,
    };
    setBusy(true);
    try {
      setRun(await runWorkflow(spec));
    } finally {
      setBusy(false);
    }
  };

  const resolveCheckpoint = async (stepId: string, approved: boolean): Promise<void> => {
    if (!run) return;
    setBusy(true);
    try {
      setRun(await approveCheckpoint(run.id, stepId, approved));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (): Promise<void> => {
    if (!run) return;
    setBusy(true);
    try {
      setRun(await resumeWorkflow(run.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsPanel
      title="Automation Studio"
      subtitle="Compose a workflow from AI Worker steps and human approval checkpoints, then run it through the orchestrator."
    >
      {/* Conceptual pipeline */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-3">
        <StageChip icon="filter" label="Trigger: manual" muted />
        <Icon name="arrow-right" size={12} className="text-faint" />
        <StageChip icon="cpu" label="AI Worker" />
        <Icon name="arrow-right" size={12} className="text-faint" />
        <StageChip icon="shield" label="Approval" />
        <Icon name="arrow-right" size={12} className="text-faint" />
        <StageChip icon="connectors" label="Connector action" muted />
        <Icon name="arrow-right" size={12} className="text-faint" />
        <StageChip icon="bell" label="Notify" muted />
        <span className="ml-auto text-2xs text-faint">
          Worker + approval steps execute now; dashed stages represent connector/notification actions wired as those scopes land.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Builder */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--hairline)] bg-transparent px-3 py-2 text-sm font-medium text-ink outline-none focus:shadow-focus"
              placeholder="Workflow name"
            />
          </div>

          <div className="space-y-2">
            {steps.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-6 text-center text-sm text-faint">
                Add an AI Worker step or an approval checkpoint to begin.
              </div>
            )}
            {steps.map((s, i) => (
              <div key={s.uid} className="rounded-2xl border border-[var(--hairline)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-[var(--fill-2)] text-2xs">{i + 1}</span>
                    {s.kind === 'worker' ? 'AI Worker' : 'Approval checkpoint'}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove step"
                    onClick={() => remove(s.uid)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-faint transition fill-hover hover:text-syspink"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>

                {s.kind === 'worker' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={s.workerId}
                      onChange={(e) => update(s.uid, { workerId: e.target.value, skillId: '' })}
                      className="rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none focus:shadow-focus"
                    >
                      <option value="">Choose worker…</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={s.skillId}
                      onChange={(e) => update(s.uid, { skillId: e.target.value })}
                      disabled={!s.workerId}
                      className="rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none focus:shadow-focus disabled:opacity-50"
                    >
                      <option value="">Choose skill…</option>
                      {(skillsByWorker.get(s.workerId) ?? []).map((sk) => (
                        <option key={sk.id} value={sk.id}>
                          {sk.title}
                          {sk.sideEffects ? ' (proposes)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    value={s.prompt}
                    onChange={(e) => update(s.uid, { prompt: e.target.value })}
                    className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none focus:shadow-focus"
                    placeholder="Approval prompt"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon="cpu" onClick={addWorker}>
              AI Worker
            </Button>
            <Button variant="secondary" icon="shield" onClick={addApproval}>
              Approval
            </Button>
            <div className="ml-auto">
              <Button variant="primary" icon="play" onClick={() => void run_()} disabled={busy || steps.length === 0}>
                Run workflow
              </Button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-syspink">{error}</p>}
        </div>

        {/* Live run */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink">Run</h3>
          {!run ? (
            <div className="rounded-2xl border border-dashed border-[var(--hairline)] p-6 text-center text-sm text-faint">
              Build a workflow and press Run to watch it execute step by step.
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--hairline)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">{name}</span>
                <MetaDot meta={workflowStatusMeta(run.status)} pulse={run.status === 'running'} />
              </div>
              <ol className="space-y-2">
                {run.stepRuns.map((sr, i) => (
                  <RunStep
                    key={sr.stepId}
                    index={i}
                    sr={sr}
                    kind={stepKind.get(sr.stepId) ?? 'worker'}
                    busy={busy}
                    onCheckpoint={resolveCheckpoint}
                    onResume={resume}
                    onNavigate={onNavigate}
                  />
                ))}
              </ol>
              {run.status === 'awaiting_approval' && (
                <p className="mt-3 text-2xs text-faint">
                  Worker steps that proposed an action are resolved in the Approval Center; resolve them, then press Resume.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </OpsPanel>
  );
}

function RunStep({
  index,
  sr,
  kind,
  busy,
  onCheckpoint,
  onResume,
  onNavigate,
}: {
  index: number;
  sr: WorkflowStepRun;
  kind: 'worker' | 'approval';
  busy: boolean;
  onCheckpoint: (stepId: string, approved: boolean) => void;
  onResume: () => void;
  onNavigate: (tab: WorkforceTab) => void;
}): JSX.Element {
  const meta = workflowStatusMeta(sr.status);
  const awaiting = sr.status === 'awaiting_approval';
  return (
    <li className="rounded-xl border border-[var(--hairline)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--fill-2)] text-2xs">{index + 1}</span>
          {kind === 'worker' ? (
            <Pill tone="blue" icon="cpu">
              worker
            </Pill>
          ) : (
            <Pill tone="orange" icon="shield">
              approval
            </Pill>
          )}
          {sr.attempts > 1 && <span className="text-2xs text-faint">· {sr.attempts} attempts</span>}
        </span>
        <MetaDot meta={meta} pulse={sr.status === 'running'} />
      </div>

      {awaiting && kind === 'approval' && (
        <div className="mt-2 flex items-center gap-2">
          <Button variant="primary" icon="check" onClick={() => onCheckpoint(sr.stepId, true)} disabled={busy}>
            Approve
          </Button>
          <Button variant="secondary" icon="close" onClick={() => onCheckpoint(sr.stepId, false)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {awaiting && kind === 'worker' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('approvals')}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <Icon name="shield" size={13} /> Resolve in Approval Center
          </button>
          <Button variant="secondary" icon="refresh" onClick={onResume} disabled={busy}>
            Resume
          </Button>
        </div>
      )}
    </li>
  );
}
