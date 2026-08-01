/**
 * Phase 6 Stage 12 — the Analytics tab (inside the EXISTING Stage 6 Insight
 * Center). Presentation over the six read-only `eana:*` reads: the unified
 * KPI catalog with producer attribution, deterministic trends over recorded
 * windows (point-in-time series declared untrendable), the forecast-capability
 * inventory with explicit cannot-predict statements, the decision-intelligence
 * rollup, the cross-domain rollups, the Principle-C recommendations, and the
 * executive analytics report. The tab mutates nothing — every suggested action
 * points at an existing governed surface, and the tab says so.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  EanaDashboard,
  EanaDecisionReport,
  EanaForecastInventory,
  EanaKpiCatalog,
  EanaReport,
  EanaTrendReport,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, LoadingBlock } from '@renderer/operationsCenter/primitives';
import {
  decisionLines,
  domainTone,
  eanaHeaderStats,
  eanaRecommendationRows,
  forecastRows,
  kpiRows,
  trendRows,
  unavailableLines,
} from './eanaPlatformModel';

interface EanaData {
  dashboard: EanaDashboard | null;
  kpis: EanaKpiCatalog | null;
  trends: EanaTrendReport | null;
  forecasts: EanaForecastInventory | null;
  decisions: EanaDecisionReport | null;
  report: EanaReport | null;
}

const EMPTY: EanaData = { dashboard: null, kpis: null, trends: null, forecasts: null, decisions: null, report: null };

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export function EanaPlatformTab(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [d, setD] = useState<EanaData>(EMPTY);

  const refresh = useCallback(async () => {
    const [dashboard, kpis, trends, forecasts, decisions, report] = await Promise.all([
      settled(ipc.eana.dashboard(), null as EanaDashboard | null),
      settled(ipc.eana.kpis(), null as EanaKpiCatalog | null),
      settled(ipc.eana.trends(), null as EanaTrendReport | null),
      settled(ipc.eana.forecasts(), null as EanaForecastInventory | null),
      settled(ipc.eana.decisions(), null as EanaDecisionReport | null),
      settled(ipc.eana.report(), null as EanaReport | null),
    ]);
    setD({ dashboard, kpis, trends, forecasts, decisions, report });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!ready) return <LoadingBlock label="Composing enterprise analytics…" />;

  const stats = d.dashboard ? eanaHeaderStats(d.dashboard) : [];
  const unavailable = unavailableLines(
    [d.dashboard, d.kpis, d.trends, d.forecasts, d.decisions].filter((x): x is NonNullable<typeof x> => x !== null),
  );

  return (
    <>
      {stats.length > 0 && (
        <OpsPanel
          title="Enterprise Analytics Platform"
          subtitle="KPI catalog · recorded-window trends · forecast inventory · decision intelligence — composed from the producers the platform already runs; read-only"
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

      {d.dashboard && d.dashboard.domains.length > 0 && (
        <OpsPanel
          title="Domain rollups (composed from the stage dashboards)"
          subtitle="One line per platform dashboard — pre-composed slices; no dashboard logic duplicated here"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.dashboard.domains.map((dm) => (
              <div key={dm.stage} className="surface-raised rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-faint">{dm.label}</span>
                  <StatusBadge tone={domainTone(dm.state)} label={dm.state} />
                </div>
                <p className="mt-2 text-2xs leading-snug text-muted">{dm.summary}</p>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      {d.kpis && (
        <OpsPanel
          title={`Unified KPI catalog (${d.kpis.totals.total})`}
          subtitle="Every reachable feed, source-attributed — producers stay authoritative; bands composed verbatim; nothing recomputed"
        >
          {d.kpis.rows.length === 0 ? (
            <EmptyState icon="pulse" title="No KPI feed readable" hint="KPIs appear when their producers respond; failures are declared below." />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
              {kpiRows(d.kpis).map((r) => (
                <div key={`${r.key}:${r.attributionText}`} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Icon name="pulse" size={15} className="text-faint" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.label}</span>
                      <span className="text-2xs text-muted">{r.display}</span>
                      {r.band && <StatusBadge tone={r.bandTone} label={r.band} />}
                      {r.unregistered && <StatusBadge tone="orange" label="unregistered producer" />}
                    </div>
                    <div className="mt-0.5 text-2xs text-muted">{r.attributionText}</div>
                    <div className="mt-0.5 text-2xs text-faint">surfaces: {r.surfacesText}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {d.kpis.overlaps.length > 0 && (
            <div className="mt-3 text-2xs text-faint">
              Served on multiple feeds (reuse made visible, not resolved): {d.kpis.overlaps.map((o) => `${o.key} (${o.sources.join(' + ')})`).join(' · ')}
            </div>
          )}
          <div className="mt-2 text-2xs text-faint">{d.kpis.disclosure}</div>
        </OpsPanel>
      )}

      {d.trends && (
        <OpsPanel
          title="Trends (recorded windows only)"
          subtitle="Deterministic deltas over values the platform actually recorded — no extrapolation, no prediction, no smoothing"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {trendRows(d.trends).map((t) => (
              <div key={t.seriesId} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="sparkles" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{t.label}</span>
                    <StatusBadge tone={t.tone} label={t.pointInTime ? 'not trendable (declared)' : t.direction} />
                    <span className="text-2xs text-faint">{t.windowLabel}</span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{t.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.trends.disclosure}</div>
        </OpsPanel>
      )}

      {d.forecasts && (
        <OpsPanel
          title={`Forecast capability (${d.forecasts.totals.registered} registered · ${d.forecasts.totals.liveInstances} firing)`}
          subtitle="A REGISTER of the predictive capability that already exists — each entry states what it CAN and CANNOT predict; Stage 12 adds zero forecasting"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {forecastRows(d.forecasts).map((f) => (
              <div key={f.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="lightbulb" size={15} className="text-faint" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{f.id}</span>
                    <span className="text-2xs text-faint">{f.kindText}</span>
                    <StatusBadge tone={f.liveTone} label={f.liveText} />
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">CAN: {f.canPredict}</div>
                  <div className="mt-0.5 text-2xs text-muted">CANNOT: {f.cannotPredict}</div>
                  <div className="mt-0.5 text-2xs text-faint">basis: {f.basis}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.forecasts.disclosure}</div>
        </OpsPanel>
      )}

      {d.decisions && (
        <OpsPanel
          title="Decision intelligence"
          subtitle="Decision store × Stage 6 outcome loop × Stage 10 value verdicts (verbatim) × the sync recommendation inventories"
        >
          <div className="flex flex-col gap-1">
            {decisionLines(d.decisions).map((line) => (
              <div key={line} className="flex items-center gap-2 text-2xs text-muted">
                <Icon name="clipboard" size={12} />
                <span>{line}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-2xs text-faint">{d.decisions.disclosure}</div>
        </OpsPanel>
      )}

      {d.dashboard && d.dashboard.recommendations.length > 0 && (
        <OpsPanel
          title={`Recommendations (${d.dashboard.recommendations.length})`}
          subtitle="Principle-C items pointing at the existing governed surfaces — nothing executes from here"
        >
          <div className="surface-raised divide-y divide-[var(--hairline)] rounded-2xl px-4 shadow-card">
            {eanaRecommendationRows(d.dashboard).map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0">
                  <Icon name="pin" size={15} className="text-faint" />
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
        <OpsPanel title={d.report.title} subtitle="Sectioned, evidence-cited composition of the same computed views — no new facts at report level">
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
        <OpsPanel title="Declared unavailability" subtitle="Sources this composition could not read this pass — declared, never silently defaulted">
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
