/**
 * Phase 6 Stage 13 — the Twin Platform tab's pure view-model (no DOM, no React,
 * no I/O; tested). Projects the read-only `etwin:*` surfaces — the runtime and
 * execution twin, the Stage 6–12 platform twins beside P15's own nine domains,
 * the enterprise state-coverage map, the simulation register, the recorded-
 * history view and the executive dashboard — into presentation rows.
 *
 * Everything renders what the main-process composition computed. This file adds
 * no health, no band, no delta and no coverage judgement of its own: module
 * attributions, coverage evidence, cannot-simulate statements, declared-
 * untrendable series and unavailable reasons all ride along unchanged. The
 * three honesty rules the composition enforces are enforced again at the
 * presentation edge, because a renderer is the last place a `null` can quietly
 * become a zero: an unreadable number is worded as unreadable and never
 * formatted as `0`, an `unknown` platform is never toned as `steady`, and a
 * registered simulation is always labelled as never invoked.
 */
import type {
  EtwinCoverageMap,
  EtwinCoverageStatus,
  EtwinDashboard,
  EtwinHistoryDirection,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
  EtwinTwinState,
} from '@neuropause/shared';
import type { IconName } from '@renderer/components/ui/Icon';

/** Presentation tone (the Stage 7–12 pattern — accepted by StatusBadge/Pill). */
export type EtwinTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

/* ── tone maps (total; tested) ────────────────────────────────────────────── */

