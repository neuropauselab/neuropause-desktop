/**
 * The Cloud Platform Center (P6) — the infrastructure sibling of the Connector Center. A tabbed hub
 * (Overview / Platforms / Resource Graph / Discovery) over `ipc.infra`, rendering with the existing design
 * system (`Stat`, `StatusBadge`, `SegmentedTabs`, `Card`, `Icon`) and the pure `infrastructureCenterModel`.
 * Business SaaS lives in the Connector Center; infrastructure (cloud platforms, resources, topology) lives
 * here. Discovery adapters land in P6.1 — until then platforms show as "Not configured".
 */
import { useMemo, useState } from 'react';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Card, CardHeader } from '@renderer/components/ui/Card';
import { SegmentedTabs, type SegmentedTabItem } from '@renderer/components/ui/pillTabs';
import { Stat, StatusBadge } from '@renderer/operations/primitives';
import type { OpsTone } from '@renderer/operations/lib';
import type { CloudPlatformDto } from '@neuropause/shared';
import { INFRASTRUCTURE_DOMAIN_CATALOG } from '@neuropause/shared';
import { InfrastructureProvider, useInfrastructure } from './InfrastructureProvider';
import {
  platformStatusMeta,
  filterPlatforms,
  presentProviders,
  cloudOverviewMetrics,
  summarizeResourceGraph,
  type CenterTone,
} from './infrastructureCenterModel';

type CenterTab = 'overview' | 'platforms' | 'graph' | 'discovery';
const TABS: SegmentedTabItem<CenterTab>[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  { id: 'platforms', label: 'Platforms', icon: 'server' },
  { id: 'graph', label: 'Resource Graph', icon: 'layers' },
  { id: 'discovery', label: 'Discovery', icon: 'pulse' },
];

/** CenterTone is a subset of OpsTone, so it feeds the design-system primitives directly. */
const tone = (t: CenterTone): OpsTone => t;

export function CloudPlatformCenterRoot(): JSX.Element {
  return (
    <InfrastructureProvider>
      <CloudPlatformCenter />
    </InfrastructureProvider>
  );
}

function CloudPlatformCenter(): JSX.Element {
  const { ready, platforms, stats, resourceGraph, refresh } = useInfrastructure();
  const [tab, setTab] = useState<CenterTab>('overview');
  const [query, setQuery] = useState('');

  const metrics = stats ? cloudOverviewMetrics(stats) : null;
  const filtered = useMemo(() => filterPlatforms(platforms, { query, provider: 'all' }), [platforms, query]);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cloud Platform Center</h1>
          <p className="text-sm text-[var(--np-text-muted)]">
            Infrastructure control plane — discover cloud platforms, resources, and topology.
          </p>
        </div>
        <button type="button" className="np-btn np-btn--ghost" onClick={() => void refresh()}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </header>

      <SegmentedTabs items={TABS} activeId={tab} onChange={setTab} ariaLabel="Cloud Platform Center" />

      {!ready ? (
        <div className="text-sm text-[var(--np-text-muted)]">Loading infrastructure…</div>
      ) : tab === 'overview' ? (
        <OverviewTab metrics={metrics} platforms={platforms} resourceGraph={resourceGraph} />
      ) : tab === 'platforms' ? (
        <PlatformsTab platforms={filtered} query={query} setQuery={setQuery} />
      ) : tab === 'graph' ? (
        <ResourceGraphTab resourceGraph={resourceGraph} />
      ) : (
        <DiscoveryTab platforms={platforms} />
      )}
    </div>
  );
}

function OverviewTab({
  metrics,
  platforms,
  resourceGraph,
}: {
  metrics: ReturnType<typeof cloudOverviewMetrics> | null;
  platforms: CloudPlatformDto[];
  resourceGraph: ReturnType<typeof useInfrastructure>['resourceGraph'];
}): JSX.Element {
  const graph = resourceGraph ? summarizeResourceGraph(resourceGraph) : null;
  return (
    <div className="flex flex-col gap-4 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon="server" label="Platforms" value={metrics?.platforms ?? 0} tone="accent" />
        <Stat icon="database" label="Resources" value={metrics?.resources ?? 0} tone="blue" />
        <Stat icon="layers" label="Domains" value={metrics?.domains ?? 0} tone="gray" />
        <Stat icon="pulse" label="Accounts" value={metrics?.accounts ?? 0} tone="gray" />
        <Stat icon="shield" label="Configured" value={metrics?.configured ?? 0} tone="green" />
        <Stat icon="activity" label="Discovering" value={metrics?.discovering ?? 0} tone="blue" />
        <Stat icon="gauge" label="Degraded" value={metrics?.degraded ?? 0} tone={(metrics?.degraded ?? 0) > 0 ? 'orange' : 'green'} />
        <Stat icon="cpu" label="Critical resources" value={graph?.critical ?? 0} tone={(graph?.critical ?? 0) > 0 ? 'red' : 'green'} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => (
          <PlatformCard key={p.id} platform={p} />
        ))}
      </div>
    </div>
  );
}

