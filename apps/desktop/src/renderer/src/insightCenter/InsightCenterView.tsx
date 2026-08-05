/**
 * Phase 6 Stage 6 — the Executive Intelligence Dashboard (6.11), rendered
 * inside the existing Intelligence workspace. Pure presentation over the
 * composed dashboard: current enterprise status (eight explained health
 * domains), active risks (correlated incidents), tracked predictions,
 * recommended actions with evidence + the outcome lifecycle, the dependency
 * explanation ("how signals produced this"), the 30-day trend, and the signal
 * honesty strip. Nothing here computes intelligence and nothing executes —
 * acting on a recommendation hands off to the Assistant's approval flow.
 */
import { useMemo, useState } from 'react';
import type { InsightDashboard } from '@neuropause/shared';
import { Icon } from '@renderer/components/ui/Icon';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { EmptyState, ErrorBlock, LoadingBlock, Meter } from '@renderer/operationsCenter/primitives';
import { setPendingAssistantQuery } from '@renderer/assistant/assistantHandoff';
import {
  dashboardHeader,
  domainRows,
  explainRecommendation,
  incidentRows,
  predictionRows,
  recommendationRows,
  signalRows,
  trendModel,
} from './insightCenterModel';

type HostState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; dashboard: InsightDashboard };

export interface InsightCenterViewProps {
  state: HostState;
  onRefresh: () => void;
  onNavigate?: (section: 'assistant') => void;
}

export function InsightCenterView(p: InsightCenterViewProps): JSX.Element {
  if (p.state.state === 'loading') return <LoadingBlock label="Composing enterprise intelligence…" />;
  if (p.state.state === 'error') return <ErrorBlock message={p.state.message} onRetry={p.onRefresh} />;
  return <Ready dashboard={p.state.dashboard} onRefresh={p.onRefresh} {...(p.onNavigate ? { onNavigate: p.onNavigate } : {})} />;
}