/** P15's own health bands, mapped for display only — never recomputed here. */
export function bandTone(band: string | null): EtwinTone {
  switch (band) {
    case 'healthy':
      return 'green';
    case 'watch':
      return 'blue';
    case 'at-risk':
      return 'orange';
    case 'critical':
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * The load-bearing tone map of this stage. `unknown` means the platform could
 * not be read, and it gets its OWN neutral tone — collapsing it into the
 * `steady` green would turn an unread subject into a healthy one, which is the
 * exact failure the composition refuses to make upstream.
 */
export function twinStateTone(state: EtwinTwinState): EtwinTone {
  switch (state) {
    case 'steady':
      return 'green';
    case 'attention':
      return 'orange';
    case 'unknown':
      return 'gray';
  }
}

export function directionTone(direction: EtwinHistoryDirection): EtwinTone {
  switch (direction) {
    case 'improving':
      return 'green';
    case 'stable':
      return 'blue';
    case 'regressing':
      return 'orange';
    case 'unavailable':
      return 'gray';
  }
}

/**
 * Coverage status tone. `not-modelled` is deliberately NOT red: a declared,
 * evidenced gap is an honest statement about the repository, not a fault
 * condition, and colouring it as an alarm would misreport the registry as a
 * health signal.
 */
export function coverageTone(status: EtwinCoverageStatus): EtwinTone {
  switch (status) {
    case 'modelled-by-twin':
      return 'green';
    case 'modelled-elsewhere':
      return 'blue';
    case 'not-modelled':
      return 'gray';
  }
}

/* ── null-safe formatting (the `null` is never `0` rule, at the edge) ─────── */

/**
 * Renders a possibly-unreadable count. A null NEVER becomes `0` and never
 * becomes an em-dash that a reader could mistake for a zero: it says what it
 * is. Every call site passes the noun so the unreadable case still names its
 * subject.
 */
export function countText(value: number | null, noun: string): string {
  return value === null ? `${noun} unreadable this pass` : `${value} ${noun}`;
}

/** Durations are optional on a session row; an absent one is stated, not zeroed. */
export function durationText(ms: number | null): string {
  if (ms === null) return 'duration not recorded';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} m ${Math.round(seconds % 60)} s`;
}

/* ── header stats (dashboard) ─────────────────────────────────────────────── */

export interface EtwinStat {
  label: string;
  value: string;
  hint: string;
  tone: EtwinTone;
  icon: IconName;
}

/**
 * Five stats over the composed dashboard. Each hint carries the attribution or
 * the limitation that makes the number honest, so a reader never sees a figure
 * without the statement of where it came from.
 */
export function etwinHeaderStats(d: EtwinDashboard): EtwinStat[] {
  return [
    {
      label: 'Enterprise twin',
      value: d.twin ? `${d.twin.overallHealth}/100 ${d.twin.healthBand}` : 'unreadable',
      hint: d.twin
        ? `${d.twin.domainCount} domain(s) · ${d.twin.totalEntities} entities · ${d.twin.criticalImpactNodes} critical-impact node(s) · ${d.twin.openDecisions} open decision(s) — P15 composed verbatim; Stage 13 recomputes no health and no band`
        : 'The P15 twin summary was unreadable this pass — declared, not defaulted; no health is assumed in its place',
      tone: d.twin ? bandTone(d.twin.healthBand) : 'gray',
      icon: 'globe',
    },
    {
      label: 'Runtime twin',
      value: d.runtime.available
        ? `${d.runtime.activeSessions} active · ${d.runtime.registeredKinds} kind(s)`
        : 'engine unreadable',
      hint: d.runtime.available
        ? `${countText(d.runtime.failed, 'failed session(s)')} · ${countText(d.runtime.recovering, 'subsystem(s) recovering')} — the partial-engine rule: any failed engine read makes the whole execution slice null rather than half-composed`
        : 'The execution slice is null this pass — an engine that half-answered is reported unreadable, never half-composed',
      tone: !d.runtime.available
        ? 'gray'
        : d.runtime.failed !== null && d.runtime.failed > 0
          ? 'orange'
          : 'green',
      icon: 'bolt',
    },
    {
      label: 'Platform twins',
      value: `${d.platforms.steady} steady · ${d.platforms.attention} attention`,
      hint: `${d.platforms.unknown} platform(s) unreadable of ${d.platforms.total} — attention means the platform reported something outstanding, not that Stage 13 assessed it; an unreadable platform stays unknown and is never assumed steady`,
      tone:
        d.platforms.attention > 0 ? 'orange' : d.platforms.unknown > 0 ? 'gray' : 'green',
      icon: 'grid',
    },
    {
      label: 'State coverage',
      value: `${d.coverage.modelledByTwin + d.coverage.modelledElsewhere}/${d.coverage.total} modelled`,
      hint: `${d.coverage.modelledByTwin} by the twin · ${d.coverage.modelledElsewhere} elsewhere · ${d.coverage.notModelled} not modelled — coverage is a statement about the repository, not a score, and every gap cites the search that proved it`,
      tone: d.coverage.notModelled > 0 ? 'blue' : 'green',
      icon: 'checklist',
    },
    {
      label: 'Recorded history',
      value: `${d.history.improving}↑ ${d.history.stable}→ ${d.history.regressing}↓`,
      hint: `${d.history.unavailable} series without a recorded window — deltas are Stage 12's over RECORDED values only; Stage 13 computes no trend and extrapolates nothing`,
      tone: d.history.regressing > 0 ? 'orange' : d.history.improving > 0 ? 'green' : 'gray',
      icon: 'pulse',
    },
  ];
}

/* ── runtime + execution twin ─────────────────────────────────────────────── */

export interface EtwinExecutionSummaryVm {
  /** False when the partial-engine rule fired — rendered as unreadable, not empty. */
  available: boolean;
  headline: string;
  statsLines: string[];
}

/**
 * The execution slice, summarised. When the engine is unavailable this returns
 * the reason shape rather than zeros, so an unreadable engine can never render
 * as an idle one.
 */
