import type { EnterpriseIntelligenceReport } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { ScoreRing } from '@renderer/enterprise/primitives';
import {
  bandLabel,
  domainLabel,
  groupKpis,
  headline,
  healthDials,
  pct01,
  priorityTone,
  recoCategoryLabel,
  relativeTime,
  riskScoreTone,
  score100,
  severityLabel,
  severityTone,
  sortedIncidents,
  sortedRecommendations,
  type OpsCenterTab,
} from '../opsModel';
import { EmptyState, Field, Grid, KpiCard, Meter, Pill } from '../primitives';

interface PanelProps {
  report: EnterpriseIntelligenceReport;
  nowMs: number;
}

/* ── Enterprise Home ────────────────────────────────────────────────────────── */

export function HomePanel({
  report,
  nowMs,
  onNavigate,
}: PanelProps & { onNavigate: (tab: OpsCenterTab) => void }): JSX.Element {
  const h = headline(report);
  const incidents = sortedIncidents(report.incidents.incidents).slice(0, 4);
  const recs = sortedRecommendations(report.recommendations).slice(0, 4);
  const topRisks = report.risk.topRisks.slice(0, 5);

  return (
    <div>
      {/* Hero */}
      <Card variant="flat" className="mb-6">
        <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-6">
            <ScoreRing value={h.healthScore / 100} label="Health" tone={h.healthTone} size={148} />
            <ScoreRing value={h.riskScore / 100} label="Risk" tone={h.riskTone} size={116} />
          </div>
          <div className="flex-1 md:pl-8">
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Enterprise posture</h2>
              <Pill tone={h.healthTone} label={bandLabel(h.healthBand)} />
            </div>
            <p className="max-w-[520px] text-sm text-muted">
              {h.nodes.toLocaleString()} entities · {h.edges.toLocaleString()} relationships across the unified
              Enterprise Graph. {h.openIncidents > 0 ? `${h.openIncidents} open incident${h.openIncidents === 1 ? '' : 's'}` : 'No open incidents'} · {h.spofCount} single point{h.spofCount === 1 ? '' : 's'} of failure.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MiniStat label="Open incidents" value={`${h.openIncidents}`} tone={h.openIncidents ? 'red' : 'green'} onClick={() => onNavigate('incidents')} />
              <MiniStat label="Critical actions" value={`${h.criticalRecommendations}`} tone={h.criticalRecommendations ? 'orange' : 'green'} onClick={() => onNavigate('recommendations')} />
              <MiniStat label="SPOFs" value={`${h.spofCount}`} tone={h.spofCount ? 'orange' : 'green'} onClick={() => onNavigate('dependencies')} />
              <MiniStat label="Drift in-sync" value={`${score100(h.driftScore)}%`} tone={riskScoreTone(100 - h.driftScore)} onClick={() => onNavigate('intelligence')} />
              <MiniStat label="Capacity load" value={`${score100(h.capacityPressure)}`} tone={riskScoreTone(h.capacityPressure)} onClick={() => onNavigate('capacity')} />
              <MiniStat label="Graph" value={`${h.nodes}`} tone="blue" onClick={() => onNavigate('graph')} />
            </div>
          </div>
        </div>
      </Card>

      {/* Two columns: incidents + recommendations */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel
          title="Active incidents"
          subtitle={`${report.incidents.open} open · ${report.incidents.total} total`}
          actions={<LinkOut onClick={() => onNavigate('incidents')} />}
        >
          {incidents.length ? (
            <div className="flex flex-col gap-2">
              {incidents.map((inc) => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => onNavigate('incidents')}
                  className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={severityTone(inc.severity)} label={severityLabel(inc.severity)} pulse={inc.severity === 'critical'} />
                      <span className="truncate text-sm font-medium">{inc.title}</span>
                    </div>
                    <p className="mt-0.5 text-2xs text-faint">
                      blast radius {inc.impact.blastRadius} · {relativeTime(inc.startTs, nowMs)}
                    </p>
                  </div>
                  <Icon name="chevron-right" size={16} className="shrink-0 text-faint" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon="check" title="No incidents" hint="No correlated incidents in the current window." />
          )}
        </OpsPanel>

        <OpsPanel
          title="Priority recommendations"
          subtitle="Ranked across every engine"
          actions={<LinkOut onClick={() => onNavigate('recommendations')} />}
        >
          {recs.length ? (
            <div className="flex flex-col gap-2">
              {recs.map((rec) => (
                <div key={rec.id} className="surface-raised rounded-xl p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{rec.title}</span>
                    <Pill tone={priorityTone(rec.priority)} label={rec.priority} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-2xs text-faint">{rec.detail}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-2xs text-faint">
                    <span>{recoCategoryLabel(rec.category)}</span>
                    <span>·</span>
                    <span>confidence {pct01(rec.confidence)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="check" title="Nothing urgent" hint="No recommendations are open right now." />
          )}
        </OpsPanel>
      </div>

      {/* Top risks */}
      <OpsPanel title="Top risk contributors" subtitle="Highest-risk entities across all categories" actions={<LinkOut onClick={() => onNavigate('risk')} />} className="mt-2">
        {topRisks.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {topRisks.map((r) => (
              <div key={r.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.label}</div>
                  <div className="text-2xs text-faint">{domainLabel(r.domain)} · {r.reason}</div>
                </div>
                <span className={cn('text-lg font-semibold tabular', riskScoreTone(r.risk) === 'red' ? 'text-white' : 'text-white/80')}>{Math.round(r.risk)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="shield" title="No elevated risks" />
        )}
      </OpsPanel>
    </div>
  );
}

function MiniStat({ label, value, tone, onClick }: { label: string; value: string; tone: ReturnType<typeof riskScoreTone>; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-left transition hover:border-white/20">
      <div className="text-2xs uppercase tracking-wide text-faint">{label}</div>
      <div className={cn('mt-0.5 text-lg font-semibold tabular', tone === 'red' ? 'text-white' : 'text-ink')}>{value}</div>
    </button>
  );
}

function LinkOut({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-ink">
      Open <Icon name="arrow-right" size={13} />
    </button>
  );
}

/* ── Enterprise Intelligence Dashboard ──────────────────────────────────────── */

export function IntelligencePanel({ report }: PanelProps): JSX.Element {
  const groups = groupKpis(report.kpis);
  const h = headline(report);
  return (
    <div>
      <OpsPanel title="Intelligence overview" subtitle="Every engine, one snapshot">
        <Grid cols={4}>
          <Stat icon="heart" label="Health" value={score100(h.healthScore)} tone={h.healthTone} hint={bandLabel(h.healthBand)} />
          <Stat icon="shield" label="Risk" value={score100(h.riskScore)} tone={h.riskTone} hint={bandLabel(h.riskBand)} />
          <Stat icon="pulse" label="Open incidents" value={h.openIncidents} tone={h.openIncidents ? 'red' : 'green'} />
          <Stat icon="layers" label="Drift in-sync" value={`${score100(h.driftScore)}%`} tone={riskScoreTone(100 - h.driftScore)} />
          <Stat icon="gauge" label="Capacity load" value={score100(h.capacityPressure)} tone={riskScoreTone(h.capacityPressure)} />
          <Stat icon="shield" label="SPOFs" value={h.spofCount} tone={h.spofCount ? 'orange' : 'green'} />
          <Stat icon="grid" label="Entities" value={h.nodes.toLocaleString()} tone="blue" />
          <Stat icon="connectors" label="Relationships" value={h.edges.toLocaleString()} tone="blue" />
        </Grid>
      </OpsPanel>

      {groups.map((g) => (
        <OpsPanel key={g.key} title={`${g.label} metrics`}>
          <Grid cols={4}>
            {g.kpis.map((kpi) => (
              <KpiCard key={kpi.key} kpi={kpi} tone={kpi.band ? (kpi.band === 'healthy' ? 'green' : kpi.band === 'watch' ? 'blue' : kpi.band === 'at-risk' ? 'orange' : 'red') : 'accent'} />
            ))}
          </Grid>
        </OpsPanel>
      ))}
    </div>
  );
}

/* ── Enterprise Health Dashboard ────────────────────────────────────────────── */

export function HealthPanel({ report }: PanelProps): JSX.Element {
  const dials = healthDials(report.health);
  return (
    <div>
      <OpsPanel title="Enterprise health" subtitle={`Overall ${score100(report.health.overall)} · ${bandLabel(report.health.band)}`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {dials.map((d) => (
            <Card key={d.key} variant="flat" className="flex flex-col items-center gap-3 py-5">
              <ScoreRing value={d.value} label={d.label} tone={d.tone} size={116} />
              <Pill tone={d.tone} label={bandLabel(d.band)} />
            </Card>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Scoring factors" subtitle="What each dimension is reading">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {dials.map((d) => (
            <Card key={d.key} variant="hairline">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{d.label}</span>
                <span className={cn('text-sm font-semibold tabular', d.tone === 'red' ? 'text-white' : 'text-white/80')}>{score100(d.score)}</span>
              </div>
              <Meter value={d.value} tone={d.tone} />
              {d.factors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.factors.map((f, i) => (
                    <span key={i} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-2xs text-faint">{f}</span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      </OpsPanel>

      <OpsPanel title="Report metadata">
        <Card variant="hairline">
          <Field label="Overall health" value={`${score100(report.health.overall)} / 100`} />
          <Field label="Band" value={bandLabel(report.health.band)} />
          <Field label="Dimensions" value={dials.length} />
          <Field label="Built at" value={new Date(report.health.builtAt).toLocaleString()} />
        </Card>
      </OpsPanel>
    </div>
  );
}
