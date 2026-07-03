import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  EnterpriseTimelinePage,
  JobPage,
  RecommendationSet,
  RiskLevel,
  VerdictDecision,
  WorkerHealthState,
  WorkerSummary,
  WorkforceAuditPage,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { formatRelative } from '@renderer/lib/format';
import { DOT_BG, TEXT_TONE, type OpsTone } from './lib';

/**
 * The Founder Workspace right rail. Compact, read-only intelligence cards — each
 * wired to real data through existing IPC channels: Today's Priorities
 * (recommendations engine), Pending Approvals (the governance proposal queue),
 * AI Worker Status (the worker registry), Recent Decisions (the workforce audit
 * log), and Recent Connector Events (the enterprise timeline). Nothing here is
 * synthesized — empty states say so plainly.
 */

interface RailData {
  priorities: RecommendationSet;
  workers: WorkerSummary[];
  approvals: JobPage;
  decisions: WorkforceAuditPage;
  events: EnterpriseTimelinePage;
}

const PRIORITY_TONE: Record<string, OpsTone> = { high: 'orange', normal: 'blue', low: 'gray' };
const HEALTH_TONE: Record<WorkerHealthState, OpsTone> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  unknown: 'gray',
};
const DECISION_TONE: Record<VerdictDecision, OpsTone> = {
  allow: 'green',
  deny: 'red',
  require_approval: 'orange',
};
const RISK_TONE: Record<RiskLevel, OpsTone> = {
  low: 'gray',
  medium: 'blue',
  high: 'orange',
  critical: 'red',
};

export function FounderWorkspaceRail(): JSX.Element {
  const [data, setData] = useState<RailData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [priorities, workers, approvals, decisions, events] = await Promise.all([
        ipc.recommendations.generate({ limit: 10 }),
        ipc.workforce.workers(),
        ipc.workforce.jobs({ status: 'awaiting_approval', limit: 5 }),
        ipc.workforce.audit({ limit: 6 }),
        ipc.enterpriseTimeline.query({ limit: 12, order: 'desc' }),
      ]);
      setData({ priorities, workers, approvals, decisions, events });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workersByHealth = (state: WorkerHealthState): number =>
    data ? data.workers.filter((w) => w.healthState === state).length : 0;

  return (
    <div className="w-full space-y-3 lg:w-[320px] lg:shrink-0">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-faint">Workspace</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-faint transition hover:text-ink fill-hover disabled:opacity-50"
          title="Refresh"
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>

      {!data && loading && (
        <div className="rounded-2xl border border-[var(--hairline)] p-4 text-2xs text-faint">
          Loading workspace…
        </div>
      )}

      {data && (
        <>
          {/* Today's Priorities */}
          <RailCard icon="checklist" title="Today's priorities" count={data.priorities.total}>
            {data.priorities.recommendations.length === 0 ? (
              <Empty>No priorities surfaced from your data.</Empty>
            ) : (
              <ul className="space-y-2">
                {collapsePriorities(data.priorities.recommendations)
                  .slice(0, 5)
                  .map((r) => (
                    <li key={r.key} className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                          DOT_BG[PRIORITY_TONE[r.priority] ?? 'gray'],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink" title={r.title}>
                        {r.title}
                      </span>
                      {r.count > 1 && (
                        <span className="shrink-0 text-2xs text-faint">×{r.count}</span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </RailCard>

          {/* Pending Approvals */}
          <RailCard icon="shield" title="Pending approvals" count={data.approvals.total}>
            {data.approvals.jobs.length === 0 ? (
              <Empty>Nothing awaiting your approval.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.approvals.jobs.slice(0, 5).map((j) => {
                  const proposal = j.proposals[0];
                  return (
                    <li key={j.id} className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                          DOT_BG[RISK_TONE[proposal?.risk ?? 'medium'] ?? 'blue'],
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-xs text-ink"
                          title={proposal?.title ?? j.skillId}
                        >
                          {proposal?.title ?? j.skillId}
                        </p>
                        <p className="text-2xs text-faint">{j.workerRole}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </RailCard>

          {/* AI Worker Status */}
          <RailCard icon="cpu" title="AI worker status" count={data.workers.length}>
            {data.workers.length === 0 ? (
              <Empty>No workers registered.</Empty>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Pill tone="green" label={`${workersByHealth('healthy')} healthy`} />
                  {workersByHealth('degraded') > 0 && (
                    <Pill tone="orange" label={`${workersByHealth('degraded')} degraded`} />
                  )}
                  {workersByHealth('unhealthy') > 0 && (
                    <Pill tone="red" label={`${workersByHealth('unhealthy')} unhealthy`} />
                  )}
                  {workersByHealth('unknown') > 0 && (
                    <Pill tone="gray" label={`${workersByHealth('unknown')} unknown`} />
                  )}
                </div>
                <ul className="space-y-1.5">
                  {data.workers.map((w) => (
                    <li key={w.id} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          DOT_BG[HEALTH_TONE[w.healthState]],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink" title={w.name}>
                        {w.name}
                      </span>
                      <span className="text-2xs text-faint">
                        {Math.round(w.trustScore * 100)}% trust
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </RailCard>

          {/* Recent Decisions */}
          <RailCard icon="clipboard" title="Recent decisions" count={data.decisions.total}>
            {data.decisions.entries.length === 0 ? (
              <Empty>No governance decisions yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.decisions.entries.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                        DOT_BG[DECISION_TONE[d.decision] ?? 'gray'],
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-ink" title={d.summary}>
                        {d.summary}
                      </p>
                      <p className="text-2xs text-faint">
                        <span className={TEXT_TONE[DECISION_TONE[d.decision] ?? 'gray']}>
                          {d.decision}
                        </span>{' '}
                        · {formatRelative(d.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>

          {/* Recent Connector Events */}
          <RailCard icon="connectors" title="Recent connector events" count={data.events.total}>
            {data.events.entries.length === 0 ? (
              <Empty>No recent events.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.events.entries.slice(0, 7).map((e) => (
                  <li key={e.id} className="min-w-0">
                    <p className="truncate text-xs text-ink" title={e.title}>
                      {e.title}
                    </p>
                    <p className="text-2xs text-faint">
                      {e.connectorId ?? e.source} · {formatRelative(e.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>
        </>
      )}
    </div>
  );
}

function RailCard({
  icon,
  title,
  count,
  children,
}: {
  icon: IconName;
  title: string;
  count?: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--hairline)] p-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name={icon} size={13} className="text-faint" />
        <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
        {count !== undefined && <span className="ml-auto text-2xs text-faint">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-2xs text-faint">{children}</p>;
}

function Pill({ tone, label }: { tone: OpsTone; label: string }): JSX.Element {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-2xs font-medium [background:var(--fill-1)]',
        TEXT_TONE[tone],
      )}
    >
      {label}
    </span>
  );
}

interface PriorityRow {
  key: string;
  title: string;
  count: number;
  priority: string;
}

/**
 * Collapse same-title recommendations into one row carrying a count. The engine
 * emits one recommendation per event, so duplicates are common and unhelpful in a
 * compact executive view.
 */
function collapsePriorities(recs: RecommendationSet['recommendations']): PriorityRow[] {
  const rows = new Map<string, PriorityRow>();
  for (const r of recs) {
    const existing = rows.get(r.title);
    if (existing) existing.count += 1;
    else rows.set(r.title, { key: r.id, title: r.title, count: 1, priority: r.priority });
  }
  return [...rows.values()];
}
