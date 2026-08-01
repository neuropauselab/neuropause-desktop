/**
 * Phase 6 Stage 13 — the Twin Platform tab (inside the EXISTING P15 Digital Twin
 * Center). Presentation over the seven read-only `etwin:*` reads: the runtime and
 * execution twin, P15's own nine domains beside the Stage 6–12 platform twins,
 * the enterprise state-coverage map with the search evidence behind every gap,
 * the simulation register, the recorded-history view with its declared-
 * untrendable series, the executive dashboard, and the sectioned report.
 *
 * The tab mutates nothing. It also computes nothing: every number, band,
 * attribution, evidence string and unavailability reason on this screen was
 * produced by the main-process composition and is rendered verbatim through the
 * tested view-model in `./etwinPlatformModel`. Where a value could not be read,
 * this tab shows the words the model produced for that case instead of a blank
 * cell or a zero — the last place a `null` could quietly become a `0` is a
 * renderer, so the three honesty rules are visible here too: an unreadable
 * number is worded as unreadable, an `unknown` platform never reads as steady,
 * and every registered simulation says it was never invoked.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EtwinCoverageMap,
  EtwinDashboard,
  EtwinHistoryView,
  EtwinPlatformTwins,
  EtwinReport,
  EtwinRuntimeTwin,
  EtwinSimulationInventory,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  coverageRows,
  coverageTotalsLine,
  domainRows,
  domainTotalsLine,
  etwinHeaderStats,
  etwinRecommendationRows,
  executionKindRows,
  executionSummary,
  historyRows,
  platformRows,
  recordedFootprintLine,
  sessionRows,
  simulationRows,
  simulationTotalsLine,
  supervisorRows,
  unavailableLines,
  untrendableLines,
} from './etwinPlatformModel';

interface EtwinData {
  dashboard: EtwinDashboard | null;
  runtime: EtwinRuntimeTwin | null;
  platforms: EtwinPlatformTwins | null;
  coverage: EtwinCoverageMap | null;
  simulation: EtwinSimulationInventory | null;
  history: EtwinHistoryView | null;
  report: EtwinReport | null;
}

const EMPTY: EtwinData = {
  dashboard: null,
  runtime: null,
  platforms: null,
  coverage: null,
  simulation: null,
  history: null,
  report: null,
};

/**
 * A failed read yields `null` for that surface alone, so one unreadable channel
 * never blanks the other six. The tab then renders the null as an absent panel
 * rather than an empty one — an absent panel claims nothing, whereas an empty
 * table claims "nothing to report".
 */
