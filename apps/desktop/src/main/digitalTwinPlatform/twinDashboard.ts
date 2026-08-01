/**
 * Phase 6 Stage 13 — the twin platform dashboard + report.
 *
 * A pure COMPOSITION of the already-computed views: P15's own summary carried
 * through verbatim, plus the runtime twin, the platform twins, the coverage
 * map, the simulation inventory and the recorded-history view. Nothing here
 * recomputes a health score, a delta, or a band.
 *
 * Its recommendations are twin-specific by design — the runtime/execution
 * estate and platform readability are exactly what no earlier stage watches, so
 * nothing Stage 12 already recommends is restated here. Every one is built
 * through the SAME throwing Principle-C guard and points only at existing
 * governed surfaces: this module recommends and never acts. Pure.
 */
import type {
  EtwinCoverageMap,
  EtwinDashboard,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinReport,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
  EtwinUnavailable,
  OperationsRecommendation,
  TwinSummary,
} from '@neuropause/shared';
import { mkRecommendation } from '../operationsPlatform/operationsModel';
import { COVERAGE_DISCLOSURE } from './stateCoverage';
import { HISTORY_DISCLOSURE } from './twinHistory';
import { PLATFORM_TWINS_DISCLOSURE } from './platformTwins';
import { RUNTIME_TWIN_DISCLOSURE } from './runtimeTwin';
import { SIMULATION_DISCLOSURE } from './simulationInventory';

export const ETWIN_DISCLOSURES: readonly string[] = [
  RUNTIME_TWIN_DISCLOSURE,
  PLATFORM_TWINS_DISCLOSURE,
  COVERAGE_DISCLOSURE,
  SIMULATION_DISCLOSURE,
  HISTORY_DISCLOSURE,
] as const;

/** P15's bands that mean the twin itself is reporting trouble. */
const UNHEALTHY_BANDS: readonly string[] = ['watch', 'at-risk', 'critical'] as const;

export interface EtwinDashboardInputs {
  nowIso: string;
  /** P15's own summary, composed verbatim; null when the twin is unreadable. */
  twin: TwinSummary | null;
  runtime: EtwinRuntimeTwin;
  platforms: EtwinPlatformTwins;
  coverage: EtwinCoverageMap;
  simulation: EtwinSimulationInventory;
  history: EtwinHistoryView;
}