export function executionSummary(r: EtwinRuntimeTwin): EtwinExecutionSummaryVm {
  if (!r.execution.available) {
    return {
      available: false,
      headline: 'Execution slice unreadable this pass (partial-engine rule)',
      statsLines: [
        'One or more of the four engine reads failed, so the whole slice is null rather than partially composed.',
        'No session count, no kind count and no statistic is shown, because none of them would be true.',
      ],
    };
  }
  const s = r.execution.stats;
  return {
    available: true,
    headline: `${r.execution.activeCount} active · ${r.execution.historyCount} historical · ${r.execution.registeredKinds.length} registered kind(s)`,
    statsLines: s
      ? [
          `Engine statistics (composed verbatim): ${s.active} active · ${s.queued} queued · ${s.completed} completed · ${s.failed} failed · ${s.cancelled} cancelled`,
          `Success rate: ${s.successRate === null ? 'not computable from the recorded sessions' : `${(s.successRate * 100).toFixed(0)}%`} · average runtime: ${s.averageRuntimeMs === null ? 'not recorded' : durationText(s.averageRuntimeMs)}`,
        ]
      : ['Engine statistics were unreadable this pass — declared, not defaulted.'],
  };
}

export interface EtwinKindRowVm {
  kind: string;
  activeText: string;
  historicalText: string;
  failedText: string;
  tone: EtwinTone;
}

export function executionKindRows(r: EtwinRuntimeTwin): EtwinKindRowVm[] {
  return r.execution.kinds.map((k) => ({
    kind: k.kind,
    activeText: `${k.active} active`,
    historicalText: `${k.historical} historical`,
    failedText: `${k.failed} failed`,
    tone: k.failed > 0 ? 'orange' : k.active > 0 ? 'blue' : 'gray',
  }));
}

export interface EtwinSessionRowVm {
  id: string;
  kind: string;
  label: string;
  state: string;
  startedAt: string;
  durationText: string;
  tone: EtwinTone;
  /** True for the active list, false for the recent list — kept distinct. */
  live: boolean;
}

function sessionTone(state: string): EtwinTone {
  switch (state) {
    case 'failed':
      return 'red';
    case 'cancelled':
    case 'interrupted':
      return 'orange';
    case 'completed':
      return 'green';
    case 'running':
      return 'blue';
    default:
      return 'gray';
  }
}

/**
 * Active sessions first, then recent ones, each tagged with which list it came
 * from. The two lists are NOT merged into one sorted view: the composition
 * bounds them separately, and a merged list would silently imply an ordering
 * across a boundary the engine never asserted.
 */
export function sessionRows(r: EtwinRuntimeTwin): EtwinSessionRowVm[] {
  const map = (live: boolean) => (s: EtwinRuntimeTwin['execution']['active'][number]) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    state: s.state,
    startedAt: s.startedAt,
    durationText: durationText(s.durationMs),
    tone: sessionTone(s.state),
    live,
  });
  return [...r.execution.active.map(map(true)), ...r.execution.recent.map(map(false))];
}

export interface EtwinSupervisorRowVm {
  subsystem: string;
  policy: string;
  stateText: string;
  detailText: string;
  tone: EtwinTone;
}

export function supervisorRows(r: EtwinRuntimeTwin): EtwinSupervisorRowVm[] {
  return r.supervisor.rows.map((row) => ({
    subsystem: row.subsystem,
    policy: row.policy,
    stateText: row.recovering ? 'recovering' : 'steady',
    detailText: `${row.recoveries} recovery(ies) · ${row.failures} recent failure(s) · last ${row.lastAt ?? 'never recorded'}`,
    tone: row.recovering ? 'orange' : row.failures > 0 ? 'blue' : 'green',
  }));
}

/* ── platform twins + P15 domains ─────────────────────────────────────────── */

export interface EtwinDomainRowVm {
  id: string;
  label: string;
  entitiesText: string;
  band: string;
  tone: EtwinTone;
}

/** P15's nine domains, verbatim. No entity is counted and no band is derived here. */
export function domainRows(p: EtwinPlatformTwins): EtwinDomainRowVm[] {
  return p.domains.map((d) => ({
    id: d.id,
    label: d.label,
    entitiesText: `${d.entities} entit${d.entities === 1 ? 'y' : 'ies'}`,
    band: d.band,
    tone: bandTone(d.band),
  }));
}

