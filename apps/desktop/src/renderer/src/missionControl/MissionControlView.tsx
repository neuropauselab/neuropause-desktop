/**
 * NCEA 11.0 / Phase 6 Stage 2 — Mission Control view. Thin JSX over the tested
 * view-model (missionControlModel.ts) plus the Stage 2 live-feed metadata
 * (per-tile availability). Navigation is DELEGATED to the shell via `onNavigate`
 * — Mission Control adds no routes.
 *
 * Stage 2 honesty rules enforced here, tile by tile:
 *   - every tile renders exactly one of: loading skeleton, live data, an honest
 *     empty state, or "Unavailable — <reason>"; never placeholder numbers;
 *   - a KPI whose source is unavailable shows "—" (with the reason on hover),
 *     never a fabricated 0;
 *   - the audit chip only claims valid/broken when the audit chain was actually
 *     checked (`governance.auditChecked`); otherwise it reports the record count;
 *   - notifications come from the REAL store (DashboardProvider, D-1); the
 *     model's derived signals render as separate "Needs attention" chips;
 *   - organization workspaces render only when an organization exists (D-4).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@renderer/lib/cn';
import { formatRelative } from '@renderer/lib/format';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { SkeletonLines } from '@renderer/components/ui/Skeleton';
import type { AppNotification } from '@renderer/data/types';
import type { SectionId } from '../shell/sections';
import { setPendingSearchQuery } from '../search/searchHandoff';
// Phase 6 Stage 4 — sanctioned minimal hand-off into the Workspace Assistant.
import { setPendingAssistantQuery } from '../assistant/assistantHandoff';
import { useMissionControl, useMissionControlMeta } from './MissionControlProvider';
import type { FeedTileState, HealthView, RecentFileItem, RunningWorkItem } from './missionControlFeed';
import {
  COMMAND_DOMAINS,
  buildSearchIndex,
  searchAll,
  missionControlOverview,
  activityFeed,
  notifications,
  workspaceSwitcher,
  type SearchHit,
} from './missionControlModel';

export interface MissionControlNotificationsStore {
  items: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export interface MissionControlViewProps {
  /** Delegates to the existing shell router — Mission Control adds no routes. */
  onNavigate?: (section: SectionId) => void;
  /** Opens the existing command palette (⌘K). */
  onOpenPalette?: () => void;
  /** D-1 — the REAL notification store (read-state + actions), passed by the host. */
  notificationsStore?: MissionControlNotificationsStore | null;
}

/* ── small pure display helpers ──────────────────────────────────────────── */

const rel = (at: number | string | null | undefined): string => {
  if (at === null || at === undefined || at === 0 || at === '') return '';
  return formatRelative(typeof at === 'number' ? new Date(at) : at);
};

const levelText: Record<string, string> = {
  healthy: 'text-sysgreen',
  degraded: 'text-sysorange',
  unknown: 'text-sysorange',
  critical: 'text-syspink',
  offline: 'text-syspink',
  down: 'text-syspink',
};
const levelDot: Record<string, string> = {
  healthy: 'bg-sysgreen',
  degraded: 'bg-sysorange',
  unknown: 'bg-sysorange',
  critical: 'bg-syspink',
  offline: 'bg-syspink',
  down: 'bg-syspink',
};
const connectorDot: Record<string, string> = {
  ok: 'bg-sysgreen',
  degraded: 'bg-sysorange',
  down: 'bg-syspink',
  disabled: 'bg-[var(--fill-2)]',
};
const runningIcon: Record<RunningWorkItem['kind'], IconName> = {
  execution: 'play',
  automation: 'bolt',
  app: 'workspace',
};
const fileIcon: Record<RecentFileItem['kind'], IconName> = {
  tab: 'workspace',
  file: 'doc',
  document: 'doc',
  attachment: 'download',
};

