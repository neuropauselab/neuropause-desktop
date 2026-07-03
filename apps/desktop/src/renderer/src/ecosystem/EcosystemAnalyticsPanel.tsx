/**
 * Ecosystem Analytics. The network-wide rollup: marketplace growth, downloads,
 * revenue, active developers and organizations, usage, top listings, the kind
 * mix, and an ecosystem health score built from four signals.
 */
import { OpsPanel, Stat, StatusDot } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon } from '@renderer/components/ui/Icon';
import { cn } from '@renderer/lib/cn';
import { useEcosystem } from './EcosystemProvider';
import { DOT_BG, formatMoney, formatMs, formatNum, healthStatusTone, kindMeta, TEXT_TONE } from './lib';

export function EcosystemAnalyticsPanel(): JSX.Element {
  const { analytics } = useEcosystem();

  if (!analytics) {
    return <EmptyState icon="analytics" title="Computing ecosystem analytics…" compact />;
  }

  const maxGrowth = Math.max(1, ...analytics.growth.map((g) => g.listings));
  const maxInstalls = Math.max(...analytics.topListings.map((t) => t.installs), 1);
  const healthTone = analytics.health.score >= 80 ? 'green' : analytics.health.score >= 55 ? 'orange' : 'red';

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="surface-raised rounded-2xl p-5 shadow-card">
          <div className="text-xs font-medium text-faint">Ecosystem health</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cn('text-4xl font-semibold tracking-tight', TEXT_TONE[healthTone])}>{analytics.health.score}</span>
            <span className="text-sm text-muted">/ 100 · {analytics.health.label}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {analytics.health.signals.map((s) => (
              <li key={s.label} className="flex items-start gap-2">
                <StatusDot tone={healthStatusTone(s.status)} />
                <div className="min-w-0">
                  <div className="text-xs font-medium">{s.label}</div>
                  <div className="text-2xs text-faint">{s.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="surface-raised rounded-2xl p-5 shadow-card">
          <div className="text-xs font-medium text-faint">Revenue (marketplace)</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{formatMoney(analytics.revenue.gross, analytics.revenue.currency)}</div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-faint">Platform fees</dt><dd className="font-medium">{formatMoney(analytics.revenue.platformFees, analytics.revenue.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-faint">Net to developers</dt><dd className="font-medium">{formatMoney(analytics.revenue.net, analytics.revenue.currency)}</dd></div>
          </dl>
          <div className="mt-3 border-t border-[var(--hairline)] pt-2 text-2xs text-faint">{formatNum(analytics.downloads30d)} downloads in the last 30 days</div>
        </div>

        <div className="surface-raised rounded-2xl p-5 shadow-card">
          <div className="text-xs font-medium text-faint">API usage (30 days)</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{formatNum(analytics.usage.requests30d)}</div>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between"><dt className="text-faint">Compute units</dt><dd className="font-medium">{formatNum(analytics.usage.computeUnits30d)}</dd></div>
            <div className="flex justify-between"><dt className="text-faint">p95 latency</dt><dd className="font-medium">{formatMs(analytics.usage.p95LatencyMs)}</dd></div>
          </dl>
        </div>
      </div>

      <OpsPanel title="Network" subtitle="The ecosystem at a glance">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7">
          <Stat icon="store" label="Listings" value={analytics.totalListings} tone="accent" />
          <Stat icon="verified" label="Published" value={analytics.publishedListings} tone="green" />
          <Stat icon="shield" label="Certified" value={analytics.certifiedListings} tone="blue" />
          <Stat icon="download" label="Installs" value={formatNum(analytics.totalInstalls)} tone="purple" />
          <Stat icon="code" label="Developers" value={analytics.activeDevelopers} tone="orange" />
          <Stat icon="grid" label="Organizations" value={analytics.activeOrganizations} tone="accent" />
          <Stat icon="package" label="Packs" value={analytics.packs} tone="green" />
        </div>
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OpsPanel title="Marketplace growth" subtitle="Cumulative listings over the last 6 months">
          <div className="surface-raised rounded-2xl p-4 shadow-card">
            <div className="flex h-36 items-end gap-2">
              {analytics.growth.map((g) => (
                <div key={g.period} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${g.period}: ${g.listings} listings, ${g.installs} installs`}>
                  <span className="text-2xs font-medium text-muted">{g.listings}</span>
                  <div className="w-full overflow-hidden rounded-t-md" style={{ height: `${(g.listings / maxGrowth) * 100}%`, minHeight: 4 }}>
                    <div className={cn('h-full w-full', DOT_BG.accent)} />
                  </div>
                  <span className="text-2xs text-faint">{g.period.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        </OpsPanel>

        <OpsPanel title="Top listings" subtitle="By installs">
          {analytics.topListings.length === 0 ? (
            <EmptyState icon="store" title="No listings yet" compact />
          ) : (
            <div className="surface-raised divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl shadow-card">
              {analytics.topListings.map((t) => {
                const km = kindMeta(t.kind as Parameters<typeof kindMeta>[0]);
                return (
                  <div key={t.name} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg [background:var(--fill-2)]', TEXT_TONE[km.tone])}><Icon name={km.icon} size={14} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.name}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full [background:var(--fill-2)]">
                        <div className={cn('h-full rounded-full', DOT_BG.accent)} style={{ width: `${(t.installs / maxInstalls) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">{formatNum(t.installs)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </OpsPanel>
      </div>

      <OpsPanel title="Listing mix" subtitle="By kind">
        <div className="flex flex-wrap gap-2">
          {Object.entries(analytics.byKind).map(([k, n]) => {
            const km = kindMeta(k as Parameters<typeof kindMeta>[0]);
            return (
              <div key={k} className="surface-raised inline-flex items-center gap-2 rounded-xl px-3 py-2 shadow-card">
                <span className={cn(TEXT_TONE[km.tone])}><Icon name={km.icon} size={15} /></span>
                <span className="text-sm font-medium">{km.label}</span>
                <span className="rounded [background:var(--fill-2)] px-1.5 text-xs text-muted">{n}</span>
              </div>
            );
          })}
        </div>
      </OpsPanel>
    </div>
  );
}
