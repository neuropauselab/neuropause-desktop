import { memo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@renderer/lib/cn';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Badge } from '@renderer/components/ui/controls';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { BarChart } from '@renderer/components/ui/BarChart';
import { formatDuration, formatRelative } from '@renderer/lib/format';
import { getAppOrFallback } from '@renderer/data/catalog';
import type {
  ActivityEvent,
  ActivityKind,
  ConnectedApp,
  PendingTask,
  ProductivitySummary,
  Recommendation,
  RunningSession,
  TaskPriority,
} from '@renderer/data/types';
import type { IconName } from '@renderer/components/ui/Icon';

/* ── Connected AI Apps ─────────────────────────────────────────────────────── */
export const ConnectedAppsCard = memo(function ConnectedAppsCard({
  apps,
  onOpenApp,
}: {
  apps: ConnectedApp[];
  onOpenApp: (appId: string, title: string) => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader
        icon={<Icon name="connectors" size={16} />}
        title="Connected AI Apps"
        tint="teal"
        action={<span className="tabular text-2xl font-semibold leading-none">{apps.length}</span>}
      />
      {apps.length === 0 ? (
        <EmptyState
          compact
          icon="connectors"
          title="No apps connected"
          description="Connect your AI accounts to see them here."
        />
      ) : (
        <div className="flex flex-col gap-1">
          {apps.map((c) => {
            const app = getAppOrFallback(c.appId);
            return (
              <button
                key={c.appId}
                type="button"
                onClick={() => onOpenApp(app.id, app.name)}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors fill-hover focus-visible:shadow-focus"
              >
                <AppGlyph glyph={app.glyph} tone={app.tone} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium">{app.name}</div>
                  <div className="truncate text-xs text-faint">Active {formatRelative(c.lastUsed)}</div>
                </div>
                <Badge tone="neutral">{c.sessionsToday} today</Badge>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
});

/* ── Running Sessions ──────────────────────────────────────────────────────── */
export const RunningSessionsCard = memo(function RunningSessionsCard({
  sessions,
  onOpenApp,
}: {
  sessions: RunningSession[];
  onOpenApp: (appId: string, title: string) => void;
}): JSX.Element {
  const activeCount = sessions.filter((s) => s.state === 'active').length;
  return (
    <Card>
      <CardHeader
        icon={<Icon name="play" size={15} />}
        title="Running Sessions"
        tint="green"
        action={<Badge tone="green">{activeCount} active</Badge>}
      />
      {sessions.length === 0 ? (
        <EmptyState
          compact
          icon="play"
          title="No active sessions"
          description="Open an app to start a working session."
        />
      ) : (
        <div className="flex flex-col gap-1">
          {sessions.map((s) => {
            const app = getAppOrFallback(s.appId);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenApp(s.appId, app.name)}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors fill-hover focus-visible:shadow-focus"
              >
                <AppGlyph glyph={app.glyph} tone={app.tone} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-base font-medium leading-snug">{s.title}</div>
                  <div className="mt-0.5 truncate text-xs text-faint">
                    {app.name} · started {formatRelative(s.startedAt)}
                  </div>
                </div>
                {s.state === 'active' ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sysgreen opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sysgreen" />
                  </span>
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-[var(--fill-2)]" title="Idle" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
});

/* ── Today's Productivity ──────────────────────────────────────────────────── */
function Metric({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div>
      <div className="tabular text-xl font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-xs text-faint">{label}</div>
    </div>
  );
}

export const ProductivityCard = memo(function ProductivityCard({
  summary,
}: {
  summary: ProductivitySummary;
}): JSX.Element {
  return (
    <Card>
      <CardHeader icon={<Icon name="activity" size={16} />} title="Today’s Productivity" tint="accent" />
      <div className="mb-5 flex items-end gap-7">
        <Metric value={formatDuration(summary.focusMinutesToday)} label="Focus time" />
        <Metric value={`${summary.deepWorkPct}%`} label="Deep work" />
        <Metric value={String(summary.sessionsToday)} label="Sessions" />
        <Metric value={String(summary.tasksCompletedToday)} label="Tasks done" />
      </div>
      <BarChart data={summary.weekly} height={88} />
    </Card>
  );
});

/* ── Pending Tasks ─────────────────────────────────────────────────────────── */
const PRIORITY_TONE: Record<TaskPriority, 'pink' | 'orange' | 'neutral'> = {
  high: 'pink',
  medium: 'orange',
  low: 'neutral',
};

export const PendingTasksCard = memo(function PendingTasksCard({
  tasks,
}: {
  tasks: PendingTask[];
}): JSX.Element {
  const [done, setDone] = useState<Set<string>>(new Set());
  const remaining = tasks.filter((t) => !done.has(t.id)).length;

  const toggle = (id: string): void =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <CardHeader
        icon={<Icon name="checklist" size={16} />}
        title="Pending Tasks"
        tint="orange"
        action={<Badge tone="neutral">{remaining} open</Badge>}
      />
      {tasks.length === 0 ? (
        <EmptyState compact icon="checklist" title="All caught up" description="No pending tasks right now." />
      ) : (
        <div className="flex flex-col gap-0.5">
          {tasks.map((t) => {
            const app = getAppOrFallback(t.appId);
            const isDone = done.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className="flex items-start gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors fill-hover focus-visible:shadow-focus"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
                    isDone ? 'border-sysgreen bg-sysgreen text-white' : 'border-[var(--hairline-strong)]',
                  )}
                >
                  <AnimatePresence>
                    {isDone && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                        <Icon name="check" size={12} strokeWidth={2.4} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-base font-medium leading-snug transition-colors',
                      isDone ? 'text-faint line-through' : 'line-clamp-2',
                    )}
                  >
                    {t.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-faint">{app.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 pt-0.5">
                  <span className="text-xs text-faint">{t.due}</span>
                  <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
});

/* ── Recent Activity ───────────────────────────────────────────────────────── */
const ACTIVITY_ICON: Record<ActivityKind, IconName> = {
  opened: 'launch',
  completed: 'check',
  created: 'plus',
  connected: 'connectors',
  summarized: 'sparkles',
};

export const RecentActivityCard = memo(function RecentActivityCard({
  events,
}: {
  events: ActivityEvent[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader icon={<Icon name="clock" size={16} />} title="Recent Activity" tint="purple" />
      {events.length === 0 ? (
        <EmptyState compact icon="clock" title="Nothing yet" description="Your recent activity will show up here." />
      ) : (
        <div className="relative flex flex-col">
          <span className="absolute bottom-3 left-[15px] top-3 w-px [background:var(--hairline)]" />
          {events.map((e) => {
            const app = getAppOrFallback(e.appId);
            return (
              <div key={e.id} className="relative flex items-start gap-3 py-2">
                <span className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full surface-raised text-muted">
                  <Icon name={ACTIVITY_ICON[e.kind]} size={14} />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="line-clamp-2 text-base leading-snug">{e.title}</div>
                  <div className="mt-0.5 truncate text-xs text-faint">
                    {app.name} · {formatRelative(e.at)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
});

/* ── AI Recommendations ────────────────────────────────────────────────────── */
const REC_DOT: Record<string, string> = {
  accent: 'bg-accent',
  blue: 'bg-sysblue',
  green: 'bg-sysgreen',
  orange: 'bg-sysorange',
  purple: 'bg-syspurple',
  teal: 'bg-systeal',
  pink: 'bg-syspink',
};

export const RecommendationsCard = memo(function RecommendationsCard({
  items,
  onAction,
}: {
  items: Recommendation[];
  onAction: (rec: Recommendation) => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader icon={<Icon name="sparkles" size={16} />} title="AI Recommendations" tint="pink" />
      {items.length === 0 ? (
        <EmptyState compact icon="sparkles" title="No recommendations" description="Suggestions appear as you work." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((r) => (
            <div key={r.id} className="rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] p-3.5">
              <div className="flex items-start gap-2.5">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', REC_DOT[r.tone])} />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium leading-snug">{r.title}</div>
                  <div className="mt-1 text-xs leading-relaxed text-muted">{r.detail}</div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => onAction(r)}>
                  {r.action}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
});
