import { useMemo, useState, type ReactNode } from 'react';
import type {
  EnterpriseIntelligenceReport,
  Incident,
  RecoPriority,
  RiskCategory,
} from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { OpsPanel, Stat, StatusBadge, OpsTable } from '@renderer/operations/primitives';
import { ScoreRing } from '@renderer/enterprise/primitives';
import { Chip, ChipRow } from '@renderer/components/ui/pillTabs';
import {
  bandLabel,
  domainLabel,
  pct01,
  pressureTone,
  priorityTone,
  recoCategoryLabel,
  relativeTime,
  riskCategoryLabel,
  riskHeatCells,
  riskScoreTone,
  score100,
  severityLabel,
  severityTone,
  sortedIncidents,
  sortedRecommendations,
  formatDuration,
  formatMoney,
} from '../opsModel';
import { EmptyState, Field, Grid, HeatTile, Meter, Pill } from '../primitives';

interface PanelProps {
  report: EnterpriseIntelligenceReport;
  nowMs: number;
}

/* ── Risk Center ────────────────────────────────────────────────────────────── */

export function RiskPanel({ report }: PanelProps): JSX.Element {
  const cells = useMemo(() => riskHeatCells(report.risk), [report.risk]);
  const [selected, setSelected] = useState<RiskCategory | null>(null);
  const active = selected ?? cells[0]?.category ?? null;
  const activeCat = report.risk.categories.find((c) => c.category === active) ?? null;

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <Card variant="flat" className="flex flex-col items-center justify-center gap-3">
          <ScoreRing value={report.risk.overall / 100} label="Risk" tone={riskScoreTone(report.risk.overall)} size={140} />
          <Pill tone={riskScoreTone(report.risk.overall)} label={bandLabel(report.risk.band)} />
          <p className="text-2xs text-faint">confidence {pct01(report.risk.confidence)}</p>
        </Card>

        <OpsPanel title="Risk heatmap" subtitle="Six categories · brightness encodes severity" className="mb-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {cells.map((cell) => (
              <HeatTile key={cell.category} cell={cell} active={cell.category === active} onClick={() => setSelected(cell.category)} />
            ))}
          </div>
        </OpsPanel>
      </div>

      {activeCat && (
        <OpsPanel title={`${riskCategoryLabel(activeCat.category)} contributors`} subtitle={`Score ${score100(activeCat.score)} · ${bandLabel(activeCat.band)} · ${activeCat.sampleSize} entities analyzed`}>
          {activeCat.contributors.length ? (
            <OpsTable head={<><Th>Entity</Th><Th>Domain</Th><Th>Reason</Th><Th className="text-right">Risk</Th></>}>
              {activeCat.contributors.map((c) => (
                <tr key={c.id} className="border-t border-[var(--hairline)]">
                  <Td className="font-medium">{c.label}</Td>
                  <Td className="text-muted">{domainLabel(c.domain)}</Td>
                  <Td className="text-muted">{c.reason}</Td>
                  <Td className="text-right"><span className={cn('font-semibold tabular', riskScoreTone(c.risk) === 'red' ? 'text-white' : 'text-white/80')}>{Math.round(c.risk)}</span></Td>
                </tr>
              ))}
            </OpsTable>
          ) : (
            <EmptyState icon="shield" title="No contributors" hint={`No ${riskCategoryLabel(activeCat.category).toLowerCase()} entities crossed the risk threshold.`} />
          )}
        </OpsPanel>
      )}

      <OpsPanel title="Top risks enterprise-wide" subtitle="Across every category">
        {report.risk.topRisks.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.risk.topRisks.slice(0, 12).map((r) => (
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
          <EmptyState icon="check" title="No elevated risks" />
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Capacity Center ────────────────────────────────────────────────────────── */

export function CapacityPanel({ report }: PanelProps): JSX.Element {
  const cap = report.capacity;
  const growthPct = cap.growth.ratePct;
  return (
    <div>
      <OpsPanel title="Capacity & cost" subtitle="Read from discovered resource attributes">
        <Grid cols={4}>
          <Stat icon="gauge" label="Pressure" value={score100(cap.pressureScore)} tone={riskScoreTone(cap.pressureScore)} hint="0–100 load" />
          <Stat icon="activity" label="Avg utilization" value={cap.utilizationAvg != null ? `${score100(cap.utilizationAvg)}%` : '—'} tone={cap.utilizationAvg != null ? riskScoreTone(cap.utilizationAvg) : 'gray'} />
          <Stat icon="database" label="Monthly cost" value={formatMoney(cap.costTotal)} tone="blue" />
          <Stat icon="arrow-up" label="Growth" value={growthPct != null ? `${growthPct > 0 ? '+' : ''}${score100(growthPct)}%` : '—'} tone={growthPct != null && growthPct > 20 ? 'orange' : 'green'} hint={cap.growth.delta != null ? `${cap.growth.delta > 0 ? '+' : ''}${cap.growth.delta} resources` : undefined} />
        </Grid>
      </OpsPanel>

      <OpsPanel title="Pressure nodes" subtitle="Highest-utilization resources">
        {cap.pressureNodes.length ? (
          <OpsTable head={<><Th>Resource</Th><Th>Type</Th><Th className="text-right">Utilization</Th><Th>Pressure</Th></>}>
            {cap.pressureNodes.slice(0, 12).map((n) => (
              <tr key={n.id} className="border-t border-[var(--hairline)]">
                <Td className="font-medium">{n.label}</Td>
                <Td className="text-muted">{n.resourceType}</Td>
                <Td className="text-right tabular">{n.utilization != null ? `${Math.round(n.utilization)}%` : '—'}</Td>
                <Td><StatusBadge tone={pressureTone(n.pressure)} label={n.pressure} /></Td>
              </tr>
            ))}
          </OpsTable>
        ) : (
          <EmptyState icon="gauge" title="No pressure detected" hint="No resources reported elevated utilization." />
        )}
      </OpsPanel>

      {cap.costOutliers.length > 0 && (
        <OpsPanel title="Cost outliers" subtitle="Most expensive resources">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cap.costOutliers.slice(0, 8).map((n) => (
              <div key={n.id} className="surface-raised flex items-center justify-between gap-3 rounded-xl p-3 shadow-card">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{n.label}</div>
                  <div className="text-2xs text-faint">{n.resourceType}</div>
                </div>
                <span className="text-sm font-semibold tabular text-white/80">{n.cost != null ? formatMoney(n.cost) : '—'}</span>
              </div>
            ))}
          </div>
        </OpsPanel>
      )}

      <OpsPanel title="Scaling recommendations">
        {cap.recommendations.length ? (
          <div className="flex flex-col gap-2">
            {cap.recommendations.map((r, i) => (
              <div key={i} className="surface-raised flex items-start gap-2.5 rounded-xl p-3 shadow-card">
                <Icon name="lightbulb" size={16} className="mt-0.5 shrink-0 text-muted" />
                <span className="text-sm">{r}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="check" title="Capacity is comfortable" hint="No scaling actions recommended." />
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Incident Center ────────────────────────────────────────────────────────── */

export function IncidentPanel({ report, nowMs }: PanelProps): JSX.Element {
  const incidents = useMemo(() => sortedIncidents(report.incidents.incidents), [report.incidents.incidents]);
  const [selectedId, setSelectedId] = useState<string | null>(incidents[0]?.id ?? null);
  const selected = incidents.find((i) => i.id === selectedId) ?? incidents[0] ?? null;

  if (!incidents.length) {
    return (
      <OpsPanel title="Incident Center" subtitle="Correlated across the Enterprise Graph">
        <EmptyState icon="check" title="No active incidents" hint="No correlated incidents in the current window. Events are clustered by correlation id, then by resource + time proximity." />
      </OpsPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <OpsPanel title="Incidents" subtitle={`${report.incidents.open} open · ${report.incidents.total} total`} className="mb-0">
        <div className="flex flex-col gap-2">
          {incidents.map((inc) => (
            <button
              key={inc.id}
              type="button"
              onClick={() => setSelectedId(inc.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition',
                inc.id === selected?.id ? 'border-white/30 bg-white/[0.05]' : 'border-white/5 hover:border-white/15',
              )}
            >
              <div className="flex items-center gap-2">
                <StatusBadge tone={severityTone(inc.severity)} label={severityLabel(inc.severity)} pulse={inc.severity === 'critical'} />
                <span className="truncate text-sm font-medium">{inc.title}</span>
              </div>
              <p className="mt-1 text-2xs text-faint">blast radius {inc.impact.blastRadius} · {relativeTime(inc.startTs, nowMs)}</p>
            </button>
          ))}
        </div>
      </OpsPanel>

      {selected && <IncidentDetail incident={selected} nowMs={nowMs} />}
    </div>
  );
}

function IncidentDetail({ incident, nowMs }: { incident: Incident; nowMs: number }): JSX.Element {
  const domains = Object.entries(incident.impact.affectedByDomain).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <OpsPanel title={incident.title} subtitle={`${severityLabel(incident.severity)} · started ${relativeTime(incident.startTs, nowMs)}`} className="mb-4">
        <Grid cols={3}>
          <Stat icon="pulse" label="Blast radius" value={incident.impact.blastRadius} tone={incident.impact.blastRadius > 8 ? 'red' : 'orange'} />
          <Stat icon="clock" label="Duration" value={formatDuration(incident.startTs, incident.endTs)} tone="blue" />
          <Stat icon="list" label="Events" value={incident.eventIds.length} tone="gray" hint={`${incident.resourceIds.length} resources`} />
        </Grid>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card variant="hairline">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="sparkles" size={15} className="text-muted" /> Probable root cause</h3>
          {incident.rootCause ? (
            <div>
              <div className="text-sm font-medium">{incident.rootCause.label}</div>
              <p className="mt-1 text-xs text-muted">{incident.rootCause.reason}</p>
              <div className="mt-2 flex items-center gap-2 text-2xs text-faint">
                <span>{incident.rootCause.hopDistance} hop{incident.rootCause.hopDistance === 1 ? '' : 's'} upstream</span>
                <span>·</span>
                <span>confidence {pct01(incident.rootCause.confidence)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-faint">No upstream cause identified — the symptom is likely the origin.</p>
          )}
          <div className="mt-3"><Field label="Overall confidence" value={pct01(incident.confidence)} /></div>
        </Card>

        <Card variant="hairline">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon name="globe" size={15} className="text-muted" /> Impact by domain</h3>
          {domains.length ? (
            <div className="flex flex-col gap-2">
              {domains.map(([dom, count]) => (
                <Meter key={dom} value={incident.impact.blastRadius ? count / incident.impact.blastRadius : 0} tone="orange" label={domainLabel(dom)} trailing={`${count}`} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-faint">No downstream impact mapped.</p>
          )}
        </Card>
      </div>

      <OpsPanel title="Recommended actions" className="mt-4 mb-0">
        {incident.recommendedActions.length ? (
          <div className="flex flex-col gap-2">
            {incident.recommendedActions.map((a, i) => (
              <div key={i} className="surface-raised flex items-start gap-2.5 rounded-xl p-3 shadow-card">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xs font-semibold">{i + 1}</span>
                <span className="text-sm">{a}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">No specific actions suggested.</p>
        )}
      </OpsPanel>
    </div>
  );
}

/* ── Recommendation Center ──────────────────────────────────────────────────── */

const PRIORITY_FILTERS: Array<{ id: 'all' | RecoPriority; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

export function RecommendationPanel({ report }: PanelProps): JSX.Element {
  const all = useMemo(() => sortedRecommendations(report.recommendations), [report.recommendations]);
  const [filter, setFilter] = useState<'all' | RecoPriority>('all');
  const shown = filter === 'all' ? all : all.filter((r) => r.priority === filter);

  const counts = useMemo(() => {
    const c: Record<'all' | RecoPriority, number> = { all: all.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of all) c[r.priority] += 1;
    return c;
  }, [all]);

  return (
    <div>
      <OpsPanel
        title="Recommendation Center"
        subtitle="Ranked across health · risk · drift · dependency · capacity · incident · security"
        actions={
          <ChipRow>
            {PRIORITY_FILTERS.map((f) => (
              <Chip key={f.id} label={f.label} count={counts[f.id]} active={filter === f.id} onClick={() => setFilter(f.id)} />
            ))}
          </ChipRow>
        }
      >
        {shown.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {shown.map((rec) => (
              <Card key={rec.id} variant="flat">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug">{rec.title}</h3>
                  <Pill tone={priorityTone(rec.priority)} label={rec.priority} />
                </div>
                <p className="mt-1.5 text-xs text-muted">{rec.detail}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-2xs font-medium text-faint">{recoCategoryLabel(rec.category)}</span>
                  <span className="text-2xs text-faint">confidence {pct01(rec.confidence)}</span>
                </div>
                {rec.evidence.length > 0 && (
                  <div className="mt-2 border-t border-white/5 pt-2">
                    <div className="text-2xs uppercase tracking-wide text-faint">Evidence</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {rec.evidence.slice(0, 6).map((e, i) => (
                        <span key={i} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-2xs text-muted">{e}</span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon="check" title="Nothing here" hint={`No ${filter} recommendations.`} />
        )}
      </OpsPanel>
    </div>
  );
}

/* ── tiny table cells ───────────────────────────────────────────────────────── */

function Th({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return <th className={cn('px-3 py-2 font-semibold', className)}>{children}</th>;
}
function Td({ children, className }: { children?: ReactNode; className?: string }): JSX.Element {
  return <td className={cn('px-3 py-2.5', className)}>{children}</td>;
}