function PlatformsTab({ platforms, query, setQuery }: { platforms: CloudPlatformDto[]; query: string; setQuery: (q: string) => void }): JSX.Element {
  return (
    <div className="flex flex-col gap-3 overflow-auto">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search platforms, providers, domains…"
        className="np-input w-full max-w-md"
      />
      <div className="text-xs text-[var(--np-text-muted)]">{presentProviders(platforms).length} providers · {platforms.length} platforms</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => (
          <PlatformCard key={p.id} platform={p} detailed />
        ))}
      </div>
    </div>
  );
}

function PlatformCard({ platform, detailed = false }: { platform: CloudPlatformDto; detailed?: boolean }): JSX.Element {
  const meta = platformStatusMeta(platform.status, platform.health);
  return (
    <Card variant="hairline">
      <CardHeader
        icon={<Icon name="server" size={16} />}
        title={platform.name}
        action={<StatusBadge tone={tone(meta.tone)} label={meta.label} />}
      />
      <div className="flex flex-col gap-2 p-3 pt-0">
        <p className="text-xs text-[var(--np-text-muted)]">{platform.description}</p>
        <div className="flex flex-wrap gap-1">
          {platform.domains.map((d) => (
            <span key={d} className="np-chip np-chip--sm" title={INFRASTRUCTURE_DOMAIN_CATALOG[d]?.description}>
              <Icon name={(INFRASTRUCTURE_DOMAIN_CATALOG[d]?.icon ?? 'server') as IconName} size={12} />
              {INFRASTRUCTURE_DOMAIN_CATALOG[d]?.label ?? d}
            </span>
          ))}
        </div>
        {detailed && (
          <div className="mt-1 flex items-center gap-3 text-xs text-[var(--np-text-muted)]">
            <span>{platform.accountNoun}s: {platform.accounts.length}</span>
            <span>Resources: {platform.resourceCount}</span>
            <span>Auth: {platform.authKind}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function ResourceGraphTab({ resourceGraph }: { resourceGraph: ReturnType<typeof useInfrastructure>['resourceGraph'] }): JSX.Element {
  const summary = resourceGraph ? summarizeResourceGraph(resourceGraph) : null;
  if (!summary || summary.resources === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-[var(--np-text-muted)]">
        <Icon name="layers" size={28} />
        <p>No resources discovered yet.</p>
        <p className="text-xs">Connect a cloud platform and run discovery — resources and their relationships appear here and in the Enterprise Graph.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon="database" label="Resources" value={summary.resources} tone="blue" />
        <Stat icon="layers" label="Relationships" value={summary.edges} tone="gray" />
        <Stat icon="cpu" label="Critical" value={summary.critical} tone={summary.critical > 0 ? 'red' : 'green'} />
        <Stat icon="gauge" label="Orphaned" value={summary.orphaned} tone={summary.orphaned > 0 ? 'orange' : 'green'} />
      </div>
      <Card variant="hairline">
        <CardHeader icon={<Icon name="layers" size={16} />} title="Top blast radius" />
        <div className="flex flex-col divide-y divide-[var(--np-border)]">
          {summary.topBlastRadius.length === 0 ? (
            <div className="p-3 text-xs text-[var(--np-text-muted)]">No dependency edges yet.</div>
          ) : (
            summary.topBlastRadius.map((r) => (
              <div key={r.resourceId} className="flex items-center justify-between p-3 text-sm">
                <span className="flex items-center gap-2">
                  <Icon name="server" size={14} />
                  {r.name} <span className="text-xs text-[var(--np-text-muted)]">({r.resourceType})</span>
                </span>
                <StatusBadge tone={r.blastRadius > 5 ? 'red' : 'orange'} label={`${r.blastRadius} dependents`} />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function DiscoveryTab({ platforms }: { platforms: CloudPlatformDto[] }): JSX.Element {
  const { discover } = useInfrastructure();
  return (
    <div className="flex flex-col gap-3 overflow-auto">
      <p className="text-sm text-[var(--np-text-muted)]">
        Discovery runs incrementally on the shared connector runtime (workers, scheduling, retry, rate-gating).
        Registering a discovery adapter and credentials for a platform lands in P6.1.
      </p>
      <div className="flex flex-col divide-y divide-[var(--np-border)]">
        {platforms.map((p) => {
          const meta = platformStatusMeta(p.status, p.health);
          return (
            <div key={p.id} className="flex items-center justify-between p-3">
              <span className="flex items-center gap-2 text-sm">
                <Icon name="server" size={16} /> {p.name}
                <StatusBadge tone={tone(meta.tone)} label={meta.label} />
              </span>
              <button
                type="button"
                className="np-btn np-btn--ghost np-btn--sm"
                disabled={!p.configured}
                title={p.configured ? 'Run discovery' : 'Not configured (P6.1)'}
                onClick={() => void discover(p.id)}
              >
                <Icon name="refresh" size={12} /> Discover
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
