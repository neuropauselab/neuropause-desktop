/**
 * AI Operating Platform (Phase 3) — the enterprise AI operating layer.
 *
 * ONE workspace that composes the platform's already-shipped AI capabilities into a single
 * operating loop — plan -> reason -> orchestrate -> simulate -> decide -> govern -> learn ->
 * (remember) -> optimize. It is a PRESENTATION LAYER: it fetches EXISTING `ipc.*` data once,
 * runs each tab's pure, tested model, and renders the result uniformly. It creates no runtime,
 * engine, IPC channel, or store; it duplicates nothing (Orchestration and Memory summarize and
 * deep-link to their canonical centers); and every capability without real backing is shown as a
 * labeled "Requires …" gap, never fabricated. Empty real signals render honest empty states.
 */
import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { useShell } from '@renderer/state/ShellProvider';
import type { SectionId } from '@renderer/shell/sections';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge, StatusDot } from '@renderer/operations/primitives';
import { EmptyState, Grid, LoadingBlock } from '@renderer/operationsCenter/primitives';
import { type OpLens, EMPTY_LENS } from './aiOperationsModel';
import { summarizePlanning } from './planningModel';
import { summarizeReasoning } from './reasoningModel';
import { summarizeDecisions } from './decisionModel';
import { summarizeSimulation } from './simulationModel';
import { summarizeLearning } from './learningModel';
import { summarizeAiGovernance } from './aiGovernanceModel';
import { summarizeExecutive } from './executiveModel';
import {
  type OpsTab,
  type LoopStage,
  operatingLoop,
  summarizeOrchestration,
  summarizeMemory,
} from './overviewModel';

const TABS: { id: OpsTab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  { id: 'planning', label: 'Planning', icon: 'checklist' },
  { id: 'reasoning', label: 'Reasoning', icon: 'lightbulb' },
  { id: 'orchestration', label: 'Orchestration', icon: 'command' },
  { id: 'memory', label: 'Memory', icon: 'memory' },
  { id: 'simulation', label: 'Simulation', icon: 'beaker' },
  { id: 'decisions', label: 'Decisions', icon: 'verified' },
  { id: 'governance', label: 'AI Governance', icon: 'shield' },
  { id: 'learning', label: 'Learning', icon: 'pulse' },
  { id: 'executive', label: 'Executive', icon: 'sparkles' },
];

type Lenses = Record<OpsTab, OpLens>;

const INITIAL: Lenses = {
  overview: EMPTY_LENS, planning: EMPTY_LENS, reasoning: EMPTY_LENS, orchestration: EMPTY_LENS,
  memory: EMPTY_LENS, simulation: EMPTY_LENS, decisions: EMPTY_LENS, governance: EMPTY_LENS,
  learning: EMPTY_LENS, executive: EMPTY_LENS,
};

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

function gridCols(n: number): 2 | 3 | 4 {
  const c = Math.min(4, Math.max(2, n));
  return (c === 4 ? 4 : c === 3 ? 3 : 2) as 2 | 3 | 4;
}

