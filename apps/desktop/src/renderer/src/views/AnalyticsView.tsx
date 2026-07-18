import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { Badge } from '@renderer/components/ui/controls';
import { Icon } from '@renderer/components/ui/Icon';
import { BarChart } from '@renderer/components/ui/BarChart';
import { AppGlyph } from '@renderer/components/ui/AppGlyph';
import { formatDuration } from '@renderer/lib/format';
import { getAppOrFallback } from '@renderer/data/catalog';
import { useDashboard } from '@renderer/state/DashboardProvider';

function Stat({ value, label, tint }: { value: string; label: string; tint: string }): JSX.Element {
  return (
    <Card>
      <div className={`mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg ${tint}`}>
        <Icon name="activity" size={15} />
      </div>
      <div className="tabular text-2xl font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-sm text-faint">{label}</div>
    </Card>
  );
}

export function AnalyticsView(): JSX.Element {
  const { data } = useDashboard();
  if (!data) {
    return (
      <ViewScroll>
        <ViewHeader title="Analytics" />
        <div className="surface-raised h-64 animate-pulse rounded-2xl" />
      </ViewScroll>
    );
  }

  const { productivity, connectedApps } = data;
  const maxSessions = Math.max(1, ...connectedApps.map((a) => a.sessionsToday));

  return (
    <ViewScroll max={1100}>
      <ViewHeader
        title="Analytics"
        subtitle="A snapshot of your focus and activity. The full analytics suite arrives in Phase 6."
        right={<Badge tone="accent">Phase 6 preview</Badge>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat value={formatDuration(productivity.focusMinutesToday)} label="Focus today" tint="bg-accent/15 text-accent" />
        <Stat value={`${productivity.deepWorkPct}%`} label="Deep work" tint="bg-sysgreen/15 text-sysgreen" />
        <Stat value={String(productivity.sessionsToday)} label="Sessions" tint="bg-sysblue/15 text-sysblue" />
        <Stat value={String(productivity.tasksCompletedToday)} label="Tasks done" tint="bg-sysorange/15 text-sysorange" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Icon name="analytics" size={16} />} title="Focus this week" tint="accent" />
          <BarChart data={productivity.weekly} height={180} />
        </Card>

        <Card>
          <CardHeader icon={<Icon name="grid" size={16} />} title="Sessions by app today" tint="purple" />
          <div className="flex flex-col gap-3">
            {connectedApps
              .slice()
              .sort((a, b) => b.sessionsToday - a.sessionsToday)
              .map((c) => {
                const app = getAppOrFallback(c.appId);
                return (
                  <div key={c.appId} className="flex items-center gap-3">
                    <AppGlyph glyph={app.glyph} tone={app.tone} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="truncate text-sm font-medium">{app.name}</span>
                        <span className="tabular text-xs text-faint">{c.sessionsToday}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full [background:var(--fill-1)]">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-500 ease-emphasized"
                          style={{ width: `${(c.sessionsToday / maxSessions) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      </div>
    </ViewScroll>
  );
}
