/**
 * Developer Dashboard — the portal home. Account + organization, the active plan,
 * headline API/marketplace metrics, a 30-day request trend, and the recent
 * submission-pipeline activity. Reads everything from the live provider.
 */
import { OpsPanel, Stat, StatusBadge } from '@renderer/operations/primitives';
import { Icon } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { cn } from '@renderer/lib/cn';
import { useDeveloper } from './DeveloperProvider';
import { DOT_BG, formatNum, formatPct, planMeta, relativeTime, type DeveloperTab } from './lib';

export function DeveloperDashboardPanel({ onNavigate }: { onNavigate: (tab: DeveloperTab) => void }): JSX.Element {
  const { dashboard, analytics, events } = useDeveloper();

  if (!dashboard) {
    return <EmptyState icon="code" title="Loading developer portal…" description="Fetching your account, keys, and marketplace state." compact />;
  }

  const { developer, plan } = dashboard;
  const pm = planMeta(developer.planTier);
  const maxDay = Math.max(1, ...(analytics?.byDay.map((d) => d.requests) ?? [0]));

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="surface-raised rounded-2xl p-5 shadow-card lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-faint">Developer account</div>
              <div className="mt-1 text-lg font-semibold tracking-tight">{developer.name}</div>
              <div className="text-sm text-muted">{developer.email}</div>
              <div className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Icon name="grid" size={14} />
                {developer.organization}
              </div>
            </div>
            <StatusBadge tone={pm.tone} label={`${pm.label} plan`} />
          </div>
        </div>

        <div className="surface-raised rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-faint">Current plan</div>
            <Button size="sm" variant="ghost" icon="arrow-right" onClick={() => onNavigate('billing')}>
              Manage
            </Button>
          </div>
          <div className="mt-1 text-lg font-semibold tracking-tight">{plan.name}</div>
          <div className="text-sm text-muted">
            {plan.priceMonthly === 0 ? 'No monthly fee' : `$${plan.priceMonthly}/mo`}
          </div>
          <dl className="mt-3 space-y-1 text-xs text-muted">
            <div className="flex justify-between">
              <dt className="text-faint">Included requests</dt>
              <dd>{formatNum(plan.includedRequests)}/mo</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">Rate limit</dt>
              <dd>{plan.rateLimit.max}/min</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">Seats</dt>
              <dd>{plan.seats < 0 ? 'Unlimited' : plan.seats}</dd>
            </div>
          </dl>
        </div>
      </div>

      <OpsPanel title="Overview" subtitle="Last 30 days of API and marketplace activity">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <Stat icon="globe" label="API requests" value={formatNum(dashboard.requests30d)} tone="blue" />
          <Stat icon="pulse" label="Error rate" value={formatPct(dashboard.errorRate30d)} tone={dashboard.errorRate30d > 0.05 ? 'red' : 'green'} />
          <Stat icon="lock" label="API keys" value={dashboard.apiKeyCount} tone="purple" hint={`${dashboard.oauthAppCount} OAuth app(s)`} />
          <Stat icon="store" label="Listings" value={dashboard.listingCount} tone="accent" />
          <Stat icon="verified" label="Published" value={dashboard.publishedCount} tone="green" />
          <Stat icon="clock" label="In review" value={dashboard.pendingReviewCount} tone={dashboard.pendingReviewCount > 0 ? 'orange' : 'gray'} />
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Request trend" subtitle={analytics ? `p95 ${analytics.p95LatencyMs}ms · ${formatNum(analytics.computeUnits)} compute units` : undefined}>
          {analytics && analytics.totalRequests > 0 ? (
            <div className="surface-raised rounded-2xl p-4 shadow-card">
              <div className="flex h-28 items-end gap-0.5">
                {analytics.byDay.map((d) => (
                  <div key={d.date} className="group flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.requests} req, ${d.errors} err`}>
                    <div className="w-full overflow-hidden rounded-sm" style={{ height: `${(d.requests / maxDay) * 100}%`, minHeight: d.requests > 0 ? 2 : 0 }}>
                      <div className={cn('h-full w-full', d.errors > 0 ? DOT_BG.orange : DOT_BG.blue)} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-2xs text-faint">
                <span>{analytics.byDay[0]?.date.slice(5)}</span>
                <span>{analytics.byDay[analytics.byDay.length - 1]?.date.slice(5)}</span>
              </div>
            </div>
          ) : (
            <EmptyState icon="pulse" title="No requests yet" description="Send a request through the API gateway to see traffic here." compact />
          )}
        </OpsPanel>

        <OpsPanel title="Recent activity" subtitle="Marketplace submission pipeline">
          {events.length === 0 ? (
            <EmptyState icon="clipboard" title="No activity yet" description="Submit a listing version to populate the pipeline log." compact />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl shadow-card">
              {events.slice(0, 7).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon name="dot" size={14} className="text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{e.detail}</div>
                    <div className="text-2xs text-faint">
                      {e.action} · {e.actor} · {relativeTime(e.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}