function LensView({ lens, go }: { lens: OpLens; go: (s: SectionId) => void }): JSX.Element {
  const hasBody = lens.stats.length > 0 || lens.groups.some((g) => g.rows.length > 0);
  return (
    <div className="space-y-6">
      {lens.stats.length > 0 && (
        <Grid cols={gridCols(lens.stats.length)}>
          {lens.stats.map((s, i) => (
            <Stat key={i} icon={s.icon} label={s.label} value={s.value} tone={s.tone} hint={s.hint} />
          ))}
        </Grid>
      )}

      {lens.groups.map((g, i) => (
        <OpsPanel key={i} title={g.title} subtitle={g.note}>
          <div className="space-y-1">
            {g.rows.length > 0 ? (
              g.rows.map((r, j) => (
                <div
                  key={j}
                  className="flex items-center justify-between gap-4 border-b border-[var(--hairline)] py-1.5 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm">{r.label}</div>
                    {r.sub && <div className="text-xs text-faint">{r.sub}</div>}
                  </div>
                  <div className="shrink-0 text-sm tabular-nums">
                    {r.tone ? <StatusBadge tone={r.tone} label={r.value} /> : r.value}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No live data yet" hint="This surface stays empty until its source is populated." />
            )}
          </div>
        </OpsPanel>
      ))}

      {lens.gaps.length > 0 && (
        <OpsPanel title="Honest gaps" subtitle="Capabilities without real backing today — labeled, never fabricated.">
          <div className="space-y-2">
            {lens.gaps.map((gp, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-[var(--hairline)] py-1.5 last:border-0">
                <Icon name="info" size={15} className="mt-0.5 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-sm">{gp.capability}</div>
                  <div className="text-xs text-faint">Requires {gp.requires}</div>
                  {gp.note && <div className="text-xs text-faint">{gp.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {lens.links && lens.links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lens.links.map((l, i) => (
            <button
              key={i}
              onClick={() => go(l.section)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hover)]"
            >
              {l.icon && <Icon name={l.icon} size={15} />}
              <span>{l.label}</span>
              <Icon name="arrow-right" size={14} />
            </button>
          ))}
        </div>
      )}

      {!hasBody && lens.gaps.length === 0 && (
        <EmptyState title="No live data yet" hint="This surface stays empty until its source is populated." />
      )}
    </div>
  );
}

function OverviewView({
  stages,
  onOpen,
}: {
  stages: LoopStage[];
  onOpen: (t: OpsTab) => void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-faint">
        The operating loop, composed from existing platform capabilities. Each stage reads live data from the
        services that already own it; open a stage for detail and honest gaps.
      </p>
      <Grid cols={3}>
        {stages.map((st) => (
          <button
            key={st.key}
            onClick={() => onOpen(st.key)}
            className="rounded-xl border border-[var(--hairline)] p-4 text-left transition-colors hover:bg-[var(--hover)]"
          >
            <div className="flex items-center gap-2">
              <Icon name={st.icon} size={16} />
              <span className="text-xs uppercase tracking-wide text-faint">{st.verb}</span>
            </div>
            <div className="mt-2 font-medium">{st.label}</div>
            <div className="mt-1 truncate text-sm text-faint">{st.headline}</div>
            <div className="mt-3 flex items-center gap-2">
              <StatusDot tone={st.tone} />
              <span className="text-xs text-faint">
                {st.gaps > 0 ? `${st.gaps} honest gap${st.gaps === 1 ? '' : 's'}` : 'no gaps'}
              </span>
            </div>
          </button>
        ))}
      </Grid>
    </div>
  );
}

export function AiOperationsView(): JSX.Element {
  const { setSection } = useShell();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<OpsTab>('overview');
  const [lenses, setLenses] = useState<Lenses>(INITIAL);

  const refresh = useCallback(async () => {
    const [
      planning, autoOpsPlans, governance, executeSessions,
      reasoning, intel, execCenter,
      orchestration, workforceIntel, memoryCounts, graphCounts,
      decisions, validationSummary, validationDashboard, strategySimulation, metering,
      autoOpsAnalytics, executeHistory, feedback,
      policies, audit, workers, compliance, briefing, dashboard,
    ] = await Promise.all([
      settled(ipc.strategyPlatform.planning(), undefined),
      settled(ipc.autoOps.plans(), undefined),
      settled(ipc.enterprise.governanceConfig(), undefined),
      settled(ipc.execute.sessions(), undefined),
      settled(ipc.strategyPlatform.reasoning(), undefined),
      settled(ipc.enterpriseIntel.report(), undefined),
      settled(ipc.intelligence.executiveCenterSnapshot(), undefined),
      settled(ipc.orchestration.overview(), undefined),
      settled(ipc.workforce.intelligence(), undefined),
      settled(ipc.memory.counts(), undefined),
      settled(ipc.graph.counts(), undefined),
      settled(ipc.decisions.list(), undefined),
      settled(ipc.sandbox.validationSummary(), undefined),
      settled(ipc.sandbox.validationDashboard(), undefined),
      settled(ipc.strategyPlatform.simulation(), undefined),
      settled(ipc.commercial.metering(), undefined),
      settled(ipc.autoOps.analytics(), undefined),
      settled(ipc.execute.history(), undefined),
      settled(ipc.feedback.list(), undefined),
      settled(ipc.workforce.policies(), undefined),
      settled(ipc.workforce.audit(), undefined),
      settled(ipc.workforce.workers(), undefined),
      settled(ipc.enterprise.compliance(), undefined),
      settled(ipc.intelligence.briefing('morning'), undefined),
      settled(ipc.enterprise.dashboard(), undefined),
    ]);

    setLenses({
      overview: EMPTY_LENS,
      planning: summarizePlanning({ planning, autoOps: autoOpsPlans, governance, execution: executeSessions }),
      reasoning: summarizeReasoning({ reasoning, intel, executive: execCenter }),
      orchestration: summarizeOrchestration({ orchestration, workforce: workforceIntel }),
      memory: summarizeMemory({ memory: memoryCounts, graph: graphCounts }),
      simulation: summarizeSimulation({ validationSummary, validationDashboard, strategySimulation, metering }),
      decisions: summarizeDecisions(decisions),
      governance: summarizeAiGovernance({ policies, audit, workers, compliance }),
      learning: summarizeLearning({
        workforce: workforceIntel,
        autoOps: autoOpsAnalytics,
        execution: executeHistory?.records,
        feedback,
      }),
      executive: summarizeExecutive({ center: execCenter, briefing, dashboard }),
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const offs = [
      ipc.enterprise.onEvent(() => void refresh()),
      ipc.workforce.onEvent(() => void refresh()),
      ipc.commercial.onEvent(() => void refresh()),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh]);

  const go = (s: SectionId): void => setSection(s);
  const stages = operatingLoop(lenses);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--hairline)] px-8 pt-7">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Operations</h1>
          <p className="mt-0.5 text-sm text-faint">
            The enterprise AI operating layer — plan, reason, orchestrate, simulate, decide, govern and learn,
            composed read-only over the platform&rsquo;s existing capabilities.
          </p>
        </div>
        <nav className="mt-5 flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ' +
                  (active
                    ? 'border-[var(--accent)] text-strong'
                    : 'border-transparent text-faint hover:text-strong')
                }
              >
                <Icon name={t.icon} size={15} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {!ready ? (
          <LoadingBlock label="Composing the operating layer…" />
        ) : tab === 'overview' ? (
          <OverviewView stages={stages} onOpen={setTab} />
        ) : (
          <LensView lens={lenses[tab]} go={go} />
        )}
      </div>
    </div>
  );
}
