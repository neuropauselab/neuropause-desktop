/**
 * P8.6 — Delegation. A lightweight goal/task composer that calls the existing delegation
 * planner (ipc.workforce.delegate → DelegationPlan) and renders the result as a wave-
 * columned DAG (deterministic layout from the tested `delegationLayout`) plus a plan
 * summary and per-worker load. No new planner — it visualizes the P8 planner's output.
 */
import { useMemo, useRef, useState } from 'react';
import type { DelegationPlan } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat } from '@renderer/operations/primitives';
import { EmptyState, Field, Grid } from '@renderer/operationsCenter/primitives';
import { Pill, WorkerGlyph } from '@renderer/workforce/primitives';
import { formatPct, titleCase } from '@renderer/workforce/lib';
import { useWorkforce } from '@renderer/workforce/WorkforceProvider';
import { delegationLayout } from './workforceCenterModel';

interface DraftTask {
  id: string;
  title: string;
  dependsOn: string[];
}

export function DelegationPanel(): JSX.Element {
  const { delegate } = useWorkforce();
  const [goalTitle, setGoalTitle] = useState('Ship the release');
  const [tasks, setTasks] = useState<DraftTask[]>([
    { id: 't1', title: 'Design', dependsOn: [] },
    { id: 't2', title: 'Build', dependsOn: ['t1'] },
    { id: 't3', title: 'Document', dependsOn: ['t1'] },
    { id: 't4', title: 'Ship', dependsOn: ['t2', 't3'] },
  ]);
  const [newTitle, setNewTitle] = useState('');
  const [plan, setPlan] = useState<DelegationPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic id source (seeded past the 4 defaults) so ids never collide after a removal.
  const nextTaskId = useRef(5);

  const addTask = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    setTasks((t) => [...t, { id: `t${nextTaskId.current++}`, title, dependsOn: [] }]);
    setNewTitle('');
  };
  const toggleDep = (taskId: string, dep: string): void => {
    setTasks((ts) =>
      ts.map((t) =>
        t.id === taskId
          ? { ...t, dependsOn: t.dependsOn.includes(dep) ? t.dependsOn.filter((d) => d !== dep) : [...t.dependsOn, dep] }
          : t,
      ),
    );
  };
  const removeTask = (id: string): void =>
    setTasks((ts) => ts.filter((t) => t.id !== id).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== id) })));

  const runPlan = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const p = await delegate({
        id: 'goal-center',
        title: goalTitle.trim() || 'Goal',
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, dependsOn: t.dependsOn })),
      });
      setPlan(p);
    } catch {
      setError('Could not plan delegation — check the goal (or your workforce:read permission).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <OpsPanel title="Goal & tasks" className="mb-0">
        <input
          value={goalTitle}
          onChange={(e) => setGoalTitle(e.target.value)}
          placeholder="Goal title"
          maxLength={200}
          className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-faint"
        />
        <div className="flex flex-col gap-2">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-xl border border-white/5 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-2xs text-faint tabular">{t.id}</span>
                <span className="flex-1 truncate text-sm font-medium">{t.title}</span>
                <button type="button" onClick={() => removeTask(t.id)} className="text-faint transition hover:text-ink">
                  <Icon name="close" size={13} />
                </button>
              </div>
              {tasks.filter((o) => o.id !== t.id).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tasks
                    .filter((o) => o.id !== t.id)
                    .map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggleDep(t.id, o.id)}
                        className={cn(
                          'rounded-full border px-1.5 py-0.5 text-2xs transition',
                          t.dependsOn.includes(o.id) ? 'border-white/30 bg-white/[0.06] text-ink' : 'border-white/5 text-faint hover:border-white/15',
                        )}
                      >
                        ← {o.id}
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder="Add a task…"
            maxLength={200}
            className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm outline-none placeholder:text-faint"
          />
          <button type="button" onClick={addTask} className="rounded-xl border border-white/10 px-3 py-2 text-sm text-muted transition hover:text-ink">
            <Icon name="plus" size={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => void runPlan()}
          disabled={busy || tasks.length === 0}
          className="mt-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-white/15 disabled:opacity-40"
        >
          {busy ? 'Planning…' : 'Plan delegation across the workforce'}
        </button>
      </OpsPanel>

      <div>
        {error ? (
          <EmptyState icon="info" title="Delegation failed" hint={error} />
        ) : !plan ? (
          <EmptyState icon="grid" title="No plan yet" hint="Compose a goal and plan its delegation to see the task graph." />
        ) : plan.error ? (
          <EmptyState icon="info" title={`Cannot plan: ${plan.error}`} hint={plan.errorDetail ?? undefined} />
        ) : (
          <DelegationResult plan={plan} />
        )}
      </div>
    </div>
  );
}