export interface EtwinPlatformRowVm {
  id: string;
  stage: string;
  label: string;
  module: string;
  state: EtwinTwinState;
  tone: EtwinTone;
  stateLabel: string;
  summary: string;
  metricsText: string;
  unknown: boolean;
}

/**
 * One row per Stage 6–12 platform. `unknown` rows keep their own wording as
 * well as their own tone — "could not be read" rather than a blank cell, which
 * a reader would otherwise fill in as "nothing to report".
 */
export function platformRows(p: EtwinPlatformTwins): EtwinPlatformRowVm[] {
  return p.platforms.map((r) => ({
    id: r.id,
    stage: r.stage,
    label: r.label,
    module: r.module,
    state: r.state,
    tone: twinStateTone(r.state),
    stateLabel: r.state === 'unknown' ? 'unknown (could not be read)' : r.state,
    summary: r.summary,
    metricsText: r.metrics.map((m) => `${m.label}: ${m.value}`).join(' · '),
    unknown: r.state === 'unknown',
  }));
}

export function domainTotalsLine(p: EtwinPlatformTwins): string {
  return p.domainTotals === null
    ? 'P15 domain totals were unreadable this pass — declared, not defaulted.'
    : `${p.domainTotals.domains} domain(s) · ${p.domainTotals.entities} entities · ${p.domainTotals.healthy} healthy · ${p.domainTotals.degraded} degraded (P15's own figures, composed verbatim)`;
}

/* ── state coverage ───────────────────────────────────────────────────────── */

export interface EtwinCoverageRowVm {
  id: string;
  label: string;
  status: EtwinCoverageStatus;
  tone: EtwinTone;
  ownerText: string;
  evidence: string;
  liveText: string;
  liveTone: EtwinTone;
  gap: boolean;
}

/**
 * Coverage rows grouped by status — modelled by the twin, modelled elsewhere,
 * then the declared gaps — mirroring how TWIN-PLATFORM.md states the split.
 * Grouping is stable and order-preserving inside each group, so the registry's
 * own order still shows through and nothing is re-ranked by this file.
 */
export function coverageRows(c: EtwinCoverageMap): EtwinCoverageRowVm[] {
  // Annotated, not inferred: the intermediate array gets no contextual type from
  // the return position, so `liveTone` would widen to `string` and the tone
  // union would stop being checked here.
  const vm: EtwinCoverageRowVm[] = c.rows.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    tone: coverageTone(r.status),
    ownerText: r.status === 'not-modelled' ? `would require: ${r.owner}` : `owned by ${r.owner}`,
    evidence: r.evidence,
    // A null live reading means nothing is observable for the row — which is a
    // different statement from "observed, and it was zero".
    liveText: r.live === null ? 'nothing observable for this row this pass' : r.live,
    liveTone: r.live === null ? 'gray' : 'blue',
    gap: r.status === 'not-modelled',
  }));
  const of = (status: EtwinCoverageStatus) => vm.filter((r) => r.status === status);
  return [...of('modelled-by-twin'), ...of('modelled-elsewhere'), ...of('not-modelled')];
}

export function coverageTotalsLine(c: EtwinCoverageMap): string {
  const t = c.totals;
  return `${t.total} enterprise state(s): ${t.modelledByTwin} modelled by the twin · ${t.modelledElsewhere} modelled elsewhere · ${t.notModelled} not modelled. Coverage is a statement about the repository, not a score.`;
}

/* ── simulation register ──────────────────────────────────────────────────── */

export interface EtwinSimulationRowVm {
  id: string;
  label: string;
  kindText: string;
  scenarioText: string;
  liveText: string;
  liveTone: EtwinTone;
  canSimulate: string;
  cannotSimulate: string;
  /** Always the same words, because `invoked` is false by construction. */
  invokedText: string;
}