export function composeTwinRecommendations(inp: EtwinDashboardInputs): OperationsRecommendation[] {
  const recs: OperationsRecommendation[] = [];

  const attention = inp.platforms.platforms.filter((p) => p.state === 'attention');
  if (attention.length > 0) {
    recs.push(
      mkRecommendation({
        id: 'etwinrec:platform:attention',
        title: `${attention.length} platform twin(s) reporting outstanding work`,
        detail: attention.map((p) => `${p.label}: ${p.summary}`).join(' '),
        priority: 'high',
        suggestedAction:
          'Open each platform’s own Center (each row names its stage and module); the work is governed there, not here.',
        evidence: attention.map((p) => p.id),
        reasoning:
          'Each platform published the slice itself — the twin composes what its owner reported and assesses nothing independently.',
        confidence: 0.9,
        affectedSystems: attention.map((p) => p.id),
        operationalImpact: 'Platforms the enterprise twin covers are reporting unresolved items.',
        expectedBusinessOutcome: 'Each owning platform clears its own outstanding work through its existing flows.',
        rollbackImplications: 'Recommendation only; the twin composes views and has nothing to roll back.',
      }),
    );
  }

  const unknown = inp.platforms.platforms.filter((p) => p.state === 'unknown');
  if (unknown.length > 0) {
    recs.push(
      mkRecommendation({
        id: 'etwinrec:platform:unknown',
        title: `${unknown.length} platform twin(s) unreadable this pass`,
        detail: `No state is assumed for: ${unknown.map((p) => p.label).join(', ')}.`,
        priority: 'medium',
        suggestedAction:
          'Check whether each subsystem initialised (the runtime wires each platform independently); the twin reports readability and repairs nothing.',
        evidence: unknown.map((p) => p.id),
        reasoning:
          'A platform slice that could not be read is recorded as unknown rather than defaulted to steady — an observability gap, not a health claim.',
        confidence: 0.8,
        affectedSystems: unknown.map((p) => p.id),
        operationalImpact: 'The enterprise twin has no coverage of those platforms until they can be read.',
        expectedBusinessOutcome: 'Every Phase 6 platform is readable, so the twin’s coverage is complete.',
        rollbackImplications: 'Recommendation only; nothing was changed to roll back.',
      }),
    );
  }

  const stats = inp.runtime.execution.stats;
  if (stats !== null && stats.failed > 0) {
    // `stats` and the session history are two SEPARATE reads of a live engine,
    // so a failure the engine has counted need not still be visible per-kind:
    // the history can be trimmed, or a session can fail between the two calls.
    // When that happens the per-kind list is empty, and an empty evidence array
    // makes the Principle-C guard throw — which would take the whole read-only
    // dashboard down over a recommendation. The failure is real either way, so
    // the evidence falls back to naming the read that reported it rather than
    // claiming a kind the retained history cannot support.
    const failingKinds = inp.runtime.execution.kinds
      .filter((k) => k.failed > 0)
      .map((k) => `kind:${k.kind}`);
    recs.push(
      mkRecommendation({
        id: 'etwinrec:runtime:failed',
        title: `${stats.failed} failed execution session(s) in the current process`,
        detail: `${stats.completed} completed · ${stats.failed} failed · ${stats.cancelled} cancelled across ${inp.runtime.execution.registeredKinds.length} registered kind(s).`,
        priority: 'high',
        suggestedAction:
          'Review the failing kinds on the surfaces that own them; re-running work happens through the Execute Engine’s existing flows, never from the twin.',
        evidence: failingKinds.length > 0 ? failingKinds : ['execute-engine:stats'],
        reasoning:
          'The Execute Engine’s own statistics, composed verbatim — the twin counts nothing and recomputes no success rate.',
        confidence: 0.9,
        affectedSystems: ['execute-engine'],
        operationalImpact: 'Execution work is failing in the running process.',
        expectedBusinessOutcome: 'The failing execution kinds succeed again.',
        rollbackImplications:
          'Recommendation only. Note the session history is in-memory, so it is lost on restart whether or not this is acted on.',
      }),
    );
  }

  const troubled = inp.runtime.supervisor.rows.filter((r) => r.recovering || r.failures > 0);
  if (troubled.length > 0) {
    recs.push(
      mkRecommendation({
        id: 'etwinrec:runtime:supervisor',
        title: `${troubled.length} supervised subsystem(s) recovering or with recorded recovery failures`,
        detail: troubled
          .map((r) => `${r.subsystem}: ${r.recovering ? 'recovering now' : 'idle'}, ${r.failures} failed recovery(ies) of ${r.recoveries}`)
          .join('; '),
        priority: troubled.some((r) => r.recovering) ? 'high' : 'medium',
        suggestedAction:
          'Inspect the subsystem and its recovery policy in the Runtime Supervisor; the twin never starts, stops or re-policies recovery.',
        evidence: troubled.map((r) => `subsystem:${r.subsystem}`),
        reasoning:
          'The Runtime Supervisor’s own status and recovery records, composed verbatim — no recovery is attempted or judged here.',
        confidence: 0.85,
        affectedSystems: troubled.map((r) => r.subsystem),
        operationalImpact: 'Supervised subsystems are unstable or have failed to self-recover.',
        expectedBusinessOutcome: 'Supervised subsystems recover cleanly and stop requiring intervention.',
        rollbackImplications: 'Recommendation only; recovery policy is unchanged by the twin.',
      }),
    );
  }

  if (inp.twin !== null && UNHEALTHY_BANDS.includes(inp.twin.healthBand)) {
    recs.push(
      mkRecommendation({
        id: 'etwinrec:twin:band',
        title: `The enterprise twin reports a ${inp.twin.healthBand} health band`,
        detail: `Overall health ${inp.twin.overallHealth} across ${inp.twin.domainCount} domain(s) and ${inp.twin.totalEntities} entity(ies); ${inp.twin.criticalImpactNodes} critical impact node(s).`,
        priority: inp.twin.healthBand === 'critical' ? 'critical' : 'high',
        suggestedAction:
          'Open the Digital Twin Center’s domain and impact views (P15) — the band, its domains and its impact graph are all owned there.',
        evidence: [`health:${inp.twin.overallHealth}`, `band:${inp.twin.healthBand}`, `impact-nodes:${inp.twin.criticalImpactNodes}`],
        reasoning:
          'P15 computed the band; Stage 13 composed it verbatim and re-derived no health of its own.',
        confidence: 0.9,
        affectedSystems: ['enterprise-twin'],
        operationalImpact: 'The enterprise twin’s own health assessment is outside the healthy band.',
        expectedBusinessOutcome: 'The domains driving the band return to healthy.',
        rollbackImplications: 'Recommendation only; the twin is a projection and changes nothing.',
      }),
    );
  }

  return recs;
}