function DelegationResult({ plan }: { plan: DelegationPlan }): JSX.Element {
  const layout = useMemo(() => delegationLayout(plan), [plan]);
  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.taskId, n])), [layout]);

  return (
    <div>
      <Grid cols={4}>
        <Stat icon="checklist" label="Tasks" value={`${plan.assignedTasks}/${plan.totalTasks}`} hint={`${plan.unassigned.length} unassigned`} />
        <Stat icon="layers" label="Waves" value={plan.waves.length} tone="blue" />
        <Stat icon="bolt" label="Critical path" value={plan.criticalPath.length} tone="orange" />
        <Stat icon="verified" label="Confidence" value={formatPct(plan.confidence)} tone="green" />
      </Grid>

      <OpsPanel title="Delegation graph" subtitle="Wave columns · dependency edges · critical path highlighted" className="mt-6">
        <div className="overflow-auto rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)]">
          <svg width={layout.width} height={layout.height} className="block">
            {layout.edges.map((e, i) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x + 150}
                  y1={a.y + 26}
                  x2={b.x}
                  y2={b.y + 26}
                  stroke={e.critical ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.14)'}
                  strokeWidth={e.critical ? 2 : 1}
                />
              );
            })}
            {layout.nodes.map((n) => (
              <g key={n.taskId} transform={`translate(${n.x},${n.y})`}>
                <rect
                  width={150}
                  height={52}
                  rx={12}
                  fill="rgba(255,255,255,0.03)"
                  stroke={n.onCriticalPath ? 'rgba(255,255,255,0.6)' : n.assigned ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}
                  strokeWidth={n.onCriticalPath ? 2 : 1}
                  strokeDasharray={n.assigned ? undefined : '4 3'}
                />
                <text x={12} y={20} fill="rgba(255,255,255,0.92)" fontSize={11} fontWeight={600}>
                  {n.title.length > 18 ? `${n.title.slice(0, 17)}…` : n.title}
                </text>
                <text x={12} y={37} fill="rgba(255,255,255,0.4)" fontSize={9}>
                  {n.workerName ? `${n.workerName}` : 'unassigned'}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Worker load" className="mb-0">
          {plan.load.length === 0 ? (
            <p className="text-xs text-faint">No workers were assigned.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {plan.load.map((l) => (
                <div key={l.workerId} className="flex items-center gap-3 rounded-xl border border-white/5 p-2.5">
                  <WorkerGlyph role={l.role} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.workerName}</div>
                    <div className="text-2xs text-faint">{titleCase(l.role)}</div>
                  </div>
                  <Pill tone="blue">{l.taskCount} task(s)</Pill>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel title="Plan" className="mb-0">
          <Field label="Goal" value={plan.goalTitle} />
          <Field label="Estimated duration" value={`${plan.estimatedDuration} unit(s)`} />
          <Field label="Assigned" value={`${plan.assignedTasks} / ${plan.totalTasks}`} />
          <Field label="Unassigned" value={plan.unassigned.length === 0 ? 'none' : plan.unassigned.join(', ')} />
          <Field label="Confidence" value={formatPct(plan.confidence)} />
        </OpsPanel>
      </div>
    </div>
  );
}