/** The four honest tile states: loading / unavailable(reason) / empty / data. */
function TileBody({
  tile,
  empty,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  rows = 3,
  children,
}: {
  tile: FeedTileState | undefined;
  empty: boolean;
  emptyIcon: IconName;
  emptyTitle: string;
  emptyDescription?: string;
  rows?: number;
  children: ReactNode;
}): JSX.Element {
  if (!tile || tile.state === 'loading') return <SkeletonLines rows={rows} />;
  if (tile.state === 'unavailable') {
    return (
      <div className="flex items-start gap-2.5 py-2">
        <Icon name="info" size={16} className="text-sysorange mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Unavailable</p>
          <p className="text-faint break-words text-xs">{tile.reason}</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {tile.note && <p className="text-faint mb-2 text-2xs">{tile.note}</p>}
      {empty ? (
        <EmptyState compact icon={emptyIcon} title={emptyTitle} {...(emptyDescription ? { description: emptyDescription } : {})} />
      ) : (
        children
      )}
    </>
  );
}

/** A KPI cell bound to its source tile — "…" while loading, "—" when unavailable. */
function Kpi({
  label,
  tile,
  value,
  sub,
  tone,
}: {
  label: string;
  tile: FeedTileState | undefined;
  value: string | number;
  sub?: string;
  tone?: string;
}): JSX.Element {
  const reason = tile && tile.state === 'unavailable' ? tile.reason : undefined;
  const unavailable = reason !== undefined;
  const loading = !tile || tile.state === 'loading';
  return (
    <Card
      variant="dashboard"
      flush
      className="flex flex-col gap-0.5 px-3.5 py-3"
      {...(reason !== undefined ? { title: `Unavailable — ${reason}` } : {})}
    >
      <span className="text-faint text-2xs font-medium uppercase tracking-wide">{label}</span>
      <span className={cn('text-xl font-semibold tabular-nums', unavailable ? 'text-faint' : tone ?? 'text-ink')}>
        {loading ? '…' : unavailable ? '—' : value}
      </span>
      {sub && !loading && !unavailable && <span className="text-faint truncate text-2xs">{sub}</span>}
    </Card>
  );
}

function ListRow({ children, onClick }: { children: ReactNode; onClick?: () => void }): JSX.Element {
  const inner = <div className="flex min-w-0 flex-1 items-center gap-2.5">{children}</div>;
  if (!onClick) return <div className="flex items-center px-4 py-2">{inner}</div>;
  return (
    <button type="button" onClick={onClick} className="fill-hover flex w-full items-center px-4 py-2 text-left outline-none focus-visible:shadow-focus">
      {inner}
    </button>
  );
}

/* ── the view ────────────────────────────────────────────────────────────── */

export function MissionControlView({ onNavigate, onOpenPalette, notificationsStore }: MissionControlViewProps): JSX.Element {
  const snapshot = useMissionControl();
  const meta = useMissionControlMeta();
  const a = meta?.availability;
  const extras = meta?.extras;

  const overview = useMemo(() => missionControlOverview(snapshot), [snapshot]);
  const searchIndex = useMemo(() => buildSearchIndex(snapshot), [snapshot]);
  const feed = useMemo(() => activityFeed(snapshot, { limit: 8 }), [snapshot]);
  const attention = useMemo(() => notifications(snapshot), [snapshot]);
  const orgWorkspaces = useMemo(() => workspaceSwitcher(snapshot), [snapshot]);
  const [query, setQuery] = useState('');
  const hits = useMemo<SearchHit[]>(() => (query ? searchAll(query, searchIndex, { limit: 10 }) : []), [query, searchIndex]);

  const go = (section: SectionId): void => onNavigate?.(section);
  const activeWs = orgWorkspaces.find((w) => w.active);
  const health: HealthView | null = extras?.health ?? null;
  const store = notificationsStore ?? null;
  const executiveReady = a?.executive.state === 'ready';

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6">
      {/* Header — identity + live status chips + refresh */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Mission Control</h1>
          <p className="text-subtle text-sm">
            {activeWs ? `${activeWs.orgName} · ${activeWs.name}` : 'Live overview of everything running in NeuroPause'}
          </p>
        </div>
        <div className="text-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {a?.health.state === 'ready' && health && (
            <span className={cn('inline-flex items-center gap-1.5 font-medium', levelText[health.level])}>
              <span className={cn('h-1.5 w-1.5 rounded-full', levelDot[health.level])} />
              system {health.level}
            </span>
          )}
          {a?.connectors.state === 'ready' && (
            <span>
              {overview.connectors.up}/{overview.connectors.total} connectors up
            </span>
          )}
          {executiveReady && <span>{overview.pendingApprovals} approvals pending</span>}
          {executiveReady && (
            <span className="inline-flex items-center gap-1">
              <Icon name="shield" size={13} />
              {snapshot.governance.auditChecked
                ? snapshot.governance.auditValid
                  ? 'audit valid'
                  : 'audit broken'
                : `${snapshot.governance.auditRecords} audit records`}
            </span>
          )}
          {meta && (
            <Button variant="ghost" size="sm" icon="refresh" onClick={meta.refresh} aria-label="Refresh all tiles">
              Refresh
            </Button>
          )}
        </div>
      </header>

      {/* Universal search — provider-agnostic ranking over every indexed kind */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="text-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Phase 6 Stage 3 — minimal hand-off into the full Search experience.
                if (e.key === 'Enter' && query.trim()) {
                  setPendingSearchQuery(query);
                  setQuery('');
                  onNavigate?.('search');
                }
              }}
              placeholder="Search organizations, people, AI employees, connectors, events…"
              aria-label="Universal search"
              className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] py-2 pl-9 pr-3 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
            />
          </div>
          {onOpenPalette && (
            <Button variant="secondary" size="md" icon="command" onClick={onOpenPalette}>
              ⌘K
            </Button>
          )}
        </div>
        {hits.length > 0 && (
          <Card variant="floating" flush className="absolute z-20 mt-1.5 max-h-80 w-full overflow-y-auto p-1">
            {/* Phase 6 Stage 3 — hand-off row into the full Search section. */}
            <button
              type="button"
              onClick={() => {
                setPendingSearchQuery(query);
                setQuery('');
                go('search');
              }}
              className="fill-hover flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none focus-visible:shadow-focus"
            >
              <Icon name="search" size={14} className="text-accent shrink-0" />
              <span className="min-w-0 flex-1 truncate text-ink">Search everywhere for “{query.trim()}”</span>
              <span className="text-faint shrink-0 text-2xs">↵</span>
            </button>
            {/* Phase 6 Stage 4 — hand-off row into the Workspace Assistant. */}
            <button
              type="button"
              onClick={() => {
                setPendingAssistantQuery(query);
                setQuery('');
                go('assistant');
              }}
              className="fill-hover flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none focus-visible:shadow-focus"
            >
              <Icon name="sparkles" size={14} className="text-accent shrink-0" />
              <span className="min-w-0 flex-1 truncate text-ink">Ask Assistant: “{query.trim()}”</span>
            </button>
            {hits.map((h) => {
              const target = h.domain ? COMMAND_DOMAINS.find((d) => d.id === h.domain)?.section : undefined;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    if (target) {
                      setQuery('');
                      go(target);
                    }
                  }}
                  className="fill-hover flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none focus-visible:shadow-focus"
                >
                  <span className="text-faint rounded [background:var(--fill-2)] px-1.5 py-0.5 text-2xs uppercase">{h.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{h.title}</span>
                  {h.subtitle && <span className="text-faint max-w-[35%] truncate text-xs">{h.subtitle}</span>}
                </button>
              );
            })}
          </Card>
        )}
      </div>

      {/* KPI row — every cell bound to its live source; no fabricated zeros */}
      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6" aria-label="Key metrics">
        <Kpi
          label="Running now"
          tile={a?.running}
          value={extras?.running.length ?? 0}
          {...(extras?.monitor ? { sub: `${extras.monitor.running} automations live` } : {})}
        />
        <Kpi label="AI employees" tile={a?.executive} value={overview.aiEmployees} sub={`${overview.workforceHealth.healthy} healthy`} />
        <Kpi
          label="Connectors up"
          tile={a?.connectors}
          value={`${overview.connectors.up}/${overview.connectors.total}`}
          {...(overview.connectors.down > 0 ? { tone: 'text-sysorange' } : {})}
        />
        <Kpi
          label="Pending approvals"
          tile={a?.executive}
          value={overview.pendingApprovals}
          {...(overview.pendingApprovals > 0 ? { tone: 'text-sysorange' } : {})}
        />
        <Kpi
          label="System score"
          tile={a?.health}
          value={health ? health.score : '—'}
          {...(health ? { sub: health.level, tone: levelText[health.level] } : {})}
        />
        <Kpi label="Timeline events" tile={a?.activity} value={extras?.timelineStats ? extras.timelineStats.total : overview.activityCount} />
      </section>

      {/* Command center — each domain routes into its existing section */}
      <section aria-label="Command center">
        <h2 className="text-subtle mb-2 text-sm font-semibold">Command center</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {COMMAND_DOMAINS.map((d) => (
            <Button key={d.id} variant="secondary" size="md" onClick={() => go(d.section)} className="justify-start">
              <Icon name={d.icon as IconName} size={15} />
              <span className="truncate">{d.label}</span>
            </Button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent activity — live platform timeline */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              icon={<Icon name="activity" size={15} />}
              title="Activity timeline"
              tint="blue"
              action={
                <Button variant="ghost" size="sm" onClick={() => go('opscenter')}>
                  Full timeline
                </Button>
              }
            />
          </div>
          <div className="px-1 pb-3">
            <TileBody
              tile={a?.activity}
              empty={feed.length === 0}
              emptyIcon="activity"
              emptyTitle="No activity yet"
              emptyDescription="Platform events appear here as apps, automations, and connectors do work."
            >
              <div className="flex flex-col">
                {feed.map((ev) => (
                  <ListRow key={ev.id}>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ev.ok ? 'bg-sysgreen' : 'bg-syspink')} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{ev.action}</span>
                    <span className="text-faint shrink-0 truncate text-xs">{ev.actor}</span>
                    <span className="text-faint shrink-0 text-xs tabular-nums">{rel(ev.at)}</span>
                  </ListRow>
                ))}
              </div>
            </TileBody>
          </div>
        </Card>

        {/* Running work — execute sessions + automations + app runtime */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader icon={<Icon name="play" size={15} />} title="Running now" tint="teal" />
          </div>
          <div className="px-1 pb-3">
            <TileBody
              tile={a?.running}
              empty={(extras?.running.length ?? 0) === 0}
              emptyIcon="play"
              emptyTitle="Nothing running right now"
              emptyDescription="Executions, live automations, and running apps appear here."
            >
              <div className="flex flex-col">
                {(extras?.running ?? []).slice(0, 8).map((item) => (
                  <ListRow key={item.id}>
                    <Icon name={runningIcon[item.kind]} size={14} className="text-subtle shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                    <span className="text-faint shrink-0 text-xs">{item.state}</span>
                    <span className="text-faint shrink-0 text-xs tabular-nums">{rel(item.startedAt)}</span>
                  </ListRow>
                ))}
              </div>
            </TileBody>
          </div>
        </Card>

        {/* Connector status */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              icon={<Icon name="connectors" size={15} />}
              title="Connector status"
              tint="green"
              action={
                <Button variant="ghost" size="sm" onClick={() => go('connectors')}>
                  Open
                </Button>
              }
            />
          </div>
          <div className="px-1 pb-3">
            <TileBody
              tile={a?.connectors}
              empty={snapshot.connectors.length === 0}
              emptyIcon="connectors"
              emptyTitle="No connectors yet"
              emptyDescription="Connect a production connector to see its live health here."
            >
              <div className="flex flex-col">
                {snapshot.connectors.slice(0, 8).map((c) => (
                  <ListRow key={c.id} onClick={() => go('connectors')}>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', connectorDot[c.status])} />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                    <span className={cn('shrink-0 text-xs', c.status === 'down' ? 'text-syspink' : c.status === 'degraded' ? 'text-sysorange' : 'text-faint')}>
                      {c.status}
                    </span>
                  </ListRow>
                ))}
              </div>
            </TileBody>
          </div>
        </Card>

        {/* Notifications — the REAL store (D-1) + derived "Needs attention" chips */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              icon={<Icon name="bell" size={15} />}
              title="Notifications"
              tint="orange"
              action={
                <div className="flex items-center gap-1">
                  {store && store.unreadCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={store.markAllRead}>
                      Mark all read
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => go('notifications')}>
                    Open
                  </Button>
                </div>
              }
            />
          </div>
          <div className="px-1 pb-3">
            {!store || store.loading ? (
              <SkeletonLines rows={3} />
            ) : store.error ? (
              <div className="flex items-start gap-2.5 px-4 py-2">
                <Icon name="info" size={16} className="text-sysorange mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-ink">Unavailable</p>
                  <p className="text-faint text-xs">The notification store failed to load.</p>
                </div>
              </div>
            ) : store.items.length === 0 ? (
              <EmptyState compact icon="bell" title="You're all caught up" description="Notifications land here as reminders, summaries, and workflows fire." />
            ) : (
              <div className="flex flex-col">
                {store.items.slice(0, 6).map((n) => (
                  <ListRow key={n.id} onClick={() => store.markRead(n.id)}>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', n.read ? 'bg-[var(--fill-2)]' : 'bg-accent')} />
                    <span className={cn('min-w-0 flex-1 truncate text-sm', n.read ? 'text-subtle' : 'text-ink')}>{n.title}</span>
                    <span className="text-faint shrink-0 text-xs tabular-nums">{rel(n.at)}</span>
                  </ListRow>
                ))}
              </div>
            )}
            {attention.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 px-4 pb-1" aria-label="Needs attention">
                {attention.slice(0, 4).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => go(n.kind === 'approval' ? 'administration' : n.id.startsWith('conn:') ? 'connectors' : 'opscenter')}
                    className={cn(
                      'fill-hover inline-flex items-center gap-1 rounded-lg border border-[var(--hairline)] px-2 py-1 text-xs outline-none focus-visible:shadow-focus',
                      n.kind === 'alert' ? 'text-syspink' : 'text-sysorange',
                    )}
                  >
                    <Icon name={n.kind === 'approval' ? 'checklist' : 'bolt'} size={12} />
                    <span className="max-w-[220px] truncate">{n.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Recent files — Stage 1 workspace tabs + unified documents (D-2) */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader icon={<Icon name="folder" size={15} />} title="Recent files" tint="purple" />
          </div>
          <div className="px-1 pb-3">
            <TileBody
              tile={a?.recentFiles}
              empty={(extras?.recentFiles.length ?? 0) === 0}
              emptyIcon="folder"
              emptyTitle="No recent files yet"
              emptyDescription="Workspace tabs and synced documents appear here as you work."
            >
              <div className="flex flex-col">
                {(extras?.recentFiles ?? []).slice(0, 8).map((f) => (
                  <ListRow key={f.key} onClick={() => go(f.kind === 'tab' ? 'workspace' : 'knowledge')}>
                    <Icon name={fileIcon[f.kind]} size={14} className="text-subtle shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.title}</span>
                    <span className="text-faint shrink-0 truncate text-xs">{f.origin}</span>
                    <span className="text-faint shrink-0 text-xs tabular-nums">{rel(f.at)}</span>
                  </ListRow>
                ))}
              </div>
            </TileBody>
          </div>
        </Card>

        {/* System health — NeuroCore composed snapshot */}
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              icon={<Icon name="gauge" size={15} />}
              title="System health"
              tint="green"
              action={
                <Button variant="ghost" size="sm" onClick={() => go('opscenter')}>
                  Operations
                </Button>
              }
            />
          </div>
          <div className="px-1 pb-3">
            <TileBody tile={a?.health} empty={!health} emptyIcon="gauge" emptyTitle="No health snapshot" rows={4}>
              {health && (
                <>
                  <div className="flex items-baseline gap-2 px-4 pb-2">
                    <span className={cn('text-2xl font-semibold tabular-nums', levelText[health.level])}>{health.score}</span>
                    <span className="text-subtle text-sm">{health.level}</span>
                    <span className="text-faint ml-auto text-xs">{health.eventsPerMinute} events/min</span>
                  </div>
                  <div className="flex flex-col">
                    {health.subsystems.map((s) => (
                      <ListRow key={s.id}>
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', levelDot[s.level])} />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.label}</span>
                        {s.detail && <span className="text-faint shrink-0 truncate text-xs">{s.detail}</span>}
                        <span className={cn('shrink-0 text-xs', levelText[s.level])}>{s.level}</span>
                      </ListRow>
                    ))}
                  </div>
                </>
              )}
            </TileBody>
          </div>
        </Card>
      </div>

      {/* Organization workspaces — rendered only when an organization exists (D-4) */}
      {a?.organization.state === 'ready' && orgWorkspaces.length > 0 && (
        <Card flush className="p-0">
          <div className="px-5 pt-5">
            <CardHeader
              icon={<Icon name="grid" size={15} />}
              title="Organization workspaces"
              tint="accent"
              action={
                <Button variant="ghost" size="sm" onClick={() => go('organization')}>
                  Open
                </Button>
              }
            />
          </div>
          <div className="px-1 pb-3">
            <div className="flex flex-col">
              {orgWorkspaces.slice(0, 6).map((w) => (
                <ListRow key={w.id} onClick={() => go('organization')}>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', w.active ? 'bg-accent' : 'bg-[var(--fill-2)]')} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{w.name}</span>
                  <span className="text-faint shrink-0 truncate text-xs">{w.orgName}</span>
                  <span className="text-faint shrink-0 text-xs tabular-nums">{w.userCount} members</span>
                  {w.active && <span className="text-accent shrink-0 text-2xs font-medium uppercase">active</span>}
                </ListRow>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