async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function EtwinPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<EtwinData>(EMPTY);

  const refresh = useCallback(async () => {
    const [dashboard, runtime, platforms, coverage, simulation, history, report] = await Promise.all([
      settled(ipc.etwin.dashboard(), null as EtwinDashboard | null),
      settled(ipc.etwin.runtime(), null as EtwinRuntimeTwin | null),
      settled(ipc.etwin.platforms(), null as EtwinPlatformTwins | null),
      settled(ipc.etwin.coverage(), null as EtwinCoverageMap | null),
      settled(ipc.etwin.simulation(), null as EtwinSimulationInventory | null),
      settled(ipc.etwin.history(), null as EtwinHistoryView | null),
      settled(ipc.etwin.report(), null as EtwinReport | null),
    ]);
    setD({ dashboard, runtime, platforms, coverage, simulation, history, report });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return <LoadingBlock label="Composing the enterprise twin platform…" />;

  const stats = d.dashboard ? etwinHeaderStats(d.dashboard) : [];
  const execution = d.runtime ? executionSummary(d.runtime) : null;
  const unavailable = unavailableLines(
    [d.dashboard, d.runtime, d.platforms, d.coverage, d.simulation, d.history].filter(
      (x): x is NonNullable<typeof x> => x !== null,
    ),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Digital Twin Platform"
          subtitle="Runtime & execution twin · Stage 6–12 platform twins · state coverage · simulation register · recorded history — composed over the P15 twin, which stays authoritative and untouched; read-only"
        >
          <div className="flex flex-wrap gap-2">
            {stats.map((s) => (
              <span key={s.label} title={s.hint}>
                <StatusBadge tone={s.tone} label={`${s.label}: ${s.value}`} />
              </span>
            ))}
          </div>
          {d.dashboard && d.dashboard.disclosures.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {d.dashboard.disclosures.map((line) => (
                <div key={line} className="flex items-center gap-2 text-2xs text-faint">
                  <Icon name="shield" size={12} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      )}

      {d.platforms && (
        <OpsPanel
          title={`Enterprise domains (${d.platforms.domains.length})`}
          subtitle="P15's own nine domain twins, composed verbatim — Stage 13 counts no entity and derives no band"
        >
          {d.platforms.domains.length === 0 ? (
            <EmptyState
              icon="globe"
              title="P15 domains unreadable"
              hint="The authoritative twin did not answer this pass; the failure is declared below rather than shown as zero domains."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {domainRows(d.platforms).map((dm) => (
                <div key={dm.id} className="surface-raised rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-faint">{dm.label}</span>
                    <StatusBadge tone={dm.tone} label={dm.band} />
                  </div>
                  <p className="mt-2 text-2xs text-muted">{dm.entitiesText}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{domainTotalsLine(d.platforms)}</div>
        </OpsPanel>
      )}

      {d.platforms && (
        <OpsPanel
          title={`Platform twins (${d.platforms.totals.steady} steady · ${d.platforms.totals.attention} attention · ${d.platforms.totals.unknown} unknown)`}
          subtitle="The Stage 6–12 platforms the P15 twin never modelled — one pre-composed slice each; no dashboard logic duplicated here"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {platformRows(d.platforms).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="grid" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="text-2xs text-faint">{r.stage}</span>
                    <StatusBadge tone={r.tone} label={r.stateLabel} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.summary}</div>
                  {r.metricsText !== '' && <div className="mt-0.5 text-2xs text-muted">{r.metricsText}</div>}
                  <div className="mt-0.5 text-2xs text-faint">module: {r.module}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.platforms.disclosure}</div>
        </OpsPanel>
      )}

      {d.runtime && execution && (
        <OpsPanel
          title="Runtime & execution twin"
          subtitle="The Execute Engine and the Runtime Supervisor, projected — the partial-engine rule applies: if any of the four engine reads fails, the whole execution slice is null rather than half-composed"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={execution.available ? 'green' : 'gray'} label={execution.headline} />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {execution.statsLines.map((line) => (
              <div key={line} className="flex items-start gap-2 text-2xs text-muted">
                <Icon name="bolt" size={12} />
                <span>{line}</span>
              </div>
            ))}
          </div>

          {execution.available && (
            <>
              {executionKindRows(d.runtime).length > 0 && (
                <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                  {executionKindRows(d.runtime).map((k) => (
                    <div key={k.kind} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span className="text-sm font-medium">{k.kind}</span>
                      <StatusBadge tone={k.tone} label={k.activeText} />
                      <span className="text-2xs text-muted">{k.historicalText}</span>
                      <span className="text-2xs text-muted">{k.failedText}</span>
                    </div>
                  ))}
                </div>
              )}

              {sessionRows(d.runtime).length > 0 && (
                <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
                  {sessionRows(d.runtime).map((s) => (
                    <div key={`${s.live ? 'active' : 'recent'}:${s.id}`} className="flex items-start gap-3 py-2.5">
                      <span className="mt-0.5 shrink-0">
                        <Icon name="clock" size={15} className="text-faint" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{s.label}</span>
                          <StatusBadge tone={s.tone} label={s.state} />
                          {/* The two lists stay distinguishable: the composition
                              bounds them separately, so a reader is told which
                              list a row came from rather than being shown one
                              merged sequence the engine never asserted. */}
                          <StatusBadge tone={s.live ? 'blue' : 'gray'} label={s.live ? 'active' : 'recent'} />
                        </div>
                        <div className="mt-0.5 text-2xs text-muted">
                          {s.kind} · started {s.startedAt} · {s.durationText}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {supervisorRows(d.runtime).length > 0 && (
            <div className="mt-3 surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {supervisorRows(d.runtime).map((row) => (
                <div key={row.subsystem} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="server" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{row.subsystem}</span>
                      <StatusBadge tone={row.tone} label={row.stateText} />
                      <span className="text-2xs text-faint">policy: {row.policy}</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{row.detailText}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 text-2xs text-faint">{d.runtime.disclosure}</div>
        </OpsPanel>
      )}

      {d.coverage && (
        <OpsPanel
          title={`Enterprise state coverage (${d.coverage.totals.total})`}
          subtitle="What the enterprise twin models, what is modelled somewhere else, and what is not modelled at all — every gap cites the search that proved it"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {coverageRows(d.coverage).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="checklist" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <StatusBadge tone={r.tone} label={r.status} />
                    <StatusBadge tone={r.liveTone} label={r.liveText} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.ownerText}</div>
                  {/* Evidence is always shown, including on the rows that ARE
                      modelled — a coverage claim without its search is an
                      assertion, and the whole point of the map is that it is not
                      one. */}
                  <div className="mt-0.5 text-2xs text-faint">evidence: {r.evidence}</div>
                </div>
              </div>
            ))}
          </div>
          {d.coverage.notModelled.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {d.coverage.notModelled.map((line) => (
                <div key={line} className="flex items-start gap-2 text-2xs text-muted">
                  <Icon name="pin" size={12} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{coverageTotalsLine(d.coverage)}</div>
          <div className="mt-1 text-2xs text-faint">{d.coverage.disclosure}</div>
        </OpsPanel>
      )}

      {d.simulation && (
        <OpsPanel
          title={`Simulation register (${d.simulation.totals.registered} registered)`}
          subtitle="A REGISTER of the simulation capability that already exists — each entry states what it CAN and CANNOT simulate; Stage 13 invokes none of them"
        >
          {d.simulation.entries.length === 0 ? (
            <EmptyState
              icon="beaker"
              title="No simulation capability readable"
              hint="Entries appear when their modules respond; failures are declared below."
            />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {simulationRows(d.simulation).map((s) => (
                <div key={s.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="beaker" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="text-2xs text-faint">{s.kindText}</span>
                      <StatusBadge tone={s.liveTone} label={s.liveText} />
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">CAN: {s.canSimulate}</div>
                    <div className="mt-0.5 text-2xs text-muted">CANNOT: {s.cannotSimulate}</div>
                    <div className="mt-0.5 text-2xs text-muted">{s.scenarioText}</div>
                    {/* Printed on EVERY row, not only where it might surprise:
                        `invoked` is false by construction in this stage, so the
                        statement is structural rather than conditional. */}
                    <div className="mt-0.5 text-2xs text-faint">{s.invokedText}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{simulationTotalsLine(d.simulation)}</div>
          <div className="mt-1 text-2xs text-faint">{d.simulation.disclosure}</div>
        </OpsPanel>
      )}

      {d.history && (
        <OpsPanel
          title="Recorded history"
          subtitle="Deltas over windows the platform actually recorded — Stage 13 computes no trend, smooths nothing, and extrapolates nothing"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {historyRows(d.history).map((r) => (
              <div key={r.seriesId} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="pulse" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <StatusBadge tone={r.tone} label={r.pointInTime ? 'not trendable (declared)' : r.direction} />
                    <span className="text-2xs text-faint">{r.windowLabel}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.valueText}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {untrendableLines(d.history).length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {untrendableLines(d.history).map((line) => (
                <div key={line} className="flex items-start gap-2 text-2xs text-muted">
                  <Icon name="lock" size={12} />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-2xs text-faint">{recordedFootprintLine(d.history)}</div>
          <div className="mt-1 text-2xs text-faint">{d.history.disclosure}</div>
        </OpsPanel>
      )}

      {d.dashboard && d.dashboard.recommendations.length > 0 && (
        <OpsPanel
          title={`Recommendations (${d.dashboard.recommendations.length})`}
          subtitle="Principle-C items pointing at the existing governed surfaces — nothing executes from here"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {etwinRecommendationRows(d.dashboard).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="lightbulb" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.title}</span>
                    <StatusBadge tone={r.tone} label={r.priority} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{r.detail}</div>
                  <div className="mt-0.5 text-2xs text-muted">Suggested: {r.suggestedAction}</div>
                  <div className="mt-0.5 text-2xs text-faint">{r.principleC}</div>
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.report && (
        <OpsPanel
          title={d.report.title}
          subtitle="Sectioned, evidence-cited composition of the same computed views — no new facts at report level"
        >
          <div className="flex flex-col gap-3">
            {d.report.sections.map((s) => (
              <div key={s.title} className="rounded-2xl border border-[var(--hairline)] p-3">
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="mt-1 flex flex-col gap-0.5">
                  {s.lines.map((line, i) => (
                    <div key={i} className="text-2xs text-muted">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {unavailable.length > 0 && (
        <OpsPanel
          title="Declared unavailability"
          subtitle="Sources this composition could not read this pass — declared, never silently defaulted"
        >
          <div className="flex flex-col gap-1">
            {unavailable.map((line) => (
              <div key={line} className="text-2xs text-faint">
                {line}
              </div>
            ))}
          </div>
        </OpsPanel>
      )}
    </>
  );
}