export function composeTwinDashboard(inp: EtwinDashboardInputs): EtwinDashboard {
  const recommendations = composeTwinRecommendations(inp);
  const unavailable: EtwinUnavailable[] = [
    ...inp.runtime.unavailable,
    ...inp.platforms.unavailable,
    ...inp.coverage.unavailable,
    ...inp.simulation.unavailable,
    ...inp.history.unavailable,
  ].filter((u, i, arr) => arr.findIndex((x) => x.system === u.system) === i);

  const stats = inp.runtime.execution.stats;

  return {
    generatedAt: inp.nowIso,
    twin:
      inp.twin === null
        ? null
        : {
            domainCount: inp.twin.domainCount,
            totalEntities: inp.twin.totalEntities,
            overallHealth: inp.twin.overallHealth,
            healthBand: inp.twin.healthBand,
            criticalImpactNodes: inp.twin.criticalImpactNodes,
            openDecisions: inp.twin.openDecisions,
          },
    runtime: {
      available: inp.runtime.execution.available || inp.runtime.supervisor.available,
      activeSessions: inp.runtime.execution.activeCount,
      registeredKinds: inp.runtime.execution.registeredKinds.length,
      // Null, not zero, when the engine could not be read this pass.
      failed: stats === null ? null : stats.failed,
      recovering: inp.runtime.supervisor.status === null ? null : inp.runtime.supervisor.status.recovering.length,
    },
    // Mapped field-by-field, never spread: `EtwinPlatformTwins.totals` names its
    // count `platforms`, while the dashboard names every rollup count `total`
    // (matching the `coverage` sibling below). The two shapes are deliberately
    // different, so a spread here would be a silent structural mismatch.
    platforms: {
      total: inp.platforms.totals.platforms,
      steady: inp.platforms.totals.steady,
      attention: inp.platforms.totals.attention,
      unknown: inp.platforms.totals.unknown,
    },
    coverage: { ...inp.coverage.totals },
    simulation: { registered: inp.simulation.totals.registered, liveInstances: inp.simulation.totals.liveInstances },
    history: { ...inp.history.totals },
    recommendations,
    disclosures: [...ETWIN_DISCLOSURES],
    unavailable,
  };
}

export function composeTwinReport(inp: EtwinDashboardInputs): EtwinReport {
  const d = composeTwinDashboard(inp);
  return {
    generatedAt: inp.nowIso,
    title: 'Enterprise digital twin platform — executive report',
    sections: [
      {
        title: 'Enterprise twin (P15, composed verbatim)',
        lines:
          d.twin === null
            ? ['The P15 enterprise twin was unreadable this pass — no health is assumed.']
            : [
                `${d.twin.domainCount} domain(s) · ${d.twin.totalEntities} entity(ies) · overall health ${d.twin.overallHealth} (${d.twin.healthBand}).`,
                `${d.twin.criticalImpactNodes} critical impact node(s) · ${d.twin.openDecisions} open decision(s).`,
              ],
      },
      {
        title: 'Runtime & execution twin (the estate P15 has no domain for)',
        lines: [
          d.runtime.available
            ? `${d.runtime.activeSessions} active session(s) across ${d.runtime.registeredKinds} registered kind(s)` +
              (d.runtime.failed === null ? ' · execution statistics unreadable.' : ` · ${d.runtime.failed} failed.`) +
              (d.runtime.recovering === null ? ' Supervisor unreadable.' : ` ${d.runtime.recovering} subsystem(s) recovering.`)
            : 'Neither the Execute Engine nor the Runtime Supervisor was readable this pass.',
          ...inp.runtime.execution.kinds.filter((k) => k.failed > 0).map((k) => `FAILING — ${k.kind}: ${k.failed} of ${k.historical} historical session(s).`),
          inp.runtime.disclosure,
        ],
      },
      {
        title: 'Platform twins (Stage 6–12)',
        lines: [
          `${d.platforms.total} platform(s): ${d.platforms.steady} steady · ${d.platforms.attention} needing attention · ${d.platforms.unknown} unreadable.`,
          ...inp.platforms.platforms.map((p) => `${p.label} (${p.stage}): ${p.state.toUpperCase()} — ${p.summary}`),
        ],
      },
      {
        title: 'State coverage (what the twin does and does not model)',
        lines: [
          `${d.coverage.total} state kind(s): ${d.coverage.modelledByTwin} by the twin · ${d.coverage.modelledElsewhere} elsewhere · ${d.coverage.notModelled} not modelled.`,
          ...(inp.coverage.notModelled.length > 0
            ? [`Not modelled anywhere: ${inp.coverage.notModelled.join('; ')}.`]
            : ['Every registered state kind has a named owner.']),
          inp.coverage.disclosure,
        ],
      },
      {
        title: 'Simulation capability (registered, never invoked)',
        lines: [
          `${d.simulation.registered} registered capabilit(ies) · ${d.simulation.liveInstances} live instance(s) observed.`,
          ...inp.simulation.entries.map((e) => `${e.label}: ${e.cannotSimulate}`),
          inp.simulation.disclosure,
        ],
      },
      {
        title: 'Recorded history (Stage 12’s deltas, composed verbatim)',
        lines: [
          `${d.history.improving} improving · ${d.history.stable} stable · ${d.history.regressing} regressing · ${d.history.unavailable} without a recorded series.`,
          inp.history.recordedDays === null
            ? 'The health history store was unreadable this pass.'
            : `${inp.history.recordedDays} recorded day(s) of health history.`,
          inp.history.recordedDecisions === null
            ? 'The decision store was unreadable this pass.'
            : `${inp.history.recordedDecisions} recorded decision(s).`,
          ...inp.history.untrendable.map((u) => `UNTRENDABLE — ${u.label}: ${u.reason}`),
        ],
      },
      {
        title: 'Twin focus (recommendations only — nothing executes from here)',
        lines:
          d.recommendations.length === 0
            ? ['No twin focus items by the composed values.']
            : d.recommendations.map((r) => `${r.priority.toUpperCase()} · ${r.title} → ${r.suggestedAction}`),
      },
    ],
  };
}
