/**
 * AI Operating Platform — "Learning" tab lens (Phase 3).
 *
 * A PURE, DESCRIPTIVE derivation over data the platform already produces about
 * execution OUTCOMES. It reports what actually happened — worker/goal execution
 * success & failure, bottlenecks, operational analytics, engine run records, and
 * user-submitted feedback — and nothing more.
 *
 * It is explicitly NOT a self-learning / retraining system. The platform has no
 * loop that consumes these outcomes to update workers, recommendations, or
 * models; that genuine absence is surfaced as honest, labeled `OpGap`s rather
 * than dressed up as a delivered capability. When a real signal is simply empty
 * (no jobs have run, no feedback submitted), the honest empty state shows
 * through — the tab renders only its gaps + deep-links, never a placeholder
 * number.
 *
 * Intended (reuse-only) wiring — the model adds no IPC and is called with the
 * results of EXISTING channels; every field below is structurally compatible
 * with those payloads:
 *   summarizeLearning({
 *     workforce: await ipc.workforce.intelligence(),   // WorkforceIntelligence
 *     autoOps:   await ipc.autoOps.analytics(),         // AutoOpsAnalytics
 *     execution: (await ipc.execute.history()).records, // ExecutionSession[]
 *     feedback:  await ipc.feedback.list(),             // FeedbackEntry[]
 *   })
 */
import {
  type OpStat,
  type OpRow,
  type OpGroup,
  type OpGap,
  type OpLink,
  type OpLens,
  type OpsTone,
  healthTone,
  riskTone,
  count,
  pctText,
} from './aiOperationsModel';

/* ── Minimal structural inputs ───────────────────────────────────────────────
 * Every field is defensively optional so partial/empty payloads are safe. Field
 * names/types mirror the REAL sources (verified against ipc.ts + @neuropause/
 * shared), so a real `WorkforceIntelligence`/`AutoOpsAnalytics`/`ExecutionSession`
 * /`FeedbackEntry` value is structurally assignable here. Nothing is invented.
 */

/** Subset of `ExecStat` (workforce intelligence per-skill/role/totals). */
export interface LearnExecStat {
  key?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  cancelled?: number;
  inFlight?: number;
  /** 0..1 success ratio. */
  successRate?: number;
  avgDurationMs?: number | null;
}

/** Subset of `WorkforceBottleneck` (a genuinely-detected execution constraint). */
export interface LearnBottleneck {
  scope?: string;
  key?: string;
  kind?: string;
  reason?: string;
}

/** Subset of `WorkforceIntelligence` — the PRIMARY execution-outcome signal. */
export interface LearnWorkforceSignal {
  totalJobs?: number;
  activeWorkers?: number;
  /** 0..1 overall success ratio across completed jobs. */
  overallSuccessRate?: number;
  inFlight?: number;
  execution?: {
    bySkill?: readonly LearnExecStat[];
    byRole?: readonly LearnExecStat[];
    totals?: LearnExecStat;
  };
  bottlenecks?: readonly LearnBottleneck[];
}

/** Subset of `OpsMetric` (autonomous-operations analytics metric). */
export interface LearnOpsMetric {
  key?: string;
  label?: string;
  value?: number;
  display?: string;
  /** `OpsBand`: 'healthy' | 'watch' | 'at-risk' | 'critical'. */
  band?: string;
}

/** Subset of `AutoOpsAnalytics` — operational success-rate analytics. */
export interface LearnAutoOpsSignal {
  metrics?: readonly LearnOpsMetric[];
  planCount?: number;
  recoveryCount?: number;
  optimizationCount?: number;
  incidentCount?: number;
  approvalRequired?: number;
  autoExecutable?: number;
  note?: string;
}

/** Subset of `ExecutionSession` (a unified Execute-engine run record). */
export interface LearnExecutionSession {
  /** `ExecutionState`: 'completed' | 'failed' | 'cancelled' | … */
  state?: string;
  durationMs?: number | null;
}

/** Subset of `FeedbackEntry` — USER-submitted feedback (not outcome feedback). */
export interface LearnFeedbackEntry {
  /** `FeedbackCategory`: 'bug' | 'idea' | 'question' | 'praise'. */
  category?: string;
}

/** The (defensively optional) input to the Learning derivation. */
export interface LearningInput {
  workforce?: LearnWorkforceSignal | null;
  autoOps?: LearnAutoOpsSignal | null;
  /** From `ipc.execute.history()` → `.records`. */
  execution?: readonly LearnExecutionSession[] | null;
  /** From `ipc.feedback.list()`. */
  feedback?: readonly LearnFeedbackEntry[] | null;
}