export function simulationRows(s: EtwinSimulationInventory): EtwinSimulationRowVm[] {
  return s.entries.map((e) => ({
    id: e.id,
    label: e.label,
    kindText: `${e.kind} · ${e.module}`,
    scenarioText:
      e.scenarioCount === null
        ? 'no authored scenario count declared'
        : `${e.scenarioCount} authored scenario(s)`,
    liveText: e.live === null ? 'live join unreadable this pass' : e.live.detail,
    liveTone: e.live === null ? 'gray' : e.live.count > 0 ? 'blue' : 'gray',
    canSimulate: e.canSimulate,
    cannotSimulate: e.cannotSimulate,
    // Structural, not policy: nothing in Stage 13 can set this true, so the tab
    // states it on every row rather than only when it happens to be false.
    invokedText: 'registered, never invoked — Stage 13 runs no simulation',
  }));
}

export function simulationTotalsLine(s: EtwinSimulationInventory): string {
  const t = s.totals;
  return `${t.registered} registered capability(ies) · ${t.withScenarios} with authored scenarios · ${t.liveInstances} live instance(s) observed. This is a register of existing capability; it counts, it does not simulate.`;
}

/* ── recorded history ─────────────────────────────────────────────────────── */

export interface EtwinHistoryRowVm {
  seriesId: string;
  label: string;
  windowLabel: string;
  direction: EtwinHistoryDirection;
  tone: EtwinTone;
  valueText: string;
  detail: string;
  pointInTime: boolean;
}

/**
 * Recorded windows first, declared-untrendable point-in-time series last — the
 * Stage 12 ordering, for the same reason: a point-in-time composition has no
 * direction to report, and listing it among the ones that do invites the reader
 * to treat its absence of movement as stability.
 */
export function historyRows(h: EtwinHistoryView): EtwinHistoryRowVm[] {
  const rows = h.rows.map((r) => ({
    seriesId: r.seriesId,
    label: r.label,
    windowLabel: r.windowLabel,
    direction: r.direction,
    tone: directionTone(r.direction),
    valueText:
      r.from === null || r.to === null
        ? 'no recorded window for this series'
        : `${r.from} → ${r.to}${r.delta === null ? '' : ` (${r.delta > 0 ? '+' : ''}${r.delta})`}`,
    detail: r.detail,
    pointInTime: r.kind === 'point-in-time',
  }));
  return [...rows.filter((r) => !r.pointInTime), ...rows.filter((r) => r.pointInTime)];
}

/** The declared-untrendable list, each with the reason the platform gave. */
export function untrendableLines(h: EtwinHistoryView): string[] {
  return h.untrendable.map((u) => `${u.label} (${u.seriesId}): ${u.reason}`);
}

export function recordedFootprintLine(h: EtwinHistoryView): string {
  return `Recorded footprint: ${countText(h.recordedDays, 'day(s) of health history')} · ${countText(h.recordedDecisions, 'recorded decision(s)')}. Stage 13 reads the footprint, never the records.`;
}

/* ── recommendations ──────────────────────────────────────────────────────── */

export interface EtwinRecommendationRowVm {
  id: string;
  title: string;
  priority: string;
  tone: EtwinTone;
  detail: string;
  suggestedAction: string;
  principleC: string;
}

export function etwinRecommendationRows(d: EtwinDashboard): EtwinRecommendationRowVm[] {
  return d.recommendations.map((r) => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    tone:
      r.priority === 'critical'
        ? 'red'
        : r.priority === 'high'
          ? 'orange'
          : r.priority === 'medium'
            ? 'blue'
            : 'gray',
    detail: r.detail,
    suggestedAction: r.suggestedAction,
    principleC: `Impact: ${r.operationalImpact} Outcome: ${r.expectedBusinessOutcome} Rollback: ${r.rollbackImplications} (confidence ${(r.confidence * 100).toFixed(0)}%, ${r.evidence.length} evidence ref(s))`,
  }));
}

/* ── honesty strips ───────────────────────────────────────────────────────── */

/** Deduped `system: reason` lines across every composed view (the S12 helper). */
export function unavailableLines(parts: { unavailable: { system: string; reason: string }[] }[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    for (const u of part.unavailable) {
      const line = `${u.system}: ${u.reason}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}
