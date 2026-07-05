import { useEffect, useState } from 'react';
import type {
  ExecutiveCard,
  ExecutiveCenterSnapshot,
  ExecutiveDecision,
  ExecutiveKpi,
  IntelligenceItem,
} from '@neuropause/shared';
import { primaryNextStatus, isOverdue } from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { useShell } from '@renderer/state/ShellProvider';
import { Icon } from '@renderer/components/ui/Icon';
import { Card } from '@renderer/components/ui/Card';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { ExecutiveTimeline } from './ExecutiveTimeline';
import { OpsPanel } from '../operations/primitives';
import { TINT_TONE, TEXT_TONE, DOT_BG, type OpsTone } from '../operations/lib';
import { deepLinkToSection } from './executiveCenterNav';

/** Health band → the existing tone system (no new palette introduced). */
function bandTone(band: ExecutiveKpi['band']): OpsTone {
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

/** Item priority → tone. */
function priorityTone(p: IntelligenceItem['priority']): OpsTone {
  switch (p) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'normal':
      return 'blue';
    default:
      return 'gray';
  }
}

/** A tiny inline sparkline (pure SVG, no dependency). Reuses NPDS tone colors. */
function Sparkline({ values, tone }: { values: number[]; tone: OpsTone }): JSX.Element | null {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const stroke =
    tone === 'green'
      ? 'rgb(var(--c-green))'
      : tone === 'red'
        ? 'rgb(var(--c-pink))'
        : 'rgb(var(--text-3))';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The Executive Intelligence Center.
 *
 * Presentation only: it reads the V2.4 snapshot over IPC and renders a KPI strip
 * plus priority-sorted cards. Every KPI and card navigates into the existing
 * module via the shell — no duplicated detail views, no new intelligence.
 */
export function ExecutiveCenterPanel(): JSX.Element {
  const { setSection } = useShell();
  const [snapshot, setSnapshot] = useState<ExecutiveCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // V3.4 decision flow: track per-recommendation action state locally so the card
  // reflects Accept/Dismiss immediately without refetching the whole snapshot.
  const [recAction, setRecAction] = useState<Record<string, 'accepted' | 'dismissed'>>({});
  const [busyRec, setBusyRec] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // On-demand read (no polling) — the snapshot is composed from live stores.
    ipc.intelligence
      .executiveCenterSnapshot()
      .then((s) => {
        if (alive) setSnapshot(s);
      })
      .catch(() => {
        if (alive) setError('Executive intelligence is unavailable right now.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const go = (deepLink: string | undefined): void => {
    setSection(deepLinkToSection(deepLink));
  };

  // V3.4 — Accept a recommendation as a decision (reuses the V3.3 decision IPC;
  // no duplicate business logic — the engine builds the decision server-side).
  const acceptDecision = async (recommendationId: string): Promise<void> => {
    setBusyRec(recommendationId);
    try {
      const { decision } = await ipc.decisions.createFromRecommendation(recommendationId);
      if (decision) {
        setRecAction((prev) => ({ ...prev, [recommendationId]: 'accepted' }));
        // Refresh the snapshot so the Decisions section reflects the new decision.
        const s = await ipc.intelligence.executiveCenterSnapshot();
        setSnapshot(s);
      }
    } catch {
      /* leave the card actionable; a transient failure shouldn't block retry */
    } finally {
      setBusyRec(null);
    }
  };

  const dismissRec = (recommendationId: string): void => {
    setRecAction((prev) => ({ ...prev, [recommendationId]: 'dismissed' }));
  };

  // V3.5 — transition a decision's status via the existing V3.3 setStatus IPC
  // (store enforces legal transitions). Optimistic refresh of the snapshot.
  const [busyDecision, setBusyDecision] = useState<string | null>(null);
  const transitionDecision = async (id: string, to: ExecutiveDecision['status']): Promise<void> => {
    setBusyDecision(id);
    try {
      const { decision } = await ipc.decisions.setStatus(id, to);
      if (decision) {
        const s = await ipc.intelligence.executiveCenterSnapshot();
        setSnapshot(s);
      }
    } catch {
      /* transient failure — leave controls actionable for retry */
    } finally {
      setBusyDecision(null);
    }
  };

  if (loading) {
    return (
      <OpsPanel title="Executive Intelligence" subtitle="Your organization at a glance">
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </OpsPanel>
    );
  }

  if (error || !snapshot) {
    return (
      <OpsPanel title="Executive Intelligence" subtitle="Your organization at a glance">
        <EmptyState
          icon="sparkles"
          title="Nothing to show yet"
          description={error ?? 'Connect a source or generate a brief to populate this view.'}
        />
      </OpsPanel>
    );
  }

  const { kpis, attentionCounts } = snapshot;
  const cards: ExecutiveCard[] = [
    snapshot.criticalAlerts,
    snapshot.founderRecommendations,
    snapshot.organizationHealth,
    snapshot.engineeringHealth,
    snapshot.upcomingPriorities,
    // V2.9 completion cards (rendered when present).
    snapshot.executiveTimeline,
    snapshot.recentDecisions,
    snapshot.recentDeliveries,
    snapshot.evidenceSummary,
  ].filter((c): c is ExecutiveCard => Boolean(c));

  return (
    <OpsPanel
      title="Executive Intelligence"
      subtitle={`${attentionCounts.critical} critical · ${attentionCounts.high} high · updated ${formatRelative(snapshot.generatedAt)}`}
    >
      {/* KPI strip — the instrument cluster. Each tile deep-links. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <button
            key={k.key}
            onClick={() => go(k.deepLink)}
            className={cn(
              'group flex flex-col items-start rounded-xl border border-white/5 p-3 text-left transition',
              'hover:border-white/15 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20',
              TINT_TONE[bandTone(k.band)],
            )}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/50">
              {k.label}
            </span>
            <span className="mt-1 text-xl font-semibold tabular-nums">{k.display}</span>
            {k.band && (
              <span
                className={cn(
                  'mt-1 flex items-center gap-1.5 text-[11px]',
                  TEXT_TONE[bandTone(k.band)],
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', DOT_BG[bandTone(k.band)])} />
                {k.band}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Weekly Trends — week-over-week movement of the headline metrics.
          Renders only when history exists (previousWeek populated). */}
      {snapshot.weeklyTrends && snapshot.weeklyTrends.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {snapshot.weeklyTrends.map((t) => {
            const tone: OpsTone =
              t.direction === 'up' ? 'green' : t.direction === 'down' ? 'red' : 'gray';
            const arrow = t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '→';
            const sign = t.delta > 0 ? '+' : '';
            return (
              <span
                key={t.key}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-white/5 px-2.5 py-1 text-xs',
                  TINT_TONE[tone],
                )}
              >
                <span className="text-white/50">{t.label} vs last week</span>
                <span className={cn('font-semibold tabular-nums', TEXT_TONE[tone])}>
                  {arrow} {sign}
                  {t.delta}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* Monthly Trends (V3.1) — rich 30-day view per metric: direction, %, moving
          average, range, stability, confidence, and a sparkline. Reuses Card flat
          variant + tone system. Renders only when history exists. */}
      {snapshot.monthlyTrends && snapshot.monthlyTrends.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/50">
            30-Day Trends
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.monthlyTrends.map((m) => {
              const tone: OpsTone =
                m.direction === 'up' ? 'green' : m.direction === 'down' ? 'red' : 'gray';
              const arrow = m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→';
              const sign = m.percentChange > 0 ? '+' : '';
              return (
                <Card key={m.key} variant="flat" flush className="p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white/70">{m.label}</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold tabular-nums',
                        TEXT_TONE[tone],
                      )}
                    >
                      {arrow} {sign}
                      {m.percentChange}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <span className="text-2xl font-semibold tabular-nums">{m.current}</span>
                    <Sparkline values={m.sparkline} tone={tone} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                    <span>avg {m.movingAverage}</span>
                    <span>
                      range {m.lowest}–{m.highest}
                    </span>
                    <span>{m.stability}</span>
                    <span>{m.confidence} confidence</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Executive Summary (V3.2) — one-glance decision header. */}
      {snapshot.executiveSummary && (
        <Card variant="flat" flush className="mt-4 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/50">
              Executive Summary
            </span>
            <span className="text-xs font-semibold tabular-nums text-white/70">
              Score {snapshot.executiveSummary.executiveScore}
            </span>
          </div>
          <div className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <p className="text-white/60">
              <span className="text-white/40">Top risk: </span>
              {snapshot.executiveSummary.topRisk}
            </p>
            <p className="text-white/60">
              <span className="text-white/40">Top recommendation: </span>
              {snapshot.executiveSummary.topRecommendation}
            </p>
            <p className="text-white/60">
              <span className="text-white/40">Top win: </span>
              {snapshot.executiveSummary.topWin}
            </p>
            <p className="text-white/60">
              <span className="text-white/40">Opportunity: </span>
              {snapshot.executiveSummary.topOpportunity}
            </p>
          </div>
        </Card>
      )}

      {/* Recommendation Cards (V3.2) — ranked decisions. Reuses Card flat + tones. */}
      {snapshot.recommendations && snapshot.recommendations.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/50">
            Recommendations
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {snapshot.recommendations
              .filter((r) => recAction[r.id] !== 'dismissed')
              .slice(0, 6)
              .map((r) => {
                const tone: OpsTone =
                  r.priority === 'critical'
                    ? 'red'
                    : r.priority === 'high'
                      ? 'orange'
                      : r.priority === 'medium'
                        ? 'blue'
                        : 'gray';
                return (
                  <Card key={r.id} variant="flat" flush className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon name={r.icon as never} className="h-4 w-4 text-white/60" />
                        <span className="text-xs font-semibold">{r.problem}</span>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          TINT_TONE[tone],
                          TEXT_TONE[tone],
                        )}
                      >
                        {r.priority}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-white/55">{r.businessImpact}</p>
                    <p className="mt-1.5 text-xs text-white/70">
                      <span className="text-white/40">Action: </span>
                      {r.recommendedAction}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                      <span>{Math.round(r.confidence * 100)}% confidence</span>
                      <span>{r.owner}</span>
                      <span>ETA {r.eta}</span>
                      {r.evidence[0] && <span>{r.evidence.slice(0, 2).join(' · ')}</span>}
                    </div>
                    {/* V3.4 Decision Flow — reuse the V3.3 decision IPC. */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {recAction[r.id] === 'accepted' ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
                            TINT_TONE['green'],
                            TEXT_TONE['green'],
                          )}
                        >
                          <Icon name="check" className="h-3 w-3" /> Decision created
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => void acceptDecision(r.id)}
                            disabled={busyRec === r.id}
                            aria-label={`Accept decision: ${r.recommendedAction}`}
                            aria-busy={busyRec === r.id || undefined}
                            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-hover focus:outline-none focus-visible:shadow-focus disabled:opacity-50"
                          >
                            {busyRec === r.id ? (
                              <Spinner size={12} />
                            ) : (
                              <Icon name="check" className="h-3 w-3" />
                            )}
                            Accept decision
                          </button>
                          <button
                            onClick={() =>
                              go(r.metric === 'governance' ? 'notifications' : undefined)
                            }
                            aria-label={`Investigate: ${r.problem}`}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white/60 transition hover:bg-white/5 hover:text-white/80 focus:outline-none focus-visible:shadow-focus"
                          >
                            <Icon name="search" className="h-3 w-3" /> Investigate
                          </button>
                          <button
                            onClick={() => dismissRec(r.id)}
                            aria-label={`Dismiss recommendation: ${r.problem}`}
                            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white/50 transition hover:bg-white/5 hover:text-white/70 focus:outline-none focus-visible:shadow-focus"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      )}

      {/* Executive Decisions (V3.3) — first-class decisions with lifecycle status.
          Reuses Card flat + tones. Renders only when decisions exist. */}
      {snapshot.decisions && snapshot.decisions.total > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/50">
              Executive Decisions
            </h3>
            <span className="text-[10px] text-white/40">
              {snapshot.decisions.pending} pending · {snapshot.decisions.accepted} active ·{' '}
              {snapshot.decisions.completed} done
              {snapshot.decisions.overdue > 0 && (
                <span className={cn('ml-1 font-medium', TEXT_TONE['red'])}>
                  · {snapshot.decisions.overdue} overdue
                </span>
              )}
              {snapshot.decisions.blocked > 0 && (
                <span className={cn('ml-1 font-medium', TEXT_TONE['orange'])}>
                  · {snapshot.decisions.blocked} blocked
                </span>
              )}
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {snapshot.decisions.top.map((d) => {
              const tone: OpsTone =
                d.priority === 'critical'
                  ? 'red'
                  : d.priority === 'high'
                    ? 'orange'
                    : d.priority === 'medium'
                      ? 'blue'
                      : 'gray';
              const ageDays = Math.max(
                0,
                Math.floor((Date.now() - Date.parse(d.createdAt)) / 86_400_000),
              );
              return (
                <Card key={d.id} variant="flat" flush className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold">{d.title}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase',
                        TINT_TONE[tone],
                        TEXT_TONE[tone],
                      )}
                    >
                      {d.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-white/55">{d.businessImpact}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                    <span className={cn('font-medium', TEXT_TONE[tone])}>{d.priority}</span>
                    <span>{Math.round(d.confidence * 100)}% confidence</span>
                    <span>{d.owner}</span>
                    <span>
                      {d.evidence.length} evidence · {ageDays}d old
                    </span>
                    {d.dueDate && (
                      <span
                        className={cn(
                          isOverdue(d, Date.now()) ? cn('font-semibold', TEXT_TONE['red']) : '',
                        )}
                      >
                        {isOverdue(d, Date.now()) ? 'overdue' : 'due'}{' '}
                        {new Date(d.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {d.status === 'blocked' && (
                      <span className={cn('font-semibold', TEXT_TONE['orange'])}>
                        blocked{d.blockedReason ? `: ${d.blockedReason}` : ''}
                      </span>
                    )}
                  </div>
                  {/* V3.5 lifecycle controls — reuse the V3.3 setStatus IPC. */}
                  {d.status !== 'archived' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(() => {
                        const next = primaryNextStatus(d.status);
                        return next ? (
                          <button
                            onClick={() => void transitionDecision(d.id, next.to)}
                            disabled={busyDecision === d.id}
                            aria-label={`${next.label} decision: ${d.title}`}
                            aria-busy={busyDecision === d.id || undefined}
                            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg transition hover:bg-accent-hover focus:outline-none focus-visible:shadow-focus disabled:opacity-50"
                          >
                            {busyDecision === d.id ? (
                              <Spinner size={12} />
                            ) : (
                              <Icon name="arrow-right" className="h-3 w-3" />
                            )}
                            {next.label}
                          </button>
                        ) : null;
                      })()}
                      <button
                        onClick={() => void transitionDecision(d.id, 'archived')}
                        disabled={busyDecision === d.id}
                        aria-label={`Archive decision: ${d.title}`}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white/50 transition hover:bg-white/5 hover:text-white/70 focus:outline-none focus-visible:shadow-focus disabled:opacity-50"
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Executive Timeline (V3.7) — chronological, filterable decision history.
          Built purely from decision history via ipc.decisions.list. */}
      <div className="mt-4">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/50">
          Executive Timeline
        </h3>
        <ExecutiveTimeline />
      </div>

      {/* Section cards. Bold lives in the KPI strip; cards stay quiet + scannable. */}
      {/* NPDS A.3: migrated to <Card variant="flat"> — reproduces the prior inline
          surface (rounded-2xl border-white/5 bg-white/[0.02]) verbatim; flush + p-4
          preserve the exact prior padding. Pixel-identical to the hand-rolled shell. */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.key} variant="flat" flush className="p-4">
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{card.title}</h3>
                {card.summary && <p className="mt-0.5 text-xs text-white/45">{card.summary}</p>}
              </div>
              <button
                onClick={() => go(card.deepLink)}
                className="rounded-lg px-2 py-1 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
              >
                Open <Icon name="arrow-right" className="ml-0.5 inline h-3 w-3" />
              </button>
            </header>

            {card.items.length === 0 ? (
              <p className="py-6 text-center text-xs text-white/30">Nothing to surface.</p>
            ) : (
              <ul className="space-y-2">
                {card.items.slice(0, 4).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] p-2.5"
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        DOT_BG[priorityTone(item.priority)],
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-white/45">{item.body}</p>
                      {item.governance && (
                        <p className="mt-1 text-[10px] text-white/30">
                          {Math.round(item.governance.confidence * 100)}% confidence ·{' '}
                          {item.governance.sourceSystems.slice(0, 2).join(', ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
                {card.items.length > 4 && (
                  <li className="pt-0.5 text-center text-[11px] text-white/35">
                    +{card.items.length - 4} more in{' '}
                    <button
                      onClick={() => go(card.deepLink)}
                      className="underline hover:text-white/60"
                    >
                      {card.title}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </OpsPanel>
  );
}