/* ── small pure helpers ── */

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function arr<T>(v: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** `OpsBand` → tone. Categorical, never a fabricated ratio. */
function bandTone(band: string | undefined): OpsTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'orange';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

function humanizeScope(scope: string | undefined): string {
  if (scope === 'worker') return 'Worker';
  if (scope === 'skill') return 'Skill';
  return scope && scope.length > 0 ? scope : 'Scope';
}

function humanizeBottleneckKind(kind: string | undefined): string {
  switch (kind) {
    case 'high_failure':
      return 'High failure';
    case 'backlog':
      return 'Backlog';
    case 'ungrounded':
      return 'Ungrounded';
    default:
      return kind && kind.length > 0 ? kind : 'Bottleneck';
  }
}

function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Highest-throughput exec stats first, dropping unused (total 0) entries. */
function topStats(stats: readonly LearnExecStat[], limit: number): LearnExecStat[] {
  return [...stats]
    .filter((s) => num(s.total) > 0)
    .sort((a, b) => num(b.total) - num(a.total))
    .slice(0, limit);
}

/**
 * The three genuine architectural absences of this tab. They are constant — the
 * platform has no learning loop regardless of how much outcome data exists — so
 * they render in every state, populated or empty. This is what keeps the tab
 * honestly DESCRIPTIVE rather than pretending to be self-improving.
 */
function learningGaps(): OpGap[] {
  return [
    {
      capability: 'Self-improving / retraining loop',
      requires:
        'a learning pipeline — today these are descriptive analytics, not a loop that updates workers/recommendations',
    },
    {
      capability: 'Execution-outcome feedback',
      requires: 'outcome-capture wiring — feedback today is user-submitted only',
    },
    {
      capability: 'Automated recommendation/worker improvement',
      requires: 'a training loop — absent',
    },
  ];
}

/** Deep-links to the canonical surfaces these analytics are derived from. */
function learningLinks(): OpLink[] {
  return [
    { label: 'Workforce intelligence', section: 'workforce', icon: 'cpu' },
    { label: 'Autonomous operations', section: 'auto-ops-center', icon: 'command' },
  ];
}

/**
 * Derive the Learning lens. Pure: same input → same output; no IPC, no clock,
 * no DOM. Only real, present signals produce stats/rows; absent signals fall
 * through to the honest empty state (gaps + links only).
 */
export function summarizeLearning(input: LearningInput): OpLens {
  const stats: OpStat[] = [];
  const groups: OpGroup[] = [];

  /* ── Workforce intelligence (PRIMARY): goal-execution outcomes ── */
  const wf = input.workforce ?? null;
  const totals = wf?.execution?.totals ?? null;
  const totalJobs = num(wf?.totalJobs);
  const jobsRan = wf !== null && totalJobs > 0;
  const succeeded = num(totals?.succeeded);
  const failed = num(totals?.failed);
  const inFlight = num(wf?.inFlight ?? totals?.inFlight);
  const hasRate = isFiniteNumber(wf?.overallSuccessRate);
  const successRate = num(wf?.overallSuccessRate);
  const outcomeDenom = succeeded + failed;
  const bottlenecks = arr(wf?.bottlenecks);

  if (jobsRan) {
    if (hasRate) {
      stats.push({
        icon: 'gauge',
        label: 'Execution success rate',
        value: pctText(successRate),
        tone: healthTone(successRate),
        hint: `${count(totalJobs)} jobs`,
      });
    }
    stats.push({
      icon: 'bolt',
      label: 'Failed executions',
      value: count(failed),
      tone: riskTone(outcomeDenom > 0 ? failed / outcomeDenom : 0),
      hint: outcomeDenom > 0 ? `${pctText(failed / outcomeDenom)} of outcomes` : undefined,
    });
    stats.push({
      icon: 'activity',
      label: 'Bottlenecks detected',
      value: count(bottlenecks.length),
      tone: bottlenecks.length > 0 ? 'orange' : 'green',
    });

    const outcomeRows: OpRow[] = [];
    if (hasRate) {
      outcomeRows.push({
        label: 'Success rate',
        value: pctText(successRate),
        tone: healthTone(successRate),
      });
    }
    outcomeRows.push({ label: 'Jobs executed', value: count(totalJobs) });
    outcomeRows.push({ label: 'Succeeded', value: count(succeeded), tone: 'green' });
    outcomeRows.push({
      label: 'Failed',
      value: count(failed),
      tone: failed > 0 ? 'red' : 'gray',
    });
    if (inFlight > 0) {
      outcomeRows.push({ label: 'In-flight', value: count(inFlight), tone: 'blue' });
    }
    outcomeRows.push({ label: 'Average duration', value: formatDurationMs(totals?.avgDurationMs) });
    groups.push({
      title: 'Goal execution outcomes (real)',
      rows: outcomeRows,
      note: 'Descriptive analytics over real outcomes, aggregated from workforce intelligence across completed jobs.',
    });
  }

  /* Success/failure by skill & role — real per-dimension breakdown. */
  const bySkill = topStats(arr(wf?.execution?.bySkill), 3);
  const byRole = topStats(arr(wf?.execution?.byRole), 3);
  if (bySkill.length > 0 || byRole.length > 0) {
    const rows: OpRow[] = [];
    for (const s of bySkill) {
      rows.push({
        label: `Skill · ${s.key ?? '—'}`,
        value: pctText(num(s.successRate)),
        tone: healthTone(num(s.successRate)),
        sub: `${count(num(s.succeeded))}/${count(num(s.total))} ok · ${count(num(s.failed))} failed`,
      });
    }
    for (const r of byRole) {
      rows.push({
        label: `Role · ${r.key ?? '—'}`,
        value: pctText(num(r.successRate)),
        tone: healthTone(num(r.successRate)),
        sub: `${count(num(r.succeeded))}/${count(num(r.total))} ok · ${count(num(r.failed))} failed`,
      });
    }
    groups.push({ title: 'Outcomes by skill & role (real)', rows });
  }

  /* Bottlenecks — genuine constraints, reported (not auto-remediated here). */
  if (bottlenecks.length > 0) {
    const rows: OpRow[] = bottlenecks.slice(0, 6).map((b) => ({
      label: `${humanizeScope(b.scope)} · ${b.key ?? '—'}`,
      value: humanizeBottleneckKind(b.kind),
      tone: b.kind === 'high_failure' ? 'red' : 'orange',
      sub: b.reason,
    }));
    groups.push({
      title: 'Bottlenecks detected (real)',
      rows,
      note: 'Constraints surfaced by workforce intelligence — reported for review, not auto-remediated here.',
    });
  }

  /* ── Autonomous operations analytics (real, operational success-rate) ── */
  const ao = input.autoOps ?? null;
  const aoMetrics = arr(ao?.metrics);
  const aoCounts =
    num(ao?.planCount) +
    num(ao?.recoveryCount) +
    num(ao?.optimizationCount) +
    num(ao?.incidentCount);
  const aoActive = ao !== null && (aoMetrics.length > 0 || aoCounts > 0);
  if (aoActive) {
    stats.push({
      icon: 'analytics',
      label: 'Operational metrics',
      value: count(aoMetrics.length),
      tone: 'blue',
    });

    const rows: OpRow[] = [];
    for (const m of aoMetrics.slice(0, 6)) {
      rows.push({
        label: m.label ?? m.key ?? '—',
        value: m.display ?? count(num(m.value)),
        tone: bandTone(m.band),
      });
    }
    rows.push({ label: 'Plans', value: count(num(ao?.planCount)) });
    rows.push({ label: 'Recoveries', value: count(num(ao?.recoveryCount)) });
    rows.push({ label: 'Optimizations', value: count(num(ao?.optimizationCount)) });
    rows.push({
      label: 'Incidents',
      value: count(num(ao?.incidentCount)),
      tone: num(ao?.incidentCount) > 0 ? 'orange' : 'gray',
    });
    groups.push({
      title: 'Operational analytics (real)',
      rows,
      note:
        ao?.note && ao.note.length > 0
          ? ao.note
          : 'Operational success-rate analytics from autonomous operations.',
    });
  }

  /* ── Execute-engine run records (real outcomes; count + success/fail) ── */
  const runs = arr(input.execution);
  if (runs.length > 0) {
    const completed = runs.filter((r) => r?.state === 'completed').length;
    const failedRuns = runs.filter((r) => r?.state === 'failed').length;
    const cancelled = runs.filter((r) => r?.state === 'cancelled').length;
    const denom = completed + failedRuns;
    const rate = denom > 0 ? completed / denom : Number.NaN;

    stats.push({
      icon: 'play',
      label: 'Engine sessions',
      value: count(runs.length),
      tone: 'blue',
      hint: denom > 0 ? `${pctText(rate)} success` : undefined,
    });

    const rows: OpRow[] = [];
    rows.push({ label: 'Sessions recorded', value: count(runs.length) });
    rows.push({ label: 'Completed', value: count(completed), tone: 'green' });
    rows.push({
      label: 'Failed',
      value: count(failedRuns),
      tone: failedRuns > 0 ? 'red' : 'gray',
    });
    if (cancelled > 0) {
      rows.push({ label: 'Cancelled', value: count(cancelled), tone: 'gray' });
    }
    if (denom > 0) {
      rows.push({ label: 'Session success rate', value: pctText(rate), tone: healthTone(rate) });
    }
    groups.push({
      title: 'Execution engine sessions (real)',
      rows,
      note: 'Run records from the unified Execute engine — outcomes only.',
    });
  }

  /* ── User-submitted feedback (labeled — NOT execution-outcome feedback) ── */
  const feedback = arr(input.feedback);
  if (feedback.length > 0) {
    const inCategory = (name: string): number =>
      feedback.filter((f) => f?.category === name).length;
    const bugs = inCategory('bug');
    const praise = inCategory('praise');

    stats.push({
      icon: 'lightbulb',
      label: 'Feedback (user-submitted)',
      value: count(feedback.length),
      tone: 'purple',
    });

    groups.push({
      title: 'Feedback (user-submitted)',
      rows: [
        { label: 'Total submitted', value: count(feedback.length) },
        { label: 'Bugs', value: count(bugs), tone: bugs > 0 ? 'orange' : 'gray' },
        { label: 'Ideas', value: count(inCategory('idea')) },
        { label: 'Questions', value: count(inCategory('question')) },
        { label: 'Praise', value: count(praise), tone: praise > 0 ? 'green' : 'gray' },
      ],
      note: 'User-submitted feedback (bug / idea / question / praise) — NOT execution-outcome feedback.',
    });
  }

  return { stats, groups, gaps: learningGaps(), links: learningLinks() };
}