function Ready({
  dashboard: d,
  onRefresh,
  onNavigate,
}: {
  dashboard: InsightDashboard;
  onRefresh: () => void;
  onNavigate?: (section: 'assistant') => void;
}): JSX.Element {
  const [explain, setExplain] = useState<string | null>(null);
  const header = useMemo(() => dashboardHeader(d), [d]);
  const domains = useMemo(() => domainRows(d.health), [d]);
  const incidents = useMemo(() => incidentRows(d.activeIncidents), [d]);
  const predictions = useMemo(() => predictionRows(d.predictions), [d]);
  const recommendations = useMemo(() => recommendationRows(d.recommendations), [d]);
  const signals = useMemo(() => signalRows(d.signals), [d]);
  const trend = useMemo(() => trendModel(d.trend), [d]);

  const askAssistant = (query: string): void => {
    setPendingAssistantQuery(query);
    onNavigate?.('assistant');
  };

  return (
    <div>
      {/* ── header: status + confidence + honesty strip ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge tone={header.tone} label={`Enterprise health ${header.healthText} · ${header.band}`} />
          <span className="text-xs text-faint">{header.signals.available}/{header.signals.total} signals available{header.signals.stale > 0 ? ` · ${header.signals.stale} aging/stale` : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xs text-faint" title={header.confidenceDetail}>
            Confidence {header.confidencePct}% — {header.confidenceDetail}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
          >
            <Icon name="pulse" size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── current enterprise status: the eight explained domains ── */}
      <OpsPanel title="Enterprise health" subtitle="Eight domains, composed from existing computations — every score explained, low confidence declared">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {domains.map((dm) => (
            <div key={dm.key} className="surface-raised rounded-2xl p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-faint">{dm.label}</span>
                <StatusBadge tone={dm.tone} label={dm.scoreText} />
              </div>
              <p className="mt-2 text-2xs leading-snug text-muted">{dm.unavailable ? `Unavailable — ${dm.unavailable}` : dm.explanation}</p>
              <div className="mt-2 text-2xs text-faint">
                {dm.unavailable ? 'no evidence' : `${dm.evidenceCount} evidence ref(s) · confidence ${dm.confidencePct}%`}
                {dm.lowConfidence && <span className="ml-1 text-sysorange">· low confidence</span>}
              </div>
            </div>
          ))}
        </div>
        {trend.points.length > 1 && (
          <div className="mt-4 rounded-2xl border border-[var(--hairline)] p-4">
            <div className="mb-2 flex items-center justify-between text-2xs text-faint">
              <span className="font-semibold uppercase tracking-wide">Health trend ({trend.points.length} days)</span>
              {trend.deltaText && <span>{trend.deltaText} vs window start</span>}
            </div>
            <div className="flex h-12 items-end gap-[2px]">
              {trend.points.map((pt) => (
                <div
                  key={pt.day}
                  title={`${pt.day}: ${pt.overall}/100`}
                  className="min-w-[3px] flex-1 rounded-t bg-sysblue/60"
                  style={{ height: `${Math.max(6, pt.y01 * 100)}%` }}
                />
              ))}
            </div>
          </div>
        )}
      </OpsPanel>

      {/* ── active risks + predictions ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <OpsPanel title="Active risks" subtitle="Correlated incidents from operational + infrastructure events">
          {incidents.length === 0 ? (
            <EmptyState icon="check" title="No open incidents" hint="Correlated event clusters produced no active anomalies in the window." />
          ) : (
            <ul className="space-y-2">
              {incidents.map((i) => (
                <li key={i.id} className="surface-raised rounded-2xl p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-ink">{i.title}</span>
                    <StatusBadge tone={i.tone} label={i.severity} />
                  </div>
                  <div className="mt-1 text-2xs text-muted">{i.causeText} · blast radius {i.blastRadius}</div>
                  {i.action && <div className="mt-1 text-2xs text-faint">{i.action}</div>}
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>

        <OpsPanel title="Predictions" subtitle="Deterministic heuristics over recorded history — evidence + horizon on every projection">
          {predictions.length === 0 ? (
            <EmptyState icon="sparkles" title="No projections firing" hint="No heuristic has enough evidence — nothing is projected, and nothing is invented." />
          ) : (
            <ul className="space-y-2">
              {predictions.map((pr) => (
                <li key={pr.id} className="surface-raised rounded-2xl p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-ink">{pr.title}</span>
                    <span className="shrink-0 text-2xs font-semibold text-sysorange">{pr.likelihoodPct}% · {pr.horizonText}</span>
                  </div>
                  <p className="mt-1 text-2xs leading-snug text-muted">{pr.detail}</p>
                  <div className="mt-1.5 text-2xs text-faint">
                    Basis: {pr.basis} · {pr.evidenceCount} evidence ref(s) · confidence {pr.confidencePct}%
                  </div>
                </li>
              ))}
            </ul>
          )}
        </OpsPanel>
      </div>

      {/* ── recommended actions with outcome lifecycle + dependency explanation ── */}
      <OpsPanel
        title="Recommended actions"
        subtitle="Governed suggestions — anything that acts runs only as an approved assistant plan step through the ExecuteEngine"
      >
        {recommendations.length === 0 ? (
          <EmptyState icon="check" title="Nothing to recommend" hint="No engine or heuristic produced a recommendation from the current evidence." />
        ) : (
          <ul className="space-y-2.5">
            {recommendations.map((r) => (
              <li key={r.id} className="surface-raised rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{r.title}</span>
                      <StatusBadge tone={r.tone} label={r.priority} />
                      <StatusBadge tone={r.outcome.tone} label={r.outcome.label} />
                    </div>
                    <p className="mt-1 text-2xs leading-snug text-muted">{r.detail}</p>
                    <div className="mt-1 text-2xs text-faint" title={r.confidenceDetail}>
                      Confidence {r.confidencePct}% · signals: {r.signals.join(', ') || '—'}
                      {r.evidence.length > 0 && <> · evidence: {r.evidence.join(', ')}</>}
                    </div>
                    {r.outcomeSteps.length > 1 && (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-2xs text-faint">
                        {r.outcomeSteps.map((s) => (
                          <span key={s.stage} title={s.detail} className="rounded-full border border-[var(--hairline)] px-2 py-0.5">
                            {s.stage}
                          </span>
                        ))}
                      </div>
                    )}
                    {explain === r.id && <Explanation dashboard={d} recoId={r.id} />}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExplain(explain === r.id ? null : r.id)}
                      className="rounded-lg border border-[var(--hairline)] px-2 py-1 text-2xs font-medium text-muted hover:text-ink"
                    >
                      {explain === r.id ? 'Hide why' : 'Why?'}
                    </button>
                    <button
                      type="button"
                      onClick={() => askAssistant(r.action)}
                      className="rounded-lg border border-[var(--hairline)] px-2 py-1 text-2xs font-medium text-muted hover:text-ink"
                      title="Hand this suggestion to the Assistant — execution requires your approval there"
                    >
                      Ask assistant
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {d.recentlyVerified.length > 0 && (
          <div className="mt-3 rounded-2xl border border-[var(--hairline)] p-3.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-faint">Recently verified</div>
            <ul className="mt-1.5 space-y-1">
              {d.recentlyVerified.slice(0, 5).map((v) => (
                <li key={v.id} className="flex items-baseline justify-between gap-3 text-2xs">
                  <span className="min-w-0 truncate text-muted">{v.title}</span>
                  <span className="shrink-0 text-faint">condition cleared · {v.at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </OpsPanel>

      {/* ── signal honesty strip ── */}
      <OpsPanel title="Signals" subtitle="The Enterprise Signal Map at report time — freshness, completeness, and availability (registry-locked)">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {signals.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
              <span className="min-w-0 truncate text-xs text-ink">{s.id}</span>
              <span className="shrink-0" title={s.note ?? undefined}>
                <StatusBadge tone={s.tone} label={s.statusText} />
              </span>
            </div>
          ))}
        </div>
        {d.unavailable.length > 0 && (
          <p className="mt-3 text-2xs text-faint">
            Unavailable at report time: {d.unavailable.map((u) => `${u.system} (${u.reason})`).join(' · ')}
          </p>
        )}
      </OpsPanel>

      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon="pulse" label="Open incidents" tone={incidents.length ? 'orange' : 'green'} value={incidents.length} />
        <Stat icon="sparkles" label="Predictions" value={predictions.length} />
        <Stat icon="lightbulb" label="Recommendations" value={recommendations.length} />
        <Stat icon="verified" label="Verified outcomes" tone={d.recentlyVerified.length ? 'green' : 'gray'} value={d.recentlyVerified.length} />
      </div>
      <div className="pb-6">
        <Meter value={Math.max(0, Math.min(1, (d.health.overall ?? 0) / 100))} tone={header.tone === 'gray' ? 'accent' : header.tone} label="Overall enterprise health" trailing={header.healthText} />
      </div>
    </div>
  );
}

/** The dependency-graph walk for one recommendation ("how signals produced this"). */
function Explanation({ dashboard, recoId }: { dashboard: InsightDashboard; recoId: string }): JSX.Element {
  const lines = useMemo(
    () => explainRecommendation(dashboard.dependencies, recoId),
    [dashboard, recoId],
  );
  if (lines.length === 0) {
    return <p className="mt-2 text-2xs text-faint">No dependency path recorded for this recommendation.</p>;
  }
  return (
    <div className="mt-2 rounded-xl border border-[var(--hairline)] p-2.5">
      <div className="text-2xs font-semibold uppercase tracking-wide text-faint">How signals produced this</div>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l, i) => (
          <li key={`${l.kind}:${i}`} className="flex items-center gap-1.5 text-2xs text-muted">
            <Icon name={l.kind === 'signal' ? 'connectors' : l.kind === 'finding' ? 'info' : 'lightbulb'} size={11} />
            <span className="text-faint">{l.kind}</span>
            <span className="min-w-0 flex-1 truncate">{l.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

